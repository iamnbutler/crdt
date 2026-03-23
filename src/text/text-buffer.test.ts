import { describe, expect, it } from "bun:test";
import {
  LamportClock,
  cloneVersionVector,
  createVersionVector,
  happenedBefore,
  mergeVersionVectors,
  observeVersion,
  versionIncludes,
  versionVectorsEqual,
} from "./clock.js";
import { createFragment, splitFragment, withVisibility } from "./fragment.js";
import {
  MAX_LOCATOR,
  MIN_LOCATOR,
  compareLocators,
  locatorBetween,
  locatorsEqual,
} from "./locator.js";
import { TextBuffer } from "./text-buffer.js";
import { compareOperationIds, operationIdsEqual, replicaId } from "./types.js";
import type { OperationId } from "./types.js";
import { UndoMap } from "./undo-map.js";

// ---------------------------------------------------------------------------
// TextBuffer: creation
// ---------------------------------------------------------------------------

describe("TextBuffer creation", () => {
  it("creates an empty buffer", () => {
    const buf = TextBuffer.create();
    expect(buf.length).toBe(0);
    expect(buf.getText()).toBe("");
  });

  it("creates a buffer from string", () => {
    const buf = TextBuffer.fromString("Hello, world!");
    expect(buf.length).toBe(13);
    expect(buf.getText()).toBe("Hello, world!");
  });

  it("creates a buffer with explicit replica ID", () => {
    const rid = replicaId(42);
    const buf = TextBuffer.create(rid);
    expect(buf.replicaId).toBe(rid);
  });

  it("creates a buffer from empty string", () => {
    const buf = TextBuffer.fromString("");
    expect(buf.length).toBe(0);
    expect(buf.getText()).toBe("");
  });

  it("normalizes CRLF line endings", () => {
    const buf = TextBuffer.fromString("line1\r\nline2\r\nline3");
    expect(buf.getText()).toBe("line1\nline2\nline3");
  });

  it("normalizes lone CR line endings", () => {
    const buf = TextBuffer.fromString("line1\rline2\rline3");
    expect(buf.getText()).toBe("line1\nline2\nline3");
  });
});

// ---------------------------------------------------------------------------
// TextBuffer: insert
// ---------------------------------------------------------------------------

describe("TextBuffer insert", () => {
  it("inserts at the beginning", () => {
    const buf = TextBuffer.fromString("world");
    buf.insert(0, "Hello, ");
    expect(buf.getText()).toBe("Hello, world");
  });

  it("inserts at the end", () => {
    const buf = TextBuffer.fromString("Hello");
    buf.insert(5, ", world!");
    expect(buf.getText()).toBe("Hello, world!");
  });

  it("inserts in the middle", () => {
    const buf = TextBuffer.fromString("Hllo");
    buf.insert(1, "e");
    expect(buf.getText()).toBe("Hello");
  });

  it("inserts into an empty buffer", () => {
    const buf = TextBuffer.create();
    buf.insert(0, "Hello");
    expect(buf.getText()).toBe("Hello");
  });

  it("inserts multiple times", () => {
    const buf = TextBuffer.create();
    buf.insert(0, "Hello");
    buf.insert(5, " world");
    buf.insert(11, "!");
    expect(buf.getText()).toBe("Hello world!");
  });

  it("returns an insert operation", () => {
    const buf = TextBuffer.create();
    const op = buf.insert(0, "test");
    expect(op.type).toBe("insert");
    if (op.type === "insert") {
      expect(op.text).toBe("test");
      expect(op.id.replicaId).toBe(buf.replicaId);
    }
  });

  it("handles empty insert", () => {
    const buf = TextBuffer.fromString("Hello");
    const op = buf.insert(2, "");
    expect(buf.getText()).toBe("Hello");
    expect(op.type).toBe("insert");
  });

  it("inserts multi-line text", () => {
    const buf = TextBuffer.create();
    buf.insert(0, "line1\nline2\nline3");
    expect(buf.getText()).toBe("line1\nline2\nline3");
  });
});

// ---------------------------------------------------------------------------
// TextBuffer: delete
// ---------------------------------------------------------------------------

