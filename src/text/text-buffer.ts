/**
 * TextBuffer: The main CRDT text buffer class.
 *
 * Stores text as a sequence of Fragments in a SumTree, with each fragment
 * carrying metadata about which operation created it, which operations deleted
 * it, and whether it's currently visible.
 *
 * Single-replica editing (insert, delete, undo, redo) is fully supported.
 * Multi-replica collaboration (applyRemote) is supported for basic convergence.
 */

import type { Epoch } from "../arena/index.js";
import { type NodeId, SumTree } from "../sum-tree/index.js";
import {
  LamportClock,
  cloneVersionVector,
  createVersionVector,
  generateReplicaId,
  mergeVersionVectors,
  observeVersion,
} from "./clock.js";
import {
  createFragment,
  deleteFragment,
  fragmentSummaryOps,
  splitFragment,
  visibleLenDimension,
  withVisibility,
} from "./fragment.js";
import { MAX_LOCATOR, MIN_LOCATOR, compareLocators, locatorBetween } from "./locator.js";
import {
  SERIALIZATION_VERSION,
  type SerializedSnapshot,
  decodeBinary,
  decodeJSON,
  deserializeLocator,
  deserializeOperationId,
  deserializeTransactionId,
  deserializeVersionVector,
  encodeBinary,
  encodeJSON,
  serializeFragment,
  serializeOperationId,
  serializeVersionVector,
} from "./serialization.js";
import { type SnapshotOptions, TextBufferSnapshot } from "./snapshot.js";
import type {
  DeleteOperation,
  Fragment,
  FragmentSummary,
  InsertOperation,
  Locator,
  Operation,
  OperationId,
  ReplicaId,
  TransactionId,
  UndoOperation,
  VersionVector,
} from "./types.js";
import {
  MAX_OPERATION_ID,
  MIN_OPERATION_ID,
  compareOperationIds,
  operationIdsEqual,
  replicaId,
  transactionId,
} from "./types.js";
import { UndoMap } from "./undo-map.js";

// ---------------------------------------------------------------------------
// Fragment sorting for canonical order
// ---------------------------------------------------------------------------

/**
 * Compare locators for fragment sorting using full lexicographic comparison.
 *
 * When one locator is a prefix of another, the shorter one sorts FIRST.
 * This is correct because child locators (e.g., [L, X]) represent positions
 * INSIDE the parent's original span - they should come after the parent's
 * left portion and before concurrent siblings that sort later.
 *
 * Operation ID tie-breaking only applies when locators are EXACTLY equal,
 * which happens with concurrent inserts at the same position.
 */
function compareLocatorsForSort(a: Locator, b: Locator): number {
  return compareLocators(a, b);
}

/**
 * Sort fragments to ensure canonical order regardless of operation application
 * sequence.
 *
 * Sort key: (locator prefix, insertionId, insertionOffset, locator length)
 *
 * This ensures:
 * 1. Fragments at the same position (locator prefix) sort by operation ID
 * 2. Split parts of the same operation sort by offset
 * 3. Child locators sort after parent locators with lower operation IDs
 */
function sortFragments(frags: Fragment[]): void {
  frags.sort((a, b) => {
    // First, compare by locator prefix
    const locCmp = compareLocatorsForSort(a.locator, b.locator);
    if (locCmp !== 0) return locCmp;

    // Same prefix: tie-break by operation ID
    const idCmp = compareOperationIds(a.insertionId, b.insertionId);
    if (idCmp !== 0) return idCmp;

    // Same operation: sort by insertionOffset (split parts)
    const offsetCmp = a.insertionOffset - b.insertionOffset;
    if (offsetCmp !== 0) return offsetCmp;

    // Finally, sort by locator length (children after parent)
    return a.locator.levels.length - b.locator.levels.length;
  });
}

// ---------------------------------------------------------------------------
// Transaction tracking
// ---------------------------------------------------------------------------

interface Transaction {
  id: TransactionId;
  operationIds: OperationId[];
  timestamp: number;
}

interface UndoEntry {
  transactionId: TransactionId;
  operationIds: OperationId[];
  /** The undo counts that were set. Needed for redo. */
  undoCounts: Array<{ operationId: OperationId; oldCount: number; newCount: number }>;
}

// ---------------------------------------------------------------------------
// TextBuffer
// ---------------------------------------------------------------------------

export class TextBuffer {
  private _replicaId: ReplicaId;
  private clock: LamportClock;
  private fragments: SumTree<Fragment, FragmentSummary>;
  private undoMap: UndoMap;
  private _version: VersionVector;

  // Transaction tracking
  private nextTransactionId: number;
  private activeTransaction: Transaction | null;
  private transactionHistory: Transaction[];

  // Time-based transaction grouping
  private groupDelay: number;
  private implicitTransaction: Transaction | null;
  private lastEditType: "insert" | "delete" | null;

  // Undo/Redo stacks
  private undoStack: UndoEntry[];
  private redoStack: UndoEntry[];

  // Track applied remote operation IDs for idempotency (replicaId -> Set<counter>)
  private appliedOps: Map<ReplicaId, Set<number>>;

  // Index of all insertionIds in the fragment tree for O(1) hasFragment checks
  private _fragmentIds: Map<ReplicaId, Set<number>>;

  // Pending operations waiting for their causal dependencies
  private pendingOps: Operation[];

  /** Injectable time source for testing. */
  private _now: () => number;

  // Snapshot tracking for epoch-based reclamation
  private _liveSnapshots: number;

  private constructor(rid: ReplicaId) {
    this._replicaId = rid;
    this.clock = new LamportClock(rid);
    this.fragments = new SumTree<Fragment, FragmentSummary>(fragmentSummaryOps);
    this.undoMap = new UndoMap();
    this._version = createVersionVector();
    this.nextTransactionId = 0;
    this.activeTransaction = null;
    this.transactionHistory = [];
    this.groupDelay = 300;
    this.implicitTransaction = null;
    this.lastEditType = null;
    this.undoStack = [];
    this.redoStack = [];
    this.appliedOps = new Map();
    this._fragmentIds = new Map();
    this.pendingOps = [];
    this._now = Date.now;
    this._liveSnapshots = 0;
  }

  /**
   * Create an empty TextBuffer.
   */
  static create(rid?: ReplicaId): TextBuffer {
    const r = rid ?? generateReplicaId();
    return new TextBuffer(r);
  }

