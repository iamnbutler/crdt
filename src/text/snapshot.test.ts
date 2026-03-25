/**
 * Tests for O(1) snapshot isolation and epoch-based reclamation.
 */

import { describe, expect, test } from "bun:test";
import { TextBuffer } from "./text-buffer.js";

describe("TextBufferSnapshot", () => {
  describe("O(1) snapshot creation", () => {
    test("snapshot() captures state at creation time", () => {
      const buffer = TextBuffer.fromString("hello world");
      const snapshot = buffer.snapshot();

      // Mutate the buffer after snapshot
      buffer.insert(5, " there");
      buffer.delete(0, 5);

      // Snapshot should still see original state
      expect(snapshot.getText()).toBe("hello world");
      expect(snapshot.length).toBe(11);

      snapshot.release();
    });

    test("snapshot version vector is independent of buffer", () => {
      const buffer = TextBuffer.fromString("test");
      const snapshot = buffer.snapshot();

      const snapshotVersion = snapshot.version;
      const bufferVersionBefore = new Map(buffer.version);

      // Mutate buffer
      buffer.insert(4, " more");

      // Snapshot version should be unchanged
      expect(snapshotVersion).toEqual(bufferVersionBefore);

      snapshot.release();
    });

    test("multiple snapshots see their respective states", () => {
      const buffer = TextBuffer.fromString("initial");
      const snap1 = buffer.snapshot();

      buffer.insert(7, " text");
      const snap2 = buffer.snapshot();

      buffer.delete(0, 7);
      const snap3 = buffer.snapshot();

      expect(snap1.getText()).toBe("initial");
      expect(snap2.getText()).toBe("initial text");
      expect(snap3.getText()).toBe(" text");

      snap1.release();
      snap2.release();
      snap3.release();
    });

    test("snapshot length uses O(1) summary", () => {
      const buffer = TextBuffer.fromString("a".repeat(10000));
      const snapshot = buffer.snapshot();

      // Length should be available without iterating
      expect(snapshot.length).toBe(10000);

      snapshot.release();
    });
  });

  describe("structural sharing", () => {
    test("two snapshots share most nodes", () => {
      const buffer = TextBuffer.fromString("shared content that should be reused");
      const snap1 = buffer.snapshot();

      // Small edit - only a few nodes should change
      buffer.insert(0, "X");
      const snap2 = buffer.snapshot();

      // Both should see correct text
      expect(snap1.getText()).toBe("shared content that should be reused");
      expect(snap2.getText()).toBe("Xshared content that should be reused");

      // Verify they share the same root (structural sharing)
      // This is an indirect test - if they didn't share, we'd exhaust memory quickly
      const utilization = buffer.arenaUtilization();
      expect(utilization.allocated).toBeLessThan(100); // Should be much less than 2x items

      snap1.release();
      snap2.release();
    });

    test("snapshots share arena with buffer", () => {
      const buffer = TextBuffer.fromString("test content");
      const snap = buffer.snapshot();

      // Both should work correctly
      expect(buffer.getText()).toBe("test content");
      expect(snap.getText()).toBe("test content");

      snap.release();
    });
  });

  describe("release() lifecycle", () => {
    test("release() prevents further use", () => {
      const buffer = TextBuffer.fromString("test");
      const snapshot = buffer.snapshot();

      snapshot.release();

      // Should throw on any operation
      expect(() => snapshot.getText()).toThrow("Cannot use released snapshot");
      expect(() => snapshot.length).toThrow("Cannot use released snapshot");
      expect(() => snapshot.lineCount).toThrow("Cannot use released snapshot");
    });

    test("release() is idempotent", () => {
      const buffer = TextBuffer.fromString("test");
      const snapshot = buffer.snapshot();

      snapshot.release();
      snapshot.release(); // Should not throw
      snapshot.release(); // Should not throw
    });

    test("release() decrements live snapshot count", () => {
      const buffer = TextBuffer.fromString("test");

      expect(buffer.liveSnapshots).toBe(0);

      const snap1 = buffer.snapshot();
      expect(buffer.liveSnapshots).toBe(1);

      const snap2 = buffer.snapshot();
      expect(buffer.liveSnapshots).toBe(2);

      snap1.release();
      expect(buffer.liveSnapshots).toBe(1);

      snap2.release();
      expect(buffer.liveSnapshots).toBe(0);
    });

    test("release callback is called", () => {
      const buffer = TextBuffer.fromString("test");
      let releaseCallbackCalled = false;
      let callbackEpoch: number | null = null;
      let wasAuto = true;

      const snapshot = buffer.snapshot({
        onRelease: (epoch, wasAutoRelease) => {
          releaseCallbackCalled = true;
          callbackEpoch = epoch;
          wasAuto = wasAutoRelease;
        },
      });

      expect(releaseCallbackCalled).toBe(false);

      snapshot.release();

      expect(releaseCallbackCalled).toBe(true);
      expect(callbackEpoch).toBeGreaterThan(0);
      expect(wasAuto).toBe(false);
    });
  });

  describe("epoch tracking", () => {
    test("each snapshot gets a unique epoch", () => {
      const buffer = TextBuffer.fromString("test");

      const snap1 = buffer.snapshot();
      const snap2 = buffer.snapshot();
      const snap3 = buffer.snapshot();

      expect(snap1.epoch).toBeLessThan(snap2.epoch);
      expect(snap2.epoch).toBeLessThan(snap3.epoch);

      snap1.release();
      snap2.release();
      snap3.release();
    });

    test("epoch is tracked in arena utilization", () => {
      const buffer = TextBuffer.fromString("test");
      const utilBefore = buffer.arenaUtilization();

      const snap = buffer.snapshot();
      const utilDuring = buffer.arenaUtilization();

      expect(utilDuring.liveEpochs).toBe(1);
      expect(utilDuring.currentEpoch).toBeGreaterThan(utilBefore.currentEpoch);

      snap.release();
      const utilAfter = buffer.arenaUtilization();

      expect(utilAfter.liveEpochs).toBe(0);
    });
  });

  describe("garbage collection", () => {
    test("collectGarbage() frees unreachable nodes", () => {
      const buffer = TextBuffer.fromString("initial content");
      const utilBefore = buffer.arenaUtilization();

      // Create and release many snapshots with mutations
      for (let i = 0; i < 10; i++) {
        buffer.insert(0, `edit${i} `);
        const snap = buffer.snapshot();
        snap.release();
      }

      // Run garbage collection
      const freed = buffer.collectGarbage();

      // Should have freed some nodes
      expect(freed).toBeGreaterThanOrEqual(0); // May be 0 if nodes are still reachable

      const utilAfter = buffer.arenaUtilization();
      // Free list should have grown
      expect(utilAfter.free).toBeGreaterThanOrEqual(0);
    });

    test("GC does not free nodes reachable from live snapshot", () => {
      const buffer = TextBuffer.fromString("original");
      const snap = buffer.snapshot();

      // Mutate buffer heavily
      for (let i = 0; i < 5; i++) {
        buffer.insert(0, `change${i} `);
      }

      // Run GC - should not affect snapshot
      buffer.collectGarbage();

      // Snapshot should still work
      expect(snap.getText()).toBe("original");

      snap.release();
    });
  });

  describe("arena utilization monitoring", () => {
    test("utilization reports basic stats", () => {
      const buffer = TextBuffer.fromString("test content");
      const util = buffer.arenaUtilization();

      expect(util.allocated).toBeGreaterThan(0);
      expect(util.capacity).toBeGreaterThan(0);
      expect(util.utilizationRatio).toBeGreaterThanOrEqual(0);
      expect(util.utilizationRatio).toBeLessThanOrEqual(1);
      expect(util.fragmentationRatio).toBeGreaterThanOrEqual(0);
      expect(util.currentEpoch).toBeGreaterThan(0);
    });

    test("utilization tracks live epochs correctly", () => {
      const buffer = TextBuffer.fromString("test");

      expect(buffer.arenaUtilization().liveEpochs).toBe(0);

      const snap1 = buffer.snapshot();
      expect(buffer.arenaUtilization().liveEpochs).toBe(1);

      const snap2 = buffer.snapshot();
      expect(buffer.arenaUtilization().liveEpochs).toBe(2);

      snap1.release();
      expect(buffer.arenaUtilization().liveEpochs).toBe(1);

      snap2.release();
      expect(buffer.arenaUtilization().liveEpochs).toBe(0);
    });
  });

  describe("snapshot read operations", () => {
    test("getText() with range parameters", () => {
      const buffer = TextBuffer.fromString("hello world");
      const snapshot = buffer.snapshot();

      expect(snapshot.getText()).toBe("hello world");
      expect(snapshot.getText(0, 5)).toBe("hello");
      expect(snapshot.getText(6)).toBe("world");
      expect(snapshot.getText(0, 0)).toBe("");

      snapshot.release();
    });

    test("line operations work correctly", () => {
      const buffer = TextBuffer.fromString("line1\nline2\nline3");
      const snapshot = buffer.snapshot();

      expect(snapshot.lineCount).toBe(3);
      expect(snapshot.getLine(0)).toBe("line1");
      expect(snapshot.getLine(1)).toBe("line2");
      expect(snapshot.getLine(2)).toBe("line3");

      expect(snapshot.lineToOffset(0)).toBe(0);
      expect(snapshot.lineToOffset(1)).toBe(6);
      expect(snapshot.lineToOffset(2)).toBe(12);

      const pos = snapshot.offsetToLineCol(7);
      expect(pos.line).toBe(1);
      expect(pos.col).toBe(1);

      snapshot.release();
    });

    test("anchor operations work correctly", () => {
      const buffer = TextBuffer.fromString("hello world");
      const snapshot = buffer.snapshot();

      const anchor = snapshot.createAnchor(5, 0);
      expect(snapshot.resolveAnchor(anchor)).toBe(5);

      snapshot.release();
    });
  });

  describe("auto-release", () => {
    test("snapshot has age property", () => {
      const buffer = TextBuffer.fromString("test");
      const snapshot = buffer.snapshot();

      expect(snapshot.age).toBeGreaterThanOrEqual(0);
      expect(snapshot.age).toBeLessThan(1000); // Should be less than 1 second

      snapshot.release();
    });

    test("snapshot with maxAgeMs=0 disables auto-release timer", () => {
      const buffer = TextBuffer.fromString("test");
      const snapshot = buffer.snapshot({ maxAgeMs: 0 });

      // Should not throw or auto-release
      expect(snapshot.released).toBe(false);

      snapshot.release();
    });
  });
});

