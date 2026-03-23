export * from "./arena/index.js";
export * from "./sum-tree/index.js";
export * from "./rope/index.js";
export * from "./protocol/index.js";

// Anchor module — these are the "public" anchor types
export * from "./anchor/index.js";

// Text module — selectively re-export to avoid conflicts with anchor module.
// The text module's OperationId/ReplicaId/etc. are the CRDT-internal types.
// Use `import { ... } from '@iamnbutler/crdt/text'` for the full text API.
export {
  TEXT_VERSION,
  // TextBuffer and Snapshot
  TextBuffer,
  TextBufferSnapshot,
  // Locator
  MIN_LOCATOR,
  MAX_LOCATOR,
  compareLocators,
  locatorBetween,
  locatorsEqual,
  // Clock
  LamportClock,
  cloneVersionVector,
  createVersionVector,
  generateReplicaId,
  happenedBefore,
  mergeVersionVectors,
  observeVersion,
  versionIncludes,
  versionVectorsEqual,
  // Undo
  UndoMap,
  // Fragment
  createFragment,
  deleteFragment,
  fragmentSummaryOps,
  splitFragment,
  visibleLenDimension,
  visibleLinesDimension,
  withVisibility,
} from "./text/index.js";

export type {
  DeleteOperation,
  DeleteRange,
  Fragment,
  InsertOperation,
  InsertionRef,
  Locator,
  Operation,
  TransactionId,
  UndoOperation,
  VersionVector,
} from "./text/index.js";