  /**
   * Create a TextBuffer initialized with the given text.
   * Uses a fast path that bypasses most CRDT infrastructure for initial content.
   */
  static fromString(text: string, rid?: ReplicaId): TextBuffer {
    const buffer = TextBuffer.create(rid);
    if (text.length > 0) {
      // Only normalize if \r characters are present (rare case)
      const normalized = text.includes("\r")
        ? text.replace(/\r\n/g, "\n").replace(/\r/g, "\n")
        : text;

      // Fast path: create fragment directly without full CRDT insert machinery.
      // We still need: clock tick, version update, and undo tracking.
      const opId = buffer.clock.tick();
      observeVersion(buffer._version, buffer._replicaId, opId.counter);

      // Record for undo support (initial content should be undoable)
      buffer.recordImplicitOp(opId, "insert");

      // Use a simple locator between MIN and MAX
      const locator = locatorBetween(MIN_LOCATOR, MAX_LOCATOR);
      const fragment = createFragment(opId, 0, locator, normalized, true);

      // Build SumTree with single fragment and initialize the insertionId index
      buffer.setFragments([fragment]);
    }
    return buffer;
  }

  get replicaId(): ReplicaId {
    return this._replicaId;
  }

  get version(): VersionVector {
    return this._version;
  }

  /**
   * Set the time-based grouping delay in milliseconds.
   * Consecutive same-type edits within this window are grouped as one undo unit.
   * Default is 300ms.
   */
  setGroupDelay(ms: number): void {
    this.groupDelay = ms;
  }

  /**
   * Override the time source used for grouping (useful for tests).
   */
  setTimeSource(now: () => number): void {
    this._now = now;
  }

  // ---------------------------------------------------------------------------
  // Read API (convenience — prefer snapshot() for consistency)
  // ---------------------------------------------------------------------------

  /** Total UTF-16 length of visible text. */
  get length(): number {
    return this.fragments.summary().visibleLen;
  }

  /** Get the visible text content. */
  getText(): string {
    const parts: string[] = [];
    for (const frag of this.fragmentsArray()) {
      if (frag.visible) {
        parts.push(frag.text);
      }
    }
    return parts.join("");
  }

  // ---------------------------------------------------------------------------
  // Editing
  // ---------------------------------------------------------------------------

  /**
   * Insert text at the given visible UTF-16 offset.
   * Returns the Operation for collaboration broadcast.
   */
  insert(offset: number, text: string): Operation {
    if (text.length === 0) {
      const opId = this.clock.tick();
      observeVersion(this._version, this._replicaId, opId.counter);
      return {
        type: "insert",
        id: opId,
        text: "",
        after: { insertionId: MIN_OPERATION_ID, offset: 0 },
        before: { insertionId: MAX_OPERATION_ID, offset: 0 },
        version: cloneVersionVector(this._version),
        locator: MIN_LOCATOR,
      };
    }

    const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

    // Fast path: insert at or past the end of the document.
    // Uses SumTree.push() (O(n)) instead of O(n log n) full rebuild.
    if (offset >= this.length) {
      return this.insertAtEndFast(normalized);
    }

    return this.insertInternal(offset, normalized);
  }

  /**
   * Delete text in the range [start, end).
   * Returns the Operation for collaboration broadcast.
   */
  delete(start: number, end: number): Operation {
    const clampedStart = Math.max(0, Math.min(start, this.length));
    const clampedEnd = Math.max(clampedStart, Math.min(end, this.length));

    if (clampedStart === clampedEnd) {
      const opId = this.clock.tick();
      observeVersion(this._version, this._replicaId, opId.counter);
      return {
        type: "delete",
        id: opId,
        ranges: [],
        version: cloneVersionVector(this._version),
      };
    }

    return this.deleteInternalOptimized(clampedStart, clampedEnd);
  }

  // ---------------------------------------------------------------------------
  // Transactions
  // ---------------------------------------------------------------------------

  /**
   * Flush the current implicit (time-based) transaction onto the undo stack.
   * Called when starting an explicit transaction, on undo/redo, or when the
   * time window expires.
   */
  private flushImplicitTransaction(): void {
    if (this.implicitTransaction !== null && this.implicitTransaction.operationIds.length > 0) {
      this.transactionHistory.push(this.implicitTransaction);
      this.undoStack.push({
        transactionId: this.implicitTransaction.id,
        operationIds: [...this.implicitTransaction.operationIds],
        undoCounts: [],
      });
      this.redoStack = [];
    }
    this.implicitTransaction = null;
    this.lastEditType = null;
  }

  /**
   * Record an operation into the implicit (time-based) transaction grouping.
   * Consecutive same-type edits within `groupDelay` ms share one transaction.
   */
  private recordImplicitOp(opId: OperationId, editType: "insert" | "delete"): void {
    const now = this._now();

    if (this.implicitTransaction !== null) {
      const elapsed = now - this.implicitTransaction.timestamp;
      if (editType === this.lastEditType && this.groupDelay > 0 && elapsed <= this.groupDelay) {
        // Append to existing implicit transaction
        this.implicitTransaction.operationIds.push(opId);
        this.implicitTransaction.timestamp = now;
        return;
      }
      // Different type or time window expired — flush the old one
      this.flushImplicitTransaction();
    }

    // Start a new implicit transaction
    const txnId = transactionId(this.nextTransactionId++);
    this.implicitTransaction = { id: txnId, operationIds: [opId], timestamp: now };
    this.lastEditType = editType;
    // Clear redo stack on new edit
    this.redoStack = [];
  }

  /**
   * Start a new explicit transaction. All operations until endTransaction()
   * are grouped into one undo unit, regardless of time or edit type.
   */
  startTransaction(): TransactionId {
    // Flush any pending implicit transaction first
    this.flushImplicitTransaction();
    const id = transactionId(this.nextTransactionId++);
    this.activeTransaction = { id, operationIds: [], timestamp: this._now() };
    return id;
  }

  /**
   * End the current explicit transaction.
   */
  endTransaction(): TransactionId {
    if (this.activeTransaction === null) {
      return transactionId(-1);
    }
    const txn = this.activeTransaction;
    this.activeTransaction = null;
    if (txn.operationIds.length > 0) {
      this.transactionHistory.push(txn);
      this.undoStack.push({
        transactionId: txn.id,
        operationIds: [...txn.operationIds],
        undoCounts: [],
      });
      // Clear redo stack on new edit
      this.redoStack = [];
    }
    return txn.id;
  }

  // ---------------------------------------------------------------------------
  // Undo / Redo
  // ---------------------------------------------------------------------------

  /**
   * Undo the most recent transaction.
   * Returns an UndoOperation for collaboration, or null if nothing to undo.
   */
  undo(): Operation | null {
    // Flush any pending implicit transaction so it becomes undoable
    this.flushImplicitTransaction();
    const entry = this.undoStack.pop();
    if (entry === undefined) {
      return null;
    }

    const opId = this.clock.tick();
    observeVersion(this._version, this._replicaId, opId.counter);

    const undoCounts: Array<{ operationId: OperationId; oldCount: number; newCount: number }> = [];

    // Increment undo count for each operation in the transaction
    for (const targetOpId of entry.operationIds) {
      const oldCount = this.undoMap.getCount(targetOpId);
      const newCount = this.undoMap.increment(targetOpId);
      undoCounts.push({ operationId: targetOpId, oldCount, newCount });
    }

    // Recompute visibility for all affected fragments
    this.recomputeVisibility();

    // Push to redo stack
    this.redoStack.push({
      transactionId: entry.transactionId,
      operationIds: entry.operationIds,
      undoCounts,
    });

    return {
      type: "undo",
      id: opId,
      transactionId: entry.transactionId,
      counts: undoCounts.map((e) => ({ operationId: e.operationId, count: e.newCount })),
      version: cloneVersionVector(this._version),
    };
  }

