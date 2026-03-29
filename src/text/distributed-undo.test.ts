import { describe, expect, it } from "bun:test";
import { TextBuffer } from "./text-buffer.js";
import { replicaId } from "./types.js";

// ---------------------------------------------------------------------------
// Distributed undo/redo: undo operations with interleaved remote ops
// ---------------------------------------------------------------------------

describe("Distributed undo with remote operations", () => {
  it("undo on replica 1 propagates to replica 2", () => {
    const rid1 = replicaId(1);
    const rid2 = replicaId(2);

    const buf1 = TextBuffer.create(rid1);
    const buf2 = TextBuffer.create(rid2);

    // Replica 1 inserts text
    const insertOp = buf1.insert(0, "Hello");
    buf2.applyRemote(insertOp);

    expect(buf1.getText()).toBe("Hello");
    expect(buf2.getText()).toBe("Hello");

    // Replica 1 undoes the insert
    const undoOp = buf1.undo();
    expect(undoOp).not.toBeNull();
    expect(buf1.getText()).toBe("");

    // Propagate undo to replica 2
    if (undoOp !== null) {
      buf2.applyRemote(undoOp);
    }
    expect(buf2.getText()).toBe("");
  });

  it("undo + redo propagation converges", () => {
    const rid1 = replicaId(1);
    const rid2 = replicaId(2);

    const buf1 = TextBuffer.create(rid1);
    const buf2 = TextBuffer.create(rid2);

    const insertOp = buf1.insert(0, "Hello");
    buf2.applyRemote(insertOp);

    // Undo on replica 1
    const undoOp = buf1.undo();
    if (undoOp !== null) buf2.applyRemote(undoOp);
    expect(buf1.getText()).toBe("");
    expect(buf2.getText()).toBe("");

    // Redo on replica 1
    const redoOp = buf1.redo();
    if (redoOp !== null) buf2.applyRemote(redoOp);
    expect(buf1.getText()).toBe("Hello");
    expect(buf2.getText()).toBe("Hello");
  });

  it("undo after receiving remote insert preserves remote text", () => {
    const rid1 = replicaId(1);
    const rid2 = replicaId(2);

    const buf1 = TextBuffer.create(rid1);
    const buf2 = TextBuffer.create(rid2);

    // Replica 1 inserts "Hello"
    const op1 = buf1.insert(0, "Hello");
    buf2.applyRemote(op1);

    // Replica 2 inserts " World" at the end
    const op2 = buf2.insert(5, " World");
    buf1.applyRemote(op2);

    expect(buf1.getText()).toBe("Hello World");
    expect(buf2.getText()).toBe("Hello World");

    // Replica 1 undoes its own insert ("Hello"), but " World" from replica 2 survives
    const undoOp = buf1.undo();
    expect(undoOp).not.toBeNull();
    expect(buf1.getText()).toBe(" World");

    // Propagate undo to replica 2
    if (undoOp !== null) buf2.applyRemote(undoOp);
    expect(buf2.getText()).toBe(" World");
  });

  it("concurrent undo on both replicas converges", () => {
    const rid1 = replicaId(1);
    const rid2 = replicaId(2);

    // Use time source to separate transactions
    let time1 = 0;
    let time2 = 0;
    const buf1 = TextBuffer.create(rid1);
    buf1.setTimeSource(() => time1);
    const buf2 = TextBuffer.create(rid2);
    buf2.setTimeSource(() => time2);

    // Both start with shared text (own transaction)
    const initOp = buf1.insert(0, "ABCD");
    buf2.applyRemote(initOp);

    // Advance time to separate transactions
    time1 += 500;
    time2 += 500;

    // Each replica inserts its own text (separate transaction from init)
    const op1 = buf1.insert(4, "EF");
    const op2 = buf2.insert(4, "GH");

    // Sync the inserts
    buf1.applyRemote(op2);
    buf2.applyRemote(op1);

    const text = buf1.getText();
    expect(text).toBe(buf2.getText());

    // Each replica undoes its own most recent insert
    const undo1 = buf1.undo(); // undoes "EF"
    const undo2 = buf2.undo(); // undoes "GH"

    // Cross-apply undos
    if (undo1 !== null) buf2.applyRemote(undo1);
    if (undo2 !== null) buf1.applyRemote(undo2);

    // Both should converge to just the initial "ABCD"
    expect(buf1.getText()).toBe(buf2.getText());
    expect(buf1.getText()).toBe("ABCD");
  });

  it("undo of delete restores text on remote replica", () => {
    const rid1 = replicaId(1);
    const rid2 = replicaId(2);

    const buf1 = TextBuffer.create(rid1);
    const buf2 = TextBuffer.create(rid2);

    // Shared initial state
    const initOp = buf1.insert(0, "Hello World");
    buf2.applyRemote(initOp);

    // Replica 1 deletes "World"
    const deleteOp = buf1.delete(6, 11);
    buf2.applyRemote(deleteOp);
    expect(buf1.getText()).toBe("Hello ");
    expect(buf2.getText()).toBe("Hello ");

    // Replica 1 undoes the delete
    const undoOp = buf1.undo();
    expect(buf1.getText()).toBe("Hello World");

    // Propagate undo to replica 2
    if (undoOp !== null) buf2.applyRemote(undoOp);
    expect(buf2.getText()).toBe("Hello World");
  });
});

// ---------------------------------------------------------------------------
// Three-replica convergence
// ---------------------------------------------------------------------------

