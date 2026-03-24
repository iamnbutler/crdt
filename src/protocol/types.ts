/**
 * Protocol types for CRDT collaboration.
 *
 * This module defines the wire format types, awareness state, and
 * protocol messages for multi-replica synchronization.
 */

import type {
  DeleteOperation,
  InsertOperation,
  Operation,
  OperationId,
  ReplicaId,
  UndoOperation,
  VersionVector,
} from "../text/types.js";

// ---------------------------------------------------------------------------
// Protocol Constants
// ---------------------------------------------------------------------------

/** Maximum number of pending operations before triggering full sync. */
export const MAX_QUEUE_SIZE = 10_000;

/** Magic bytes for binary format identification. */
export const PROTOCOL_MAGIC = 0x43524454; // "CRDT" in ASCII

/** Current binary protocol version. */
export const BINARY_VERSION = 1;

// ---------------------------------------------------------------------------
// Message Types
// ---------------------------------------------------------------------------

/** Message type discriminators for binary protocol. */
export enum MessageType {
  /** Single operation message. */
  Operation = 1,
  /** Full state snapshot for initial sync or recovery. */
  StateSnapshot = 2,
  /** Awareness update (ephemeral). */
  Awareness = 3,
  /** Request full state sync. */
  SyncRequest = 4,
  /** Acknowledgment of received operations. */
  Ack = 5,
}

/** Operation type discriminators for binary protocol. */
export enum OperationType {
  Insert = 1,
  Delete = 2,
  Undo = 3,
}

// ---------------------------------------------------------------------------
// Awareness State
// ---------------------------------------------------------------------------

/** Cursor position in a document. */
export interface CursorPosition {
  /** UTF-16 offset in the document. */
  readonly offset: number;
  /** Optional selection anchor (for range selections). */
  readonly anchorOffset?: number;
}

/** User information for awareness display. */
export interface UserInfo {
  /** Display name for the user. */
  readonly name: string;
  /** Optional color for cursor/selection rendering. */
  readonly color?: string;
  /** Optional avatar URL. */
  readonly avatarUrl?: string;
}

/**
 * Per-replica awareness state.
 * Ephemeral data that is not part of the CRDT state.
 */
export interface AwarenessState {
  /** The replica this awareness belongs to. */
  readonly replicaId: ReplicaId;
  /** Primary cursor position. */
  readonly cursor?: CursorPosition;
  /** User information. */
  readonly user?: UserInfo;
  /** Last update timestamp (local clock). */
  readonly timestamp: number;
  /** Custom application-specific data. */
  readonly custom?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Validation Results
// ---------------------------------------------------------------------------

/** Validation error codes. */
export enum ValidationError {
  /** Operation is valid. */
  None = 0,
  /** Replica ID doesn't match expected sender. */
  InvalidReplicaId = 1,
  /** Counter is not sequential for this replica. */
  NonSequentialCounter = 2,
  /** Version vector is inconsistent with operation. */
  InconsistentVersion = 3,
  /** Operation references unknown fragments. */
  UnknownReference = 4,
  /** Insert text is empty but should not be. */
  EmptyInsert = 5,
  /** Delete ranges are invalid. */
  InvalidDeleteRange = 6,
}

/** Result of operation validation. */
export interface ValidationResult {
  readonly valid: boolean;
  readonly error: ValidationError;
  readonly message?: string;
}

// ---------------------------------------------------------------------------
// Sync Protocol Types
// ---------------------------------------------------------------------------

/** Fragment data for state snapshot serialization. */
export interface SerializedFragment {
  readonly insertionId: OperationId;
  readonly insertionOffset: number;
  readonly locatorLevels: ReadonlyArray<number>;
  readonly baseLocatorLevels: ReadonlyArray<number>;
  readonly length: number;
  readonly visible: boolean;
  readonly deletions: ReadonlyArray<OperationId>;
  readonly text: string;
}

/** Full state snapshot for initial sync or recovery. */
export interface StateSnapshot {
  /** Protocol version. */
  readonly version: number;
  /** Replica that created this snapshot. */
  readonly replicaId: ReplicaId;
  /** Version vector at time of snapshot. */
  readonly versionVector: VersionVector;
  /** All fragments in document order. */
  readonly fragments: ReadonlyArray<SerializedFragment>;
  /** Undo counts for all operations. */
  readonly undoCounts: ReadonlyArray<{ operationId: OperationId; count: number }>;
}

/** Request for full state synchronization. */
export interface SyncRequest {
  /** Replica requesting sync. */
  readonly replicaId: ReplicaId;
  /** Current version vector (may be empty for initial sync). */
  readonly versionVector: VersionVector;
}

/** Acknowledgment of received operations. */
export interface OperationAck {
  /** Replica sending the ack. */
  readonly replicaId: ReplicaId;
  /** Highest operation ID acknowledged per replica. */
  readonly acknowledged: VersionVector;
}

// ---------------------------------------------------------------------------
// Protocol Message Union
// ---------------------------------------------------------------------------

export type ProtocolMessage =
  | { readonly type: MessageType.Operation; readonly operation: Operation }
  | { readonly type: MessageType.StateSnapshot; readonly snapshot: StateSnapshot }
  | { readonly type: MessageType.Awareness; readonly state: AwarenessState }
  | { readonly type: MessageType.SyncRequest; readonly request: SyncRequest }
  | { readonly type: MessageType.Ack; readonly ack: OperationAck };

// ---------------------------------------------------------------------------
// Re-exports
// ---------------------------------------------------------------------------

export type {
  DeleteOperation,
  InsertOperation,
  Operation,
  OperationId,
  ReplicaId,
  UndoOperation,
  VersionVector,
};
