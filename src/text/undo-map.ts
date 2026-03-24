/**
 * CRDT Undo Map
 *
 * Tracks undo counts per OperationId using max-wins semantics (NOT additive).
 * An operation is considered "undone" when its undo count is odd.
 *
 * Visibility formula:
 *   visible = !isUndone(insertion) && deletions.every(d => isUndone(d))
 *
 * Max-wins ensures that concurrent undos from different replicas converge:
 * if both User A and User B undo the same operation (both set count=1),
 * max(1,1) = 1 (still undone), rather than 1+1 = 2 (re-done).
 */

import type { OperationId } from "./types.js";

/**
 * Key for the undo map. We use a string key derived from (replicaId, counter)
 * for efficient Map lookup.
 */
function undoKey(opId: OperationId): string {
  return `${opId.replicaId}:${opId.counter}`;
}

/**
 * UndoMap stores the highest undo count observed for each OperationId.
 */
export class UndoMap {
  private counts: Map<string, { opId: OperationId; count: number }>;

  constructor() {
    this.counts = new Map();
  }

  /**
   * Get the current undo count for an operation.
   * Returns 0 if no undo has been recorded.
   */
  getCount(opId: OperationId): number {
    const entry = this.counts.get(undoKey(opId));
    return entry !== undefined ? entry.count : 0;
  }

  /**
   * Set the undo count for an operation using max-wins semantics.
   * The stored count is max(existing, newCount).
   */
  setCount(opId: OperationId, newCount: number): void {
    const key = undoKey(opId);
    const existing = this.counts.get(key);
    if (existing === undefined || newCount > existing.count) {
      this.counts.set(key, { opId, count: newCount });
    }
  }

  /**
   * Increment the undo count for an operation.
   * Returns the new count.
   */
  increment(opId: OperationId): number {
    const current = this.getCount(opId);
    const newCount = current + 1;
    this.counts.set(undoKey(opId), { opId, count: newCount });
    return newCount;
  }

  /**
   * Check if an operation is currently undone (odd undo count).
   */
  isUndone(opId: OperationId): boolean {
    return this.getCount(opId) % 2 === 1;
  }

  /**
   * Determine fragment visibility using the CRDT undo formula:
   *   visible = !isUndone(insertionId) && deletions.every(d => isUndone(d))
   */
  isVisible(insertionId: OperationId, deletions: ReadonlyArray<OperationId>): boolean {
    // If the insertion itself is undone, the fragment is not visible
    if (this.isUndone(insertionId)) {
      return false;
    }

    // All deletions must be undone for the fragment to be visible
    for (const deletion of deletions) {
      if (!this.isUndone(deletion)) {
        return false;
      }
    }

    // No un-undone deletions: fragment is visible
    // (An empty deletions array means the fragment was never deleted)
    return true;
  }

  /**
   * Merge remote undo counts into this map using max-wins semantics.
   */
  mergeFrom(entries: ReadonlyArray<{ operationId: OperationId; count: number }>): void {
    for (const entry of entries) {
      this.setCount(entry.operationId, entry.count);
    }
  }

  /**
   * Get all entries in the undo map (for serialization or sync).
   */
  entries(): Array<{ operationId: OperationId; count: number }> {
    const result: Array<{ operationId: OperationId; count: number }> = [];
    for (const entry of this.counts.values()) {
      result.push({ operationId: entry.opId, count: entry.count });
    }
    return result;
  }

  /**
   * Get undo counts for a set of specific operation IDs.
   */
  getCountsFor(
    opIds: ReadonlyArray<OperationId>,
  ): Array<{ operationId: OperationId; count: number }> {
    const result: Array<{ operationId: OperationId; count: number }> = [];
    for (const opId of opIds) {
      const count = this.getCount(opId);
      if (count > 0) {
        result.push({ operationId: opId, count });
      }
    }
    return result;
  }
}
