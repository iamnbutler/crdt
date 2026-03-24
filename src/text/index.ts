/**
 * Text CRDT Module
 *
 * The CRDT text buffer stores text as a sequence of Fragments, with
 * Lamport clocks for identity, version vectors for causality, and
 * an undo map for reversible operations.
 *
 * @example
 * ```ts
 * import { TextBuffer } from "@iamnbutler/crdt/text";
 *
 * const buffer = TextBuffer.fromString("Hello, world!");
 * buffer.insert(7, "CRDT ");
 * console.log(buffer.getText()); // "Hello, CRDT world!"
 *
 * const snap = buffer.snapshot();
 * console.log(snap.lineCount); // 1
 * snap.release();
 * ```
 */

export const TEXT_VERSION = "0.1.0";

// Types
export type {
  DeleteOperation,
  DeleteRange,
  Fragment,
  FragmentSummary,
  InsertOperation,
  InsertionRef,
  Locator,
  Operation,
  OperationId,
  ReplicaId,
  TransactionId,
  UndoOperation,
  VersionVector,
} from "./types.js";

export {
  MIN_OPERATION_ID,
  MAX_OPERATION_ID,
  compareOperationIds,
  operationIdsEqual,
  replicaId,
  transactionId,
} from "./types.js";

// Locator
export {
  MIN_LOCATOR,
  MAX_LOCATOR,
  compareLocators,
  locatorBetween,
  locatorsEqual,
} from "./locator.js";

// Clock
export {
  LamportClock,
  cloneVersionVector,
  createVersionVector,
  generateReplicaId,
  happenedBefore,
  mergeVersionVectors,
  observeVersion,
  versionIncludes,
  versionVectorsEqual,
} from "./clock.js";

// Undo
export { UndoMap } from "./undo-map.js";

// Fragment
export {
  createFragment,
  deleteFragment,
  fragmentSummaryOps,
  splitFragment,
  visibleLenDimension,
  visibleLinesDimension,
  withVisibility,
} from "./fragment.js";

// TextBuffer
export { TextBuffer } from "./text-buffer.js";

// Snapshot
export {
  TextBufferSnapshot,
  createSnapshot,
  DEFAULT_MAX_SNAPSHOT_AGE_MS,
  type SnapshotOptions,
} from "./snapshot.js";