  /**
   * Redo the most recently undone transaction.
   * Returns an UndoOperation for collaboration, or null if nothing to redo.
   */
  redo(): Operation | null {
    // Flush any pending implicit transaction first
    this.flushImplicitTransaction();
    const entry = this.redoStack.pop();
    if (entry === undefined) {
      return null;
    }

    const opId = this.clock.tick();
    observeVersion(this._version, this._replicaId, opId.counter);

    const undoCounts: Array<{ operationId: OperationId; oldCount: number; newCount: number }> = [];

    // Increment undo count again (even count = done)
    for (const targetOpId of entry.operationIds) {
      const oldCount = this.undoMap.getCount(targetOpId);
      const newCount = this.undoMap.increment(targetOpId);
      undoCounts.push({ operationId: targetOpId, oldCount, newCount });
    }

    // Recompute visibility
    this.recomputeVisibility();

    // Push back to undo stack
    this.undoStack.push({
      transactionId: entry.transactionId,
      operationIds: entry.operationIds,
      undoCounts,
    });

    return {
      type: "undo",
      id: opId,
      transactionId: entry.transactionId,
      counts: undoCounts.map((e) => ({ operationId: e.operationId, count: e.newCount })),
      version: cloneVersionVector(this._version),
    };
  }

  // ---------------------------------------------------------------------------
  // Snapshots
  // ---------------------------------------------------------------------------

  /**
   * Create an immutable O(1) snapshot of the current buffer state.
   *
   * The snapshot captures:
   * - Root NodeId of the fragment SumTree (O(1))
   * - Cloned VersionVector (O(replicas))
   * - Epoch for reclamation tracking
   *
   * Call snapshot.release() when done to enable memory reclamation.
   */
  snapshot(options?: SnapshotOptions): TextBufferSnapshot {
    // Advance epoch and get the new one for this snapshot
    const arena = this.fragments.getArena();
    const snapshotEpoch = arena.advanceEpoch();

    // Retain the epoch (increment ref count)
    arena.retainEpoch(snapshotEpoch);
    this._liveSnapshots++;

    // Create a shallow clone of the tree (O(1))
    const treeSnapshot = this.fragments.snapshotClone();

    // Create the snapshot with release callback
    return new TextBufferSnapshot(treeSnapshot, cloneVersionVector(this._version), snapshotEpoch, {
      ...options,
      onRelease: (epoch: Epoch, wasAutoRelease: boolean) => {
        this.onSnapshotReleased(epoch, wasAutoRelease);
        // Call user's onRelease if provided
        if (options?.onRelease) {
          options.onRelease(epoch, wasAutoRelease);
        }
      },
    });
  }

  /**
   * Called when a snapshot is released. Updates epoch tracking.
   */
  private onSnapshotReleased(epoch: Epoch, _wasAutoRelease: boolean): void {
    const arena = this.fragments.getArena();
    arena.releaseEpoch(epoch);
    this._liveSnapshots = Math.max(0, this._liveSnapshots - 1);
  }

  /** Number of live (unreleased) snapshots. */
  get liveSnapshots(): number {
    return this._liveSnapshots;
  }

  // ---------------------------------------------------------------------------
  // Arena utilization and garbage collection
  // ---------------------------------------------------------------------------

  /**
   * Get utilization statistics for the underlying arena.
   */
  arenaUtilization(): import("../arena/index.js").ArenaUtilization {
    return this.fragments.getArena().utilization();
  }

  /**
   * Perform garbage collection on the arena.
   * Frees nodes that are no longer reachable from any live snapshot or the current tree.
   * Returns the number of nodes freed.
   */
  collectGarbage(): number {
    const arena = this.fragments.getArena();
    return arena.collectGarbage([this.fragments.root]);
  }

  /**
   * Get the current root NodeId of the fragment tree.
   * Useful for debugging and testing structural sharing.
   */
  get fragmentsRoot(): NodeId {
    return this.fragments.root;
  }

  // ---------------------------------------------------------------------------
  // Collaboration
  // ---------------------------------------------------------------------------

  /**
   * Apply a remote operation to this buffer.
   */
  applyRemote(operation: Operation): void {
    // Idempotency check: skip operations that have already been applied.
    if (this.hasAppliedOp(operation.id)) {
      return; // Already applied
    }

    // Check causal readiness: all operations that the sender had seen
    // when generating this operation must already be applied here.
    if (!this.isCausallyReady(operation)) {
      this.pendingOps.push(operation);
      return;
    }

    this.applyRemoteInternal(operation);
    this.retryPendingOps();
  }

  /**
   * Check if an operation's causal dependencies are satisfied.
   * For inserts: the referenced after/before fragments must exist.
   * For deletes: the referenced fragments must exist.
   * For undos: always ready (undo counts are merged via max-wins).
   */
  private isCausallyReady(operation: Operation): boolean {
    switch (operation.type) {
      case "insert":
        return this.isInsertReady(operation);
      case "delete":
        return this.isDeleteReady(operation);
      case "undo":
        return true;
    }
  }

  /** Check if an insert operation's after/before fragments exist. */
  private isInsertReady(op: InsertOperation): boolean {
    if (!operationIdsEqual(op.after.insertionId, MIN_OPERATION_ID)) {
      if (!this.hasFragment(op.after.insertionId)) {
        return false;
      }
    }
    if (!operationIdsEqual(op.before.insertionId, MAX_OPERATION_ID)) {
      if (!this.hasFragment(op.before.insertionId)) {
        return false;
      }
    }
    return true;
  }

  /** Check if a delete operation's target fragments exist. */
  private isDeleteReady(op: DeleteOperation): boolean {
    for (const range of op.ranges) {
      if (!this.hasFragment(range.insertionId)) {
        return false;
      }
    }
    return true;
  }

  /** Check if any fragment with the given insertionId exists. O(1) via index. */
  private hasFragment(insertionId: OperationId): boolean {
    return this._fragmentIds.get(insertionId.replicaId)?.has(insertionId.counter) ?? false;
  }

  /**
   * Apply a remote operation that has been confirmed as causally ready.
   */
  private applyRemoteInternal(operation: Operation): void {
    this.markAppliedOp(operation.id);

    switch (operation.type) {
      case "insert":
        this.applyRemoteInsertDirect(operation);
        break;
      case "delete":
        this.applyRemoteDelete(operation);
        break;
      case "undo":
        this.applyRemoteUndo(operation);
        break;
    }
  }

