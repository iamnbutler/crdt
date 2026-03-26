/**
 * Anchor Functions
 *
 * Core functions for creating and resolving CRDT anchors.
 * Anchors are stable positions that survive edits without replay.
 */

import type { DocumentSnapshot } from "./snapshot.ts";
import {
  type Anchor,
  Bias,
  MAX_ANCHOR,
  MAX_OPERATION_ID,
  MIN_ANCHOR,
  MIN_OPERATION_ID,
  anchorsEqual,
  operationIdsEqual,
} from "./types.ts";

/**
 * Create an anchor at a given UTF-16 offset in the document.
 *
 * The anchor references the insertion operation that created the character
 * at this position, making it stable across concurrent edits.
 *
 * @param snapshot - The document snapshot to create the anchor in
 * @param utf16Offset - Position in UTF-16 code units
 * @param bias - Which direction to prefer at boundaries
 * @returns An anchor at the specified position
 *
 * @example
 * ```ts
 * const anchor = createAnchor(snapshot, 5, Bias.Left);
 * // Later, even after edits:
 * const newOffset = resolveAnchor(newSnapshot, anchor);
 * ```
 */
export function createAnchor(snapshot: DocumentSnapshot, utf16Offset: number, bias: Bias): Anchor {
  // Clamp offset to valid range
  const clampedOffset = Math.max(0, Math.min(utf16Offset, snapshot.length));

  // Handle edge cases
  if (snapshot.length === 0) {
    return bias === Bias.Left ? MIN_ANCHOR : MAX_ANCHOR;
  }

  if (clampedOffset === 0 && bias === Bias.Left) {
    return MIN_ANCHOR;
  }

  if (clampedOffset === snapshot.length && bias === Bias.Right) {
    return MAX_ANCHOR;
  }

  return snapshot.anchorAtOffset(clampedOffset, bias);
}

/**
 * Resolve an anchor to its current UTF-16 offset in the document.
 *
 * This operation is O(log n) using the InsertionFragment index,
 * where n is the number of fragments in the document.
 *
 * @param snapshot - The document snapshot to resolve against
 * @param anchor - The anchor to resolve
 * @returns The current UTF-16 offset of the anchor
 *
 * @example
 * ```ts
 * const offset = resolveAnchor(snapshot, anchor);
 * // offset is the current position of the anchored character
 * ```
 */
export function resolveAnchor(snapshot: DocumentSnapshot, anchor: Anchor): number {
  // Handle sentinel anchors
  if (isMinAnchor(anchor)) {
    return 0;
  }

  if (isMaxAnchor(anchor)) {
    return snapshot.length;
  }

  // Seek to the insertion fragment
  const result = snapshot.seekToInsertion(anchor.insertionId, anchor.offset);

  if (!result.found) {
    // Insertion was deleted - resolve based on bias
    // For deleted content, we return the position where it would have been
    // A more sophisticated implementation would track tombstones
    return anchor.bias === Bias.Left ? 0 : snapshot.length;
  }

  return result.position.utf16Offset;
}

/**
 * Check if an anchor is the MIN_ANCHOR sentinel.
 */
export function isMinAnchor(anchor: Anchor): boolean {
  return operationIdsEqual(anchor.insertionId, MIN_OPERATION_ID);
}

/**
 * Check if an anchor is the MAX_ANCHOR sentinel.
 */
export function isMaxAnchor(anchor: Anchor): boolean {
  return operationIdsEqual(anchor.insertionId, MAX_OPERATION_ID);
}

/**
 * Check if an anchor is a sentinel (MIN or MAX).
 */
export function isSentinelAnchor(anchor: Anchor): boolean {
  return isMinAnchor(anchor) || isMaxAnchor(anchor);
}

/**
 * Create an anchor that tracks the start of a range.
 * Uses Right bias so it stays at the start when content is inserted.
 */
export function createRangeStartAnchor(snapshot: DocumentSnapshot, utf16Offset: number): Anchor {
  return createAnchor(snapshot, utf16Offset, Bias.Right);
}

/**
 * Create an anchor that tracks the end of a range.
 * Uses Left bias so it stays at the end when content is inserted.
 */
export function createRangeEndAnchor(snapshot: DocumentSnapshot, utf16Offset: number): Anchor {
  return createAnchor(snapshot, utf16Offset, Bias.Left);
}

/**
 * Resolve a range defined by two anchors.
 *
 * @returns Object with start and end offsets, plus whether the range is collapsed
 */
export function resolveAnchorRange(
  snapshot: DocumentSnapshot,
  startAnchor: Anchor,
  endAnchor: Anchor,
): { start: number; end: number; collapsed: boolean } {
  const start = resolveAnchor(snapshot, startAnchor);
  const end = resolveAnchor(snapshot, endAnchor);

  // Ensure start <= end (ranges can flip due to edits)
  const normalizedStart = Math.min(start, end);
  const normalizedEnd = Math.max(start, end);

  return {
    start: normalizedStart,
    end: normalizedEnd,
    collapsed: normalizedStart === normalizedEnd,
  };
}

/**
 * Create a cloned anchor with a different bias.
 */
export function withBias(anchor: Anchor, bias: Bias): Anchor {
  if (anchor.bias === bias) return anchor;
  return {
    insertionId: anchor.insertionId,
    offset: anchor.offset,
    bias,
  };
}

/**
 * Serialize an anchor to a compact string representation.
 * Format: "replicaId:localSeq:offset:bias"
 */
export function serializeAnchor(anchor: Anchor): string {
  return `${anchor.insertionId.replicaId}:${anchor.insertionId.localSeq}:${anchor.offset}:${anchor.bias}`;
}

/**
 * Deserialize an anchor from string representation.
 * Returns null if the string is invalid.
 */
export function deserializeAnchor(str: string): Anchor | null {
  const parts = str.split(":");
  if (parts.length !== 4) return null;

  const replicaIdStr = parts[0];
  const localSeqStr = parts[1];
  const offsetStr = parts[2];
  const biasStr = parts[3];

  if (
    replicaIdStr === undefined ||
    localSeqStr === undefined ||
    offsetStr === undefined ||
    biasStr === undefined
  ) {
    return null;
  }

  const replicaId = Number.parseInt(replicaIdStr, 10);
  const localSeq = Number.parseInt(localSeqStr, 10);
  const offset = Number.parseInt(offsetStr, 10);
  const bias = Number.parseInt(biasStr, 10);

  if (
    Number.isNaN(replicaId) ||
    Number.isNaN(localSeq) ||
    Number.isNaN(offset) ||
    (bias !== 0 && bias !== 1)
  ) {
    return null;
  }

  return {
    insertionId: { replicaId, localSeq },
    offset,
    bias: bias as Bias,
  };
}

export { anchorsEqual };