describe("TextBuffer delete", () => {
  it("deletes from the beginning", () => {
    const buf = TextBuffer.fromString("Hello, world!");
    buf.delete(0, 7);
    expect(buf.getText()).toBe("world!");
  });

  it("deletes from the end", () => {
    const buf = TextBuffer.fromString("Hello, world!");
    buf.delete(5, 13);
    expect(buf.getText()).toBe("Hello");
  });

  it("deletes from the middle", () => {
    const buf = TextBuffer.fromString("Hello, world!");
    buf.delete(5, 7);
    expect(buf.getText()).toBe("Helloworld!");
  });

  it("deletes all text", () => {
    const buf = TextBuffer.fromString("Hello");
    buf.delete(0, 5);
    expect(buf.getText()).toBe("");
    expect(buf.length).toBe(0);
  });

  it("handles empty delete range", () => {
    const buf = TextBuffer.fromString("Hello");
    buf.delete(2, 2);
    expect(buf.getText()).toBe("Hello");
  });

  it("clamps out-of-bounds delete", () => {
    const buf = TextBuffer.fromString("Hello");
    buf.delete(3, 100);
    expect(buf.getText()).toBe("Hel");
  });

  it("returns a delete operation", () => {
    const buf = TextBuffer.fromString("Hello");
    const op = buf.delete(1, 4);
    expect(op.type).toBe("delete");
    if (op.type === "delete") {
      expect(op.ranges.length).toBeGreaterThan(0);
    }
  });

  it("handles delete after insert", () => {
    const buf = TextBuffer.create();
    buf.insert(0, "Hello, world!");
    buf.delete(5, 7);
    expect(buf.getText()).toBe("Helloworld!");
  });

  it("deletes multi-line text", () => {
    const buf = TextBuffer.fromString("line1\nline2\nline3");
    buf.delete(5, 11);
    expect(buf.getText()).toBe("line1\nline3");
  });
});

// ---------------------------------------------------------------------------
// TextBuffer: insert at boundaries
// ---------------------------------------------------------------------------

describe("TextBuffer boundary operations", () => {
  it("insert at offset 0 of multi-fragment buffer", () => {
    const buf = TextBuffer.fromString("world");
    buf.insert(5, "!");
    buf.insert(0, "Hello ");
    expect(buf.getText()).toBe("Hello world!");
  });

  it("sequential inserts at the end", () => {
    const buf = TextBuffer.create();
    buf.insert(0, "a");
    buf.insert(1, "b");
    buf.insert(2, "c");
    buf.insert(3, "d");
    expect(buf.getText()).toBe("abcd");
  });

  it("sequential inserts at the beginning", () => {
    const buf = TextBuffer.create();
    buf.insert(0, "d");
    buf.insert(0, "c");
    buf.insert(0, "b");
    buf.insert(0, "a");
    expect(buf.getText()).toBe("abcd");
  });
});

// ---------------------------------------------------------------------------
// TextBuffer: undo/redo
// ---------------------------------------------------------------------------

describe("TextBuffer undo/redo", () => {
  it("undoes a single insert", () => {
    const buf = TextBuffer.create();
    buf.insert(0, "Hello");
    const op = buf.undo();
    expect(op).not.toBeNull();
    expect(buf.getText()).toBe("");
  });

  it("redoes a single insert", () => {
    const buf = TextBuffer.create();
    buf.insert(0, "Hello");
    buf.undo();
    expect(buf.getText()).toBe("");
    const op = buf.redo();
    expect(op).not.toBeNull();
    expect(buf.getText()).toBe("Hello");
  });

  it("undoes a single delete", () => {
    const buf = TextBuffer.fromString("Hello");
    buf.delete(1, 4);
    expect(buf.getText()).toBe("Ho");
    buf.undo();
    expect(buf.getText()).toBe("Hello");
  });

  it("redoes a single delete", () => {
    const buf = TextBuffer.fromString("Hello");
    buf.delete(1, 4);
    buf.undo();
    expect(buf.getText()).toBe("Hello");
    buf.redo();
    expect(buf.getText()).toBe("Ho");
  });

  it("undo returns null when nothing to undo", () => {
    const buf = TextBuffer.create();
    expect(buf.undo()).toBeNull();
  });

  it("redo returns null when nothing to redo", () => {
    const buf = TextBuffer.create();
    expect(buf.redo()).toBeNull();
  });

  it("new edit clears redo stack", () => {
    const buf = TextBuffer.create();
    buf.insert(0, "Hello");
    buf.undo();
    buf.insert(0, "Goodbye");
    expect(buf.redo()).toBeNull();
    expect(buf.getText()).toBe("Goodbye");
  });

  it("multiple undo/redo cycles", () => {
    let time = 0;
    const buf = TextBuffer.create();
    buf.setTimeSource(() => time);

    buf.insert(0, "A");
    time += 500; // exceed groupDelay so each insert is a separate group
    buf.insert(1, "B");
    time += 500;
    buf.insert(2, "C");
    expect(buf.getText()).toBe("ABC");

    buf.undo(); // undo "C"
    expect(buf.getText()).toBe("AB");

    buf.undo(); // undo "B"
    expect(buf.getText()).toBe("A");

    buf.redo(); // redo "B"
    expect(buf.getText()).toBe("AB");

    buf.redo(); // redo "C"
    expect(buf.getText()).toBe("ABC");
  });
});

