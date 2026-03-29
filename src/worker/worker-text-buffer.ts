/**
 * WorkerTextBuffer: Main-thread proxy for the CRDT worker.
 *
 * Provides an async API that mirrors TextBuffer's interface, but all
 * heavy CRDT operations run in a Web Worker. The main thread never blocks
 * on CRDT computation.
 *
 * Sync events are pushed from the worker after every mutation, keeping the
 * main thread's text snapshot up to date for rendering.
 *
 * @example
 * ```ts
 * import { WorkerTextBuffer } from "@iamnbutler/crdt/worker";
 *
 * const buffer = await WorkerTextBuffer.create(workerUrl);
 * const op = await buffer.insert(0, "Hello");
 * console.log(buffer.text); // "Hello" (from sync event)
 * buffer.onSync = (text, length) => updateUI(text);
 * buffer.terminate();
 * ```
 */

import type { Operation, ReplicaId, VersionVector } from "../text/types.js";
import type { WorkerRequest, WorkerResponse } from "./types.js";

/** Callback invoked whenever the worker pushes a sync event. */
export type SyncCallback = (text: string, length: number) => void;

interface PendingRequest {
  resolve: (response: WorkerResponse) => void;
  reject: (error: Error) => void;
}

/**
 * Main-thread client that proxies TextBuffer operations to a Web Worker.
 *
 * All mutation methods return Promises that resolve once the worker has
 * processed the operation. A sync callback fires after every mutation
 * with the updated text snapshot.
 */
export class WorkerTextBuffer {
  private readonly worker: Worker;
  private nextId = 1;
  private readonly pending = new Map<number, PendingRequest>();
  private terminated = false;

  /** Current text snapshot, updated by sync events from the worker. */
  text = "";

  /** Current document length, updated by sync events from the worker. */
  length = 0;

  /** Optional callback invoked on every sync event from the worker. */
  onSync: SyncCallback | null = null;

  private constructor(worker: Worker) {
    this.worker = worker;
    this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      this.handleMessage(event.data);
    };
    this.worker.onerror = (event: ErrorEvent) => {
      // Reject all pending requests on worker error
      for (const [id, req] of this.pending) {
        req.reject(new Error(`Worker error: ${event.message}`));
        this.pending.delete(id);
      }
    };
  }

  /**
   * Create a new WorkerTextBuffer with an empty document.
   *
   * @param workerOrUrl - A Worker instance or a URL/string to create one.
   *   Browser: `new URL('./crdt-worker.js', import.meta.url)`
   *   Bun: `new URL('./crdt-worker.ts', import.meta.url)`
   */
  static async create(
    workerOrUrl: Worker | URL | string,
    replicaId?: ReplicaId,
  ): Promise<WorkerTextBuffer> {
    const worker =
      workerOrUrl instanceof Worker ? workerOrUrl : new Worker(workerOrUrl, { type: "module" });
    const client = new WorkerTextBuffer(worker);
    const request: WorkerRequest =
      replicaId !== undefined ? { type: "create", id: 0, replicaId } : { type: "create", id: 0 };
    await client.send(request);
    return client;
  }

  /**
   * Create a new WorkerTextBuffer initialized with text.
   */
  static async fromString(
    workerOrUrl: Worker | URL | string,
    text: string,
    replicaId?: ReplicaId,
  ): Promise<WorkerTextBuffer> {
    const worker =
      workerOrUrl instanceof Worker ? workerOrUrl : new Worker(workerOrUrl, { type: "module" });
    const client = new WorkerTextBuffer(worker);
    const request: WorkerRequest =
      replicaId !== undefined
        ? { type: "fromString", id: 0, text, replicaId }
        : { type: "fromString", id: 0, text };
    await client.send(request);
    return client;
  }

  /** Insert text at a position. Returns the operation for broadcasting. */
  async insert(offset: number, text: string): Promise<Operation | null> {
    const response = await this.send({ type: "insert", id: 0, offset, text });
    if (response.type === "operation") return response.operation;
    return null;
  }

  /** Delete a range of text. Returns the operation for broadcasting. */
  async delete(start: number, end: number): Promise<Operation | null> {
    const response = await this.send({ type: "delete", id: 0, start, end });
    if (response.type === "operation") return response.operation;
    return null;
  }

  /** Undo the last transaction. Returns the operation or null. */
  async undo(): Promise<Operation | null> {
    const response = await this.send({ type: "undo", id: 0 });
    if (response.type === "operation") return response.operation;
    return null;
  }

  /** Redo the last undone transaction. Returns the operation or null. */
  async redo(): Promise<Operation | null> {
    const response = await this.send({ type: "redo", id: 0 });
    if (response.type === "operation") return response.operation;
    return null;
  }

  /** Apply a remote operation. */
  async applyRemote(operation: Operation): Promise<void> {
    await this.send({ type: "applyRemote", id: 0, operation });
  }

  /** Apply a batch of remote operations. */
  async applyRemoteBatch(operations: ReadonlyArray<Operation>): Promise<void> {
    await this.send({ type: "applyRemoteBatch", id: 0, operations });
  }

  /** Get the current text from the worker (round-trip). */
  async getText(): Promise<string> {
    const response = await this.send({ type: "getText", id: 0 });
    if (response.type === "text") return response.text;
    return this.text;
  }

  /** Get the current length from the worker (round-trip). */
  async getLength(): Promise<number> {
    const response = await this.send({ type: "getLength", id: 0 });
    if (response.type === "length") return response.length;
    return this.length;
  }

  /** Get the version vector from the worker. */
  async getVersion(): Promise<VersionVector> {
    const response = await this.send({ type: "getVersion", id: 0 });
    if (response.type === "version") return response.version;
    return new Map();
  }

  /** Set the undo group delay. */
  async setGroupDelay(ms: number): Promise<void> {
    await this.send({ type: "setGroupDelay", id: 0, ms });
  }

  /** Terminate the worker. No further operations are possible. */
  terminate(): void {
    this.terminated = true;
    this.worker.terminate();
    const pending = Array.from(this.pending.values());
    this.pending.clear();
    for (const req of pending) {
      req.reject(new Error("Worker terminated"));
    }
  }

  private send(request: WorkerRequest): Promise<WorkerResponse> {
    if (this.terminated) {
      return Promise.reject(new Error("Worker terminated"));
    }
    const id = this.nextId++;
    const tagged = { ...request, id };
    return new Promise<WorkerResponse>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage(tagged);
    });
  }

  private handleMessage(response: WorkerResponse): void {
    // Sync events are broadcast, not tied to a request
    if (response.type === "sync") {
      this.text = response.text;
      this.length = response.length;
      if (this.onSync !== null) {
        this.onSync(response.text, response.length);
      }
      return;
    }

    const req = this.pending.get(response.id);
    if (req === undefined) return;
    this.pending.delete(response.id);

    if (response.type === "error") {
      req.reject(new Error(response.message));
    } else {
      req.resolve(response);
    }
  }
}
