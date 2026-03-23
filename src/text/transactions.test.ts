import { describe, expect, it } from "bun:test";
import { TextBuffer } from "./text-buffer.js";

// ---------------------------------------------------------------------------
// Time-based transaction grouping
// ---------------------------------------------------------------------------

describe("Time-based transaction grouping", () => {
  it("typing characters within 300ms groups as one undo unit", () => {
    let time = 0;
    const buf = TextBuffer.create();
    buf.setTimeSource(() => time);

    buf.insert(0, "h");
    time += 50;
    buf.insert(1, "e");
    time += 50;
    buf.insert(2, "l");
    time += 50;
    buf.insert(3, "l");
    time += 50;
    buf.insert(4, "o");
    expect(buf.getText()).toBe("hello");

    // Single undo should remove all 5 characters
    buf.undo();
    expect(buf.getText()).toBe("");
  });

  it("typing with >300ms gap creates separate undo units", () => {
    let time = 0;
    const buf = TextBuffer.create();
    buf.setTimeSource(() => time);

    buf.insert(0, "a");
    time += 50;
    buf.insert(1, "b");
    expect(buf.getText()).toBe("ab");

    // Gap exceeds groupDelay
    time += 500;
    buf.insert(2, "c");
    time += 50;
    buf.insert(3, "d");
    expect(buf.getText()).toBe("abcd");

    // Undo should only remove "cd"
    buf.undo();
    expect(buf.getText()).toBe("ab");

    // Undo again should remove "ab"
    buf.undo();
    expect(buf.getText()).toBe("");
  });

  it("delete operations group separately from insert operations", () => {
    let time = 0;
    const buf = TextBuffer.create();
    buf.setTimeSource(() => time);

    buf.insert(0, "hello world");
    time += 50;

    // Now delete some characters — different edit type forces a new group
    buf.delete(5, 11); // delete " world"
    time += 50;
    buf.delete(3, 5); // delete "lo"
    expect(buf.getText()).toBe("hel");

    // Undo should restore the two deletes as one group
    buf.undo();
    expect(buf.getText()).toBe("hello world");

    // Undo again should remove the insert group
    buf.undo();
    expect(buf.getText()).toBe("");
  });

  it("insert after delete creates new group even within time window", () => {
    let time = 0;
    const buf = TextBuffer.create();
    buf.setTimeSource(() => time);

    buf.insert(0, "abc");
    time += 50;
    buf.delete(1, 2); // delete "b"
    time += 50;
    buf.insert(1, "x"); // insert after delete = new group
    expect(buf.getText()).toBe("axc");

    // Undo the insert "x"
    buf.undo();
    expect(buf.getText()).toBe("ac");

    // Undo the delete of "b"
    buf.undo();
    expect(buf.getText()).toBe("abc");

    // Undo the initial insert
    buf.undo();
    expect(buf.getText()).toBe("");
  });

  it("respects custom groupDelay", () => {
    let time = 0;
    const buf = TextBuffer.create();
    buf.setTimeSource(() => time);
    buf.setGroupDelay(100); // 100ms instead of default 300ms

    buf.insert(0, "a");
    time += 80; // within 100ms
    buf.insert(1, "b");
    time += 80; // within 100ms of last edit
    buf.insert(2, "c");
    expect(buf.getText()).toBe("abc");

    // All within the custom 100ms window
    buf.undo();
    expect(buf.getText()).toBe("");
  });

  it("custom groupDelay separates groups correctly", () => {
    let time = 0;
    const buf = TextBuffer.create();
    buf.setTimeSource(() => time);
    buf.setGroupDelay(100);

    buf.insert(0, "a");
    time += 150; // exceeds 100ms
    buf.insert(1, "b");
    expect(buf.getText()).toBe("ab");

    buf.undo(); // only "b"
    expect(buf.getText()).toBe("a");

    buf.undo(); // only "a"
    expect(buf.getText()).toBe("");
  });
});

// ---------------------------------------------------------------------------
// Explicit transaction boundaries
// ---------------------------------------------------------------------------