  /**
   * Retry pending operations that may now have their causal dependencies satisfied.
   */
  private retryPendingOps(): void {
    let madeProgress = true;
    while (madeProgress) {
      madeProgress = false;
      const stillPending: Operation[] = [];

      for (const pendingOp of this.pendingOps) {
        if (this.hasAppliedOp(pendingOp.id)) {
          continue; // Already applied (idempotency)
        }
        if (this.isCausallyReady(pendingOp)) {
          this.applyRemoteInternal(pendingOp);
          madeProgress = true;
        } else {
          stillPending.push(pendingOp);
        }
      }

      this.pendingOps = stillPending;
    }
  }

  // ---------------------------------------------------------------------------
  // Internal: insert
  // ---------------------------------------------------------------------------

  private insertInternal(offset: number, text: string): InsertOperation {
    const opId = this.clock.tick();
    observeVersion(this._version, this._replicaId, opId.counter);

    // Record in active (explicit) transaction or implicit (time-based) group
    if (this.activeTransaction !== null) {
      this.activeTransaction.operationIds.push(opId);
    } else {
      this.recordImplicitOp(opId, "insert");
    }

    const frags = this.fragmentsArray();

    // Find the position to insert: seek to the visible offset
    const { leftLocator, rightLocator, insertLocator, afterRef, beforeRef } =
      this.findInsertPosition(frags, offset);

    // Use explicit insertLocator if provided (for split cases), otherwise compute via locatorBetween
    const locator = insertLocator ?? locatorBetween(leftLocator, rightLocator);

    // Create the new fragment
    const newFrag = createFragment(opId, 0, locator, text, true);

    // Insert at the correct sorted position (no sort needed since
    // insertFragmentByLocator uses consistent comparison logic)
    this.insertFragmentByLocator(frags, newFrag);
    this.setFragments(frags);

    return {
      type: "insert",
      id: opId,
      text,
      after: afterRef,
      before: beforeRef,
      version: cloneVersionVector(this._version),
      locator,
    };
  }

  private findInsertPosition(
    frags: Fragment[],
    offset: number,
  ): {
    leftLocator: Locator;
    rightLocator: Locator;
    /** Explicit Locator for the new insert (computed for split cases to avoid collisions) */
    insertLocator?: Locator;
    insertIndex: number;
    afterRef: { insertionId: OperationId; offset: number };
    beforeRef: { insertionId: OperationId; offset: number };
  } {
    if (frags.length === 0) {
      return {
        leftLocator: MIN_LOCATOR,
        rightLocator: MAX_LOCATOR,
        insertIndex: 0,
        afterRef: { insertionId: MIN_OPERATION_ID, offset: 0 },
        beforeRef: { insertionId: MAX_OPERATION_ID, offset: 0 },
      };
    }

    let visibleOffset = 0;

    for (let i = 0; i < frags.length; i++) {
      const frag = frags[i];
      if (frag === undefined) continue;

      if (frag.visible) {
        if (visibleOffset + frag.length > offset) {
          const localOffset = offset - visibleOffset;

          // If localOffset === 0, insert BEFORE this fragment (at boundary)
          // Don't split — that would create a zero-length fragment and use 2*0-1 = -1
          if (localOffset === 0) {
            const leftLocator = i > 0 ? (frags[i - 1]?.locator ?? MIN_LOCATOR) : MIN_LOCATOR;
            const rightLocator = frag.locator;

            return {
              leftLocator,
              rightLocator,
              insertIndex: i,
              afterRef:
                i > 0 && frags[i - 1] !== undefined
                  ? {
                      insertionId: frags[i - 1]!.insertionId,
                      offset: frags[i - 1]!.insertionOffset + frags[i - 1]!.length,
                    }
                  : { insertionId: MIN_OPERATION_ID, offset: 0 },
              beforeRef: {
                insertionId: frag.insertionId,
                offset: frag.insertionOffset,
              },
            };
          }

          // The insert point is strictly inside this fragment — split it
          const [left, right] = splitFragment(frag, localOffset);

          // Replace the original fragment with the split pair
          frags.splice(i, 1, left, right);

          // Compute explicit Locator using the 2*k-1 scheme to avoid collisions
          // with the 2*k scheme used for split fragments
          const k = right.insertionOffset;
          const insertLocator: Locator = {
            levels: [...frag.baseLocator.levels, 2 * k - 1],
          };

          return {
            leftLocator: left.locator,
            rightLocator: right.locator,
            insertLocator,
            insertIndex: i + 1,
            afterRef: {
              insertionId: left.insertionId,
              offset: left.insertionOffset + left.length,
            },
            beforeRef: {
              insertionId: right.insertionId,
              offset: right.insertionOffset,
            },
          };
        }
        visibleOffset += frag.length;

        if (visibleOffset === offset) {
          // Insert right after this fragment
          const leftLocator = frag.locator;
          const rightLocator =
            i + 1 < frags.length ? (frags[i + 1]?.locator ?? MAX_LOCATOR) : MAX_LOCATOR;

          return {
            leftLocator,
            rightLocator,
            insertIndex: i + 1,
            afterRef: {
              insertionId: frag.insertionId,
              offset: frag.insertionOffset + frag.length,
            },
            beforeRef: (() => {
              const nextFrag = frags[i + 1];
              if (nextFrag !== undefined) {
                return {
                  insertionId: nextFrag.insertionId,
                  offset: nextFrag.insertionOffset,
                };
              }
              return { insertionId: MAX_OPERATION_ID, offset: 0 };
            })(),
          };
        }
      }
    }

    // Insert at the end
    const lastFrag = frags[frags.length - 1];
    return {
      leftLocator: lastFrag !== undefined ? lastFrag.locator : MIN_LOCATOR,
      rightLocator: MAX_LOCATOR,
      insertIndex: frags.length,
      afterRef:
        lastFrag !== undefined
          ? {
              insertionId: lastFrag.insertionId,
              offset: lastFrag.insertionOffset + lastFrag.length,
            }
          : { insertionId: MIN_OPERATION_ID, offset: 0 },
      beforeRef: { insertionId: MAX_OPERATION_ID, offset: 0 },
    };
  }

  // ---------------------------------------------------------------------------
  // Internal: delete (optimized with O(log n) for single-fragment case)
  // ---------------------------------------------------------------------------