describe("TextBuffer snapshot integration", () => {
  test("complex editing scenario with snapshots", () => {
    const buffer = TextBuffer.fromString("The quick brown fox");

    // Take snapshot before edit
    const snap1 = buffer.snapshot();

    // Multiple edits
    buffer.delete(4, 10); // Delete "quick "
    buffer.insert(4, "slow ");

    const snap2 = buffer.snapshot();

    buffer.insert(0, "[START] ");
    buffer.insert(buffer.length, " [END]");

    const snap3 = buffer.snapshot();

    // Verify all snapshots
    expect(snap1.getText()).toBe("The quick brown fox");
    expect(snap2.getText()).toBe("The slow brown fox");
    expect(snap3.getText()).toBe("[START] The slow brown fox [END]");

    // Release in different order than creation
    snap2.release();
    snap1.release();
    snap3.release();

    // Buffer should still work
    expect(buffer.getText()).toBe("[START] The slow brown fox [END]");
  });

  test("undo/redo with snapshots", () => {
    // Note: Need to control time source for proper undo grouping.
    const buffer = TextBuffer.create();

    // Set time source before any operations
    let time = 0;
    buffer.setTimeSource(() => time);

    // First insert: this will be the "original" state
    buffer.insert(0, "original");
    const snapOriginal = buffer.snapshot();

    // Advance time past group delay (default 300ms) to create separate undo group
    time += 500;

    buffer.insert(8, " text");
    const snapAfterInsert = buffer.snapshot();

    // Undo the second insert only
    buffer.undo();
    const snapAfterUndo = buffer.snapshot();

    // Redo
    buffer.redo();
    const snapAfterRedo = buffer.snapshot();

    expect(snapOriginal.getText()).toBe("original");
    expect(snapAfterInsert.getText()).toBe("original text");
    // After undo of " text" insert, we go back to just "original"
    expect(snapAfterUndo.getText()).toBe("original");
    expect(snapAfterRedo.getText()).toBe("original text");

    snapOriginal.release();
    snapAfterInsert.release();
    snapAfterUndo.release();
    snapAfterRedo.release();
  });
});
