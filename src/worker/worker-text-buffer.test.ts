import { describe, expect, it } from "bun:test";
import { TextBuffer } from "../text/text-buffer.js";
import { replicaId } from "../text/types.js";
import { WorkerTextBuffer } from "./worker-text-buffer.js";

const WORKER_URL = new URL("./crdt-worker.ts", import.meta.url).href;

// ---------------------------------------------------------------------------
// WorkerTextBuffer: creation
// ---------------------------------------------------------------------------

describe("WorkerTextBuffer creation", () => {
  it("creates an empty buffer", async () => {
    const buf = await WorkerTextBuffer.create(WORKER_URL);
    expect(buf.text).toBe("");
    expect(buf.length).toBe(0);
    buf.terminate();
  });

  it("creates a buffer from string", async () => {
    const buf = await WorkerTextBuffer.fromString(WORKER_URL, "Hello, world!");
    expect(buf.text).toBe("Hello, world!");
    expect(buf.length).toBe(13);
    buf.terminate();
  });

  it("creates a buffer with explicit replica ID", async () => {
    const rid = replicaId(42);
    const buf = await WorkerTextBuffer.create(WORKER_URL, rid);
    expect(buf.text).toBe("");
    buf.terminate();
  });
});

// ---------------------------------------------------------------------------
// WorkerTextBuffer: editing
// ---------------------------------------------------------------------------

describe("WorkerTextBuffer editing", () => {
  it("inserts text", async () => {
    const buf = await WorkerTextBuffer.create(WORKER_URL);
    const op = await buf.insert(0, "Hello");
    expect(op).not.toBeNull();
    expect(buf.text).toBe("Hello");
    expect(buf.length).toBe(5);
    buf.terminate();
  });

  it("inserts at different positions", async () => {
    const buf = await WorkerTextBuffer.fromString(WORKER_URL, "Hello!");
    await buf.insert(5, ", world");
    expect(buf.text).toBe("Hello, world!");
    buf.terminate();
  });

  it("deletes text", async () => {
    const buf = await WorkerTextBuffer.fromString(WORKER_URL, "Hello, world!");
    const op = await buf.delete(5, 12);
    expect(op).not.toBeNull();
    expect(buf.text).toBe("Hello!");
    buf.terminate();
  });

  it("handles sequential edits", async () => {
    const buf = await WorkerTextBuffer.create(WORKER_URL);
    await buf.insert(0, "abc");
    await buf.insert(3, "def");
    await buf.delete(1, 5);
    expect(buf.text).toBe("af");
    buf.terminate();
  });
});

// ---------------------------------------------------------------------------
// WorkerTextBuffer: getText round-trip
// ---------------------------------------------------------------------------

describe("WorkerTextBuffer getText", () => {
  it("gets text via round-trip", async () => {
    const buf = await WorkerTextBuffer.fromString(WORKER_URL, "test content");
    const text = await buf.getText();
    expect(text).toBe("test content");
    buf.terminate();
  });

  it("gets length via round-trip", async () => {
    const buf = await WorkerTextBuffer.fromString(WORKER_URL, "abcdef");
    const len = await buf.getLength();
    expect(len).toBe(6);
    buf.terminate();
  });
});

// ---------------------------------------------------------------------------
// WorkerTextBuffer: sync callback
// ---------------------------------------------------------------------------

describe("WorkerTextBuffer sync", () => {
  it("calls onSync after mutations", async () => {
    const syncs: Array<{ text: string; length: number }> = [];
    const buf = await WorkerTextBuffer.create(WORKER_URL);
    buf.onSync = (text, length) => {
      syncs.push({ text, length });
    };
    await buf.insert(0, "Hello");
    await buf.insert(5, " World");
    // onSync is called via the sync event after each mutation,
    // but by the time the operation promise resolves the sync
    // has already been processed, so we can check state directly
    expect(buf.text).toBe("Hello World");
    expect(syncs.length).toBeGreaterThanOrEqual(1);
    buf.terminate();
  });
});

// ---------------------------------------------------------------------------
// WorkerTextBuffer: collaboration
// ---------------------------------------------------------------------------

describe("WorkerTextBuffer collaboration", () => {
  it("applies remote operations from another buffer", async () => {
    // Create a local in-memory buffer to generate operations
    const rid1 = replicaId(1);
    const rid2 = replicaId(2);
    const local = TextBuffer.create(rid1);
    const op1 = local.insert(0, "Hello");

    // Create a worker buffer and apply the remote operation
    const worker = await WorkerTextBuffer.create(WORKER_URL, rid2);
    await worker.applyRemote(op1);
    expect(worker.text).toBe("Hello");
    worker.terminate();
  });

  it("applies batch of remote operations", async () => {
    const rid1 = replicaId(1);
    const rid2 = replicaId(2);
    const local = TextBuffer.create(rid1);
    const op1 = local.insert(0, "Hello");
    const op2 = local.insert(5, " World");

    const worker = await WorkerTextBuffer.create(WORKER_URL, rid2);
    await worker.applyRemoteBatch([op1, op2]);
    expect(worker.text).toBe("Hello World");
    worker.terminate();
  });
});

// ---------------------------------------------------------------------------
// WorkerTextBuffer: undo/redo
// ---------------------------------------------------------------------------

describe("WorkerTextBuffer undo/redo", () => {
  it("undoes an insert", async () => {
    const buf = await WorkerTextBuffer.create(WORKER_URL);
    await buf.setGroupDelay(0);
    await buf.insert(0, "Hello");
    const undoOp = await buf.undo();
    expect(undoOp).not.toBeNull();
    expect(buf.text).toBe("");
    buf.terminate();
  });

  it("redoes after undo", async () => {
    const buf = await WorkerTextBuffer.create(WORKER_URL);
    await buf.setGroupDelay(0);
    await buf.insert(0, "Hello");
    await buf.undo();
    const redoOp = await buf.redo();
    expect(redoOp).not.toBeNull();
    expect(buf.text).toBe("Hello");
    buf.terminate();
  });

  it("returns null when nothing to undo", async () => {
    const buf = await WorkerTextBuffer.create(WORKER_URL);
    const op = await buf.undo();
    expect(op).toBeNull();
    buf.terminate();
  });
});

// ---------------------------------------------------------------------------
// WorkerTextBuffer: error handling
// ---------------------------------------------------------------------------

describe("WorkerTextBuffer errors", () => {
  it("rejects on terminate", async () => {
    const buf = await WorkerTextBuffer.create(WORKER_URL);
    buf.terminate();
    await expect(buf.insert(0, "test")).rejects.toThrow("Worker terminated");
  });
});
