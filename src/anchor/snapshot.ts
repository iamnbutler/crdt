/**
 * Document Snapshot Interface
 *
 * Defines the interface that a CRDT document must implement to support anchors.
 * The actual implementation lives in the text module; this interface allows
 * the anchor module to work independently.
 */

import type { Anchor, Bias, InsertionFragment, OperationId, Position } from "./types.ts";

/**
 * Callback for iterating over fragments.
 * Return false to stop iteration early.
 */
export type FragmentVisitor = (fragment: InsertionFragment, position: Position) => boolean;

/**
 * Result of seeking to an insertion ID in the fragment index.
 */
export interface SeekResult {
  /** Whether the insertion was found */
  found: boolean;
  /** The fragment containing the insertion (if found) */
  fragment: InsertionFragment | null;
  /** Position at the start of the fragment */
  position: Position;
}

/**
 * Interface for a document snapshot that supports anchor operations.
 *
 * A snapshot represents an immutable view of the document at a point in time.
 * Multiple snapshots can coexist, allowing anchors to be created and resolved
 * against different document states.
 */
export interface DocumentSnapshot {
  /**
   * Total length of the document in UTF-16 code units.
   */
  readonly length: number;

  /**
   * Seek to a fragment by insertion ID and offset.
   * Used for O(log n) anchor resolution.
   *
   * @param insertionId - The operation ID to seek
   * @param offset - Offset within that operation's text
   * @returns SeekResult with the fragment and position
   */
  seekToInsertion(insertionId: OperationId, offset: number): SeekResult;

  /**
   * Find the insertion fragment at a given UTF-16 offset.
   * Used for creating anchors from document positions.
   *
   * @param utf16Offset - Position in the document
   * @param bias - Which direction to prefer at boundaries
   * @returns The anchor at this position
   */
  anchorAtOffset(utf16Offset: number, bias: Bias): Anchor;

  /**
   * Iterate over all fragments in document order.
   * Used for batch anchor resolution.
   *
   * @param visitor - Callback for each fragment
   */
  visitFragments(visitor: FragmentVisitor): void;

  /**
   * Get the visible text content of the document.
   */
  getText(): string;
}

/**
 * A minimal in-memory implementation of DocumentSnapshot for testing.
 * Real implementations will use the text CRDT's fragment tree.
 */
export class SimpleSnapshot implements DocumentSnapshot {
  private readonly fragments: InsertionFragment[];
  private readonly text: string;
  readonly length: number;

  constructor(fragments: InsertionFragment[], text: string) {
    this.fragments = fragments;
    this.text = text;
    this.length = text.length;
  }

  seekToInsertion(insertionId: OperationId, offset: number): SeekResult {
    let utf16Offset = 0;
    let lastMatchingFragment: { fragment: InsertionFragment; utf16Offset: number } | null = null;

    for (const fragment of this.fragments) {
      // Check if this fragment matches the insertion ID
      if (
        fragment.insertionId.replicaId === insertionId.replicaId &&
        fragment.insertionId.localSeq === insertionId.localSeq
      ) {
        // Check if the offset falls within this fragment
        // endOffset is exclusive, so we use < for the upper bound
        if (offset >= fragment.startOffset && offset < fragment.endOffset) {
          const localOffset = offset - fragment.startOffset;
          const position = fragment.isDeleted ? utf16Offset : utf16Offset + localOffset;
          return {
            found: true,
            fragment,
            position: { utf16Offset: position },
          };
        }

        // Track the last fragment with this insertion ID in case offset equals endOffset
        if (offset === fragment.endOffset) {
          lastMatchingFragment = { fragment, utf16Offset };
        }
      }

      // Accumulate position for non-deleted fragments
      if (!fragment.isDeleted) {
        utf16Offset += fragment.utf16Len;
      }
    }

    // Handle case where offset equals the endOffset of a fragment (boundary case)
    if (lastMatchingFragment) {
      const { fragment, utf16Offset: fragOffset } = lastMatchingFragment;
      const position = fragment.isDeleted ? fragOffset : fragOffset + fragment.utf16Len;
      return {
        found: true,
        fragment,
        position: { utf16Offset: position },
      };
    }

    return {
      found: false,
      fragment: null,
      position: { utf16Offset: 0 },
    };
  }

  anchorAtOffset(utf16Offset: number, bias: Bias): Anchor {
    let currentOffset = 0;
    let lastVisibleFragment: InsertionFragment | undefined;

    for (const fragment of this.fragments) {
      if (fragment.isDeleted) continue;

      lastVisibleFragment = fragment;
      const fragmentEnd = currentOffset + fragment.utf16Len;

      // Check if this offset falls within or at the boundary of this fragment
      if (utf16Offset < fragmentEnd) {
        // Strictly inside this fragment
        const localOffset = utf16Offset - currentOffset;
        return {
          insertionId: fragment.insertionId,
          offset: fragment.startOffset + localOffset,
          bias,
        };
      }

      if (utf16Offset === fragmentEnd) {
        // At exact boundary - with Left bias stay here, with Right bias go to next
        if (bias === 0) {
          // Left bias: stay at end of this fragment
          return {
            insertionId: fragment.insertionId,
            offset: fragment.endOffset, // Points to position at end of fragment
            bias,
          };
        }
        // Right bias: continue to next fragment
      }

      currentOffset = fragmentEnd;
    }

    // Past end of document - return anchor to last visible fragment
    if (lastVisibleFragment) {
      return {
        insertionId: lastVisibleFragment.insertionId,
        offset: lastVisibleFragment.endOffset,
        bias,
      };
    }

    // Empty document
    return {
      insertionId: { replicaId: 0, localSeq: 0 },
      offset: 0,
      bias,
    };
  }

  visitFragments(visitor: FragmentVisitor): void {
    let utf16Offset = 0;

    for (const fragment of this.fragments) {
      const position: Position = { utf16Offset };
      const shouldContinue = visitor(fragment, position);
      if (!shouldContinue) break;

      if (!fragment.isDeleted) {
        utf16Offset += fragment.utf16Len;
      }
    }
  }

  getText(): string {
    return this.text;
  }
}