  /**
   * Optimized delete for single-fragment case using O(log n) tree operations.
   * Falls back to full delete for multi-fragment deletes.
   */
  private deleteInternalOptimized(start: number, end: number): DeleteOperation {
    const deleteLen = end - start;

    // Find the fragment at the start position using O(log n) seeking
    const startResult = this.fragments.findByDimension(visibleLenDimension, start, "right");
    if (startResult === undefined) {
      // Empty or past end - fall back to regular delete
      return this.deleteInternalSlow(start, end);
    }

    // Check if entire delete range fits within this single fragment
    const startPath = startResult.path;
    const startLeaf = startPath[startPath.length - 1];
    if (startLeaf === undefined) {
      return this.deleteInternalSlow(start, end);
    }

    const leafData = this.fragments.getArena().getItem(startLeaf.nodeId);
    const items = (leafData as { items?: Fragment[] } | undefined)?.items;
    if (!items) {
      return this.deleteInternalSlow(start, end);
    }

    const fragment = items[startLeaf.indexInNode];
    if (fragment === undefined || !fragment.visible) {
      return this.deleteInternalSlow(start, end);
    }

    const localOffset = startResult.localOffset as number;
    const fragRemaining = fragment.length - localOffset;

    // Check if delete fits entirely within this fragment
    if (deleteLen <= fragRemaining) {
      // Single-fragment delete - use optimized path
      return this.deleteSingleFragmentOptimized(start, end, fragment, localOffset);
    }

    // Multi-fragment delete - use slow path
    return this.deleteInternalSlow(start, end);
  }

  /**
   * Optimized delete when the range is entirely within a single fragment.
   * Uses O(log n) tree editing instead of O(n) rebuild.
   */
  private deleteSingleFragmentOptimized(
    start: number,
    end: number,
    fragment: Fragment,
    localOffset: number,
  ): DeleteOperation {
    const opId = this.clock.tick();
    observeVersion(this._version, this._replicaId, opId.counter);

    // Record in transaction
    if (this.activeTransaction !== null) {
      this.activeTransaction.operationIds.push(opId);
    } else {
      this.recordImplicitOp(opId, "delete");
    }

    const deleteLen = end - start;
    const ranges: Array<{ insertionId: OperationId; offset: number; length: number }> = [];

    // Use editByDimension to transform the fragment in-place
    this.fragments = this.fragments.editByDimension(
      visibleLenDimension,
      start,
      (frag, fragLocalOffset) => {
        const offset = fragLocalOffset as number;

        if (offset === 0 && deleteLen >= frag.length) {
          // Delete entire fragment
          ranges.push({
            insertionId: frag.insertionId,
            offset: frag.insertionOffset,
            length: frag.length,
          });
          return deleteFragment(frag, opId);
        }

        if (offset === 0) {
          // Delete from start of fragment
          const [toDelete, keep] = splitFragment(frag, deleteLen);
          ranges.push({
            insertionId: toDelete.insertionId,
            offset: toDelete.insertionOffset,
            length: toDelete.length,
          });
          return [deleteFragment(toDelete, opId), keep];
        }

        if (offset + deleteLen >= frag.length) {
          // Delete to end of fragment
          const [keep, toDelete] = splitFragment(frag, offset);
          ranges.push({
            insertionId: toDelete.insertionId,
            offset: toDelete.insertionOffset,
            length: toDelete.length,
          });
          return [keep, deleteFragment(toDelete, opId)];
        }

        // Delete in middle of fragment - split into 3 parts
        const [left, rest] = splitFragment(frag, offset);
        const [toDelete, right] = splitFragment(rest, deleteLen);
        ranges.push({
          insertionId: toDelete.insertionId,
          offset: toDelete.insertionOffset,
          length: toDelete.length,
        });
        return [left, deleteFragment(toDelete, opId), right];
      },
      "right",
    );

    return {
      type: "delete",
      id: opId,
      ranges,
      version: cloneVersionVector(this._version),
    };
  }

  /**
   * Original O(n) delete implementation, used as fallback for multi-fragment deletes.
   */
  private deleteInternalSlow(start: number, end: number): DeleteOperation {
    const opId = this.clock.tick();
    observeVersion(this._version, this._replicaId, opId.counter);

    if (this.activeTransaction !== null) {
      this.activeTransaction.operationIds.push(opId);
    } else {
      this.recordImplicitOp(opId, "delete");
    }

    const frags = this.fragmentsArray();
    const newFrags: Fragment[] = [];
    const ranges: Array<{ insertionId: OperationId; offset: number; length: number }> = [];

    let visibleOffset = 0;

    for (let i = 0; i < frags.length; i++) {
      const frag = frags[i];
      if (frag === undefined) continue;

      if (!frag.visible) {
        newFrags.push(frag);
        continue;
      }

      const fragStart = visibleOffset;
      const fragEnd = visibleOffset + frag.length;

      if (fragEnd <= start || fragStart >= end) {
        newFrags.push(frag);
      } else if (fragStart >= start && fragEnd <= end) {
        newFrags.push(deleteFragment(frag, opId));
        ranges.push({
          insertionId: frag.insertionId,
          offset: frag.insertionOffset,
          length: frag.length,
        });
      } else if (fragStart < start && fragEnd > end) {
        const deleteStart = start - fragStart;
        const deleteEnd = end - fragStart;

        const [beforePart, rest] = splitFragment(frag, deleteStart);
        const [deletedPart, afterPart] = splitFragment(rest, deleteEnd - deleteStart);

        newFrags.push(beforePart);
        newFrags.push(deleteFragment(deletedPart, opId));
        newFrags.push(afterPart);

        ranges.push({
          insertionId: deletedPart.insertionId,
          offset: deletedPart.insertionOffset,
          length: deletedPart.length,
        });
      } else if (fragStart < start) {
        const splitPoint = start - fragStart;
        const [keepPart, deletedPart] = splitFragment(frag, splitPoint);

        newFrags.push(keepPart);
        newFrags.push(deleteFragment(deletedPart, opId));

        ranges.push({
          insertionId: deletedPart.insertionId,
          offset: deletedPart.insertionOffset,
          length: deletedPart.length,
        });
      } else {
        const splitPoint = end - fragStart;
        const [deletedPart, keepPart] = splitFragment(frag, splitPoint);

        newFrags.push(deleteFragment(deletedPart, opId));
        newFrags.push(keepPart);

        ranges.push({
          insertionId: deletedPart.insertionId,
          offset: deletedPart.insertionOffset,
          length: deletedPart.length,
        });
      }

      visibleOffset = fragEnd;
    }

    sortFragments(newFrags);
    this.setFragments(newFrags);

    return {
      type: "delete",
      id: opId,
      ranges,
      version: cloneVersionVector(this._version),
    };
  }

  // ---------------------------------------------------------------------------
  // Internal: recompute visibility after undo/redo
  // ---------------------------------------------------------------------------

  private recomputeVisibility(): void {
    const frags = this.fragmentsArray();
    let changed = false;
    const newFrags: Fragment[] = [];

    for (const frag of frags) {
      const shouldBeVisible = this.undoMap.isVisible(frag.insertionId, frag.deletions);
      if (shouldBeVisible !== frag.visible) {
        newFrags.push(withVisibility(frag, shouldBeVisible));
        changed = true;
      } else {
        newFrags.push(frag);
      }
    }

    if (changed) {
      this.setFragments(newFrags);
    }
  }