// ---------------------------------------------------------------------------
// TextBuffer: transactions
// ---------------------------------------------------------------------------

describe("TextBuffer transactions", () => {
  it("groups multiple edits into a single undo unit", () => {
    const buf = TextBuffer.create();
    buf.startTransaction();
    buf.insert(0, "Hello");
    buf.insert(5, " world");
    buf.endTransaction();

    expect(buf.getText()).toBe("Hello world");

    buf.undo();
    expect(buf.getText()).toBe("");
  });

  it("transaction redo restores all edits", () => {
    const buf = TextBuffer.create();
    buf.startTransaction();
    buf.insert(0, "Hello");
    buf.insert(5, " world");
    buf.endTransaction();

    buf.undo();
    buf.redo();
    expect(buf.getText()).toBe("Hello world");
  });
});

// ---------------------------------------------------------------------------
// Snapshot
// ---------------------------------------------------------------------------

describe("TextBufferSnapshot", () => {
  it("snapshot sees state at creation time", () => {
    const buf = TextBuffer.fromString("Hello");
    const snap = buf.snapshot();

    buf.insert(5, " world");
    expect(buf.getText()).toBe("Hello world");
    expect(snap.getText()).toBe("Hello");

    snap.release();
  });

  it("snapshot reports correct length", () => {
    const buf = TextBuffer.fromString("Hello\nworld");
    const snap = buf.snapshot();
    expect(snap.length).toBe(11);
    snap.release();
  });

  it("snapshot reports correct line count", () => {
    const buf = TextBuffer.fromString("line1\nline2\nline3");
    const snap = buf.snapshot();
    expect(snap.lineCount).toBe(3);
    snap.release();
  });

  it("snapshot lineToOffset conversion", () => {
    const buf = TextBuffer.fromString("line1\nline2\nline3");
    const snap = buf.snapshot();
    expect(snap.lineToOffset(0)).toBe(0);
    expect(snap.lineToOffset(1)).toBe(6);
    expect(snap.lineToOffset(2)).toBe(12);
    snap.release();
  });

  it("snapshot offsetToLineCol conversion", () => {
    const buf = TextBuffer.fromString("line1\nline2\nline3");
    const snap = buf.snapshot();
    expect(snap.offsetToLineCol(0)).toEqual({ line: 0, col: 0 });
    expect(snap.offsetToLineCol(6)).toEqual({ line: 1, col: 0 });
    expect(snap.offsetToLineCol(8)).toEqual({ line: 1, col: 2 });
    snap.release();
  });

  it("snapshot getLine", () => {
    const buf = TextBuffer.fromString("line1\nline2\nline3");
    const snap = buf.snapshot();
    expect(snap.getLine(0)).toBe("line1");
    expect(snap.getLine(1)).toBe("line2");
    expect(snap.getLine(2)).toBe("line3");
    snap.release();
  });

  it("snapshot getText with range", () => {
    const buf = TextBuffer.fromString("Hello, world!");
    const snap = buf.snapshot();
    expect(snap.getText(7, 12)).toBe("world");
    snap.release();
  });

  it("snapshot of empty buffer", () => {
    const buf = TextBuffer.create();
    const snap = buf.snapshot();
    expect(snap.length).toBe(0);
    expect(snap.lineCount).toBe(1);
    expect(snap.getText()).toBe("");
    snap.release();
  });
});

// ---------------------------------------------------------------------------
// Anchor resolution through snapshots
// ---------------------------------------------------------------------------

describe("Anchor resolution", () => {
  it("creates and resolves an anchor", () => {
    const buf = TextBuffer.fromString("Hello, world!");
    const snap = buf.snapshot();
    const anchor = snap.createAnchor(7);
    const offset = snap.resolveAnchor(anchor);
    expect(offset).toBe(7);
    snap.release();
  });

  it("anchor survives inserts after it within same snapshot", () => {
    // Create buffer and take a snapshot
    const buf = TextBuffer.fromString("Hello, world!");
    const snap = buf.snapshot();

    // Create anchors at various positions
    const anchor0 = snap.createAnchor(0);
    const anchor5 = snap.createAnchor(5);
    const anchor13 = snap.createAnchor(13);

    // All should resolve correctly within the same snapshot
    expect(snap.resolveAnchor(anchor0)).toBe(0);
    expect(snap.resolveAnchor(anchor5)).toBe(5);
    expect(snap.resolveAnchor(anchor13)).toBe(13);
    snap.release();
  });

  it("anchor created on one snapshot resolves on the same snapshot", () => {
    const buf = TextBuffer.create();
    buf.insert(0, "Hello");
    buf.insert(5, " world");

    const snap = buf.snapshot();
    const anchor = snap.createAnchor(5); // at the space
    expect(snap.resolveAnchor(anchor)).toBe(5);
    snap.release();
  });

  it("anchor at document boundaries", () => {
    const buf = TextBuffer.fromString("Hello");
    const snap = buf.snapshot();

    const startAnchor = snap.createAnchor(0);
    const endAnchor = snap.createAnchor(5);

    expect(snap.resolveAnchor(startAnchor)).toBe(0);
    expect(snap.resolveAnchor(endAnchor)).toBe(5);
    snap.release();
  });
});

