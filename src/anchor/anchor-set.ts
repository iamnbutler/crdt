/**
 * AnchorSet<T>
 *
 * A collection for managing multiple anchors with associated data.
 * Useful for decorations, diagnostics, cursors, bookmarks, etc.
 *
 * Features:
 * - Efficient batch resolution via single tree traversal
 * - Generic type parameter for associated data
 * - Add/remove/update operations
 */

import { resolveAnchor } from "./anchor.ts";
import type { DocumentSnapshot, FragmentVisitor } from "./snapshot.ts";
import { type Anchor, type OperationId, anchorsEqual, compareAnchors } from "./types.ts";

/**
 * Entry in the anchor set: an anchor paired with user data.
 */
export interface AnchorEntry<T> {
  readonly anchor: Anchor;
  readonly data: T;
}

/**
 * Result of resolving an anchor: position plus the associated data.
 */
export interface ResolvedEntry<T> {
  readonly offset: number;
  readonly data: T;
  readonly anchor: Anchor;
}

/**
 * Unique identifier for entries in the set.
 */
type EntryId = number;

/**
 * AnchorSet manages a collection of anchors with associated data.
 *
 * @typeParam T - The type of data associated with each anchor
 *
 * @example
 * ```ts
 * // Create an anchor set for cursor positions
 * const cursors = new AnchorSet<{ userId: string; color: string }>();
 *
 * // Add a cursor
 * const id = cursors.add(anchor, { userId: "alice", color: "blue" });
 *
 * // Resolve all cursors efficiently
 * const resolved = cursors.resolveAll(snapshot);
 * ```
 */
export class AnchorSet<T> {
  private entries: Map<EntryId, AnchorEntry<T>> = new Map();
  private nextId: EntryId = 0;

  /** Index by insertion ID for efficient batch resolution */
  private byInsertionId: Map<string, Set<EntryId>> = new Map();

  /**
   * Number of anchors in the set.
   */
  get size(): number {
    return this.entries.size;
  }

  /**
   * Add an anchor with associated data.
   *
   * @param anchor - The anchor to add
   * @param data - Data associated with the anchor
   * @returns A unique ID for the entry
   */
  add(anchor: Anchor, data: T): EntryId {
    const id = this.nextId++;
    const entry: AnchorEntry<T> = { anchor, data };

    this.entries.set(id, entry);
    this.indexEntry(id, anchor.insertionId);

    return id;
  }

  /**
   * Remove an anchor by its ID.
   *
   * @param id - The entry ID returned from add()
   * @returns true if the entry existed and was removed
   */
  remove(id: EntryId): boolean {
    const entry = this.entries.get(id);
    if (!entry) return false;

    this.unindexEntry(id, entry.anchor.insertionId);
    this.entries.delete(id);

    return true;
  }

  /**
   * Get an entry by its ID.
   *
   * @param id - The entry ID
   * @returns The entry, or undefined if not found
   */
  get(id: EntryId): AnchorEntry<T> | undefined {
    return this.entries.get(id);
  }

  /**
   * Check if an entry exists.
   *
   * @param id - The entry ID
   * @returns true if the entry exists
   */
  has(id: EntryId): boolean {
    return this.entries.has(id);
  }

  /**
   * Update the data for an entry.
   *
   * @param id - The entry ID
   * @param data - New data to associate with the anchor
   * @returns true if the entry existed and was updated
   */
  updateData(id: EntryId, data: T): boolean {
    const entry = this.entries.get(id);
    if (!entry) return false;

    this.entries.set(id, { anchor: entry.anchor, data });
    return true;
  }

  /**
   * Update the anchor for an entry (e.g., after user moves a cursor).
   *
   * @param id - The entry ID
   * @param anchor - New anchor
   * @returns true if the entry existed and was updated
   */
  updateAnchor(id: EntryId, anchor: Anchor): boolean {
    const entry = this.entries.get(id);
    if (!entry) return false;

    // Update index
    this.unindexEntry(id, entry.anchor.insertionId);
    this.indexEntry(id, anchor.insertionId);

    this.entries.set(id, { anchor, data: entry.data });
    return true;
  }

  /**
   * Clear all entries from the set.
   */
  clear(): void {
    this.entries.clear();
    this.byInsertionId.clear();
    this.nextId = 0;
  }

  /**
   * Iterate over all entries.
   */
  *[Symbol.iterator](): IterableIterator<[EntryId, AnchorEntry<T>]> {
    yield* this.entries;
  }

  /**
   * Get all entries as an array.
   */
  toArray(): Array<{ id: EntryId; entry: AnchorEntry<T> }> {
    const result: Array<{ id: EntryId; entry: AnchorEntry<T> }> = [];
    for (const [id, entry] of this.entries) {
      result.push({ id, entry });
    }
    return result;
  }

