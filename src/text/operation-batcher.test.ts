import { describe, expect, test } from "bun:test";
import { OperationBatcher } from "./operation-batcher.js";
import { TextBuffer } from "./text-buffer.js";

describe("OperationBatcher", () => {
  test("single insert flushes correctly", () => {
    const buf = TextBuffer.create();
    const batcher = new OperationBatcher(buf, { flushDelay: 0 });

    batcher.insert(0, "a");
    expect(batcher.hasPending).toBe(true);
    expect(batcher.pendingLength).toBe(1);

    const ops = batcher.flush();
    expect(ops.length).toBe(1);
    expect(buf.getText()).toBe("a");
    expect(batcher.hasPending).toBe(false);
  });

  test("sequential inserts are coalesced", () => {
    const buf = TextBuffer.create();
    const batcher = new OperationBatcher(buf, { flushDelay: 0 });

    batcher.insert(0, "h");
    batcher.insert(1, "e");
    batcher.insert(2, "l");
    batcher.insert(3, "l");
    batcher.insert(4, "o");

    expect(batcher.pendingLength).toBe(5);
    expect(batcher.coalescedCount).toBe(4);

    batcher.flush();
    expect(buf.getText()).toBe("hello");
    expect(batcher.flushCount).toBe(1);
  });

  test("non-sequential insert triggers flush and starts new batch", () => {
    const buf = TextBuffer.create();
    const batcher = new OperationBatcher(buf, { flushDelay: 0 });

    // Type "ab" sequentially
    batcher.insert(0, "a");
    batcher.insert(1, "b");
    expect(batcher.coalescedCount).toBe(1);

    // Jump to a different position — should flush "ab", then start "x"
    batcher.insert(0, "x");
    expect(batcher.flushCount).toBe(1);
    expect(buf.getText()).toBe("ab");

    // Flush the "x"
    batcher.flush();
    expect(buf.getText()).toBe("xab");
    expect(batcher.flushCount).toBe(2);
  });

  test("delete flushes pending inserts first", () => {
    const buf = TextBuffer.fromString("hello world");
    const batcher = new OperationBatcher(buf, { flushDelay: 0 });

    // Add some text
    batcher.insert(5, "!");
    expect(batcher.hasPending).toBe(true);

    // Delete should flush first
    batcher.delete(0, 5);
    expect(batcher.hasPending).toBe(false);
    expect(buf.getText()).toBe("! world");
  });

  test("getText flushes pending inserts", () => {
    const buf = TextBuffer.create();
    const batcher = new OperationBatcher(buf, { flushDelay: 0 });

    batcher.insert(0, "h");
    batcher.insert(1, "i");

    expect(batcher.getText()).toBe("hi");
    expect(batcher.hasPending).toBe(false);
  });

  test("getLength flushes pending inserts", () => {
    const buf = TextBuffer.create();
    const batcher = new OperationBatcher(buf, { flushDelay: 0 });

    batcher.insert(0, "a");
    batcher.insert(1, "b");
    batcher.insert(2, "c");

    expect(batcher.getLength()).toBe(3);
  });

  test("maxBatchSize triggers auto-flush", () => {
    const buf = TextBuffer.create();
    const batcher = new OperationBatcher(buf, { flushDelay: 0, maxBatchSize: 5 });

    for (let i = 0; i < 5; i++) {
      batcher.insert(i, String.fromCharCode(97 + i));
    }

    // Should have auto-flushed at maxBatchSize
    expect(batcher.flushCount).toBe(1);
    expect(buf.getText()).toBe("abcde");
    expect(batcher.hasPending).toBe(false);
  });

  test("multi-char inserts are coalesced when sequential", () => {
    const buf = TextBuffer.create();
    const batcher = new OperationBatcher(buf, { flushDelay: 0 });

    batcher.insert(0, "hel");
    batcher.insert(3, "lo");

    expect(batcher.pendingLength).toBe(5);
    batcher.flush();
    expect(buf.getText()).toBe("hello");
    expect(batcher.flushCount).toBe(1);
  });

  test("empty insert is ignored", () => {
    const buf = TextBuffer.create();
    const batcher = new OperationBatcher(buf, { flushDelay: 0 });

    batcher.insert(0, "");
    expect(batcher.hasPending).toBe(false);
  });

  test("flush with nothing pending returns empty array", () => {
    const buf = TextBuffer.create();
    const batcher = new OperationBatcher(buf, { flushDelay: 0 });

    const ops = batcher.flush();
    expect(ops.length).toBe(0);
    expect(batcher.flushCount).toBe(0);
  });

  test("onOperation callback fires on flush", () => {
    const buf = TextBuffer.create();
    const ops: unknown[] = [];
    const batcher = new OperationBatcher(buf, {
      flushDelay: 0,
      onOperation: (op) => ops.push(op),
    });

    batcher.insert(0, "a");
    batcher.insert(1, "b");
    batcher.flush();

    expect(ops.length).toBe(1);
    expect((ops[0] as { type: string }).type).toBe("insert");
  });

  test("onOperation callback fires on delete", () => {
    const buf = TextBuffer.fromString("hello");
    const ops: unknown[] = [];
    const batcher = new OperationBatcher(buf, {
      flushDelay: 0,
      onOperation: (op) => ops.push(op),
    });

    batcher.delete(0, 3);
    expect(ops.length).toBe(1);
    expect((ops[0] as { type: string }).type).toBe("delete");
  });

  test("applyRemote flushes pending inserts first", () => {
    const source = TextBuffer.create();
    const remoteOp = source.insert(0, "remote");

    const buf = TextBuffer.create();
    const batcher = new OperationBatcher(buf, { flushDelay: 0 });

    batcher.insert(0, "local");
    expect(batcher.hasPending).toBe(true);

    batcher.applyRemote(remoteOp);
    expect(batcher.hasPending).toBe(false);
    // Both local and remote text should be present
    const text = buf.getText();
    expect(text).toContain("local");
    expect(text).toContain("remote");
  });

  test("dispose flushes and returns operations", () => {
    const buf = TextBuffer.create();
    const batcher = new OperationBatcher(buf, { flushDelay: 0 });

    batcher.insert(0, "a");
    batcher.insert(1, "b");

    const ops = batcher.dispose();
    expect(ops.length).toBe(1);
    expect(buf.getText()).toBe("ab");
    expect(batcher.hasPending).toBe(false);
  });

  test("getBuffer flushes and returns underlying buffer", () => {
    const buf = TextBuffer.create();
    const batcher = new OperationBatcher(buf, { flushDelay: 0 });

    batcher.insert(0, "test");
    const returned = batcher.getBuffer();
    expect(returned).toBe(buf);
    expect(returned.getText()).toBe("test");
  });

  test("rawBuffer returns buffer without flushing", () => {
    const buf = TextBuffer.create();
    const batcher = new OperationBatcher(buf, { flushDelay: 0 });

    batcher.insert(0, "pending");
    expect(batcher.rawBuffer).toBe(buf);
    expect(buf.getText()).toBe(""); // Not flushed yet
    expect(batcher.hasPending).toBe(true);
  });

  test("realistic typing simulation: sequential chars then cursor jump", () => {
    const buf = TextBuffer.create();
    const batcher = new OperationBatcher(buf, { flushDelay: 0 });

    // Type "Hello" at position 0
    for (let i = 0; i < 5; i++) {
      batcher.insert(i, "Hello".charAt(i));
    }
    expect(batcher.coalescedCount).toBe(4);

    // Type " World" continuing
    for (let i = 0; i < 6; i++) {
      batcher.insert(5 + i, " World".charAt(i));
    }
    expect(batcher.coalescedCount).toBe(10); // all coalesced into one batch

    // Flush
    batcher.flush();
    expect(buf.getText()).toBe("Hello World");
    expect(batcher.flushCount).toBe(1); // Single flush for all 11 chars
  });

  test("interleaved typing and deletion", () => {
    const buf = TextBuffer.create();
    const batcher = new OperationBatcher(buf, { flushDelay: 0 });

    // Type "Hello"
    for (let i = 0; i < 5; i++) {
      batcher.insert(i, "Hello".charAt(i));
    }

    // Delete forces flush, then deletes
    batcher.delete(4, 5); // Remove the "o"
    expect(buf.getText()).toBe("Hell");

    // Continue typing
    batcher.insert(4, "o");
    batcher.insert(5, "!");
    batcher.flush();
    expect(buf.getText()).toBe("Hello!");
  });

  test("large batch coalescing matches direct insert", () => {
    const text = "The quick brown fox jumps over the lazy dog. ".repeat(20);

    // Direct insert
    const directBuf = TextBuffer.create();
    directBuf.insert(0, text);

    // Batched char-by-char insert
    const batchBuf = TextBuffer.create();
    const batcher = new OperationBatcher(batchBuf, { flushDelay: 0, maxBatchSize: 1000 });
    for (let i = 0; i < text.length; i++) {
      batcher.insert(i, text.charAt(i));
    }
    batcher.flush();

    expect(batchBuf.getText()).toBe(text);
    expect(batcher.flushCount).toBe(1);
    expect(batcher.coalescedCount).toBe(text.length - 1);
  });

  test("multiple sequential runs produce correct text", () => {
    const buf = TextBuffer.create();
    const batcher = new OperationBatcher(buf, { flushDelay: 0, maxBatchSize: 50 });

    // First typing run
    const first = "hello ";
    for (let i = 0; i < first.length; i++) {
      batcher.insert(i, first.charAt(i));
    }
    batcher.flush();

    // Second typing run (continuing at cursor)
    const second = "world";
    for (let i = 0; i < second.length; i++) {
      batcher.insert(first.length + i, second.charAt(i));
    }
    batcher.flush();

    expect(buf.getText()).toBe("hello world");
    expect(batcher.flushCount).toBe(2);
  });
});