  // ---------------------------------------------------------------------------
  // Internal: apply remote operations
  // ---------------------------------------------------------------------------

  /**
   * Apply a remote insert operation. Causal ordering is guaranteed by the
   * caller (applyRemote), so all referenced fragments should exist.
   *
   * Key insight: the operation's Locator determines its canonical position.
   * We binary search the ENTIRE array by Locator — the after/before refs are
   * only for causal ordering (ensuring dependencies exist), not positioning.
   */
  private applyRemoteInsertDirect(op: InsertOperation): void {
    // Update clock
    this.clock.observe(op.id.counter);
    observeVersion(this._version, op.id.replicaId, op.id.counter);
    mergeVersionVectors(this._version, op.version);

    const frags = this.fragmentsArray();

    // findRefIndex calls may split fragments, which is necessary for causal
    // correctness, but we don't use the returned indices for positioning.
    if (!operationIdsEqual(op.after.insertionId, MIN_OPERATION_ID)) {
      this.findRefIndex(frags, op.after, "after");
    }
    if (!operationIdsEqual(op.before.insertionId, MAX_OPERATION_ID)) {
      this.findRefIndex(frags, op.before, "before");
    }

    // After splits, the array may not be in locator order. Re-sort it.
    sortFragments(frags);

    // Create the new fragment with its original locator.
    // The sort function handles interleaving with children based on operation ID.
    // Check the undo map to determine initial visibility - an undo operation
    // for this insert might have arrived before the insert itself.
    const visible = !this.undoMap.isUndone(op.id);
    const newFrag = createFragment(op.id, 0, op.locator, op.text, visible);

    // Insert the fragment at its locator-sorted position (no re-sort needed
    // since insertFragmentByLocator uses consistent comparison logic)
    this.insertFragmentByLocator(frags, newFrag);
    this.setFragments(frags);
  }

  /**
   * Insert a fragment into the array at its locator-sorted position.
   * Modifies the array in place.
   *
   * Uses binary search for O(log n) position finding, with comparison logic
   * identical to sortFragments to ensure consistent ordering.
   */
  private insertFragmentByLocator(frags: Fragment[], newFrag: Fragment): void {
    if (frags.length === 0) {
      frags.push(newFrag);
      return;
    }

    // Binary search for the correct insertion position
    let low = 0;
    let high = frags.length;

    while (low < high) {
      const mid = (low + high) >>> 1;
      const frag = frags[mid];
      if (frag === undefined) {
        // Skip undefined entries (shouldn't happen, but defensive)
        low = mid + 1;
        continue;
      }

      // Use same comparison as sortFragments for consistency
      const cmp = this.compareFragmentsForSort(newFrag, frag);
      if (cmp <= 0) {
        high = mid;
      } else {
        low = mid + 1;
      }
    }

    frags.splice(low, 0, newFrag);
  }

  /**
   * Compare two fragments using the same logic as sortFragments.
   * This ensures insertFragmentByLocator produces the same order as sorting.
   * Returns: <0 if a should come before b, >0 if after, 0 if equal.
   */
  private compareFragmentsForSort(a: Fragment, b: Fragment): number {
    // First, compare by locator prefix (not lexicographic!)
    const locCmp = compareLocatorsForSort(a.locator, b.locator);
    if (locCmp !== 0) return locCmp;

    // Same prefix: tie-break by operation ID
    const idCmp = compareOperationIds(a.insertionId, b.insertionId);
    if (idCmp !== 0) return idCmp;

    // Same operation: sort by insertionOffset (split parts)
    const offsetCmp = a.insertionOffset - b.insertionOffset;
    if (offsetCmp !== 0) return offsetCmp;

    // Finally, sort by locator length (children after parent)
    return a.locator.levels.length - b.locator.levels.length;
  }

  /**
   * Find the index of a fragment referenced by an after/before ref.
   * Splits the fragment if the reference point falls inside it.
   * Returns the index, or null if the referenced fragment doesn't exist.
   *
   * For "after": returns the index of the fragment AFTER which to insert.
   * For "before": returns the index of the fragment BEFORE which to insert.
   */
  private findRefIndex(
    frags: Fragment[],
    ref: { insertionId: OperationId; offset: number },
    type: "after" | "before",
  ): number | null {
    // Collect indices of all fragments with the matching insertionId
    const matchingIndices: number[] = [];
    for (let i = 0; i < frags.length; i++) {
      const frag = frags[i];
      if (frag === undefined) continue;
      if (operationIdsEqual(frag.insertionId, ref.insertionId)) {
        matchingIndices.push(i);
      }
    }

    if (matchingIndices.length === 0) {
      return null; // Insertion not found — dependency not yet applied
    }

    // Check for exact matches and splits
    for (const i of matchingIndices) {
      const frag = frags[i];
      if (frag === undefined) continue;
      const fragEnd = frag.insertionOffset + frag.length;

      // Case 1: Reference falls strictly inside this fragment — split it
      if (ref.offset > frag.insertionOffset && ref.offset < fragEnd) {
        const splitPoint = ref.offset - frag.insertionOffset;
        const [leftPart, rightPart] = splitFragment(frag, splitPoint);
        frags.splice(i, 1, leftPart, rightPart);
        return type === "after" ? i : i + 1;
      }

      if (type === "after") {
        // Case 2: Fragment ends exactly at the reference offset
        if (fragEnd === ref.offset) {
          return i;
        }
      }

      if (type === "before") {
        // Case 3: Fragment starts exactly at the reference offset
        // Prefer non-zero-length fragments to avoid matching zero-length splits
        // that are meant for "after" references.
        if (frag.insertionOffset === ref.offset && frag.length > 0) {
          return i;
        }
      }
    }

    // Edge cases: the reference points to a boundary that requires
    // a zero-length split to exist (the sender created one during local editing).
    if (type === "after") {
      // "after offset X" where X equals the insertionOffset of the first
      // matching fragment. This means the sender had a zero-length left split.
      const firstIdx = matchingIndices[0];
      if (firstIdx === undefined) return null;
      const firstFrag = frags[firstIdx];
      if (
        firstFrag !== undefined &&
        firstFrag.insertionOffset === ref.offset &&
        firstFrag.length > 0
      ) {
        // Create zero-length left split to match sender state
        const [leftPart, rightPart] = splitFragment(firstFrag, 0);
        frags.splice(firstIdx, 1, leftPart, rightPart);
        return firstIdx; // Return the zero-length fragment's index
      }
    }

    if (type === "before") {
      // "before offset X" where X equals the end of the last matching fragment.
      // This means the sender had a zero-length right split.
      const lastIdx = matchingIndices[matchingIndices.length - 1];
      if (lastIdx === undefined) return null;
      const lastFrag = frags[lastIdx];
      if (lastFrag !== undefined) {
        const lastEnd = lastFrag.insertionOffset + lastFrag.length;
        if (lastEnd === ref.offset && lastFrag.length > 0) {
          // Create zero-length right split to match sender state
          const [leftPart, rightPart] = splitFragment(lastFrag, lastFrag.length);
          frags.splice(lastIdx, 1, leftPart, rightPart);
          return lastIdx + 1; // Return the zero-length fragment's index
        }
      }
    }

    return null; // Reference not found
  }