describe("Three-replica convergence", () => {
  it("three concurrent inserts at same position converge", () => {
    const rid1 = replicaId(1);
    const rid2 = replicaId(2);
    const rid3 = replicaId(3);

    const buf1 = TextBuffer.create(rid1);
    const buf2 = TextBuffer.create(rid2);
    const buf3 = TextBuffer.create(rid3);

    // Each replica inserts different text at position 0
    const op1 = buf1.insert(0, "A");
    const op2 = buf2.insert(0, "B");
    const op3 = buf3.insert(0, "C");

    // Full sync: each replica receives the other two ops
    buf1.applyRemote(op2);
    buf1.applyRemote(op3);
    buf2.applyRemote(op1);
    buf2.applyRemote(op3);
    buf3.applyRemote(op1);
    buf3.applyRemote(op2);

    // All three must converge to the same text
    const text = buf1.getText();
    expect(buf2.getText()).toBe(text);
    expect(buf3.getText()).toBe(text);

    // Must contain all three characters
    expect(text).toContain("A");
    expect(text).toContain("B");
    expect(text).toContain("C");
    expect(text.length).toBe(3);
  });

  it("three replicas with inserts and deletes converge", () => {
    const rid1 = replicaId(1);
    const rid2 = replicaId(2);
    const rid3 = replicaId(3);

    const buf1 = TextBuffer.create(rid1);
    const buf2 = TextBuffer.create(rid2);
    const buf3 = TextBuffer.create(rid3);

    // Replica 1 creates initial text
    const initOp = buf1.insert(0, "ABCDE");
    buf2.applyRemote(initOp);
    buf3.applyRemote(initOp);

    // Concurrent operations:
    // Replica 1: insert "X" at position 2
    const op1 = buf1.insert(2, "X");
    // Replica 2: delete "CD" (positions 2-4)
    const op2 = buf2.delete(2, 4);
    // Replica 3: insert "Y" at position 4
    const op3 = buf3.insert(4, "Y");

    // Full sync
    buf1.applyRemote(op2);
    buf1.applyRemote(op3);
    buf2.applyRemote(op1);
    buf2.applyRemote(op3);
    buf3.applyRemote(op1);
    buf3.applyRemote(op2);

    // All must converge
    const text = buf1.getText();
    expect(buf2.getText()).toBe(text);
    expect(buf3.getText()).toBe(text);

    // "X" and "Y" should survive (different insertions)
    // "CD" should be deleted
    expect(text).toContain("X");
    expect(text).toContain("Y");
    expect(text).not.toContain("C");
    expect(text).not.toContain("D");
  });

  it("three replicas with different operation ordering converge", () => {
    const rid1 = replicaId(1);
    const rid2 = replicaId(2);
    const rid3 = replicaId(3);

    const buf1 = TextBuffer.create(rid1);
    const buf2 = TextBuffer.create(rid2);
    const buf3 = TextBuffer.create(rid3);

    // Shared initial state
    const initOp = buf1.insert(0, "Hello");
    buf2.applyRemote(initOp);
    buf3.applyRemote(initOp);

    // Concurrent inserts
    const op1 = buf1.insert(5, " World");
    const op2 = buf2.insert(0, "Say: ");
    const op3 = buf3.insert(5, "!");

    // Apply in DIFFERENT orders to each replica
    buf1.applyRemote(op3);
    buf1.applyRemote(op2);

    buf2.applyRemote(op1);
    buf2.applyRemote(op3);

    buf3.applyRemote(op2);
    buf3.applyRemote(op1);

    // Must converge regardless of application order
    const text = buf1.getText();
    expect(buf2.getText()).toBe(text);
    expect(buf3.getText()).toBe(text);
  });
});

// ---------------------------------------------------------------------------
// Snapshot isolation with concurrent mutations
// ---------------------------------------------------------------------------

describe("Snapshot isolation under mutations", () => {
  it("snapshot is not affected by subsequent inserts and deletes", () => {
    const buf = TextBuffer.fromString("Initial");
    const snap = buf.snapshot();

    // Mutate the buffer heavily
    buf.insert(7, " text");
    buf.delete(0, 7);
    buf.insert(0, "New");

    // Snapshot still sees original
    expect(snap.getText()).toBe("Initial");
    expect(snap.length).toBe(7);

    snap.release();
  });

  it("multiple snapshots capture different states", () => {
    const buf = TextBuffer.create();

    buf.insert(0, "A");
    const snap1 = buf.snapshot();

    buf.insert(1, "B");
    const snap2 = buf.snapshot();

    buf.insert(2, "C");
    const snap3 = buf.snapshot();

    expect(snap1.getText()).toBe("A");
    expect(snap2.getText()).toBe("AB");
    expect(snap3.getText()).toBe("ABC");

    snap1.release();
    snap2.release();
    snap3.release();
  });

  it("snapshot survives undo/redo on the live buffer", () => {
    let time = 0;
    const buf = TextBuffer.create();
    buf.setTimeSource(() => time);

    buf.insert(0, "Hello");
    time += 500; // separate transaction
    const snap = buf.snapshot();

    buf.insert(5, " World");
    buf.undo(); // undoes " World" only
    buf.redo(); // redoes " World"
    buf.undo(); // undoes " World" again

    // Snapshot is frozen at "Hello"
    expect(snap.getText()).toBe("Hello");
    expect(buf.getText()).toBe("Hello");

    snap.release();
  });
});
