/**
 * Worker Module
 *
 * Off-main-thread CRDT processing via Web Workers. The main thread holds
 * only a text snapshot for rendering; all CRDT state and merge logic
 * lives in the worker.
 *
 * Two entry points:
 * - `WorkerTextBuffer` (main thread): async proxy that sends commands to the worker
 * - `crdt-worker.ts` (worker thread): hosts the TextBuffer and processes commands
 *
 * @example
 * ```ts
 * import { WorkerTextBuffer } from "@iamnbutler/crdt/worker";
 *
 * // Create with a URL pointing to the worker entry point
 * const buffer = await WorkerTextBuffer.fromString(
 *   new URL("@iamnbutler/crdt/worker/crdt-worker", import.meta.url),
 *   "Hello, world!",
 * );
 *
 * // All operations are async — main thread never blocks
 * const op = await buffer.insert(7, "CRDT ");
 * console.log(buffer.text); // "Hello, CRDT world!"
 *
 * // Listen for sync events (after every mutation)
 * buffer.onSync = (text, length) => {
 *   renderEditor(text);
 * };
 *
 * // Broadcast operations to other replicas
 * if (op) sendToNetwork(op);
 *
 * // Clean up
 * buffer.terminate();
 * ```
 */

export const WORKER_VERSION = "0.1.0";

// Main-thread client
export { WorkerTextBuffer, type SyncCallback } from "./worker-text-buffer.js";

// Protocol types
export type {
  // Requests (main → worker)
  WorkerRequest,
  CreateRequest,
  FromStringRequest,
  InsertRequest,
  DeleteRequest,
  UndoRequest,
  RedoRequest,
  ApplyRemoteRequest,
  ApplyRemoteBatchRequest,
  GetTextRequest,
  GetLengthRequest,
  GetVersionRequest,
  SetGroupDelayRequest,
  // Responses (worker → main)
  WorkerResponse,
  OperationResponse,
  TextResponse,
  LengthResponse,
  VersionResponse,
  AckResponse,
  ErrorResponse,
  SyncEvent,
} from "./types.js";