  private applyRemoteDelete(op: DeleteOperation): void {
    this.clock.observe(op.id.counter);
    observeVersion(this._version, op.id.replicaId, op.id.counter);
    mergeVersionVectors(this._version, op.version);

    // Use a work list approach: when a fragment is split, the resulting parts
    // may still overlap with other delete ranges and need re-processing.
    const workList = [...this.fragmentsArray()];
    const resultFrags: Fragment[] = [];

    while (workList.length > 0) {
      const frag = workList.shift();
      if (frag === undefined) break; // Should never happen, but satisfies lint
      let wasProcessed = false;

      for (const range of op.ranges) {
        if (!operationIdsEqual(frag.insertionId, range.insertionId)) {
          continue;
        }

        const fragStart = frag.insertionOffset;
        const fragEnd = frag.insertionOffset + frag.length;
        const rangeStart = range.offset;
        const rangeEnd = range.offset + range.length;

        // Check for any overlap between the fragment and the delete range
        if (fragEnd <= rangeStart || fragStart >= rangeEnd) {
          // No overlap with this range
          continue;
        }

        if (fragStart >= rangeStart && fragEnd <= rangeEnd) {
          // Fragment is entirely within the delete range - done with this fragment
          resultFrags.push(deleteFragment(frag, op.id));
          wasProcessed = true;
          break;
        }

        if (fragStart < rangeStart && fragEnd > rangeEnd) {
          // Delete range is entirely within this fragment — split into 3 parts
          // The "after" part might still overlap with other ranges, so re-check it.
          const deleteLocalStart = rangeStart - fragStart;
          const deleteLocalEnd = rangeEnd - fragStart;

          const [beforePart, rest] = splitFragment(frag, deleteLocalStart);
          const [deletedPart, afterPart] = splitFragment(rest, deleteLocalEnd - deleteLocalStart);

          resultFrags.push(beforePart);
          resultFrags.push(deleteFragment(deletedPart, op.id));
          workList.unshift(afterPart); // Re-check against remaining ranges
          wasProcessed = true;
          break;
        }

        if (fragStart < rangeStart) {
          // Delete range overlaps the end of this fragment
          const splitPoint = rangeStart - fragStart;
          const [keepPart, deletedPart] = splitFragment(frag, splitPoint);

          resultFrags.push(keepPart);
          resultFrags.push(deleteFragment(deletedPart, op.id));
          wasProcessed = true;
          break;
        }

        // Delete range overlaps the start of this fragment (fragEnd > rangeEnd)
        // The "keep" part might still overlap with other ranges, so re-check it.
        const splitPoint = rangeEnd - fragStart;
        const [deletedPart, keepPart] = splitFragment(frag, splitPoint);

        resultFrags.push(deleteFragment(deletedPart, op.id));
        workList.unshift(keepPart); // Re-check against remaining ranges
        wasProcessed = true;
        break;
      }
      if (!wasProcessed) {
        resultFrags.push(frag);
      }
    }

    // Sort by (locator, insertionId, insertionOffset) to maintain canonical order
    // after splits. This matches the sorting in applyRemoteInsertDirect.
    resultFrags.sort((a, b) => {
      const locCmp = compareLocators(a.locator, b.locator);
      if (locCmp !== 0) return locCmp;
      const idCmp = compareOperationIds(a.insertionId, b.insertionId);
      if (idCmp !== 0) return idCmp;
      return a.insertionOffset - b.insertionOffset;
    });

    this.setFragments(resultFrags);
  }

  private applyRemoteUndo(op: UndoOperation): void {
    this.clock.observe(op.id.counter);
    observeVersion(this._version, op.id.replicaId, op.id.counter);
    mergeVersionVectors(this._version, op.version);

    // Apply undo counts with max-wins
    this.undoMap.mergeFrom(op.counts);

    // Recompute visibility
    this.recomputeVisibility();
  }

  // ---------------------------------------------------------------------------
  // Internal: insert at end (append fast path)
  // ---------------------------------------------------------------------------

  /**
   * Insert text at the end of the document.
   * Avoids the O(n log n) full tree rebuild used by insertInternal by using
   * SumTree.push() which is O(n) (vs O(n log n) for fromItems-based rebuild).
   *
   * Correctness: uses the last item in the tree (visible or not) as the left
   * locator boundary, ensuring the new fragment sorts after ALL existing fragments.
   */
  private insertAtEndFast(text: string): InsertOperation {
    const opId = this.clock.tick();
    observeVersion(this._version, this._replicaId, opId.counter);

    if (this.activeTransaction !== null) {
      this.activeTransaction.operationIds.push(opId);
    } else {
      this.recordImplicitOp(opId, "insert");
    }

    // Get the last fragment in tree order (O(log n) traversal to rightmost leaf).
    // This may be an invisible fragment — we need the highest locator in the tree
    // so the new fragment sorts after everything, including deleted content.
    const lastFrag = this.getLastTreeFragment();

    const leftLocator = lastFrag?.locator ?? MIN_LOCATOR;
    const locator = locatorBetween(leftLocator, MAX_LOCATOR);
    const newFrag = createFragment(opId, 0, locator, text, true);

    // Append to tree — avoids O(n log n) full rebuild.
    this.fragments = this.fragments.push(newFrag);

    // Update the fragment ID index in O(1) instead of rebuilding it from scratch.
    this.addFragmentId(opId);

    const afterRef = lastFrag
      ? { insertionId: lastFrag.insertionId, offset: lastFrag.insertionOffset + lastFrag.length }
      : { insertionId: MIN_OPERATION_ID, offset: 0 };

    return {
      type: "insert",
      id: opId,
      text,
      after: afterRef,
      before: { insertionId: MAX_OPERATION_ID, offset: 0 },
      version: cloneVersionVector(this._version),
      locator,
    };
  }