// ---------------------------------------------------------------------------
// Two-replica convergence
// ---------------------------------------------------------------------------

describe("Two-replica convergence", () => {
  it("concurrent inserts on empty buffers converge", () => {
    const rid1 = replicaId(1);
    const rid2 = replicaId(2);

    // Both start empty
    const buf1 = TextBuffer.create(rid1);
    const buf2 = TextBuffer.create(rid2);

    // Each inserts different text
    const op1 = buf1.insert(0, "Hello");
    const op2 = buf2.insert(0, "World");

    // Cross-apply
    buf1.applyRemote(op2);
    buf2.applyRemote(op1);

    // Both should converge to the same text
    expect(buf1.getText()).toBe(buf2.getText());
    // Both texts should contain both words
    expect(buf1.getText()).toContain("Hello");
    expect(buf1.getText()).toContain("World");
  });

  it("concurrent inserts after shared initial insert converge", () => {
    const rid1 = replicaId(1);
    const rid2 = replicaId(2);

    // Replica 1 creates the initial state
    const buf1 = TextBuffer.create(rid1);
    const initOp = buf1.insert(0, "AC");

    // Replica 2 starts from same state by applying the initial op
    const buf2 = TextBuffer.create(rid2);
    buf2.applyRemote(initOp);

    expect(buf1.getText()).toBe("AC");
    expect(buf2.getText()).toBe("AC");

    // Both insert between A and C
    const op1 = buf1.insert(1, "B1");
    const op2 = buf2.insert(1, "B2");

    // Cross-apply
    buf1.applyRemote(op2);
    buf2.applyRemote(op1);

    // Both should converge (order determined by locator then replica ID)
    expect(buf1.getText()).toBe(buf2.getText());
    // Both inserts should be present
    expect(buf1.getText()).toContain("B1");
    expect(buf1.getText()).toContain("B2");
    expect(buf1.getText()).toContain("A");
    expect(buf1.getText()).toContain("C");
  });

  it("sequential operations from one replica applied to another", () => {
    const rid1 = replicaId(1);
    const rid2 = replicaId(2);

    const buf1 = TextBuffer.create(rid1);
    const buf2 = TextBuffer.create(rid2);

    // Replica 1 does a sequence of operations
    const op1 = buf1.insert(0, "Hello");
    const op2 = buf1.insert(5, " world");

    // Replica 2 applies them in order
    buf2.applyRemote(op1);
    buf2.applyRemote(op2);

    expect(buf2.getText()).toBe("Hello world");
    expect(buf1.getText()).toBe(buf2.getText());
  });

  it("operations applied in different orders converge", () => {
    const rid1 = replicaId(1);
    const rid2 = replicaId(2);
    const rid3 = replicaId(3);

    // All start empty
    const buf1 = TextBuffer.create(rid1);
    const buf2 = TextBuffer.create(rid2);
    const buf3 = TextBuffer.create(rid3);

    // Each replica inserts independently
    const op1 = buf1.insert(0, "A");
    const op2 = buf2.insert(0, "B");
    const op3 = buf3.insert(0, "C");

    // Apply in different orders
    buf1.applyRemote(op2);
    buf1.applyRemote(op3);

    buf2.applyRemote(op3);
    buf2.applyRemote(op1);

    buf3.applyRemote(op1);
    buf3.applyRemote(op2);

    // All three should converge
    expect(buf1.getText()).toBe(buf2.getText());
    expect(buf2.getText()).toBe(buf3.getText());
  });
});

// ---------------------------------------------------------------------------
// Locator operations
// ---------------------------------------------------------------------------

