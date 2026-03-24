/**
 * Anchor Types
 *
 * CRDT anchors are stable positions that reference a specific insertion operation.
 * They survive all edits without replay, resolving in O(log n) via InsertionFragment index.
 */

/**
 * Unique identifier for a replica/site in the CRDT system.
 * Together with a local sequence number, forms an OperationId.
 */
export type ReplicaId = number;

/**
 * Local sequence number within a replica.
 * Monotonically increasing for each operation from a replica.
 */
export type LocalSeq = number;

/**
 * Unique identifier for an operation in the CRDT.
 * Composed of (replicaId, localSeq) - globally unique across all replicas.
 */
export interface OperationId {
  readonly replicaId: ReplicaId;
  readonly localSeq: LocalSeq;
}

/**
 * Bias determines which side of a position an anchor prefers
 * when characters are inserted exactly at that position.
 *
 * - Left: anchor stays before insertions at this position (cursor-like)
 * - Right: anchor stays after insertions at this position (marker-like)
 */
export const Bias = {
  Left: 0,
  Right: 1,
} as const;

export type Bias = (typeof Bias)[keyof typeof Bias];

/**
 * An anchor is a stable position reference that survives edits.
 * It references the insertion operation that created the character at this position.
 */
export interface Anchor {
  /** Which operation created the character this anchor references */
  readonly insertionId: OperationId;
  /** Offset within that operation's inserted text (0-based) */
  readonly offset: number;
  /** Bias for handling insertions at this position */
  readonly bias: Bias;
}

/**
 * Sentinel OperationId for MIN_ANCHOR (document start)
 */
export const MIN_OPERATION_ID: OperationId = {
  replicaId: 0,
  localSeq: 0,
};

/**
 * Sentinel OperationId for MAX_ANCHOR (document end)
 */
export const MAX_OPERATION_ID: OperationId = {
  replicaId: 0xffffffff,
  localSeq: 0xffffffff,
};

/**
 * Anchor representing the start of the document.
 * Always resolves to offset 0.
 */
export const MIN_ANCHOR: Anchor = {
  insertionId: MIN_OPERATION_ID,
  offset: 0,
  bias: Bias.Right,
};

/**
 * Anchor representing the end of the document.
 * Always resolves to the document length.
 */
export const MAX_ANCHOR: Anchor = {
  insertionId: MAX_OPERATION_ID,
  offset: 0,
  bias: Bias.Left,
};

/**
 * A fragment of text from a single insertion operation.
 * Fragments may be split when concurrent edits interleave.
 */
export interface InsertionFragment {
  /** The operation that created this text */
  readonly insertionId: OperationId;
  /** Start offset within the original operation's text */
  readonly startOffset: number;
  /** End offset within the original operation's text (exclusive) */
  readonly endOffset: number;
  /** Whether this fragment has been deleted (tombstone) */
  readonly isDeleted: boolean;
  /** UTF-16 length of this fragment (if not deleted) */
  readonly utf16Len: number;
}

/**
 * Summary data for efficient tree traversal.
 * Accumulated during tree descent to resolve anchors in O(log n).
 */
export interface FragmentSummary {
  /** Total UTF-16 length of visible (non-deleted) text */
  readonly utf16Len: number;
  /** Total number of fragments */
  readonly fragmentCount: number;
}

/**
 * Position within the document, accumulated during tree traversal.
 */
export interface Position {
  /** Current UTF-16 offset from document start */
  utf16Offset: number;
}

/**
 * Comparison function for OperationIds.
 * Returns negative if a < b, zero if a === b, positive if a > b.
 */
export function compareOperationIds(a: OperationId, b: OperationId): number {
  if (a.replicaId !== b.replicaId) {
    return a.replicaId - b.replicaId;
  }
  return a.localSeq - b.localSeq;
}

/**
 * Check if two OperationIds are equal.
 */
export function operationIdsEqual(a: OperationId, b: OperationId): boolean {
  return a.replicaId === b.replicaId && a.localSeq === b.localSeq;
}

/**
 * Check if two Anchors reference the same position.
 */
export function anchorsEqual(a: Anchor, b: Anchor): boolean {
  return (
    operationIdsEqual(a.insertionId, b.insertionId) && a.offset === b.offset && a.bias === b.bias
  );
}

/**
 * Compare two anchors for ordering.
 * Returns negative if a < b, zero if a === b, positive if a > b.
 */
export function compareAnchors(a: Anchor, b: Anchor): number {
  const idCmp = compareOperationIds(a.insertionId, b.insertionId);
  if (idCmp !== 0) return idCmp;
  if (a.offset !== b.offset) return a.offset - b.offset;
  return a.bias - b.bias;
}