  /**
   * Traverse the tree to its rightmost leaf and return the last item.
   * Avoids extracting all fragments as an array.
   */
  private getLastTreeFragment(): Fragment | undefined {
    if (this.fragments.isEmpty()) return undefined;
    const arena = this.fragments.getArena();
    let current = this.fragments.root;
    while (!arena.isLeaf(current)) {
      const children = arena.getChildren(current);
      const lastChild = children[children.length - 1];
      if (lastChild === undefined) return undefined;
      current = lastChild;
    }
    const data = arena.getItem(current) as { items?: Fragment[] } | undefined;
    const items = data?.items;
    if (!items || items.length === 0) return undefined;
    return items[items.length - 1];
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /** Get all fragments as an array. */
  private fragmentsArray(): Fragment[] {
    return this.fragments.toArray();
  }

  /** Check if an operation has already been applied. O(1) numeric lookup. */
  private hasAppliedOp(id: OperationId): boolean {
    return this.appliedOps.get(id.replicaId)?.has(id.counter) ?? false;
  }

  /** Mark an operation as applied. */
  private markAppliedOp(id: OperationId): void {
    let counters = this.appliedOps.get(id.replicaId);
    if (counters === undefined) {
      counters = new Set();
      this.appliedOps.set(id.replicaId, counters);
    }
    counters.add(id.counter);
  }

  /** Add a single fragment's insertionId to the _fragmentIds index in O(1). */
  private addFragmentId(id: OperationId): void {
    let counters = this._fragmentIds.get(id.replicaId);
    if (counters === undefined) {
      counters = new Set();
      this._fragmentIds.set(id.replicaId, counters);
    }
    counters.add(id.counter);
  }

  /**
   * Replace the fragment tree with a new set of fragments.
   * Rebuilds both the SumTree and the insertionId index for O(1) hasFragment checks.
   */
  private setFragments(frags: Fragment[]): void {
    this.fragments = SumTree.fromItems(frags, fragmentSummaryOps);
    const index = new Map<ReplicaId, Set<number>>();
    for (const frag of frags) {
      const rid = frag.insertionId.replicaId;
      let counters = index.get(rid);
      if (counters === undefined) {
        counters = new Set();
        index.set(rid, counters);
      }
      counters.add(frag.insertionId.counter);
    }
    this._fragmentIds = index;
  }

  // ---------------------------------------------------------------------------
  // Serialization
  // ---------------------------------------------------------------------------

  /**
   * Create a serializable snapshot of the complete CRDT state.
   * This includes all data needed to fully reconstruct the buffer.
   */
  toSerializedSnapshot(): SerializedSnapshot {
    // Serialize undo stack
    const undoStack = this.undoStack.map((entry) => ({
      txnId: entry.transactionId as number,
      ops: entry.operationIds.map(serializeOperationId),
      counts: entry.undoCounts.map((c) => ({
        op: serializeOperationId(c.operationId),
        old: c.oldCount,
        new: c.newCount,
      })),
    }));

    // Serialize redo stack
    const redoStack = this.redoStack.map((entry) => ({
      txnId: entry.transactionId as number,
      ops: entry.operationIds.map(serializeOperationId),
      counts: entry.undoCounts.map((c) => ({
        op: serializeOperationId(c.operationId),
        old: c.oldCount,
        new: c.newCount,
      })),
    }));

    // Serialize undo map
    const undoMapEntries = this.undoMap.entries().map((e) => ({
      op: serializeOperationId(e.operationId),
      count: e.count,
    }));

    return {
      version: SERIALIZATION_VERSION,
      replicaId: this._replicaId as number,
      clockCounter: this.clock.counter,
      versionVector: serializeVersionVector(this._version),
      fragments: this.fragmentsArray().map(serializeFragment),
      undoMap: undoMapEntries,
      undoStack,
      redoStack,
      appliedOps: [...this.appliedOps.entries()].flatMap(([rid, counters]) =>
        [...counters].map((c) => `${rid}:${c}`),
      ),
      nextTransactionId: this.nextTransactionId,
      groupDelay: this.groupDelay,
    };
  }

  /**
   * Serialize the buffer to a compact binary format.
   * This is suitable for network transfer and persistent storage.
   */
  serialize(): Uint8Array {
    return encodeBinary(this.toSerializedSnapshot());
  }

  /**
   * Serialize the buffer to a JSON string.
   * This is useful for debugging and human-readable storage.
   */
  serializeJSON(): string {
    return encodeJSON(this.toSerializedSnapshot());
  }

  /**
   * Restore a TextBuffer from a serialized binary snapshot.
   */
  static deserialize(data: Uint8Array): TextBuffer {
    const snapshot = decodeBinary(data);
    return TextBuffer.fromSerializedSnapshot(snapshot);
  }

  /**
   * Restore a TextBuffer from a serialized JSON string.
   */
  static deserializeJSON(json: string): TextBuffer {
    const snapshot = decodeJSON(json);
    return TextBuffer.fromSerializedSnapshot(snapshot);
  }

  /**
   * Restore a TextBuffer from a SerializedSnapshot.
   */
  static fromSerializedSnapshot(snapshot: SerializedSnapshot): TextBuffer {
    const rid = replicaId(snapshot.replicaId);
    const buffer = new TextBuffer(rid);

    // Restore clock counter
    buffer.clock.observe(snapshot.clockCounter - 1);

    // Restore version vector
    buffer._version = deserializeVersionVector(snapshot.versionVector);

    // Restore fragments
    const fragments: Fragment[] = snapshot.fragments.map((sf) => {
      const insertionId = deserializeOperationId(sf.id);
      const locator = deserializeLocator(sf.loc);
      const baseLocator = deserializeLocator(sf.base);
      const deletions = sf.del.map(deserializeOperationId);

      return createFragment(insertionId, sf.io, locator, sf.t, sf.v, deletions, baseLocator);
    });
    buffer.setFragments(fragments);

    // Restore undo map
    buffer.undoMap.mergeFrom(
      snapshot.undoMap.map((e) => ({
        operationId: deserializeOperationId(e.op),
        count: e.count,
      })),
    );

    // Restore undo stack
    buffer.undoStack = snapshot.undoStack.map((entry) => ({
      transactionId: deserializeTransactionId(entry.txnId),
      operationIds: entry.ops.map(deserializeOperationId),
      undoCounts: entry.counts.map((c) => ({
        operationId: deserializeOperationId(c.op),
        oldCount: c.old,
        newCount: c.new,
      })),
    }));

    // Restore redo stack
    buffer.redoStack = snapshot.redoStack.map((entry) => ({
      transactionId: deserializeTransactionId(entry.txnId),
      operationIds: entry.ops.map(deserializeOperationId),
      undoCounts: entry.counts.map((c) => ({
        operationId: deserializeOperationId(c.op),
        oldCount: c.old,
        newCount: c.new,
      })),
    }));

    // Restore applied ops set (stored as "replicaId:counter" strings)
    for (const key of snapshot.appliedOps) {
      const colonIdx = key.indexOf(":");
      if (colonIdx !== -1) {
        const rid = replicaId(Number(key.slice(0, colonIdx)));
        const counter = Number(key.slice(colonIdx + 1));
        let counters = buffer.appliedOps.get(rid);
        if (counters === undefined) {
          counters = new Set();
          buffer.appliedOps.set(rid, counters);
        }
        counters.add(counter);
      }
    }

    // Restore transaction state
    buffer.nextTransactionId = snapshot.nextTransactionId;
    buffer.groupDelay = snapshot.groupDelay;

    return buffer;
  }
}
