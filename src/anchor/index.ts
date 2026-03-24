/**
 * Anchor Module
 *
 * CRDT anchors are stable positions that reference specific insertion operations.
 * They survive all edits without replay, resolving in O(log n).
 *
 * @example
 * ```ts
 * import { createAnchor, resolveAnchor, Bias, AnchorSet } from "@iamnbutler/crdt/anchor";
 *
 * // Create an anchor at offset 10
 * const anchor = createAnchor(snapshot, 10, Bias.Left);
 *
 * // Later, after edits, resolve to current position
 * const currentOffset = resolveAnchor(newSnapshot, anchor);
 *
 * // For many anchors, use AnchorSet for efficient batch resolution
 * const cursors = new AnchorSet<{ userId: string }>();
 * cursors.add(anchor, { userId: "alice" });
 * const resolved = cursors.resolveAll(snapshot);
 * ```
 */

// Types
export {
  type Anchor,
  Bias,
  type FragmentSummary,
  type InsertionFragment,
  type LocalSeq,
  MAX_ANCHOR,
  MAX_OPERATION_ID,
  MIN_ANCHOR,
  MIN_OPERATION_ID,
  type OperationId,
  type Position,
  type ReplicaId,
  anchorsEqual,
  compareAnchors,
  compareOperationIds,
  operationIdsEqual,
} from "./types.ts";

// Snapshot interface
export {
  type DocumentSnapshot,
  type FragmentVisitor,
  type SeekResult,
  SimpleSnapshot,
} from "./snapshot.ts";

// Anchor functions
export {
  createAnchor,
  createRangeEndAnchor,
  createRangeStartAnchor,
  deserializeAnchor,
  isMaxAnchor,
  isMinAnchor,
  isSentinelAnchor,
  resolveAnchor,
  resolveAnchorRange,
  serializeAnchor,
  withBias,
} from "./anchor.ts";

// AnchorSet
export {
  type AnchorEntry,
  AnchorSet,
  type ResolvedEntry,
} from "./anchor-set.ts";

export const ANCHOR_VERSION = "0.1.0";
