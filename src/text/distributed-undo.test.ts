import { describe, expect, it } from "bun:test";
import { TextBuffer } from "./text-buffer.js";
import { replicaId } from "./types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePair() {
  const rid1 = replicaId(1);
  const rid2 = replicaId(2);
  const buf1 = TextBuffer.create(rid1);
  const buf2 = TextBuffer.create(rid2);
  return { rid1, rid2, buf1, buf2 };
}

function makeTriple() {
  const rid1 = replicaId(1);
  const rid2 = replicaId(2);
  const rid3 = replicaId(3);
  const buf1 = TextBuffer.create(rid1);
  const buf2 = TextBuffer.create(rid2);
  const buf3 = TextBuffer.create(rid3);
  return { rid1, rid2, rid3, buf1, buf2, buf3 };
}

// ---------------------------------------------------------------------------
// Distributed undo: propagation
// ---------------------------------------------------------------------------

describe("Distributed undo propagation", () => {
  it("undo on replica1 propagates to replica2", () => {
    const { buf1, buf2 } = makePair();

    const insertOp = buf1.insert(0, "Hello");
    buf2.applyRemote(insertOp);
    expect(buf2.getText()).toBe("Hello");

    const undoOp = buf1.undo();
    expect(undoOp).not.toBeNull();
    if (undoOp === null) return;

    buf2.applyRemote(undoOp);
    expect(buf1.getText()).toBe("");
    expect(buf2.getText()).toBe("");
  });

  it("undo + redo propagate and converge", () => {
    const { buf1, buf2 } = makePair();

    const insertOp = buf1.insert(0, "Hello");
    buf2.applyRemote(insertOp);

    const undoOp = buf1.undo();
    expect(undoOp).not.toBeNull();
    if (undoOp === null) return;
    buf2.applyRemote(undoOp);
    expect(buf2.getText()).toBe("");

    const redoOp = buf1.redo();
    expect(redoOp).not.toBeNull();
    if (redoOp === null) return;
    buf2.applyRemote(redoOp);
    expect(buf1.getText()).toBe("Hello");
    expect(buf2.getText()).toBe("Hello");
  });

  it("undo after remote insert preserves remote content", () => {
    const { buf1, buf2 } = makePair();

    // buf1 inserts "AB"
    const op1 = buf1.insert(0, "AB");
    buf2.applyRemote(op1);

    // buf2 inserts "X" at position 1 (between A and B)
    const op2 = buf2.insert(1, "X");
    buf1.applyRemote(op2);
    expect(buf1.getText()).toBe("AXB");

    // buf1 undoes its own "AB" insert — "X" from buf2 should remain
    const undoOp = buf1.undo();
    expect(undoOp).not.toBeNull();
    if (undoOp === null) return;
    buf2.applyRemote(undoOp);

    expect(buf1.getText()).toBe("X");
    expect(buf2.getText()).toBe("X");
  });
});

// ---------------------------------------------------------------------------
// Distributed undo: concurrent undo
// ---------------------------------------------------------------------------

describe("Concurrent undo", () => {
  it("both replicas undo their own inserts concurrently", () => {
    const { buf1, buf2 } = makePair();

    // Each replica inserts and syncs
    const op1 = buf1.insert(0, "A");
    const op2 = buf2.insert(0, "B");
    buf1.applyRemote(op2);
    buf2.applyRemote(op1);

    // Both undo concurrently
    const undo1 = buf1.undo();
    const undo2 = buf2.undo();
    expect(undo1).not.toBeNull();
    expect(undo2).not.toBeNull();
    if (undo1 === null || undo2 === null) return;

    // Cross-apply undos
    buf1.applyRemote(undo2);
    buf2.applyRemote(undo1);

    // Both should be empty
    expect(buf1.getText()).toBe("");
    expect(buf2.getText()).toBe("");
  });

  it("one replica undoes while other inserts", () => {
    const { buf1, buf2 } = makePair();

    const op1 = buf1.insert(0, "Hello");
    buf2.applyRemote(op1);

    // Concurrent: buf1 undoes, buf2 inserts
    const undoOp = buf1.undo();
    const op2 = buf2.insert(5, " World");
    expect(undoOp).not.toBeNull();
    if (undoOp === null) return;

    buf1.applyRemote(op2);
    buf2.applyRemote(undoOp);

    // Both should converge: "Hello" undone, " World" remains
    expect(buf1.getText()).toBe(buf2.getText());
  });
});

// ---------------------------------------------------------------------------
// Distributed undo: delete operations
// ---------------------------------------------------------------------------

