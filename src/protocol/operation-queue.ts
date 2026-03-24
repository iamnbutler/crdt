import type {
  DeleteOperation,
  InsertOperation,
  Operation,
  OperationId,
  ReplicaId,
  VersionVector,
} from "../text/types.js";
import { MAX_QUEUE_SIZE } from "./types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Callback to check if a fragment exists by insertion ID. */
export type FragmentExistsCallback = (insertionId: OperationId) => boolean;

/** Callback invoked when an operation is ready to apply. */
export type ApplyOperationCallback = (operation: Operation) => void;

/** Result of trying to enqueue an operation. */
export interface EnqueueResult {
  /** Whether the operation was accepted (not a duplicate). */
  readonly accepted: boolean;
  /** Whether the operation was immediately ready (applied synchronously). */
  readonly ready: boolean;
  /** Whether the queue has overflowed and needs full sync. */
  readonly overflow: boolean;
}

/** Statistics about the operation queue state. */
export interface QueueStats {
  /** Total number of pending operations. */
  readonly pendingCount: number;
  /** Number of replicas with deferred operations. */
  readonly deferredReplicaCount: number;
  /** Set of replica IDs with deferred operations. */
  readonly deferredReplicas: ReadonlySet<ReplicaId>;
  /** Maximum queue size before overflow. */
  readonly maxSize: number;
  /** Whether the queue has overflowed. */
  readonly overflowed: boolean;
}

// ---------------------------------------------------------------------------
// OperationQueue
// ---------------------------------------------------------------------------

/**
 * Queue for managing deferred operations awaiting causal dependencies.
 */
export class OperationQueue {
  private readonly maxSize: number;
  private pending: Operation[];
  private appliedOps: Set<string>;
  private _deferredReplicas: Set<ReplicaId>;
  private _overflowed: boolean;

  /** Per-replica tracking of highest seen counter. */
  private replicaCounters: Map<ReplicaId, number>;

  constructor(maxSize = MAX_QUEUE_SIZE) {
    this.maxSize = maxSize;
    this.pending = [];
    this.appliedOps = new Set();
    this._deferredReplicas = new Set();
    this._overflowed = false;
    this.replicaCounters = new Map();
  }

  /**
   * Check if an operation has already been applied.
   */
  hasApplied(operation: Operation): boolean {
    return this.appliedOps.has(this.opKey(operation.id));
  }

  /**
   * Mark an operation as applied (for idempotency).
   */
  markApplied(operation: Operation): void {
    this.appliedOps.add(this.opKey(operation.id));

    // Track highest counter per replica
    const current = this.replicaCounters.get(operation.id.replicaId) ?? -1;
    if (operation.id.counter > current) {
      this.replicaCounters.set(operation.id.replicaId, operation.id.counter);
    }
  }

  /**
   * Enqueue an operation. Returns whether it was accepted and/or ready.
   *
   * @param operation The operation to enqueue
   * @param fragmentExists Callback to check if referenced fragments exist
   * @param apply Callback to apply the operation when ready
   * @param localVersion Current local version vector
   */
  enqueue(
    operation: Operation,
    fragmentExists: FragmentExistsCallback,
    apply: ApplyOperationCallback,
    localVersion: VersionVector,
  ): EnqueueResult {
    // Idempotency: skip already-applied operations
    if (this.hasApplied(operation)) {
      return { accepted: false, ready: false, overflow: false };
    }

    // Check if ready
    if (this.isReady(operation, fragmentExists, localVersion)) {
      this.applyAndFlush(operation, fragmentExists, apply, localVersion);
      return { accepted: true, ready: true, overflow: false };
    }

    // Overflow check
    if (this.pending.length >= this.maxSize) {
      this._overflowed = true;
      return { accepted: false, ready: false, overflow: true };
    }

    // Defer the operation
    this.pending.push(operation);
    this._deferredReplicas.add(operation.id.replicaId);

    return { accepted: true, ready: false, overflow: false };
  }

  /**
   * Apply an operation and flush any pending operations that become ready.
   */
  private applyAndFlush(
    operation: Operation,
    fragmentExists: FragmentExistsCallback,
    apply: ApplyOperationCallback,
    localVersion: VersionVector,
  ): void {
    // Apply the initial operation
    this.markApplied(operation);
    apply(operation);

    // Iterative flush loop
    let madeProgress = true;
    while (madeProgress && this.pending.length > 0) {
      madeProgress = false;
      const stillPending: Operation[] = [];

      for (const pendingOp of this.pending) {
        // Skip already applied (shouldn't happen, but defensive)
        if (this.hasApplied(pendingOp)) {
          continue;
        }

        if (this.isReady(pendingOp, fragmentExists, localVersion)) {
          this.markApplied(pendingOp);
          apply(pendingOp);
          madeProgress = true;
        } else {
          stillPending.push(pendingOp);
        }
      }

      this.pending = stillPending;
    }

    // Update deferred replicas set
    this.updateDeferredReplicas();
  }

