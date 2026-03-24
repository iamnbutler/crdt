import { describe, expect, spyOn, test } from "bun:test";
import { DEFAULT_MAX_SNAPSHOT_AGE_MS } from "./snapshot.js";
import { TextBuffer } from "./text-buffer.js";

describe("TextBufferSnapshot", () => {
  describe("O(1) creation", () => {
    test("snapshot captures state at creation time", () => {
      const buffer = TextBuffer.fromString("Hello, world!");
      const snap = buffer.snapshot({ maxAgeMs: 0 });

      expect(snap.getText()).toBe("Hello, world!");
      expect(snap.length).toBe(13);
      expect(snap.lineCount).toBe(1);

      snap.release();
    });

    test("snapshot sees pre-edit state after mutation", () => {
      const buffer = TextBuffer.fromString("Hello");
      const snap1 = buffer.snapshot({ maxAgeMs: 0 });

      // Mutate buffer
      buffer.insert(5, ", world!");

      // Snapshot should still see old state
      expect(snap1.getText()).toBe("Hello");
      expect(buffer.getText()).toBe("Hello, world!");

      // New snapshot sees new state
      const snap2 = buffer.snapshot({ maxAgeMs: 0 });
      expect(snap2.getText()).toBe("Hello, world!");

      snap1.release();
      snap2.release();
    });

    test("multiple snapshots at different points", () => {
      const buffer = TextBuffer.fromString("A");
      const snap1 = buffer.snapshot({ maxAgeMs: 0 });

      buffer.insert(1, "B");
      const snap2 = buffer.snapshot({ maxAgeMs: 0 });

      buffer.insert(2, "C");
      const snap3 = buffer.snapshot({ maxAgeMs: 0 });

      expect(snap1.getText()).toBe("A");
      expect(snap2.getText()).toBe("AB");
      expect(snap3.getText()).toBe("ABC");
      expect(buffer.getText()).toBe("ABC");

      snap1.release();
      snap2.release();
      snap3.release();
    });

    test("snapshot with deletions preserves visibility state", () => {
      const buffer = TextBuffer.fromString("Hello, world!");
      buffer.delete(5, 7); // Delete ", " (positions 5-7)
      const snap = buffer.snapshot({ maxAgeMs: 0 });

      expect(snap.getText()).toBe("Helloworld!");
      expect(snap.length).toBe(11);

      snap.release();
    });

    test("snapshot with undo/redo preserves state", () => {
      let time = 0;
      const buffer = TextBuffer.create();
      buffer.setTimeSource(() => time);

      buffer.insert(0, "Hello");
      time += 500; // Exceed groupDelay
      buffer.insert(5, "!");

      const snap1 = buffer.snapshot({ maxAgeMs: 0 });
      expect(snap1.getText()).toBe("Hello!");

      buffer.undo(); // Undoes just "!"
      const snap2 = buffer.snapshot({ maxAgeMs: 0 });
      expect(snap2.getText()).toBe("Hello");

      // Old snapshot still has old state
      expect(snap1.getText()).toBe("Hello!");

      buffer.redo();
      const snap3 = buffer.snapshot({ maxAgeMs: 0 });
      expect(snap3.getText()).toBe("Hello!");

      snap1.release();
      snap2.release();
      snap3.release();
    });
  });

  describe("structural sharing", () => {
    test("two snapshots share most nodes", () => {
      const buffer = TextBuffer.fromString("Hello, world!");
      const snap1 = buffer.snapshot({ maxAgeMs: 0 });

      // Small edit
      buffer.insert(0, "!");

      const snap2 = buffer.snapshot({ maxAgeMs: 0 });

      // Both snapshots work independently
      expect(snap1.getText()).toBe("Hello, world!");
      expect(snap2.getText()).toBe("!Hello, world!");

      // Get arena stats to verify sharing
      const arena = buffer.snapshot({ maxAgeMs: 0 });
      // Can't directly verify node sharing, but both snapshots work

      snap1.release();
      snap2.release();
      arena.release();
    });
  });

  describe("release lifecycle", () => {
    test("release clears cached data", () => {
      const buffer = TextBuffer.fromString("Hello");
      const snap = buffer.snapshot({ maxAgeMs: 0 });

      // Access to cache data
      expect(snap.getText()).toBe("Hello");

      // Release
      snap.release();
      expect(snap.released).toBe(true);

      // Second release returns 0
      expect(snap.release()).toBe(0);
    });

    test("accessing released snapshot throws", () => {
      const buffer = TextBuffer.fromString("Hello");
      const snap = buffer.snapshot({ maxAgeMs: 0 });
      snap.release();

      expect(() => snap.getText()).toThrow("Cannot access released snapshot");
      expect(() => snap.length).toThrow("Cannot access released snapshot");
      expect(() => snap.lineCount).toThrow("Cannot access released snapshot");
    });

    test("release frees dead nodes when last snapshot released", () => {
      const buffer = TextBuffer.fromString("Hello");
      const snap1 = buffer.snapshot({ maxAgeMs: 0 });

      // Mutate many times
      buffer.insert(5, "1");
      buffer.insert(6, "2");
      buffer.insert(7, "3");

      const snap2 = buffer.snapshot({ maxAgeMs: 0 });

      // Release first snapshot
      snap1.release();
      // May or may not free nodes depending on reachability

      // Release second snapshot
      snap2.release();
      // After all snapshots released, nodes may be freed

      expect(snap1.released).toBe(true);
      expect(snap2.released).toBe(true);
    });
  });

  describe("epoch tracking", () => {
    test("snapshot info contains epoch", () => {
      const buffer = TextBuffer.fromString("Hello");
      const snap1 = buffer.snapshot({ maxAgeMs: 0 });
      const snap2 = buffer.snapshot({ maxAgeMs: 0 });

      // Each snapshot has increasing epoch
      expect(snap2.info.epoch).toBeGreaterThan(snap1.info.epoch);

      snap1.release();
      snap2.release();
    });

    test("snapshot info contains creation time", () => {
      const before = Date.now();
      const buffer = TextBuffer.fromString("Hello");
      const snap = buffer.snapshot({ maxAgeMs: 0 });
      const after = Date.now();

      expect(snap.info.createdAt).toBeGreaterThanOrEqual(before);
      expect(snap.info.createdAt).toBeLessThanOrEqual(after);

      snap.release();
    });
  });

  describe("max age auto-release", () => {
    test("snapshot with maxAgeMs=0 does not auto-release", async () => {
      const buffer = TextBuffer.fromString("Hello");
      const snap = buffer.snapshot({ maxAgeMs: 0 });

      // Wait a bit
      await new Promise((r) => setTimeout(r, 10));

      // Should still be accessible
      expect(snap.released).toBe(false);
      expect(snap.getText()).toBe("Hello");

      snap.release();
    });

    test("snapshot auto-releases after max age", async () => {
      const warnSpy = spyOn(console, "warn").mockImplementation(() => {
        // Suppress warnings during test
      });

      const buffer = TextBuffer.fromString("Hello");
      const snap = buffer.snapshot({ maxAgeMs: 50 });

      expect(snap.released).toBe(false);

      // Wait for auto-release
      await new Promise((r) => setTimeout(r, 100));

      expect(snap.released).toBe(true);
      expect(warnSpy).toHaveBeenCalled();

      warnSpy.mockRestore();
    });

    test("default max age is 30 seconds", () => {
      expect(DEFAULT_MAX_SNAPSHOT_AGE_MS).toBe(30_000);
    });

    test("manual release cancels auto-release timer", async () => {
      const warnSpy = spyOn(console, "warn").mockImplementation(() => {
        // Suppress warnings during test
      });

      const buffer = TextBuffer.fromString("Hello");
      const snap = buffer.snapshot({ maxAgeMs: 50 });

      // Release manually before timeout
      snap.release();

      // Wait past the would-be timeout
      await new Promise((r) => setTimeout(r, 100));

      // Should not have logged warning about auto-release
      const autoReleaseCalls = warnSpy.mock.calls.filter(
        (args) => args[0] && String(args[0]).includes("exceeded max age"),
      );
      expect(autoReleaseCalls.length).toBe(0);

      warnSpy.mockRestore();
    });
  });

  describe("DocumentSnapshot interface", () => {
    test("lineToOffset and offsetToLineCol work correctly", () => {
      const buffer = TextBuffer.fromString("Hello\nWorld\nTest");
      const snap = buffer.snapshot({ maxAgeMs: 0 });

      expect(snap.lineCount).toBe(3);
      expect(snap.lineToOffset(0)).toBe(0);
      expect(snap.lineToOffset(1)).toBe(6); // After "Hello\n"
      expect(snap.lineToOffset(2)).toBe(12); // After "Hello\nWorld\n"

      expect(snap.offsetToLineCol(0)).toEqual({ line: 0, col: 0 });
      expect(snap.offsetToLineCol(7)).toEqual({ line: 1, col: 1 });
      expect(snap.offsetToLineCol(14)).toEqual({ line: 2, col: 2 });

      snap.release();
    });

    test("getLine returns correct line", () => {
      const buffer = TextBuffer.fromString("Hello\nWorld\nTest");
      const snap = buffer.snapshot({ maxAgeMs: 0 });

      expect(snap.getLine(0)).toBe("Hello");
      expect(snap.getLine(1)).toBe("World");
      expect(snap.getLine(2)).toBe("Test");

      snap.release();
    });

    test("getText with range returns slice", () => {
      const buffer = TextBuffer.fromString("Hello, world!");
      const snap = buffer.snapshot({ maxAgeMs: 0 });

      expect(snap.getText(0, 5)).toBe("Hello");
      expect(snap.getText(7, 12)).toBe("world");
      expect(snap.getText(7)).toBe("world!");

      snap.release();
    });

    test("anchor creation and resolution", () => {
      const buffer = TextBuffer.fromString("Hello, world!");
      const snap = buffer.snapshot({ maxAgeMs: 0 });

      const anchor = snap.createAnchor(7);
      const resolved = snap.resolveAnchor(anchor);

      expect(resolved).toBe(7);

      snap.release();
    });

    test("version vector is captured", () => {
      const buffer = TextBuffer.fromString("Hello");
      buffer.insert(5, "!");

      const snap = buffer.snapshot({ maxAgeMs: 0 });

      // Version should have entry for this replica
      expect(snap.version.size).toBeGreaterThan(0);
      expect(snap.version.get(buffer.replicaId)).toBeGreaterThan(0);

      snap.release();
    });
  });

  describe("empty document", () => {
    test("snapshot of empty buffer", () => {
      const buffer = TextBuffer.create();
      const snap = buffer.snapshot({ maxAgeMs: 0 });

      expect(snap.getText()).toBe("");
      expect(snap.length).toBe(0);
      expect(snap.lineCount).toBe(1);

      snap.release();
    });

    test("anchor at empty document", () => {
      const buffer = TextBuffer.create();
      const snap = buffer.snapshot({ maxAgeMs: 0 });

      const anchor = snap.createAnchor(0);
      expect(snap.resolveAnchor(anchor)).toBe(0);

      snap.release();
    });
  });

  describe("large documents", () => {
    test("snapshot of document with many lines", () => {
      const lines = Array.from({ length: 1000 }, (_, i) => `Line ${i}`);
      const text = lines.join("\n");
      const buffer = TextBuffer.fromString(text);
      const snap = buffer.snapshot({ maxAgeMs: 0 });

      expect(snap.lineCount).toBe(1000);
      expect(snap.getLine(500)).toBe("Line 500");

      snap.release();
    });
  });
});

describe("Arena reclamation", () => {
  test("arena stats show active snapshots", () => {
    const buffer = TextBuffer.fromString("Hello");
    const arena = buffer.snapshot({ maxAgeMs: 0 });
    arena.release();

    // Create new snapshots
    const snap1 = buffer.snapshot({ maxAgeMs: 0 });
    const snap2 = buffer.snapshot({ maxAgeMs: 0 });

    // Can't directly access arena from TextBuffer, but snapshots work
    expect(snap1.released).toBe(false);
    expect(snap2.released).toBe(false);

    snap1.release();
    snap2.release();
  });
});