  /**
   * Resolve a single anchor to its current offset.
   * For bulk operations, use resolveAll() instead.
   *
   * @param id - The entry ID
   * @param snapshot - The document snapshot
   * @returns The resolved position, or undefined if entry not found
   */
  resolve(id: EntryId, snapshot: DocumentSnapshot): ResolvedEntry<T> | undefined {
    const entry = this.entries.get(id);
    if (!entry) return undefined;

    return {
      offset: resolveAnchor(snapshot, entry.anchor),
      data: entry.data,
      anchor: entry.anchor,
    };
  }

  /**
   * Resolve all anchors in a single tree traversal.
   *
   * This is more efficient than calling resolve() multiple times,
   * especially for large numbers of anchors, as it processes
   * fragments in document order and accumulates positions.
   *
   * @param snapshot - The document snapshot
   * @returns Array of resolved entries in document order
   */
  resolveAll(snapshot: DocumentSnapshot): ResolvedEntry<T>[] {
    if (this.entries.size === 0) {
      return [];
    }

    // Map from entry ID to resolved offset
    const resolved = new Map<EntryId, number>();

    // Group entries by insertion ID for efficient lookup during traversal
    const pendingByInsertion = new Map<string, Array<{ id: EntryId; entry: AnchorEntry<T> }>>();

    for (const [id, entry] of this.entries) {
      const key = operationIdKey(entry.anchor.insertionId);
      const list = pendingByInsertion.get(key);
      if (list) {
        list.push({ id, entry });
      } else {
        pendingByInsertion.set(key, [{ id, entry }]);
      }
    }

    // Track how many we've resolved
    let resolvedCount = 0;
    const totalCount = this.entries.size;

    // Traverse fragments in document order
    const visitor: FragmentVisitor = (fragment, position) => {
      // Check if any entries reference this fragment's insertion
      const key = operationIdKey(fragment.insertionId);
      const pending = pendingByInsertion.get(key);

      if (pending) {
        for (const { id, entry } of pending) {
          // Check if this entry's offset falls within this fragment
          if (
            entry.anchor.offset >= fragment.startOffset &&
            entry.anchor.offset < fragment.endOffset
          ) {
            // Calculate position within fragment
            const localOffset = entry.anchor.offset - fragment.startOffset;
            const globalOffset = fragment.isDeleted
              ? position.utf16Offset // Deleted fragment: position stays at fragment start
              : position.utf16Offset + localOffset;

            resolved.set(id, globalOffset);
            resolvedCount++;
          }
        }
      }

      // Continue until all resolved
      return resolvedCount < totalCount;
    };

    snapshot.visitFragments(visitor);

    // Handle unresolved entries (deleted content or sentinel anchors)
    for (const [id, entry] of this.entries) {
      if (!resolved.has(id)) {
        // Fall back to individual resolution
        resolved.set(id, resolveAnchor(snapshot, entry.anchor));
      }
    }

    // Build result array
    const result: ResolvedEntry<T>[] = [];
    for (const [id, offset] of resolved) {
      const entry = this.entries.get(id);
      if (entry) {
        result.push({
          offset,
          data: entry.data,
          anchor: entry.anchor,
        });
      }
    }

    // Sort by offset (document order)
    result.sort((a, b) => {
      if (a.offset !== b.offset) return a.offset - b.offset;
      // Stable sort by anchor for ties
      return compareAnchors(a.anchor, b.anchor);
    });

    return result;
  }

  /**
   * Get all entries in a given offset range.
   *
   * @param snapshot - The document snapshot
   * @param startOffset - Start of range (inclusive)
   * @param endOffset - End of range (exclusive)
   * @returns Resolved entries within the range
   */
  resolveInRange(
    snapshot: DocumentSnapshot,
    startOffset: number,
    endOffset: number,
  ): ResolvedEntry<T>[] {
    const all = this.resolveAll(snapshot);
    return all.filter((e) => e.offset >= startOffset && e.offset < endOffset);
  }

  /**
   * Find entries that reference a specific anchor.
   *
   * @param anchor - The anchor to search for
   * @returns Array of entry IDs with matching anchors
   */
  findByAnchor(anchor: Anchor): EntryId[] {
    const result: EntryId[] = [];
    for (const [id, entry] of this.entries) {
      if (anchorsEqual(entry.anchor, anchor)) {
        result.push(id);
      }
    }
    return result;
  }

  // --- Private helpers ---

  private indexEntry(id: EntryId, insertionId: OperationId): void {
    const key = operationIdKey(insertionId);
    const set = this.byInsertionId.get(key);
    if (set) {
      set.add(id);
    } else {
      this.byInsertionId.set(key, new Set([id]));
    }
  }

  private unindexEntry(id: EntryId, insertionId: OperationId): void {
    const key = operationIdKey(insertionId);
    const set = this.byInsertionId.get(key);
    if (set) {
      set.delete(id);
      if (set.size === 0) {
        this.byInsertionId.delete(key);
      }
    }
  }
}

/**
 * Create a string key for an OperationId (for Map indexing).
 */
function operationIdKey(id: OperationId): string {
  return `${id.replicaId}:${id.localSeq}`;
}