describe("Distributed undo of deletes", () => {
  it("undo of delete restores text on remote", () => {
    const { buf1, buf2 } = makePair();

    const insertOp = buf1.insert(0, "Hello");
    buf2.applyRemote(insertOp);

    const deleteOp = buf1.delete(1, 4); // delete "ell"
    buf2.applyRemote(deleteOp);
    expect(buf2.getText()).toBe("Ho");

    const undoOp = buf1.undo();
    expect(undoOp).not.toBeNull();
    if (undoOp === null) return;
    buf2.applyRemote(undoOp);

    expect(buf1.getText()).toBe("Hello");
    expect(buf2.getText()).toBe("Hello");
  });

  it("undo of delete after remote edit", () => {
    const { buf1, buf2 } = makePair();

    const insertOp = buf1.insert(0, "ABCDE");
    buf2.applyRemote(insertOp);

    // buf1 deletes "BCD"
    const deleteOp = buf1.delete(1, 4);
    buf2.applyRemote(deleteOp);
    expect(buf2.getText()).toBe("AE");

    // buf2 appends "X"
    const appendOp = buf2.insert(2, "X");
    buf1.applyRemote(appendOp);

    // buf1 undoes the delete
    const undoOp = buf1.undo();
    expect(undoOp).not.toBeNull();
    if (undoOp === null) return;
    buf2.applyRemote(undoOp);

    // Both should converge
    expect(buf1.getText()).toBe(buf2.getText());
    // "BCD" should be restored, "X" should still be present
    expect(buf1.getText()).toContain("BCD");
    expect(buf1.getText()).toContain("X");
  });
});

// ---------------------------------------------------------------------------
// Three-replica convergence
// ---------------------------------------------------------------------------

describe("Three-replica convergence", () => {
  it("three concurrent inserts at same position converge", () => {
    const { buf1, buf2, buf3 } = makeTriple();

    // All three insert at position 0 concurrently
    const op1 = buf1.insert(0, "A");
    const op2 = buf2.insert(0, "B");
    const op3 = buf3.insert(0, "C");

    // Apply all ops to all replicas (different orders)
    buf1.applyRemote(op2);
    buf1.applyRemote(op3);

    buf2.applyRemote(op3);
    buf2.applyRemote(op1);

    buf3.applyRemote(op1);
    buf3.applyRemote(op2);

    // All three should converge to the same text
    expect(buf1.getText()).toBe(buf2.getText());
    expect(buf2.getText()).toBe(buf3.getText());
  });

  it("three replicas with mixed insert/delete converge", () => {
    const { buf1, buf2, buf3 } = makeTriple();

    // Shared initial state
    const initOp = buf1.insert(0, "Hello");
    buf2.applyRemote(initOp);
    buf3.applyRemote(initOp);

    // Concurrent operations
    const op1 = buf1.insert(5, " World"); // append
    const op2 = buf2.delete(0, 1); // delete "H"
    const op3 = buf3.insert(0, "!"); // prepend

    // Apply to buf1 (has op1)
    buf1.applyRemote(op2);
    buf1.applyRemote(op3);

    // Apply to buf2 (has op2)
    buf2.applyRemote(op1);
    buf2.applyRemote(op3);

    // Apply to buf3 (has op3)
    buf3.applyRemote(op1);
    buf3.applyRemote(op2);

    expect(buf1.getText()).toBe(buf2.getText());
    expect(buf2.getText()).toBe(buf3.getText());
  });

  it("three replicas with undo converge", () => {
    const { buf1, buf2, buf3 } = makeTriple();

    // Use explicit time source to separate undo groups
    let time = 0;
    buf1.setTimeSource(() => time);

    // Shared state
    const initOp = buf1.insert(0, "ABC");
    buf2.applyRemote(initOp);
    buf3.applyRemote(initOp);

    // Advance time so next insert is a separate undo group
    time += 500;

    // buf1 inserts, buf2 inserts, buf3 does nothing
    const op1 = buf1.insert(3, "D");
    const op2 = buf2.insert(0, "X");

    // Sync all
    buf1.applyRemote(op2);
    buf2.applyRemote(op1);
    buf3.applyRemote(op1);
    buf3.applyRemote(op2);

    // All should agree
    expect(buf1.getText()).toBe(buf2.getText());
    expect(buf2.getText()).toBe(buf3.getText());

    // Now buf1 undoes its "D" insert
    const undoOp = buf1.undo();
    expect(undoOp).not.toBeNull();
    if (undoOp === null) return;

    buf2.applyRemote(undoOp);
    buf3.applyRemote(undoOp);

    // All converge after undo
    expect(buf1.getText()).toBe(buf2.getText());
    expect(buf2.getText()).toBe(buf3.getText());
    expect(buf1.getText()).toContain("ABC");
    expect(buf1.getText()).toContain("X");
    expect(buf1.getText()).not.toContain("D");
  });
});

// ---------------------------------------------------------------------------
// Snapshot isolation under distributed undo
// ---------------------------------------------------------------------------

describe("Snapshot isolation with distributed undo", () => {
  it("snapshot is not affected by subsequent undo", () => {
    const buf = TextBuffer.create(replicaId(1));
    buf.insert(0, "Hello");
    const snap = buf.snapshot();
    expect(snap.getText()).toBe("Hello");

    buf.undo();
    expect(buf.getText()).toBe("");
    // Snapshot should still see the old state
    expect(snap.getText()).toBe("Hello");
    snap.release();
  });

  it("snapshot is not affected by remote undo", () => {
    const { buf1, buf2 } = makePair();

    const insertOp = buf1.insert(0, "World");
    buf2.applyRemote(insertOp);

    const snap = buf2.snapshot();
    expect(snap.getText()).toBe("World");

    // buf1 undoes and propagates
    const undoOp = buf1.undo();
    expect(undoOp).not.toBeNull();
    if (undoOp === null) {
      snap.release();
      return;
    }
    buf2.applyRemote(undoOp);

    expect(buf2.getText()).toBe("");
    expect(snap.getText()).toBe("World");
    snap.release();
  });
});
