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

  // Undo/Redo stacks
  private undoStack: UndoEntry[];
  private redoStack: UndoEntry[];

  private constructor(rid: ReplicaId) {
    this._replicaId = rid;
    this.clock = new LamportClock(rid);
    this.fragments = new SumTree<Fragment, FragmentSummary>(fragmentSummaryOps);
    this.undoMap = new UndoMap();
    this._version = createVersionVector();
    this.nextTransactionId = 0;
    this.activeTransaction = null;
    this.transactionHistory = [];
    this.undoStack = [];
    this.redoStack = [];
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
   * Start a new transaction. All operations until endTransaction() are grouped.
   */
  startTransaction(): TransactionId {
    const id = transactionId(this.nextTransactionId++);
    this.activeTransaction = { id, operationIds: [] };
    return id;
  }

  /**
   * End the current transaction.
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
    switch (operation.type) {
      case "insert":
        this.applyRemoteInsert(operation);
        break;
      case "delete":
        this.applyRemoteDelete(operation);
        break;
      case "undo":
        this.applyRemoteUndo(operation);
        break;
    }
  }

  // ---------------------------------------------------------------------------
  // Internal: insert
  // ---------------------------------------------------------------------------

  private insertInternal(offset: number, text: string): InsertOperation {
    const opId = this.clock.tick();
    observeVersion(this._version, this._replicaId, opId.counter);

    // Record in active transaction
    if (this.activeTransaction !== null) {
      this.activeTransaction.operationIds.push(opId);
    } else {
      // Auto-transaction: single operation = single transaction
      const txnId = transactionId(this.nextTransactionId++);
      const txn: Transaction = { id: txnId, operationIds: [opId] };
      this.transactionHistory.push(txn);
      this.undoStack.push({
        transactionId: txnId,
        operationIds: [opId],
        undoCounts: [],
      });
      this.redoStack = [];
    }

    const frags = this.fragmentsArray();

    // Find the position to insert: seek to the visible offset
    const { leftLocator, rightLocator, insertIndex, afterRef, beforeRef } = this.findInsertPosition(
      frags,
      offset,
    );

    // Compute locator between left and right neighbors
    const locator = locatorBetween(leftLocator, rightLocator);

    // Create the new fragment
    const newFrag = createFragment(opId, 0, locator, text, true);

    // Build new fragment array
    const newFrags = [...frags.slice(0, insertIndex), newFrag, ...frags.slice(insertIndex)];

    // Rebuild the SumTree
    this.fragments = SumTree.fromItems(newFrags, fragmentSummaryOps);

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
          // The insert point is within this fragment — split it
          const localOffset = offset - visibleOffset;
          const [left, right] = splitFragment(frag, localOffset);

          // Replace the original fragment with the split pair
          frags.splice(i, 1, left, right);

          const rightLocator =
            i + 2 < frags.length ? (frags[i + 2]?.locator ?? MAX_LOCATOR) : MAX_LOCATOR;

          return {
            // We need a locator between the left split and right split.
            // Since they have the same locator, we use the left's locator as left bound
            // and the next fragment's locator as right bound.
            leftLocator: left.locator,
            rightLocator: rightLocator,
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

    // Record in active transaction
    if (this.activeTransaction !== null) {
      this.activeTransaction.operationIds.push(opId);
    } else {
      const txnId = transactionId(this.nextTransactionId++);
      const txn: Transaction = { id: txnId, operationIds: [opId] };
      this.transactionHistory.push(txn);
      this.undoStack.push({
        transactionId: txnId,
        operationIds: [opId],
        undoCounts: [],
      });
      this.redoStack = [];
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
        // Fragment is entirely outside the delete range
        newFrags.push(frag);
      } else if (fragStart >= start && fragEnd <= end) {
        // Fragment is entirely within the delete range
        newFrags.push(deleteFragment(frag, opId));
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

        newFrags.push(beforePart);
        newFrags.push(deleteFragment(deletedPart, opId));
        newFrags.push(afterPart);

        ranges.push({
          insertionId: deletedPart.insertionId,
          offset: deletedPart.insertionOffset,
          length: deletedPart.length,
        });
      } else if (fragStart < start) {
        // Delete range overlaps the end of this fragment
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
        // Delete range overlaps the start of this fragment (fragEnd > end)
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

    this.fragments = SumTree.fromItems(newFrags, fragmentSummaryOps);

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
      this.fragments = SumTree.fromItems(newFrags, fragmentSummaryOps);
    }
  }

  // ---------------------------------------------------------------------------
  // Internal: apply remote operations
  // ---------------------------------------------------------------------------

  private applyRemoteInsert(op: InsertOperation): void {
    // Update clock
    this.clock.observe(op.id.counter);
    observeVersion(this._version, op.id.replicaId, op.id.counter);
    mergeVersionVectors(this._version, op.version);

    const frags = this.fragmentsArray();
    const newFrag = createFragment(op.id, 0, op.locator, op.text, true);

    // Strategy: Use the after/before references to find the correct
    // insertion region, then use locator comparison to resolve ordering
    // among concurrent inserts in the same region.

    // Step 1: Find the fragment referenced by "after" (insert goes after this).
    // We look for the fragment whose insertion range ENDS at or contains the
    // after offset. Among multiple splits of the same insertion, we want the
    // one whose end == after.offset (i.e. the left side of the split point).
    let afterIndex = -1;
    if (!operationIdsEqual(op.after.insertionId, MIN_OPERATION_ID)) {
      for (let i = 0; i < frags.length; i++) {
        const frag = frags[i];
        if (frag === undefined) continue;
        if (!operationIdsEqual(frag.insertionId, op.after.insertionId)) continue;

        const fragEnd = frag.insertionOffset + frag.length;

        if (op.after.offset > frag.insertionOffset && op.after.offset < fragEnd) {
          // The after point falls strictly inside this fragment — split it
          const splitPoint = op.after.offset - frag.insertionOffset;
          const [leftPart, rightPart] = splitFragment(frag, splitPoint);
          frags.splice(i, 1, leftPart, rightPart);
          afterIndex = i; // Insert after leftPart
          break;
        }

        if (fragEnd === op.after.offset) {
          // This fragment ends exactly at the after point
          afterIndex = i;
          // Don't break — there might be a later split fragment that also
          // ends here (if the fragment was previously split at this exact
          // point by another operation). But actually that can't happen:
          // if the fragment was split, the left part ends at the split point
          // and the right part starts there. So this is the correct fragment.
          break;
        }
      }
    }

    // Step 2: Find the fragment referenced by "before" (insert goes before this).
    // We look for the fragment whose insertion range STARTS at the before offset.
    let beforeIndex = frags.length;
    if (!operationIdsEqual(op.before.insertionId, MAX_OPERATION_ID)) {
      for (let i = 0; i < frags.length; i++) {
        const frag = frags[i];
        if (frag === undefined) continue;
        if (!operationIdsEqual(frag.insertionId, op.before.insertionId)) continue;

        const fragEnd = frag.insertionOffset + frag.length;

        if (op.before.offset > frag.insertionOffset && op.before.offset < fragEnd) {
          // The before point falls strictly inside this fragment — split it
          const splitPoint = op.before.offset - frag.insertionOffset;
          const [leftPart, rightPart] = splitFragment(frag, splitPoint);
          frags.splice(i, 1, leftPart, rightPart);
          beforeIndex = i + 1; // Insert before rightPart
          break;
        }

        if (frag.insertionOffset === op.before.offset) {
          // This fragment starts exactly at the before point
          beforeIndex = i;
          break;
        }
      }
    }

    // Step 3: Find the exact position within [afterIndex+1, beforeIndex)
    // using locator comparison for ordering among concurrent inserts.
    const searchStart = afterIndex + 1;
    const searchEnd = Math.min(beforeIndex, frags.length);
    let insertIndex = searchStart;

    for (let i = searchStart; i < searchEnd; i++) {
      const frag = frags[i];
      if (frag === undefined) continue;

      const cmp = compareLocators(op.locator, frag.locator);
      if (cmp < 0) {
        break;
      }
      if (cmp === 0) {
        // Same locator — tie-break by operation ID
        if (compareOperationIds(op.id, frag.insertionId) < 0) {
          break;
        }
      }
      insertIndex = i + 1;
    }

    const newFrags = [...frags.slice(0, insertIndex), newFrag, ...frags.slice(insertIndex)];
    this.fragments = SumTree.fromItems(newFrags, fragmentSummaryOps);
  }

  private applyRemoteDelete(op: DeleteOperation): void {
    this.clock.observe(op.id.counter);
    observeVersion(this._version, op.id.replicaId, op.id.counter);
    mergeVersionVectors(this._version, op.version);

    const frags = this.fragmentsArray();
    const newFrags: Fragment[] = [];

    for (const frag of frags) {
      let matched = false;
      for (const range of op.ranges) {
        if (
          operationIdsEqual(frag.insertionId, range.insertionId) &&
          frag.insertionOffset >= range.offset &&
          frag.insertionOffset + frag.length <= range.offset + range.length
        ) {
          // This fragment falls entirely within a deleted range
          newFrags.push(deleteFragment(frag, op.id));
          matched = true;
          break;
        }
      }
      if (!matched) {
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