  /**
   * Force flush: try to apply all pending operations.
   * Called after receiving a state snapshot.
   */
  flush(
    fragmentExists: FragmentExistsCallback,
    apply: ApplyOperationCallback,
    localVersion: VersionVector,
  ): number {
    let applied = 0;
    let madeProgress = true;

    while (madeProgress && this.pending.length > 0) {
      madeProgress = false;
      const stillPending: Operation[] = [];

      for (const pendingOp of this.pending) {
        if (this.hasApplied(pendingOp)) {
          continue;
        }

        if (this.isReady(pendingOp, fragmentExists, localVersion)) {
          this.markApplied(pendingOp);
          apply(pendingOp);
          applied++;
          madeProgress = true;
        } else {
          stillPending.push(pendingOp);
        }
      }

      this.pending = stillPending;
    }

    this.updateDeferredReplicas();
    return applied;
  }

  /**
   * Check if an operation is causally ready.
   */
  private isReady(
    operation: Operation,
    fragmentExists: FragmentExistsCallback,
    _localVersion: VersionVector,
  ): boolean {
    switch (operation.type) {
      case "insert":
        return this.isInsertReady(operation, fragmentExists);
      case "delete":
        return this.isDeleteReady(operation, fragmentExists);
      case "undo":
        // Undo operations are always ready (undo counts merge via max-wins)
        return true;
    }
  }

  /**
   * Check if an insert operation's after/before fragments exist.
   */
  private isInsertReady(op: InsertOperation, fragmentExists: FragmentExistsCallback): boolean {
    const MIN_REPLICA = 0;
    const MAX_REPLICA = 0xffffffff;

    // Check after reference (unless it's MIN sentinel)
    if (!(op.after.insertionId.replicaId === MIN_REPLICA && op.after.insertionId.counter === 0)) {
      if (!fragmentExists(op.after.insertionId)) {
        return false;
      }
    }

    // Check before reference (unless it's MAX sentinel)
    if (
      !(
        op.before.insertionId.replicaId === MAX_REPLICA &&
        op.before.insertionId.counter === 0xffffffff
      )
    ) {
      if (!fragmentExists(op.before.insertionId)) {
        return false;
      }
    }

    return true;
  }

  /**
   * Check if a delete operation's target fragments exist.
   */
  private isDeleteReady(op: DeleteOperation, fragmentExists: FragmentExistsCallback): boolean {
    for (const range of op.ranges) {
      if (!fragmentExists(range.insertionId)) {
        return false;
      }
    }
    return true;
  }

  /**
   * Update the set of replicas with deferred operations.
   */
  private updateDeferredReplicas(): void {
    this._deferredReplicas.clear();
    for (const op of this.pending) {
      this._deferredReplicas.add(op.id.replicaId);
    }
  }

  /**
   * Generate a unique key for an operation.
   */
  private opKey(id: OperationId): string {
    return `${id.replicaId}:${id.counter}`;
  }

  /**
   * Get queue statistics.
   */
  get stats(): QueueStats {
    return {
      pendingCount: this.pending.length,
      deferredReplicaCount: this._deferredReplicas.size,
      deferredReplicas: new Set(this._deferredReplicas),
      maxSize: this.maxSize,
      overflowed: this._overflowed,
    };
  }

  /**
   * Get the set of replicas with deferred operations.
   */
  get deferredReplicas(): ReadonlySet<ReplicaId> {
    return this._deferredReplicas;
  }

  /**
   * Whether the queue has overflowed.
   */
  get overflowed(): boolean {
    return this._overflowed;
  }

  /**
   * Reset overflow state after full sync.
   */
  resetOverflow(): void {
    this._overflowed = false;
  }

  /**
   * Clear all pending operations (after full sync).
   */
  clear(): void {
    this.pending = [];
    this._deferredReplicas.clear();
    this._overflowed = false;
    // Note: we keep appliedOps for idempotency
  }

  /**
   * Get the number of pending operations.
   */
  get pendingCount(): number {
    return this.pending.length;
  }

  /**
   * Get all pending operations (for debugging/serialization).
   */
  getPending(): ReadonlyArray<Operation> {
    return this.pending;
  }

  /**
   * Get the highest counter seen for a replica.
   */
  getHighestCounter(replicaId: ReplicaId): number {
    return this.replicaCounters.get(replicaId) ?? -1;
  }
}
