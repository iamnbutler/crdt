/**
 * CRDT Worker Entry Point
 *
 * Hosts the TextBuffer inside a Web Worker. Receives requests from the
 * main thread via postMessage, executes them against the TextBuffer,
 * and sends back responses. Before every mutation response, a sync event
 * is sent with the updated text snapshot so the main thread has current
 * state by the time the response promise resolves.
 *
 * Usage (browser):
 *   const worker = new Worker(new URL('./crdt-worker.js', import.meta.url), { type: 'module' });
 *
 * Usage (Bun):
 *   const worker = new Worker(new URL('./crdt-worker.ts', import.meta.url), { type: 'module' });
 */

import { TextBuffer } from "../text/text-buffer.js";
import type { SyncEvent, WorkerRequest, WorkerResponse } from "./types.js";

let buffer: TextBuffer | undefined;

function sendResponse(response: WorkerResponse): void {
  postMessage(response);
}

/** Send sync event BEFORE the response so main thread state is current when the promise resolves. */
function sendSync(): void {
  if (buffer === undefined) return;
  const event: SyncEvent = {
    type: "sync",
    text: buffer.getText(),
    length: buffer.length,
  };
  postMessage(event);
}

function handleMessage(request: WorkerRequest): void {
  try {
    switch (request.type) {
      case "create": {
        buffer = TextBuffer.create(request.replicaId);
        sendSync();
        sendResponse({ type: "ack", id: request.id });
        break;
      }
      case "fromString": {
        buffer = TextBuffer.fromString(request.text, request.replicaId);
        sendSync();
        sendResponse({ type: "ack", id: request.id });
        break;
      }
      case "insert": {
        if (buffer === undefined) {
          sendResponse({ type: "error", id: request.id, message: "Buffer not initialized" });
          return;
        }
        const op = buffer.insert(request.offset, request.text);
        sendSync();
        sendResponse({ type: "operation", id: request.id, operation: op });
        break;
      }
      case "delete": {
        if (buffer === undefined) {
          sendResponse({ type: "error", id: request.id, message: "Buffer not initialized" });
          return;
        }
        const op = buffer.delete(request.start, request.end);
        sendSync();
        sendResponse({ type: "operation", id: request.id, operation: op });
        break;
      }
      case "undo": {
        if (buffer === undefined) {
          sendResponse({ type: "error", id: request.id, message: "Buffer not initialized" });
          return;
        }
        const op = buffer.undo();
        if (op !== null) sendSync();
        sendResponse({ type: "operation", id: request.id, operation: op });
        break;
      }
      case "redo": {
        if (buffer === undefined) {
          sendResponse({ type: "error", id: request.id, message: "Buffer not initialized" });
          return;
        }
        const op = buffer.redo();
        if (op !== null) sendSync();
        sendResponse({ type: "operation", id: request.id, operation: op });
        break;
      }
      case "applyRemote": {
        if (buffer === undefined) {
          sendResponse({ type: "error", id: request.id, message: "Buffer not initialized" });
          return;
        }
        buffer.applyRemote(request.operation);
        sendSync();
        sendResponse({ type: "ack", id: request.id });
        break;
      }
      case "applyRemoteBatch": {
        if (buffer === undefined) {
          sendResponse({ type: "error", id: request.id, message: "Buffer not initialized" });
          return;
        }
        for (const operation of request.operations) {
          buffer.applyRemote(operation);
        }
        sendSync();
        sendResponse({ type: "ack", id: request.id });
        break;
      }
      case "getText": {
        if (buffer === undefined) {
          sendResponse({ type: "error", id: request.id, message: "Buffer not initialized" });
          return;
        }
        sendResponse({ type: "text", id: request.id, text: buffer.getText() });
        break;
      }
      case "getLength": {
        if (buffer === undefined) {
          sendResponse({ type: "error", id: request.id, message: "Buffer not initialized" });
          return;
        }
        sendResponse({ type: "length", id: request.id, length: buffer.length });
        break;
      }
      case "getVersion": {
        if (buffer === undefined) {
          sendResponse({ type: "error", id: request.id, message: "Buffer not initialized" });
          return;
        }
        sendResponse({ type: "version", id: request.id, version: buffer.version });
        break;
      }
      case "setGroupDelay": {
        if (buffer === undefined) {
          sendResponse({ type: "error", id: request.id, message: "Buffer not initialized" });
          return;
        }
        buffer.setGroupDelay(request.ms);
        sendResponse({ type: "ack", id: request.id });
        break;
      }
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    sendResponse({ type: "error", id: request.id, message });
  }
}

addEventListener("message", (event: MessageEvent<WorkerRequest>) => {
  handleMessage(event.data);
});