describe("Explicit transactions", () => {
  it("startTransaction/endTransaction forces grouping", () => {
    let time = 0;
    const buf = TextBuffer.create();
    buf.setTimeSource(() => time);

    buf.startTransaction();
    buf.insert(0, "hello");
    time += 1000; // way past groupDelay, but explicit transaction overrides
    buf.insert(5, " world");
    buf.endTransaction();

    expect(buf.getText()).toBe("hello world");

    buf.undo();
    expect(buf.getText()).toBe("");
  });

  it("explicit transaction overrides time-based grouping", () => {
    let time = 0;
    const buf = TextBuffer.create();
    buf.setTimeSource(() => time);

    // Type some characters implicitly
    buf.insert(0, "a");
    time += 50;
    buf.insert(1, "b");
    time += 50;

    // Start explicit transaction
    buf.startTransaction();
    buf.insert(2, "c");
    time += 50;
    buf.delete(0, 1); // delete "a" — mixed types in explicit transaction
    buf.endTransaction();

    expect(buf.getText()).toBe("bc");

    // Undo the explicit transaction
    buf.undo();
    expect(buf.getText()).toBe("ab");

    // Undo the implicit group
    buf.undo();
    expect(buf.getText()).toBe("");
  });

  it("explicit transaction groups inserts and deletes together", () => {
    const buf = TextBuffer.create();

    buf.startTransaction();
    buf.insert(0, "hello");
    buf.delete(0, 3); // delete "hel"
    buf.insert(2, " world");
    buf.endTransaction();

    expect(buf.getText()).toBe("lo world");

    // Single undo reverses the whole transaction
    buf.undo();
    expect(buf.getText()).toBe("");
  });

  it("empty transaction (no ops between start/end) is a no-op", () => {
    const buf = TextBuffer.create();
    buf.insert(0, "hello");

    buf.startTransaction();
    buf.endTransaction();

    // The empty transaction should not affect the undo stack
    buf.undo();
    expect(buf.getText()).toBe("");
  });

  it("nested startTransaction flushes pending implicit transaction", () => {
    let time = 0;
    const buf = TextBuffer.create();
    buf.setTimeSource(() => time);

    buf.insert(0, "a");
    time += 50;
    buf.insert(1, "b");
    // Implicit group has "ab"

    buf.startTransaction();
    buf.insert(2, "c");
    buf.endTransaction();

    expect(buf.getText()).toBe("abc");

    // Undo explicit transaction "c"
    buf.undo();
    expect(buf.getText()).toBe("ab");

    // Undo implicit group "ab"
    buf.undo();
    expect(buf.getText()).toBe("");
  });
});

// ---------------------------------------------------------------------------
// Undo/redo with transaction groups
// ---------------------------------------------------------------------------

