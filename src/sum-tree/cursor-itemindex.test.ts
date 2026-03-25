import { describe, expect, it } from "bun:test";
import {
  type CountSummary,
  SumTree,
  type Summarizable,
  countDimension,
  countSummaryOps,
} from "./index.js";

// Simple test item for count-based tests
class CountItem implements Summarizable<CountSummary> {
  constructor(public value: number) {}

  summary(): CountSummary {
    return { count: 1 };
  }
}

describe("Cursor.itemIndex()", () => {
  describe("consistency between walk and seek", () => {
    it("matches for single-leaf tree", () => {
      // Small tree that fits in one leaf
      const items = Array.from({ length: 5 }, (_, i) => new CountItem(i));
      const tree = SumTree.fromItems(items, countSummaryOps);

      for (let target = 0; target < items.length; target++) {
        // Method 1: Walk with next() from beginning
        const walkCursor = tree.cursor(countDimension);
        for (let j = 0; j < target; j++) {
          walkCursor.next();
        }
        const walkIndex = walkCursor.itemIndex();

        // Method 2: Seek directly
        const seekCursor = tree.cursor(countDimension);
        seekCursor.seekForward(target, "right");
        const seekIndex = seekCursor.itemIndex();

        expect(seekIndex).toBe(walkIndex);
        expect(seekIndex).toBe(target);
      }
    });

    it("matches for multi-leaf tree (branching factor 4)", () => {
      // Tree with multiple leaves to create internal nodes
      const items = Array.from({ length: 20 }, (_, i) => new CountItem(i));
      const tree = SumTree.fromItems(items, countSummaryOps, 4);

      for (let target = 0; target < items.length; target++) {
        // Method 1: Walk with next() from beginning
        const walkCursor = tree.cursor(countDimension);
        for (let j = 0; j < target; j++) {
          walkCursor.next();
        }
        const walkIndex = walkCursor.itemIndex();

        // Method 2: Seek directly
        const seekCursor = tree.cursor(countDimension);
        seekCursor.seekForward(target, "right");
        const seekIndex = seekCursor.itemIndex();

        expect(seekIndex).toBe(walkIndex);
        expect(seekIndex).toBe(target);
      }
    });

    it("matches for 39-item tree (original reproduction)", () => {
      // Reproduction from issue: 39 items, branching factor 4
      const items = Array.from({ length: 39 }, (_, i) => new CountItem(i));
      const tree = SumTree.fromItems(items, countSummaryOps, 4);

      // Seek to last item
      const seekCursor = tree.cursor(countDimension);
      seekCursor.seekForward(38, "right");
      const seekIndex = seekCursor.itemIndex();

      // Walk to last item
      const walkCursor = tree.cursor(countDimension);
      for (let j = 0; j < 38; j++) {
        walkCursor.next();
      }
      const walkIndex = walkCursor.itemIndex();

      expect(seekIndex).toBe(walkIndex);
      expect(seekIndex).toBe(38);
    });

    it("matches for fresh seeks to various positions", () => {
      const items = Array.from({ length: 100 }, (_, i) => new CountItem(i));
      const tree = SumTree.fromItems(items, countSummaryOps, 4);

      // Use fresh cursor for each seek (sequential seeks have a separate bug)
      const targets = [10, 25, 50, 75, 90, 95];
      for (const target of targets) {
        const cursor = tree.cursor(countDimension);
        cursor.seekForward(target, "right");
        const seekIndex = cursor.itemIndex();
        expect(seekIndex).toBe(target);
      }
    });
  });

  describe("edge cases", () => {
    it("returns 0 at beginning", () => {
      const items = Array.from({ length: 10 }, (_, i) => new CountItem(i));
      const tree = SumTree.fromItems(items, countSummaryOps, 4);

      const cursor = tree.cursor(countDimension);
      expect(cursor.itemIndex()).toBe(0);
    });

    it("returns length at end", () => {
      const items = Array.from({ length: 10 }, (_, i) => new CountItem(i));
      const tree = SumTree.fromItems(items, countSummaryOps, 4);

      const cursor = tree.cursor(countDimension);
      // Walk to end
      while (!cursor.atEnd) {
        cursor.next();
      }
      expect(cursor.itemIndex()).toBe(10);
    });

    it("works on empty tree", () => {
      const tree = new SumTree<CountItem, CountSummary>(countSummaryOps);
      const cursor = tree.cursor(countDimension);
      expect(cursor.itemIndex()).toBe(0);
    });

    it("handles single item tree", () => {
      const tree = SumTree.fromItems([new CountItem(42)], countSummaryOps);
      const cursor = tree.cursor(countDimension);

      expect(cursor.itemIndex()).toBe(0);
      cursor.next();
      expect(cursor.itemIndex()).toBe(1);
    });
  });

  describe("minimal reproduction with 2 leaves", () => {
    it("matches for tree with exactly 2 leaves", () => {
      // Branching factor 4 means a leaf can hold 4 items
      // 5 items forces 2 leaves with 1 internal node
      const items = Array.from({ length: 5 }, (_, i) => new CountItem(i));
      const tree = SumTree.fromItems(items, countSummaryOps, 4);

      // Check invariants to understand structure
      const invariants = tree.checkInvariants();
      expect(invariants.valid).toBe(true);

      // Seek to item at index 4 (first item in second leaf likely)
      const seekCursor = tree.cursor(countDimension);
      seekCursor.seekForward(4, "right");
      const seekIndex = seekCursor.itemIndex();

      // Walk to same position
      const walkCursor = tree.cursor(countDimension);
      for (let j = 0; j < 4; j++) {
        walkCursor.next();
      }
      const walkIndex = walkCursor.itemIndex();

      expect(seekIndex).toBe(walkIndex);
      expect(seekIndex).toBe(4);
    });
  });

  describe("deep trees (multiple internal levels)", () => {
    it("matches for tree with 3+ levels (branching factor 4, 100 items)", () => {
      // With B=4, 100 items creates at least 3 levels
      const items = Array.from({ length: 100 }, (_, i) => new CountItem(i));
      const tree = SumTree.fromItems(items, countSummaryOps, 4);

      // Test various positions throughout the tree
      const targets = [0, 15, 32, 63, 77, 99];
      for (const target of targets) {
        const seekCursor = tree.cursor(countDimension);
        seekCursor.seekForward(target, "right");
        const seekIndex = seekCursor.itemIndex();

        const walkCursor = tree.cursor(countDimension);
        for (let j = 0; j < target; j++) {
          walkCursor.next();
        }
        const walkIndex = walkCursor.itemIndex();

        expect(seekIndex).toBe(walkIndex);
        expect(seekIndex).toBe(target);
      }
    });

    it("matches for tree with 4+ levels (branching factor 4, 1000 items)", () => {
      const items = Array.from({ length: 1000 }, (_, i) => new CountItem(i));
      const tree = SumTree.fromItems(items, countSummaryOps, 4);

      // Test various positions
      const targets = [0, 127, 256, 511, 768, 999];
      for (const target of targets) {
        const seekCursor = tree.cursor(countDimension);
        seekCursor.seekForward(target, "right");
        const seekIndex = seekCursor.itemIndex();

        expect(seekIndex).toBe(target);
      }
    });
  });

  describe("position after walk then itemIndex", () => {
    it("itemIndex tracks position correctly during iteration", () => {
      const items = Array.from({ length: 50 }, (_, i) => new CountItem(i));
      const tree = SumTree.fromItems(items, countSummaryOps, 4);

      const cursor = tree.cursor(countDimension);
      let count = 0;
      while (!cursor.atEnd) {
        expect(cursor.itemIndex()).toBe(count);
        cursor.next();
        count++;
      }
      expect(count).toBe(50);
    });
  });

  describe("O(log n) efficiency with getItemCount", () => {
    it("uses O(1) summary lookup for item counts", () => {
      // countSummaryOps has getItemCount, so itemIndex should be O(log n)
      const items = Array.from({ length: 10000 }, (_, i) => new CountItem(i));
      const tree = SumTree.fromItems(items, countSummaryOps, 16);

      // This should be fast (O(log n)) not slow (O(n))
      const start = performance.now();
      for (let i = 0; i < 1000; i++) {
        const cursor = tree.cursor(countDimension);
        cursor.seekForward(5000, "right");
        cursor.itemIndex();
      }
      const elapsed = performance.now() - start;

      // 1000 iterations of O(log n) work should complete in < 100ms
      // If it were O(n), it would take much longer
      expect(elapsed).toBeLessThan(100);
    });
  });
});
