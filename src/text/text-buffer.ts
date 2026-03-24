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

import { SumTree } from "../sum-tree/index.js";
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
import { TextBufferSnapshot } from "./snapshot.js";
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
  transactionId,
} from "./types.js";
import { UndoMap } from "./undo-map.js";

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

  // Track applied remote operation IDs for idempotency
  private appliedOps: Set<string>;

  // Pending operations waiting for their causal dependencies
  private pendingOps: Operation[];

  /** Injectable time source for testing. */
  private _now: () => number;

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
    this.appliedOps = new Set();
    this.pendingOps = [];
    this._now = Date.now;
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
   */
  static fromString(text: string, rid?: ReplicaId): TextBuffer {
    const buffer = TextBuffer.create(rid);
    if (text.length > 0) {
      // Normalize line endings
      const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
      buffer.insertInternal(0, normalized);
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

    return this.deleteInternal(clampedStart, clampedEnd);
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
   * Create an immutable snapshot of the current buffer state.
   */
  snapshot(): TextBufferSnapshot {
    return new TextBufferSnapshot(this.fragmentsArray(), cloneVersionVector(this._version));
  }

  // ---------------------------------------------------------------------------
  // Collaboration
  // ---------------------------------------------------------------------------

  /**
   * Apply a remote operation to this buffer.
   */
  applyRemote(operation: Operation): void {
    // Idempotency check: skip operations that have already been applied.
    const opKey = `${operation.id.replicaId}:${operation.id.counter}`;
    if (this.appliedOps.has(opKey)) {
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

  /** Check if any fragment with the given insertionId exists. */
  private hasFragment(insertionId: OperationId): boolean {
    for (const frag of this.fragmentsArray()) {
      if (operationIdsEqual(frag.insertionId, insertionId)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Apply a remote operation that has been confirmed as causally ready.
   */
  private applyRemoteInternal(operation: Operation): void {
    const opKey = `${operation.id.replicaId}:${operation.id.counter}`;
    this.appliedOps.add(opKey);

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
        const opKey = `${pendingOp.id.replicaId}:${pendingOp.id.counter}`;
        if (this.appliedOps.has(opKey)) {
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

    // Use O(log n) seek to find position
    const {
      index,
      item: frag,
      position,
    } = this.fragments.findIndexByDimension(visibleLenDimension, offset, "right");

    // Compute locators and refs based on position
    let leftLocator: Locator = MIN_LOCATOR;
    let rightLocator: Locator = MAX_LOCATOR;
    let insertLocator: Locator | undefined;
    const insertIndex = index;
    let afterRef: { insertionId: OperationId; offset: number } = {
      insertionId: MIN_OPERATION_ID,
      offset: 0,
    };
    let beforeRef: { insertionId: OperationId; offset: number } = {
      insertionId: MAX_OPERATION_ID,
      offset: 0,
    };

    const len = this.fragments.length();

    if (len === 0) {
      // Empty tree - just insert
      const locator = locatorBetween(leftLocator, rightLocator);
      const newFrag = createFragment(opId, 0, locator, text, true);
      this.fragments = this.fragments.insertAt(0, newFrag);

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

    if (frag?.visible) {
      const localOffset = offset - position;

      if (localOffset === 0) {
        // Insert BEFORE this fragment (at boundary)
        rightLocator = frag.locator;
        beforeRef = {
          insertionId: frag.insertionId,
          offset: frag.insertionOffset,
        };

        if (index > 0) {
          const prevFrag = this.fragments.get(index - 1);
          if (prevFrag !== undefined) {
            leftLocator = prevFrag.locator;
            afterRef = {
              insertionId: prevFrag.insertionId,
              offset: prevFrag.insertionOffset + prevFrag.length,
            };
          }
        }

        const locator = locatorBetween(leftLocator, rightLocator);
        const newFrag = createFragment(opId, 0, locator, text, true);
        this.fragments = this.fragments.insertAt(insertIndex, newFrag);

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

      if (localOffset > 0 && localOffset < frag.length) {
        // Insert INSIDE this fragment - need to split
        const [left, right] = splitFragment(frag, localOffset);

        // Compute explicit Locator using the 2*k-1 scheme
        const k = right.insertionOffset;
        insertLocator = {
          levels: [...frag.baseLocator.levels, 2 * k - 1],
        };

        leftLocator = left.locator;
        rightLocator = right.locator;
        afterRef = {
          insertionId: left.insertionId,
          offset: left.insertionOffset + left.length,
        };
        beforeRef = {
          insertionId: right.insertionId,
          offset: right.insertionOffset,
        };

        const locator = insertLocator;
        const newFrag = createFragment(opId, 0, locator, text, true);

        // Replace 1 fragment with 3 (left, new, right) using spliceAt
        this.fragments = this.fragments.spliceAt(index, 1, left, newFrag, right);

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
    }

    // Insert after current fragment (or at end if at end of tree)
    if (index > 0) {
      const prevFrag = frag ?? this.fragments.get(index - 1);
      if (prevFrag !== undefined) {
        leftLocator = prevFrag.locator;
        afterRef = {
          insertionId: prevFrag.insertionId,
          offset: prevFrag.insertionOffset + prevFrag.length,
        };
      }
    }

    if (index < len) {
      const nextFrag = this.fragments.get(index);
      if (nextFrag !== undefined) {
        rightLocator = nextFrag.locator;
        beforeRef = {
          insertionId: nextFrag.insertionId,
          offset: nextFrag.insertionOffset,
        };
      }
    }

    const locator = insertLocator ?? locatorBetween(leftLocator, rightLocator);
    const newFrag = createFragment(opId, 0, locator, text, true);
    this.fragments = this.fragments.insertAt(insertIndex, newFrag);

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
              afterRef: (() => {
                const prevFrag = frags[i - 1];
                if (i > 0 && prevFrag !== undefined) {
                  return {
                    insertionId: prevFrag.insertionId,
                    offset: prevFrag.insertionOffset + prevFrag.length,
                  };
                }
                return { insertionId: MIN_OPERATION_ID, offset: 0 };
              })(),
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
  // Internal: delete
  // ---------------------------------------------------------------------------

  private deleteInternal(start: number, end: number): DeleteOperation {
    const opId = this.clock.tick();
    observeVersion(this._version, this._replicaId, opId.counter);

    // Record in active (explicit) transaction or implicit (time-based) group
    if (this.activeTransaction !== null) {
      this.activeTransaction.operationIds.push(opId);
    } else {
      this.recordImplicitOp(opId, "delete");
    }

    const ranges: Array<{ insertionId: OperationId; offset: number; length: number }> = [];

    // Find the first fragment that overlaps the delete range using O(log n) seek
    const { index: startIndex, position: startPos } = this.fragments.findIndexByDimension(
      visibleLenDimension,
      start,
      "right",
    );

    // Find the last fragment that overlaps the delete range
    const { index: endIndex } = this.fragments.findIndexByDimension(
      visibleLenDimension,
      end,
      "left",
    );

    // Collect replacement fragments for the affected range
    const replacements: Fragment[] = [];
    let visibleOffset = startPos;
    let currentIndex = startIndex;

    // Process fragments in the affected range
    while (currentIndex <= endIndex && currentIndex < this.fragments.length()) {
      const frag = this.fragments.get(currentIndex);
      if (frag === undefined) {
        currentIndex++;
        continue;
      }

      if (!frag.visible) {
        // Invisible fragments pass through unchanged
        replacements.push(frag);
        currentIndex++;
        continue;
      }

      const fragStart = visibleOffset;
      const fragEnd = visibleOffset + frag.length;

      if (fragEnd <= start || fragStart >= end) {
        // Fragment is entirely outside the delete range
        replacements.push(frag);
      } else if (fragStart >= start && fragEnd <= end) {
        // Fragment is entirely within the delete range
        replacements.push(deleteFragment(frag, opId));
        ranges.push({
          insertionId: frag.insertionId,
          offset: frag.insertionOffset,
          length: frag.length,
        });
      } else if (fragStart < start && fragEnd > end) {
        // Delete range is entirely within this fragment — split into 3 parts
        const deleteStart = start - fragStart;
        const deleteEnd = end - fragStart;

        const [beforePart, rest] = splitFragment(frag, deleteStart);
        const [deletedPart, afterPart] = splitFragment(rest, deleteEnd - deleteStart);

        replacements.push(beforePart);
        replacements.push(deleteFragment(deletedPart, opId));
        replacements.push(afterPart);

        ranges.push({
          insertionId: deletedPart.insertionId,
          offset: deletedPart.insertionOffset,
          length: deletedPart.length,
        });
      } else if (fragStart < start) {
        // Delete range overlaps the end of this fragment
        const splitPoint = start - fragStart;
        const [keepPart, deletedPart] = splitFragment(frag, splitPoint);

        replacements.push(keepPart);
        replacements.push(deleteFragment(deletedPart, opId));

        ranges.push({
          insertionId: deletedPart.insertionId,
          offset: deletedPart.insertionOffset,
          length: deletedPart.length,
        });
      } else {
        // Delete range overlaps the start of this fragment (fragEnd > end)
        const splitPoint = end - fragStart;
        const [deletedPart, keepPart] = splitFragment(frag, splitPoint);

        replacements.push(deleteFragment(deletedPart, opId));
        replacements.push(keepPart);

        ranges.push({
          insertionId: deletedPart.insertionId,
          offset: deletedPart.insertionOffset,
          length: deletedPart.length,
        });
      }

      visibleOffset = fragEnd;
      currentIndex++;
    }

    // Replace the affected range with the new fragments using spliceAt
    const deleteCount = endIndex - startIndex + 1;
    if (deleteCount > 0 && replacements.length > 0) {
      this.fragments = this.fragments.spliceAt(startIndex, deleteCount, ...replacements);
    }

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
    // Use setAt for O(log n) per changed fragment instead of O(n) rebuild
    const len = this.fragments.length();

    for (let i = 0; i < len; i++) {
      const frag = this.fragments.get(i);
      if (frag === undefined) continue;

      const shouldBeVisible = this.undoMap.isVisible(frag.insertionId, frag.deletions);
      if (shouldBeVisible !== frag.visible) {
        this.fragments = this.fragments.setAt(i, withVisibility(frag, shouldBeVisible));
      }
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
    const newFrag = createFragment(op.id, 0, op.locator, op.text, true);

    // findRefIndex calls may split fragments, which is necessary for causal
    // correctness, but we don't use the returned indices for positioning.
    if (!operationIdsEqual(op.after.insertionId, MIN_OPERATION_ID)) {
      this.findRefIndex(frags, op.after, "after");
    }
    if (!operationIdsEqual(op.before.insertionId, MAX_OPERATION_ID)) {
      this.findRefIndex(frags, op.before, "before");
    }

    // Binary search the entire array for the Locator-sorted position.
    // Tie-break by (replicaId, counter, insertionOffset) for determinism.
    let insertIndex = 0;
    for (let i = 0; i < frags.length; i++) {
      const frag = frags[i];
      if (frag === undefined) continue;

      const cmp = compareLocators(op.locator, frag.locator);
      if (cmp < 0) {
        break;
      }
      if (cmp === 0) {
        // Same locator — tie-break by (replicaId, counter, insertionOffset)
        const idCmp = compareOperationIds(op.id, frag.insertionId);
        if (idCmp < 0) {
          break;
        }
        if (idCmp === 0) {
          // Same operation — compare insertionOffset (new frag has offset 0)
          if (0 < frag.insertionOffset) {
            break;
          }
        }
      }
      insertIndex = i + 1;
    }

    // Add the new fragment and sort by (Locator, insertionId, insertionOffset)
    // to ensure canonical order regardless of application sequence.
    frags.push(newFrag);
    frags.sort((a, b) => {
      const locCmp = compareLocators(a.locator, b.locator);
      if (locCmp !== 0) return locCmp;
      const idCmp = compareOperationIds(a.insertionId, b.insertionId);
      if (idCmp !== 0) return idCmp;
      return a.insertionOffset - b.insertionOffset;
    });
    this.fragments = SumTree.fromItems(frags, fragmentSummaryOps);
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

    const frags = this.fragmentsArray();
    const newFrags: Fragment[] = [];

    for (const frag of frags) {
      let handled = false;
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
          // Fragment is entirely within the delete range
          newFrags.push(deleteFragment(frag, op.id));
          handled = true;
          break;
        }

        if (fragStart < rangeStart && fragEnd > rangeEnd) {
          // Delete range is entirely within this fragment — split into 3 parts
          const deleteLocalStart = rangeStart - fragStart;
          const deleteLocalEnd = rangeEnd - fragStart;

          const [beforePart, rest] = splitFragment(frag, deleteLocalStart);
          const [deletedPart, afterPart] = splitFragment(rest, deleteLocalEnd - deleteLocalStart);

          newFrags.push(beforePart);
          newFrags.push(deleteFragment(deletedPart, op.id));
          newFrags.push(afterPart);
          handled = true;
          break;
        }

        if (fragStart < rangeStart) {
          // Delete range overlaps the end of this fragment
          const splitPoint = rangeStart - fragStart;
          const [keepPart, deletedPart] = splitFragment(frag, splitPoint);

          newFrags.push(keepPart);
          newFrags.push(deleteFragment(deletedPart, op.id));
          handled = true;
          break;
        }

        // Delete range overlaps the start of this fragment (fragEnd > rangeEnd)
        const splitPoint = rangeEnd - fragStart;
        const [deletedPart, keepPart] = splitFragment(frag, splitPoint);

        newFrags.push(deleteFragment(deletedPart, op.id));
        newFrags.push(keepPart);
        handled = true;
        break;
      }
      if (!handled) {
        newFrags.push(frag);
      }
    }

    this.fragments = SumTree.fromItems(newFrags, fragmentSummaryOps);
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
  // Helpers
  // ---------------------------------------------------------------------------

  /** Get all fragments as an array. */
  private fragmentsArray(): Fragment[] {
    return this.fragments.toArray();
  }
}