describe("Locator", () => {
  it("MIN_LOCATOR < MAX_LOCATOR", () => {
    expect(compareLocators(MIN_LOCATOR, MAX_LOCATOR)).toBeLessThan(0);
  });

  it("between() produces a locator between left and right", () => {
    const mid = locatorBetween(MIN_LOCATOR, MAX_LOCATOR);
    expect(compareLocators(MIN_LOCATOR, mid)).toBeLessThan(0);
    expect(compareLocators(mid, MAX_LOCATOR)).toBeLessThan(0);
  });

  it("between() with adjacent locators extends depth", () => {
    const a = { levels: [5] };
    const b = { levels: [6] };
    const mid = locatorBetween(a, b);
    expect(compareLocators(a, mid)).toBeLessThan(0);
    expect(compareLocators(mid, b)).toBeLessThan(0);
  });

  it("between() with room picks midpoint", () => {
    const a = { levels: [10] };
    const b = { levels: [20] };
    const mid = locatorBetween(a, b);
    expect(compareLocators(a, mid)).toBeLessThan(0);
    expect(compareLocators(mid, b)).toBeLessThan(0);
    // Should be a single-level locator since there's room
    expect(mid.levels.length).toBe(1);
  });

  it("sequential between() calls maintain ordering", () => {
    let left = MIN_LOCATOR;
    const right = MAX_LOCATOR;
    const locators = [left];

    for (let i = 0; i < 20; i++) {
      const next = locatorBetween(left, right);
      expect(compareLocators(left, next)).toBeLessThan(0);
      expect(compareLocators(next, right)).toBeLessThan(0);
      locators.push(next);
      left = next;
    }

    // Verify all locators are in order
    for (let i = 1; i < locators.length; i++) {
      const prev = locators[i - 1];
      const curr = locators[i];
      if (prev !== undefined && curr !== undefined) {
        expect(compareLocators(prev, curr)).toBeLessThan(0);
      }
    }
  });

  it("locatorsEqual returns true for identical locators", () => {
    const a = { levels: [1, 2, 3] };
    const b = { levels: [1, 2, 3] };
    expect(locatorsEqual(a, b)).toBe(true);
  });

  it("locatorsEqual returns false for different locators", () => {
    const a = { levels: [1, 2, 3] };
    const b = { levels: [1, 2, 4] };
    expect(locatorsEqual(a, b)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Version vector operations
// ---------------------------------------------------------------------------

describe("VersionVector", () => {
  it("creates empty version vector", () => {
    const vv = createVersionVector();
    expect(vv.size).toBe(0);
  });

  it("observeVersion sets entry", () => {
    const vv = createVersionVector();
    const rid = replicaId(1);
    observeVersion(vv, rid, 5);
    expect(vv.get(rid)).toBe(5);
  });

  it("observeVersion takes max", () => {
    const vv = createVersionVector();
    const rid = replicaId(1);
    observeVersion(vv, rid, 5);
    observeVersion(vv, rid, 3);
    expect(vv.get(rid)).toBe(5);
    observeVersion(vv, rid, 7);
    expect(vv.get(rid)).toBe(7);
  });

  it("mergeVersionVectors combines two vectors", () => {
    const vv1 = createVersionVector();
    const vv2 = createVersionVector();
    const rid1 = replicaId(1);
    const rid2 = replicaId(2);

    observeVersion(vv1, rid1, 5);
    observeVersion(vv2, rid1, 3);
    observeVersion(vv2, rid2, 7);

    mergeVersionVectors(vv1, vv2);
    expect(vv1.get(rid1)).toBe(5); // max(5,3) = 5
    expect(vv1.get(rid2)).toBe(7);
  });

  it("versionIncludes checks operation membership", () => {
    const vv = createVersionVector();
    const rid = replicaId(1);
    observeVersion(vv, rid, 5);

    expect(versionIncludes(vv, { replicaId: rid, counter: 3 })).toBe(true);
    expect(versionIncludes(vv, { replicaId: rid, counter: 5 })).toBe(true);
    expect(versionIncludes(vv, { replicaId: rid, counter: 6 })).toBe(false);
  });

  it("happenedBefore is correct", () => {
    const a = createVersionVector();
    const b = createVersionVector();
    const rid1 = replicaId(1);
    const rid2 = replicaId(2);

    observeVersion(a, rid1, 3);
    observeVersion(b, rid1, 5);
    observeVersion(b, rid2, 2);

    expect(happenedBefore(a, b)).toBe(true);
    expect(happenedBefore(b, a)).toBe(false);
  });

  it("happenedBefore with concurrent vectors returns false", () => {
    const a = createVersionVector();
    const b = createVersionVector();
    const rid1 = replicaId(1);
    const rid2 = replicaId(2);

    observeVersion(a, rid1, 5);
    observeVersion(a, rid2, 2);
    observeVersion(b, rid1, 3);
    observeVersion(b, rid2, 7);

    // Neither happened before the other (concurrent)
    expect(happenedBefore(a, b)).toBe(false);
    expect(happenedBefore(b, a)).toBe(false);
  });

  it("versionVectorsEqual checks equality", () => {
    const a = createVersionVector();
    const b = createVersionVector();
    const rid = replicaId(1);

    expect(versionVectorsEqual(a, b)).toBe(true);

    observeVersion(a, rid, 5);
    expect(versionVectorsEqual(a, b)).toBe(false);

    observeVersion(b, rid, 5);
    expect(versionVectorsEqual(a, b)).toBe(true);
  });

  it("cloneVersionVector creates independent copy", () => {
    const vv = createVersionVector();
    const rid = replicaId(1);
    observeVersion(vv, rid, 5);

    const clone = cloneVersionVector(vv);
    observeVersion(clone, rid, 10);

    expect(vv.get(rid)).toBe(5);
    expect(clone.get(rid)).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// Lamport clock
// ---------------------------------------------------------------------------

describe("LamportClock", () => {
  it("tick produces monotonically increasing counters", () => {
    const rid = replicaId(1);
    const clock = new LamportClock(rid);

    const id1 = clock.tick();
    const id2 = clock.tick();
    const id3 = clock.tick();

    expect(id1.counter).toBe(0);
    expect(id2.counter).toBe(1);
    expect(id3.counter).toBe(2);
    expect(id1.replicaId).toBe(rid);
  });

  it("observe advances clock past observed value", () => {
    const rid = replicaId(1);
    const clock = new LamportClock(rid);

    clock.tick(); // counter = 0 -> 1
    clock.observe(10);
    const id = clock.tick();
    expect(id.counter).toBe(11);
  });

  it("observe does not go backwards", () => {
    const rid = replicaId(1);
    const clock = new LamportClock(rid);

    clock.observe(10);
    clock.observe(5);
    const id = clock.tick();
    expect(id.counter).toBe(11);
  });
});

// ---------------------------------------------------------------------------
// UndoMap
// ---------------------------------------------------------------------------

describe("UndoMap", () => {
  const makeOpId = (r: number, c: number): OperationId => ({
    replicaId: replicaId(r),
    counter: c,
  });

  it("getCount returns 0 for unknown operation", () => {
    const map = new UndoMap();
    expect(map.getCount(makeOpId(1, 0))).toBe(0);
  });

  it("increment increases count", () => {
    const map = new UndoMap();
    const opId = makeOpId(1, 0);
    expect(map.increment(opId)).toBe(1);
    expect(map.increment(opId)).toBe(2);
  });

  it("isUndone checks odd count", () => {
    const map = new UndoMap();
    const opId = makeOpId(1, 0);
    expect(map.isUndone(opId)).toBe(false); // count = 0
    map.increment(opId);
    expect(map.isUndone(opId)).toBe(true); // count = 1
    map.increment(opId);
    expect(map.isUndone(opId)).toBe(false); // count = 2
  });

  it("setCount uses max-wins semantics", () => {
    const map = new UndoMap();
    const opId = makeOpId(1, 0);
    map.setCount(opId, 5);
    expect(map.getCount(opId)).toBe(5);
    map.setCount(opId, 3); // should not decrease
    expect(map.getCount(opId)).toBe(5);
    map.setCount(opId, 7);
    expect(map.getCount(opId)).toBe(7);
  });

  it("isVisible applies CRDT visibility formula", () => {
    const map = new UndoMap();
    const insertId = makeOpId(1, 0);
    const deleteId = makeOpId(2, 0);

    // No deletions, insertion not undone => visible
    expect(map.isVisible(insertId, [])).toBe(true);

    // Insertion undone => not visible
    map.increment(insertId);
    expect(map.isVisible(insertId, [])).toBe(false);

    // Insertion re-done => visible again
    map.increment(insertId);
    expect(map.isVisible(insertId, [])).toBe(true);

    // With a deletion that is NOT undone => not visible
    expect(map.isVisible(insertId, [deleteId])).toBe(false);

    // Undo the deletion => visible
    map.increment(deleteId);
    expect(map.isVisible(insertId, [deleteId])).toBe(true);
  });

  it("mergeFrom uses max-wins", () => {
    const map = new UndoMap();
    const opId = makeOpId(1, 0);
    map.setCount(opId, 3);

    map.mergeFrom([{ operationId: opId, count: 5 }]);
    expect(map.getCount(opId)).toBe(5);

    map.mergeFrom([{ operationId: opId, count: 2 }]);
    expect(map.getCount(opId)).toBe(5); // max-wins
  });
});

// ---------------------------------------------------------------------------
// Fragment operations
// ---------------------------------------------------------------------------

describe("Fragment", () => {
  const opId: OperationId = { replicaId: replicaId(1), counter: 0 };

  it("creates a visible fragment with correct summary", () => {
    const frag = createFragment(opId, 0, MIN_LOCATOR, "Hello\nworld", true);
    const summary = frag.summary();
    expect(summary.visibleLen).toBe(11);
    expect(summary.visibleLines).toBe(1);
    expect(summary.deletedLen).toBe(0);
  });

  it("creates a deleted fragment with correct summary", () => {
    const frag = createFragment(opId, 0, MIN_LOCATOR, "Hello\nworld", false);
    const summary = frag.summary();
    expect(summary.visibleLen).toBe(0);
    expect(summary.deletedLen).toBe(11);
    expect(summary.deletedLines).toBe(1);
  });

  it("splits a fragment correctly", () => {
    const frag = createFragment(opId, 0, MIN_LOCATOR, "Hello", true);
    const [left, right] = splitFragment(frag, 3);

    expect(left.text).toBe("Hel");
    expect(left.insertionOffset).toBe(0);
    expect(left.length).toBe(3);

    expect(right.text).toBe("lo");
    expect(right.insertionOffset).toBe(3);
    expect(right.length).toBe(2);
  });

  it("withVisibility changes visibility", () => {
    const frag = createFragment(opId, 0, MIN_LOCATOR, "Hello", true);
    expect(frag.visible).toBe(true);

    const hidden = withVisibility(frag, false);
    expect(hidden.visible).toBe(false);
    expect(hidden.text).toBe("Hello");
  });

  it("withVisibility returns same fragment if no change", () => {
    const frag = createFragment(opId, 0, MIN_LOCATOR, "Hello", true);
    const same = withVisibility(frag, true);
    expect(same).toBe(frag); // same reference
  });
});

// ---------------------------------------------------------------------------
// OperationId comparison
// ---------------------------------------------------------------------------

describe("OperationId", () => {
  it("compares by replicaId first", () => {
    const a: OperationId = { replicaId: replicaId(1), counter: 5 };
    const b: OperationId = { replicaId: replicaId(2), counter: 3 };
    expect(compareOperationIds(a, b)).toBeLessThan(0);
  });

  it("compares by counter when replicaId is equal", () => {
    const a: OperationId = { replicaId: replicaId(1), counter: 3 };
    const b: OperationId = { replicaId: replicaId(1), counter: 5 };
    expect(compareOperationIds(a, b)).toBeLessThan(0);
  });

  it("operationIdsEqual checks equality", () => {
    const a: OperationId = { replicaId: replicaId(1), counter: 5 };
    const b: OperationId = { replicaId: replicaId(1), counter: 5 };
    const c: OperationId = { replicaId: replicaId(1), counter: 6 };
    expect(operationIdsEqual(a, b)).toBe(true);
    expect(operationIdsEqual(a, c)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Integration: multiple operations
// ---------------------------------------------------------------------------

describe("TextBuffer integration", () => {
  it("insert, delete, undo, redo cycle", () => {
    const buf = TextBuffer.create();
    buf.insert(0, "Hello, world!");
    expect(buf.getText()).toBe("Hello, world!");

    buf.delete(5, 7);
    expect(buf.getText()).toBe("Helloworld!");

    buf.undo();
    expect(buf.getText()).toBe("Hello, world!");

    buf.undo();
    expect(buf.getText()).toBe("");

    buf.redo();
    expect(buf.getText()).toBe("Hello, world!");

    buf.redo();
    expect(buf.getText()).toBe("Helloworld!");
  });

  it("many sequential inserts", () => {
    const buf = TextBuffer.create();
    const chars = "abcdefghijklmnopqrstuvwxyz";
    for (let i = 0; i < chars.length; i++) {
      buf.insert(i, chars[i] ?? "");
    }
    expect(buf.getText()).toBe(chars);
  });

  it("alternating inserts and deletes", () => {
    const buf = TextBuffer.create();
    buf.insert(0, "Hello");
    buf.delete(0, 2);
    expect(buf.getText()).toBe("llo");
    buf.insert(0, "He");
    expect(buf.getText()).toBe("Hello");
    buf.delete(4, 5);
    expect(buf.getText()).toBe("Hell");
    buf.insert(4, "o!");
    expect(buf.getText()).toBe("Hello!");
  });

  it("version vector advances with each operation", () => {
    const rid = replicaId(1);
    const buf = TextBuffer.create(rid);

    buf.insert(0, "A");
    const v1 = cloneVersionVector(buf.version);

    buf.insert(1, "B");
    const v2 = cloneVersionVector(buf.version);

    expect(happenedBefore(v1, v2)).toBe(true);
    expect(happenedBefore(v2, v1)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Locator: >>> truncation regression
// ---------------------------------------------------------------------------

describe("Locator depth with sequential insertions", () => {
  it("100 sequential insertions stay at depth 1", () => {
    // With the corrected >> 37 shift giving ~65K values at depth 0,
    // 100 sequential insertions should never need to go deeper than depth 1.
    let left = MIN_LOCATOR;
    const right = MAX_LOCATOR;
    let maxDepth = 0;

    for (let i = 0; i < 100; i++) {
      const loc = locatorBetween(left, right);
      if (loc.levels.length > maxDepth) {
        maxDepth = loc.levels.length;
      }
      // Each new locator should still be between left and right
      expect(compareLocators(left, loc)).toBeLessThan(0);
      expect(compareLocators(loc, right)).toBeLessThan(0);
      left = loc;
    }

    // With the fix, the first level has ~65K values (MAX_SAFE_INTEGER / 2^37).
    // 100 sequential insertions should easily fit in depth 1.
    expect(maxDepth).toBeLessThanOrEqual(2);
  });

  it("locatorBetween depth-0 max is large enough for many insertions", () => {
    // Verify the depth-0 range is actually large (~65K), not truncated to near-zero.
    const mid = locatorBetween(MIN_LOCATOR, MAX_LOCATOR);
    // The midpoint should be roughly (MAX_SAFE_INTEGER / 2^37) / 2 ~ 32768
    expect(mid.levels.length).toBe(1);
    const midValue = mid.levels[0] ?? 0;
    // With the fix, midpoint should be around 32768. Before the fix (>>> truncation),
    // MAX_SAFE_INTEGER >>> 37 would give 0 or a very small number due to 32-bit truncation.
    expect(midValue).toBeGreaterThan(10000);
  });
});

// ---------------------------------------------------------------------------
// Remote delete: partial fragment overlap after concurrent split
// ---------------------------------------------------------------------------

describe("Remote delete with split fragments", () => {
  it("concurrent insert-split + remote delete converge", () => {
    const rid1 = replicaId(1);
    const rid2 = replicaId(2);

    // Both replicas start with the same text "ABCDE"
    const buf1 = TextBuffer.create(rid1);
    const initOp = buf1.insert(0, "ABCDE");

    const buf2 = TextBuffer.create(rid2);
    buf2.applyRemote(initOp);

    expect(buf1.getText()).toBe("ABCDE");
    expect(buf2.getText()).toBe("ABCDE");

    // Replica 1 inserts "X" at position 2 (between B and C), splitting the "ABCDE" fragment
    const insertOp = buf1.insert(2, "X");
    expect(buf1.getText()).toBe("ABXCDE");

    // Replica 2 deletes "BCD" (positions 1-4) from the ORIGINAL unsplit fragment
    const deleteOp = buf2.delete(1, 4);
    expect(buf2.getText()).toBe("AE");

    // Cross-apply: buf1 gets the delete, buf2 gets the insert
    buf1.applyRemote(deleteOp);
    buf2.applyRemote(insertOp);

    // Both should converge: "X" was inserted between B and C.
    // The delete of "BCD" should still delete B, C, D even though the fragment
    // was split by the concurrent insert. The "X" should survive since it's
    // a different insertion.
    expect(buf1.getText()).toBe(buf2.getText());
    // Both should contain "A", "X", "E" but not "B", "C", "D"
    expect(buf1.getText()).toContain("A");
    expect(buf1.getText()).toContain("X");
    expect(buf1.getText()).toContain("E");
    expect(buf1.getText()).not.toContain("B");
    expect(buf1.getText()).not.toContain("C");
    expect(buf1.getText()).not.toContain("D");
  });

  it("remote delete partially overlapping a split fragment", () => {
    const rid1 = replicaId(1);
    const rid2 = replicaId(2);

    // Both replicas start with "ABCDEF"
    const buf1 = TextBuffer.create(rid1);
    const initOp = buf1.insert(0, "ABCDEF");

    const buf2 = TextBuffer.create(rid2);
    buf2.applyRemote(initOp);

    // Replica 1 inserts "X" at position 3 (between C and D), splitting the fragment
    const insertOp = buf1.insert(3, "X");
    expect(buf1.getText()).toBe("ABCXDEF");

    // Replica 2 deletes "CD" (positions 2-4), which partially overlaps the
    // sub-fragments after the split
    const deleteOp = buf2.delete(2, 4);
    expect(buf2.getText()).toBe("ABEF");

    // Cross-apply
    buf1.applyRemote(deleteOp);
    buf2.applyRemote(insertOp);

    // Both should converge
    expect(buf1.getText()).toBe(buf2.getText());
    // "C" and "D" should be deleted, "X" should survive
    expect(buf1.getText()).toContain("X");
    expect(buf1.getText()).not.toContain("C");
    expect(buf1.getText()).not.toContain("D");
  });
});