describe("Undo/redo with grouped transactions", () => {
  it("undo reverses an entire group", () => {
    let time = 0;
    const buf = TextBuffer.create();
    buf.setTimeSource(() => time);

    buf.insert(0, "h");
    time += 50;
    buf.insert(1, "i");
    time += 50;
    buf.insert(2, "!");
    expect(buf.getText()).toBe("hi!");

    buf.undo();
    expect(buf.getText()).toBe("");
  });

  it("redo restores an entire group", () => {
    let time = 0;
    const buf = TextBuffer.create();
    buf.setTimeSource(() => time);

    buf.insert(0, "h");
    time += 50;
    buf.insert(1, "i");
    expect(buf.getText()).toBe("hi");

    buf.undo();
    expect(buf.getText()).toBe("");

    buf.redo();
    expect(buf.getText()).toBe("hi");
  });

  it("undo/redo/undo cycle", () => {
    let time = 0;
    const buf = TextBuffer.create();
    buf.setTimeSource(() => time);

    buf.insert(0, "a");
    time += 50;
    buf.insert(1, "b");
    time += 400; // new group
    buf.insert(2, "c");
    expect(buf.getText()).toBe("abc");

    buf.undo(); // undo "c"
    expect(buf.getText()).toBe("ab");

    buf.redo(); // redo "c"
    expect(buf.getText()).toBe("abc");

    buf.undo(); // undo "c" again
    expect(buf.getText()).toBe("ab");

    buf.undo(); // undo "ab" group
    expect(buf.getText()).toBe("");

    buf.redo(); // redo "ab"
    expect(buf.getText()).toBe("ab");

    buf.redo(); // redo "c"
    expect(buf.getText()).toBe("abc");
  });

  it("new edit after undo clears redo stack", () => {
    let time = 0;
    const buf = TextBuffer.create();
    buf.setTimeSource(() => time);

    buf.insert(0, "a");
    time += 400;
    buf.insert(1, "b");
    expect(buf.getText()).toBe("ab");

    buf.undo(); // undo "b"
    expect(buf.getText()).toBe("a");

    // New edit clears redo
    time += 400;
    buf.insert(1, "c");

    expect(buf.redo()).toBeNull();
    expect(buf.getText()).toBe("ac");
  });

  it("undo with grouped deletes restores all deleted text", () => {
    let time = 0;
    const buf = TextBuffer.create();
    buf.setTimeSource(() => time);

    buf.insert(0, "hello world");
    time += 400; // new group for the deletes

    buf.delete(10, 11); // delete "d"
    time += 50;
    buf.delete(9, 10); // delete "l"
    time += 50;
    buf.delete(8, 9); // delete "r"
    expect(buf.getText()).toBe("hello wo");

    // Single undo should restore "rld"
    buf.undo();
    expect(buf.getText()).toBe("hello world");
  });

  it("redo with grouped deletes re-deletes all text", () => {
    let time = 0;
    const buf = TextBuffer.create();
    buf.setTimeSource(() => time);

    buf.insert(0, "abcdef");
    time += 400;

    buf.delete(4, 6); // delete "ef"
    time += 50;
    buf.delete(2, 4); // delete "cd"
    expect(buf.getText()).toBe("ab");

    buf.undo();
    expect(buf.getText()).toBe("abcdef");

    buf.redo();
    expect(buf.getText()).toBe("ab");
  });

  it("multiple groups with mixed types undo independently", () => {
    let time = 0;
    const buf = TextBuffer.create();
    buf.setTimeSource(() => time);

    // Group 1: inserts
    buf.insert(0, "hello");
    time += 400;

    // Group 2: deletes
    buf.delete(3, 5); // delete "lo"
    time += 50;
    buf.delete(0, 1); // delete "h"
    expect(buf.getText()).toBe("el");
    time += 400;

    // Group 3: inserts
    buf.insert(2, "m");
    time += 50;
    buf.insert(3, "s");
    expect(buf.getText()).toBe("elms");

    // Undo group 3
    buf.undo();
    expect(buf.getText()).toBe("el");

    // Undo group 2
    buf.undo();
    expect(buf.getText()).toBe("hello");

    // Undo group 1
    buf.undo();
    expect(buf.getText()).toBe("");
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe("Transaction edge cases", () => {
  it("time exactly at groupDelay boundary groups together", () => {
    let time = 0;
    const buf = TextBuffer.create();
    buf.setTimeSource(() => time);

    buf.insert(0, "a");
    time += 300; // exactly at boundary (<=)
    buf.insert(1, "b");
    expect(buf.getText()).toBe("ab");

    buf.undo();
    expect(buf.getText()).toBe("");
  });

  it("time one ms past groupDelay creates separate group", () => {
    let time = 0;
    const buf = TextBuffer.create();
    buf.setTimeSource(() => time);

    buf.insert(0, "a");
    time += 301; // one past boundary
    buf.insert(1, "b");
    expect(buf.getText()).toBe("ab");

    buf.undo();
    expect(buf.getText()).toBe("a");
  });

  it("groupDelay of 0 makes every edit a separate undo unit", () => {
    const time = 0;
    const buf = TextBuffer.create();
    buf.setTimeSource(() => time);
    buf.setGroupDelay(0);

    buf.insert(0, "a");
    buf.insert(1, "b");
    buf.insert(2, "c");
    expect(buf.getText()).toBe("abc");

    buf.undo();
    expect(buf.getText()).toBe("ab");

    buf.undo();
    expect(buf.getText()).toBe("a");

    buf.undo();
    expect(buf.getText()).toBe("");
  });

  it("undo on empty buffer returns null", () => {
    const buf = TextBuffer.create();
    expect(buf.undo()).toBeNull();
  });

  it("redo on empty buffer returns null", () => {
    const buf = TextBuffer.create();
    expect(buf.redo()).toBeNull();
  });

  it("undo returns an operation object", () => {
    const buf = TextBuffer.create();
    buf.insert(0, "test");
    const op = buf.undo();
    expect(op).not.toBeNull();
    // biome-ignore lint/style/noNonNullAssertion: expect: op was just asserted not null
    expect(op!.type).toBe("undo");
  });

  it("redo returns an operation object", () => {
    const buf = TextBuffer.create();
    buf.insert(0, "test");
    buf.undo();
    const op = buf.redo();
    expect(op).not.toBeNull();
    // biome-ignore lint/style/noNonNullAssertion: expect: op was just asserted not null
    expect(op!.type).toBe("undo");
  });

  it("fromString initial content can be undone as a group", () => {
    const buf = TextBuffer.fromString("hello");
    expect(buf.getText()).toBe("hello");

    buf.undo();
    expect(buf.getText()).toBe("");
  });

  it("implicit transaction timestamps update on each op", () => {
    let time = 0;
    const buf = TextBuffer.create();
    buf.setTimeSource(() => time);

    // Each insert is within 300ms of the PREVIOUS one,
    // so the rolling window keeps the group alive
    buf.insert(0, "a");
    time += 200;
    buf.insert(1, "b");
    time += 200;
    buf.insert(2, "c");
    time += 200;
    buf.insert(3, "d");
    // Total elapsed: 600ms, but each step is only 200ms apart
    expect(buf.getText()).toBe("abcd");

    buf.undo();
    expect(buf.getText()).toBe("");
  });
});
