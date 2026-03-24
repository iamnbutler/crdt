export * from "./arena/index.js";
export * from "./sum-tree/index.js";
export * from "./rope/index.js";

// Protocol module - selectively export to avoid conflicts with anchor types
export {
  PROTOCOL_VERSION,
  // Constants
  MAX_QUEUE_SIZE,
  PROTOCOL_MAGIC,
  BINARY_VERSION,
  // Enums
  MessageType,
  OperationType,
  ValidationError,
  // Serialization
  BinaryWriter,
  BinaryReader,
  serializeOperation,
  deserializeOperation,
  serializeOperations,
  deserializeOperations,
  serializeSnapshot,
  deserializeSnapshot,
  // Queue
  OperationQueue,
  // Validation
  validateOperation,
  validateOperationStrict,
  isCausallyReady,
  // Replica ID
  SequentialReplicaIdAssigner,
  generateRandomReplicaId,
  generateSecureReplicaId,
  isValidReplicaId,
  RESERVED_REPLICA_IDS,
  // Awareness
  AwarenessManager,
  AwarenessBroadcaster,
  serializeAwareness,
  deserializeAwareness,
  DEFAULT_AWARENESS_INTERVAL,
  DEFAULT_AWARENESS_TIMEOUT,
  // State Sync
  createSnapshot,
  applySnapshot,
  requiresFullSync,
  snapshotsEqual,
  getSnapshotText,
} from "./protocol/index.js";

export type {
  AwarenessState,
  CursorPosition,
  UserInfo,
  ValidationResult,
  SerializedFragment,
  StateSnapshot,
  SyncRequest,
  OperationAck,
  ProtocolMessage,
  EnqueueResult,
  QueueStats,
  FragmentExistsCallback,
  ApplyOperationCallback,
  ValidationContext,
  AwarenessSendCallback,
  SnapshotSourceContext,
  ApplySnapshotResult,
  DeltaSyncRequest,
} from "./protocol/index.js";

// Branded types for public API
export {
  type ByteOffset,
  type Column,
  type LineColumn,
  type LineNumber,
  type Utf16Offset,
  byteOffset,
  column,
  lineColumn,
  lineNumber,
  utf16Offset,
} from "./types.js";

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
