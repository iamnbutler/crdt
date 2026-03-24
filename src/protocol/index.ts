/**
 * CRDT Sync Protocol
 *
 * This module provides everything needed for multi-replica collaboration:
 * - Operation serialization (binary format)
 * - Causal ordering and operation queuing
 * - Operation validation
 * - Replica ID assignment
 * - Awareness state (cursors, users)
 * - State snapshot sync
 *
 * @example
 * ```ts
 * import {
 *   serializeOperation,
 *   deserializeOperation,
 *   OperationQueue,
 *   AwarenessManager,
 * } from "@iamnbutler/crdt/protocol";
 *
 * // Serialize an operation for sending over the wire
 * const bytes = serializeOperation(operation);
 *
 * // Deserialize received data
 * const op = deserializeOperation(bytes);
 *
 * // Manage deferred operations
 * const queue = new OperationQueue();
 * queue.enqueue(op, fragmentExists, applyOp, localVersion);
 * ```
 */

export const PROTOCOL_VERSION = "0.1.0";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export {
  // Protocol constants
  MAX_QUEUE_SIZE,
  PROTOCOL_MAGIC,
  BINARY_VERSION,
  // Enums
  MessageType,
  OperationType,
  ValidationError,
  // Awareness types
  type AwarenessState,
  type CursorPosition,
  type UserInfo,
  // Validation types
  type ValidationResult,
  // Sync types
  type SerializedFragment,
  type StateSnapshot,
  type SyncRequest,
  type OperationAck,
  type ProtocolMessage,
} from "./types.js";

// Re-export text types under protocol namespace for convenience
// (These are also available from @iamnbutler/crdt/text)
export type {
  Operation,
  InsertOperation,
  DeleteOperation,
  UndoOperation,
  OperationId,
  ReplicaId,
  VersionVector,
} from "../text/types.js";

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

export {
  // Binary writer/reader (for advanced use)
  BinaryWriter,
  BinaryReader,
  // Operation serialization
  serializeOperation,
  deserializeOperation,
  serializeOperations,
  deserializeOperations,
  // Snapshot serialization
  serializeSnapshot,
  deserializeSnapshot,
} from "./serialization.js";

// ---------------------------------------------------------------------------
// Operation Queue
// ---------------------------------------------------------------------------

export {
  OperationQueue,
  type EnqueueResult,
  type QueueStats,
  type FragmentExistsCallback,
  type ApplyOperationCallback,
} from "./operation-queue.js";

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export {
  validateOperation,
  validateOperationStrict,
  isCausallyReady,
  type ValidationContext,
} from "./validation.js";

// ---------------------------------------------------------------------------
// Replica ID Assignment
// ---------------------------------------------------------------------------

export {
  SequentialReplicaIdAssigner,
  generateRandomReplicaId,
  generateSecureReplicaId,
  isValidReplicaId,
  RESERVED_REPLICA_IDS,
} from "./replica-id.js";

// ---------------------------------------------------------------------------
// Awareness
// ---------------------------------------------------------------------------

export {
  AwarenessManager,
  AwarenessBroadcaster,
  serializeAwareness,
  deserializeAwareness,
  DEFAULT_AWARENESS_INTERVAL,
  DEFAULT_AWARENESS_TIMEOUT,
  type AwarenessSendCallback,
} from "./awareness.js";

// ---------------------------------------------------------------------------
// State Sync
// ---------------------------------------------------------------------------

export {
  createSnapshot,
  applySnapshot,
  requiresFullSync,
  snapshotsEqual,
  getSnapshotText,
  type SnapshotSourceContext,
  type ApplySnapshotResult,
  type DeltaSyncRequest,
} from "./state-sync.js";
