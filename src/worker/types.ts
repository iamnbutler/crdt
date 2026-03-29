/**
 * Worker Protocol Types
 *
 * Defines the message protocol between the main thread and the CRDT worker.
 * All communication is via postMessage with structured clone serialization.
 */

import type { Operation, ReplicaId, VersionVector } from "../text/types.js";

// ---------------------------------------------------------------------------
// Request messages (main thread → worker)
// ---------------------------------------------------------------------------

/** Create a new empty TextBuffer in the worker. */
export interface CreateRequest {
  readonly type: "create";
  readonly id: number;
  readonly replicaId?: ReplicaId;
}

/** Create a TextBuffer from initial text. */
export interface FromStringRequest {
  readonly type: "fromString";
  readonly id: number;
  readonly text: string;
  readonly replicaId?: ReplicaId;
}

/** Insert text at a position. */
export interface InsertRequest {
  readonly type: "insert";
  readonly id: number;
  readonly offset: number;
  readonly text: string;
}

/** Delete a range of text. */
export interface DeleteRequest {
  readonly type: "delete";
  readonly id: number;
  readonly start: number;
  readonly end: number;
}

/** Undo the last transaction. */
export interface UndoRequest {
  readonly type: "undo";
  readonly id: number;
}

/** Redo the last undone transaction. */
export interface RedoRequest {
  readonly type: "redo";
  readonly id: number;
}

/** Apply a remote operation. */
export interface ApplyRemoteRequest {
  readonly type: "applyRemote";
  readonly id: number;
  readonly operation: Operation;
}

/** Apply a batch of remote operations. */
export interface ApplyRemoteBatchRequest {
  readonly type: "applyRemoteBatch";
  readonly id: number;
  readonly operations: ReadonlyArray<Operation>;
}

/** Get the current text content. */
export interface GetTextRequest {
  readonly type: "getText";
  readonly id: number;
}

/** Get the current document length. */
export interface GetLengthRequest {
  readonly type: "getLength";
  readonly id: number;
}

/** Get the version vector. */
export interface GetVersionRequest {
  readonly type: "getVersion";
  readonly id: number;
}

/** Set the undo group delay. */
export interface SetGroupDelayRequest {
  readonly type: "setGroupDelay";
  readonly id: number;
  readonly ms: number;
}

/** All possible request messages. */
export type WorkerRequest =
  | CreateRequest
  | FromStringRequest
  | InsertRequest
  | DeleteRequest
  | UndoRequest
  | RedoRequest
  | ApplyRemoteRequest
  | ApplyRemoteBatchRequest
  | GetTextRequest
  | GetLengthRequest
  | GetVersionRequest
  | SetGroupDelayRequest;

// ---------------------------------------------------------------------------
// Response messages (worker → main thread)
// ---------------------------------------------------------------------------

/** Successful response with an operation (insert/delete/undo/redo). */
export interface OperationResponse {
  readonly type: "operation";
  readonly id: number;
  readonly operation: Operation | null;
}

/** Successful response with text content. */
export interface TextResponse {
  readonly type: "text";
  readonly id: number;
  readonly text: string;
}

/** Successful response with document length. */
export interface LengthResponse {
  readonly type: "length";
  readonly id: number;
  readonly length: number;
}

/** Successful response with version vector. */
export interface VersionResponse {
  readonly type: "version";
  readonly id: number;
  readonly version: VersionVector;
}

/** Acknowledgement for void operations. */
export interface AckResponse {
  readonly type: "ack";
  readonly id: number;
}

/** Error response. */
export interface ErrorResponse {
  readonly type: "error";
  readonly id: number;
  readonly message: string;
}

/**
 * Sync event pushed from the worker after any mutation.
 * Contains the updated text snapshot so the main thread can re-render.
 */
export interface SyncEvent {
  readonly type: "sync";
  readonly text: string;
  readonly length: number;
}

/** All possible response messages. */
export type WorkerResponse =
  | OperationResponse
  | TextResponse
  | LengthResponse
  | VersionResponse
  | AckResponse
  | ErrorResponse
  | SyncEvent;
