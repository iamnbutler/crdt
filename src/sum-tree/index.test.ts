import { describe, expect, it } from "bun:test";
import {
  type CountSummary,
  SumTree,
  type Summarizable,
  type TextSummary,
  countDimension,
  countSummaryOps,
  lineDimension,
  pointDimension,
  textSummaryOps,
  utf16Dimension,
} from "./index.js";

// Simple test item for count-based tests
class CountItem implements Summarizable<CountSummary> {
  constructor(public value: number) {}

  summary(): CountSummary {
    return { count: 1 };
  }
}

// Text chunk item for text-based tests
class TextChunk implements Summarizable<TextSummary> {
  constructor(public text: string) {}

  summary(): TextSummary {
    let lines = 0;
    let lastLineLen = 0;
    let lastLineBytes = 0;

    const encoder = new TextEncoder();
    const bytes = encoder.encode(this.text).length;

    for (let i = 0; i < this.text.length; i++) {
      const char = this.text[i];
      if (char === "\n") {
        lines++;
        lastLineLen = 0;
        lastLineBytes = 0;
      } else {
        lastLineLen++;
        lastLineBytes += encoder.encode(char ?? "").length;
      }
    }

    return {
      lines,
      utf16Len: this.text.length,
      bytes,
      lastLineLen,
      lastLineBytes,
    };
  }
}

describe("SumTree", () => {
  describe("basic operations", () => {
    it("creates an empty tree", () => {
      const tree = new SumTree<CountItem, CountSummary>(countSummaryOps);
      expect(tree.isEmpty()).toBe(true);
      expect(tree.length()).toBe(0);
      expect(tree.summary()).toEqual({ count: 0 });
    });

    it("pushes items", () => {
      let tree = new SumTree<CountItem, CountSummary>(countSummaryOps);
      tree = tree.push(new CountItem(1));
      tree = tree.push(new CountItem(2));
      tree = tree.push(new CountItem(3));

      expect(tree.isEmpty()).toBe(false);
      expect(tree.length()).toBe(3);
      expect(tree.summary()).toEqual({ count: 3 });
    });

    it("gets items by index", () => {
      let tree = new SumTree<CountItem, CountSummary>(countSummaryOps);
      tree = tree.push(new CountItem(10));
      tree = tree.push(new CountItem(20));
      tree = tree.push(new CountItem(30));

      expect(tree.get(0)?.value).toBe(10);
      expect(tree.get(1)?.value).toBe(20);
      expect(tree.get(2)?.value).toBe(30);
      expect(tree.get(3)).toBeUndefined();
      expect(tree.get(-1)).toBeUndefined();
    });

    it("inserts at specific positions", () => {
      let tree = new SumTree<CountItem, CountSummary>(countSummaryOps);
      tree = tree.push(new CountItem(1));
      tree = tree.push(new CountItem(3));
      tree = tree.insertAt(1, new CountItem(2));

      expect(tree.get(0)?.value).toBe(1);
      expect(tree.get(1)?.value).toBe(2);
      expect(tree.get(2)?.value).toBe(3);
    });

    it("removes items", () => {
      let tree = new SumTree<CountItem, CountSummary>(countSummaryOps);
      tree = tree.push(new CountItem(1));
      tree = tree.push(new CountItem(2));
      tree = tree.push(new CountItem(3));

      tree = tree.removeAt(1);

      expect(tree.length()).toBe(2);
      expect(tree.get(0)?.value).toBe(1);
      expect(tree.get(1)?.value).toBe(3);
    });

    it("converts to array", () => {
      let tree = new SumTree<CountItem, CountSummary>(countSummaryOps);
      tree = tree.push(new CountItem(1));
      tree = tree.push(new CountItem(2));
      tree = tree.push(new CountItem(3));

      const arr = tree.toArray();
      expect(arr.length).toBe(3);
      expect(arr.map((i) => i.value)).toEqual([1, 2, 3]);
    });
  });

  describe("path copying (persistence)", () => {
    it("push does not mutate original tree", () => {
      const original = new SumTree<CountItem, CountSummary>(countSummaryOps);
      const modified = original.push(new CountItem(1));

      expect(original.length()).toBe(0);
      expect(modified.length()).toBe(1);
    });

    it("insertAt does not mutate original tree", () => {
      let tree = new SumTree<CountItem, CountSummary>(countSummaryOps);
      tree = tree.push(new CountItem(1));
      tree = tree.push(new CountItem(3));

      const original = tree;
      const modified = tree.insertAt(1, new CountItem(2));

      expect(original.get(1)?.value).toBe(3);
      expect(modified.get(1)?.value).toBe(2);
    });

    it("removeAt does not mutate original tree", () => {
      let tree = new SumTree<CountItem, CountSummary>(countSummaryOps);
      tree = tree.push(new CountItem(1));
      tree = tree.push(new CountItem(2));
      tree = tree.push(new CountItem(3));

      const original = tree;
      const modified = tree.removeAt(1);

      expect(original.length()).toBe(3);
      expect(modified.length()).toBe(2);
    });

    it("old roots remain valid after multiple mutations", () => {
      let tree1 = new SumTree<CountItem, CountSummary>(countSummaryOps);
      tree1 = tree1.push(new CountItem(1));

      const tree2 = tree1.push(new CountItem(2));
      const tree3 = tree2.push(new CountItem(3));
      const tree4 = tree3.removeAt(1);

      // All trees should still be valid
      expect(tree1.toArray().map((i) => i.value)).toEqual([1]);
      expect(tree2.toArray().map((i) => i.value)).toEqual([1, 2]);
      expect(tree3.toArray().map((i) => i.value)).toEqual([1, 2, 3]);
      expect(tree4.toArray().map((i) => i.value)).toEqual([1, 3]);
    });

    it("replaceAt replaces single item with multiple items", () => {
      let tree = new SumTree<CountItem, CountSummary>(countSummaryOps);
      tree = tree.push(new CountItem(1));
      tree = tree.push(new CountItem(2));
      tree = tree.push(new CountItem(3));

      const modified = tree.replaceAt(1, [new CountItem(10), new CountItem(20), new CountItem(30)]);

      expect(tree.toArray().map((i) => i.value)).toEqual([1, 2, 3]);
      expect(modified.toArray().map((i) => i.value)).toEqual([1, 10, 20, 30, 3]);
    });

    it("replaceAt with single item acts like edit", () => {
      let tree = new SumTree<CountItem, CountSummary>(countSummaryOps);
      tree = tree.push(new CountItem(1));
      tree = tree.push(new CountItem(2));
      tree = tree.push(new CountItem(3));

      const modified = tree.replaceAt(1, [new CountItem(99)]);

      expect(modified.toArray().map((i) => i.value)).toEqual([1, 99, 3]);
    });

    it("replaceAt with empty array acts like removeAt", () => {
      let tree = new SumTree<CountItem, CountSummary>(countSummaryOps);
      tree = tree.push(new CountItem(1));
      tree = tree.push(new CountItem(2));
      tree = tree.push(new CountItem(3));

      const modified = tree.replaceAt(1, []);

      expect(modified.toArray().map((i) => i.value)).toEqual([1, 3]);
    });

    it("replaceAt throws on out of bounds index", () => {
      let tree = new SumTree<CountItem, CountSummary>(countSummaryOps);
      tree = tree.push(new CountItem(1));

      expect(() => tree.replaceAt(-1, [new CountItem(2)])).toThrow();
      expect(() => tree.replaceAt(5, [new CountItem(2)])).toThrow();
    });

    it("replaceAtMut mutates in place", () => {
      let tree = new SumTree<CountItem, CountSummary>(countSummaryOps);
      tree = tree.push(new CountItem(1));
      tree = tree.push(new CountItem(2));
      tree = tree.push(new CountItem(3));

      tree.replaceAtMut(1, [new CountItem(10), new CountItem(20)]);

      expect(tree.toArray().map((i) => i.value)).toEqual([1, 10, 20, 3]);
    });

    it("replaceAtMut with empty array removes item", () => {
      let tree = new SumTree<CountItem, CountSummary>(countSummaryOps);
      tree = tree.push(new CountItem(1));
      tree = tree.push(new CountItem(2));
      tree = tree.push(new CountItem(3));

      tree.replaceAtMut(1, []);

      expect(tree.toArray().map((i) => i.value)).toEqual([1, 3]);
    });
  });

  describe("B-tree structure", () => {
    it("handles node splitting with small branching factor", () => {
      // Use small branching factor to force splits
      let tree = new SumTree<CountItem, CountSummary>(countSummaryOps, 4);

      for (let i = 0; i < 20; i++) {
        tree = tree.push(new CountItem(i));
      }

      expect(tree.length()).toBe(20);
      expect(tree.toArray().map((i) => i.value)).toEqual([...Array(20).keys()]);

      const invariants = tree.checkInvariants();
      expect(invariants.valid).toBe(true);
    });

    it("replaceAt handles node splitting when replacing with many items", () => {
      // Use small branching factor to force splits
      let tree = new SumTree<CountItem, CountSummary>(countSummaryOps, 4);

      // Start with 3 items
      tree = tree.push(new CountItem(1));
      tree = tree.push(new CountItem(2));
      tree = tree.push(new CountItem(3));

      // Replace middle item with 10 items - will trigger multiple splits
      const replacements = [];
      for (let i = 0; i < 10; i++) {
        replacements.push(new CountItem(100 + i));
      }
      tree = tree.replaceAt(1, replacements);

      expect(tree.length()).toBe(12);
      expect(tree.toArray().map((i) => i.value)).toEqual([
        1, 100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 3,
      ]);

      const invariants = tree.checkInvariants();
      expect(invariants.valid).toBe(true);
    });

    it("replaceAtMut handles node splitting when replacing with many items", () => {
      let tree = new SumTree<CountItem, CountSummary>(countSummaryOps, 4);

      tree = tree.push(new CountItem(1));
      tree = tree.push(new CountItem(2));
      tree = tree.push(new CountItem(3));

      const replacements = [];
      for (let i = 0; i < 10; i++) {
        replacements.push(new CountItem(100 + i));
      }
      tree.replaceAtMut(1, replacements);

      expect(tree.length()).toBe(12);
      expect(tree.toArray().map((i) => i.value)).toEqual([
        1, 100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 3,
      ]);

      const invariants = tree.checkInvariants();
      expect(invariants.valid).toBe(true);
    });

    it("handles node merging on delete with small branching factor", () => {
      let tree = new SumTree<CountItem, CountSummary>(countSummaryOps, 4);

      for (let i = 0; i < 20; i++) {
        tree = tree.push(new CountItem(i));
      }

      // Delete items to trigger merging
      for (let i = 19; i >= 10; i--) {
        tree = tree.removeAt(i);
      }

      expect(tree.length()).toBe(10);
      expect(tree.toArray().map((i) => i.value)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);

      const invariants = tree.checkInvariants();
      expect(invariants.valid).toBe(true);
    });

    it("maintains all leaves at same depth", () => {
      let tree = new SumTree<CountItem, CountSummary>(countSummaryOps, 4);

      // Build up
      for (let i = 0; i < 100; i++) {
        tree = tree.push(new CountItem(i));
        const invariants = tree.checkInvariants();
        if (!invariants.valid) {
          console.log(`Failed at insert ${i}:`, invariants.errors);
        }
        expect(invariants.valid).toBe(true);
      }

      // Delete random positions
      for (let i = 0; i < 50; i++) {
        const idx = Math.floor(Math.random() * tree.length());
        tree = tree.removeAt(idx);
        const invariants = tree.checkInvariants();
        expect(invariants.valid).toBe(true);
      }
    });
  });

  describe("fromItems", () => {
    it("creates tree from array", () => {
      const items = [new CountItem(1), new CountItem(2), new CountItem(3)];
      const tree = SumTree.fromItems(items, countSummaryOps);

      expect(tree.length()).toBe(3);
      expect(tree.toArray().map((i) => i.value)).toEqual([1, 2, 3]);
    });

    it("handles large arrays efficiently", () => {
      const items = Array.from({ length: 1000 }, (_, i) => new CountItem(i));
      const tree = SumTree.fromItems(items, countSummaryOps);

      expect(tree.length()).toBe(1000);
      expect(tree.get(500)?.value).toBe(500);

      const invariants = tree.checkInvariants();
      expect(invariants.valid).toBe(true);
    });

    it("handles empty array", () => {
      const tree = SumTree.fromItems<CountItem, CountSummary>([], countSummaryOps);
      expect(tree.isEmpty()).toBe(true);
    });
  });

  describe("slice", () => {
    it("splits tree at position", () => {
      const items = Array.from({ length: 10 }, (_, i) => new CountItem(i));
      const tree = SumTree.fromItems(items, countSummaryOps);

      const [left, right] = tree.slice(5);

      expect(left.length()).toBe(5);
      expect(right.length()).toBe(5);
      expect(left.toArray().map((i) => i.value)).toEqual([0, 1, 2, 3, 4]);
      expect(right.toArray().map((i) => i.value)).toEqual([5, 6, 7, 8, 9]);
    });

    it("handles edge cases", () => {
      const items = Array.from({ length: 5 }, (_, i) => new CountItem(i));
      const tree = SumTree.fromItems(items, countSummaryOps);

      // Split at 0
      const [left0, right0] = tree.slice(0);
      expect(left0.length()).toBe(0);
      expect(right0.length()).toBe(5);

      // Split at end
      const [leftEnd, rightEnd] = tree.slice(5);
      expect(leftEnd.length()).toBe(5);
      expect(rightEnd.length()).toBe(0);
    });

    it("does not mutate original", () => {
      const items = Array.from({ length: 10 }, (_, i) => new CountItem(i));
      const tree = SumTree.fromItems(items, countSummaryOps);

      const [left, right] = tree.slice(5);

      expect(tree.length()).toBe(10);
      expect(left.length()).toBe(5);
      expect(right.length()).toBe(5);
    });
  });

  describe("concat", () => {
    it("concatenates two trees", () => {
      const items1 = Array.from({ length: 5 }, (_, i) => new CountItem(i));
      const items2 = Array.from({ length: 5 }, (_, i) => new CountItem(i + 10));

      const tree1 = SumTree.fromItems(items1, countSummaryOps);
      const tree2 = SumTree.fromItems(items2, countSummaryOps);

      const combined = SumTree.concat(tree1, tree2);

      expect(combined.length()).toBe(10);
      expect(combined.toArray().map((i) => i.value)).toEqual([0, 1, 2, 3, 4, 10, 11, 12, 13, 14]);
    });

    it("does not mutate originals", () => {
      const tree1 = SumTree.fromItems([new CountItem(1)], countSummaryOps);
      const tree2 = SumTree.fromItems([new CountItem(2)], countSummaryOps);

      SumTree.concat(tree1, tree2);

      expect(tree1.length()).toBe(1);
      expect(tree2.length()).toBe(1);
    });
  });

  describe("cursor", () => {
    it("creates cursor and seeks", () => {
      const items = Array.from({ length: 10 }, (_, i) => new CountItem(i));
      const tree = SumTree.fromItems(items, countSummaryOps);

      const cursor = tree.cursor(countDimension);
      expect(cursor.position).toBe(0);

      cursor.seekForward(5, "right");
      const item = cursor.item();
      expect(item?.value).toBe(5);
    });

    it("traverses with next()", () => {
      const items = Array.from({ length: 5 }, (_, i) => new CountItem(i));
      const tree = SumTree.fromItems(items, countSummaryOps);

      const cursor = tree.cursor(countDimension);
      const values: number[] = [];

      let item = cursor.item();
      while (item !== undefined) {
        values.push(item.value);
        cursor.next();
        item = cursor.item();
      }

      expect(values).toEqual([0, 1, 2, 3, 4]);
    });

    it("traverses with prev()", () => {
      const items = Array.from({ length: 5 }, (_, i) => new CountItem(i));
      const tree = SumTree.fromItems(items, countSummaryOps);

      const cursor = tree.cursor(countDimension);
      cursor.seekForward(4, "right");

      const values: number[] = [];
      let item = cursor.item();
      while (item !== undefined) {
        values.push(item.value);
        if (!cursor.prev()) break;
        item = cursor.item();
      }

      expect(values).toEqual([4, 3, 2, 1, 0]);
    });

    it("handles empty tree", () => {
      const tree = new SumTree<CountItem, CountSummary>(countSummaryOps);
      const cursor = tree.cursor(countDimension);

      expect(cursor.atEnd).toBe(true);
      expect(cursor.item()).toBeUndefined();
    });
  });

  describe("text summary and dimensions", () => {
    it("computes text summary correctly", () => {
      const chunks = [new TextChunk("hello\n"), new TextChunk("world\n"), new TextChunk("test")];
      const tree = SumTree.fromItems(chunks, textSummaryOps);

      const summary = tree.summary();
      expect(summary.lines).toBe(2);
      expect(summary.utf16Len).toBe(16); // "hello\nworld\ntest"
      expect(summary.lastLineLen).toBe(4); // "test"
    });

    it("seeks by line number", () => {
      const chunks = [new TextChunk("line1\n"), new TextChunk("line2\n"), new TextChunk("line3")];
      const tree = SumTree.fromItems(chunks, textSummaryOps);

      const cursor = tree.cursor(lineDimension);
      cursor.seekForward(1, "right");

      const item = cursor.item();
      expect(item?.text).toBe("line2\n");
    });

    it("seeks by UTF-16 offset", () => {
      const chunks = [new TextChunk("abc"), new TextChunk("def"), new TextChunk("ghi")];
      const tree = SumTree.fromItems(chunks, textSummaryOps);

      const cursor = tree.cursor(utf16Dimension);
      cursor.seekForward(4, "right");

      const item = cursor.item();
      expect(item?.text).toBe("def");
    });

    it("seeks by point (line + column)", () => {
      const chunks = [new TextChunk("abc\n"), new TextChunk("defgh\n"), new TextChunk("ij")];
      const tree = SumTree.fromItems(chunks, textSummaryOps);

      const cursor = tree.cursor(pointDimension);
      cursor.seekForward({ line: 1, column: 0 }, "right");

      const item = cursor.item();
      expect(item?.text).toBe("defgh\n");
    });

    it("startPosition returns cumulative position before current item", () => {
      const chunks = [new TextChunk("abc"), new TextChunk("def"), new TextChunk("ghi")];
      const tree = SumTree.fromItems(chunks, textSummaryOps);

      const cursor = tree.cursor(utf16Dimension);
      cursor.seekForward(4, "right"); // Seek to "def"

      // Start position should be 3 (length of "abc")
      expect(cursor.startPosition()).toBe(3);
      expect(cursor.item()?.text).toBe("def");
    });

    it("peekPrev returns previous item without moving cursor", () => {
      const chunks = [new TextChunk("abc"), new TextChunk("def"), new TextChunk("ghi")];
      const tree = SumTree.fromItems(chunks, textSummaryOps);

      const cursor = tree.cursor(utf16Dimension);
      cursor.seekForward(4, "right"); // Seek to "def"

      const prevItem = cursor.peekPrev();
      expect(prevItem?.text).toBe("abc");

      // Cursor should still be at "def"
      expect(cursor.item()?.text).toBe("def");
      expect(cursor.startPosition()).toBe(3);
    });

    it("peekNext returns next item without moving cursor", () => {
      const chunks = [new TextChunk("abc"), new TextChunk("def"), new TextChunk("ghi")];
      const tree = SumTree.fromItems(chunks, textSummaryOps);

      const cursor = tree.cursor(utf16Dimension);
      cursor.seekForward(4, "right"); // Seek to "def"

      const nextItem = cursor.peekNext();
      expect(nextItem?.text).toBe("ghi");

      // Cursor should still be at "def"
      expect(cursor.item()?.text).toBe("def");
      expect(cursor.startPosition()).toBe(3);
    });

    it("peekPrev returns undefined at beginning", () => {
      const chunks = [new TextChunk("abc"), new TextChunk("def")];
      const tree = SumTree.fromItems(chunks, textSummaryOps);

      const cursor = tree.cursor(utf16Dimension);
      cursor.reset();

      expect(cursor.peekPrev()).toBeUndefined();
    });

    it("peekNext returns undefined at end", () => {
      const chunks = [new TextChunk("abc"), new TextChunk("def")];
      const tree = SumTree.fromItems(chunks, textSummaryOps);

      const cursor = tree.cursor(utf16Dimension);
      cursor.seekForward(4, "right"); // Seek to "def"
      cursor.next(); // Move past "def"

      expect(cursor.peekNext()).toBeUndefined();
    });
  });

  describe("dimension-based operations", () => {
    it("inserts by dimension", () => {
      const chunks = [new TextChunk("abc"), new TextChunk("ghi")];
      let tree = SumTree.fromItems(chunks, textSummaryOps);

      // Insert "def" at UTF-16 position 3 (between "abc" and "ghi")
      tree = tree.insertByDimension(utf16Dimension, 3, new TextChunk("def"), "right");

      expect(tree.length()).toBe(3);
      expect(tree.get(0)?.text).toBe("abc");
      expect(tree.get(1)?.text).toBe("def");
      expect(tree.get(2)?.text).toBe("ghi");
    });

    it("edits by dimension", () => {
      const chunks = [new TextChunk("abc"), new TextChunk("def"), new TextChunk("ghi")];
      let tree = SumTree.fromItems(chunks, textSummaryOps);

      // Edit item at UTF-16 position 4 (inside "def")
      tree = tree.editByDimension(utf16Dimension, 4, () => new TextChunk("DEF"), "right");

      expect(tree.length()).toBe(3);
      expect(tree.get(1)?.text).toBe("DEF");
    });

    it("deletes by dimension", () => {
      const chunks = [new TextChunk("abc"), new TextChunk("def"), new TextChunk("ghi")];
      let tree = SumTree.fromItems(chunks, textSummaryOps);

      // Delete item at UTF-16 position 4 (inside "def")
      tree = tree.deleteByDimension(utf16Dimension, 4, "right");

      expect(tree.length()).toBe(2);
      expect(tree.get(0)?.text).toBe("abc");
      expect(tree.get(1)?.text).toBe("ghi");
    });

    it("delete by dimension returns original tree for empty tree", () => {
      const tree = new SumTree<TextChunk, TextSummary>(textSummaryOps);
      const result = tree.deleteByDimension(utf16Dimension, 0, "right");

      expect(result).toBe(tree); // Same reference
      expect(result.isEmpty()).toBe(true);
    });

    it("delete by dimension maintains invariants", () => {
      const chunks = Array.from({ length: 100 }, (_, i) => new CountItem(i));
      let tree = SumTree.fromItems(chunks, countSummaryOps, 4);

      // Delete items at various positions
      tree = tree.deleteByDimension(countDimension, 50, "right"); // Middle
      tree = tree.deleteByDimension(countDimension, 0, "right"); // Start
      tree = tree.deleteByDimension(countDimension, 95, "right"); // Near end

      expect(tree.length()).toBe(97);
      const invariants = tree.checkInvariants();
      expect(invariants.valid).toBe(true);
    });

    it("delete by dimension handles underflow correctly", () => {
      const chunks = Array.from({ length: 10 }, (_, i) => new CountItem(i));
      let tree = SumTree.fromItems(chunks, countSummaryOps, 4);

      // Delete enough items to trigger underflow
      for (let i = 0; i < 7; i++) {
        tree = tree.deleteByDimension(countDimension, 0, "right");
      }

      expect(tree.length()).toBe(3);
      const invariants = tree.checkInvariants();
      expect(invariants.valid).toBe(true);
    });
  });


  describe("invariants", () => {
    it("summary invariant: parent = sum of children", () => {
      const items = Array.from({ length: 100 }, (_, i) => new CountItem(i));
      const tree = SumTree.fromItems(items, countSummaryOps, 4);

      const invariants = tree.checkInvariants();
      expect(invariants.valid).toBe(true);
    });

    it("depth invariant: all leaves at same depth", () => {
      let tree = new SumTree<CountItem, CountSummary>(countSummaryOps, 4);

      for (let i = 0; i < 50; i++) {
        tree = tree.push(new CountItem(i));
      }

      const invariants = tree.checkInvariants();
      expect(invariants.valid).toBe(true);
    });

    it("count invariant: nodes within bounds", () => {
      let tree = new SumTree<CountItem, CountSummary>(countSummaryOps, 4);

      for (let i = 0; i < 50; i++) {
        tree = tree.push(new CountItem(i));
      }

      const invariants = tree.checkInvariants();
      expect(invariants.valid).toBe(true);
    });
  });

  describe("edge cases", () => {
    it("handles single character document", () => {
      const tree = SumTree.fromItems([new TextChunk("a")], textSummaryOps);

      expect(tree.length()).toBe(1);
      expect(tree.summary().utf16Len).toBe(1);
      expect(tree.get(0)?.text).toBe("a");
    });

    it("handles empty document", () => {
      const tree = new SumTree<TextChunk, TextSummary>(textSummaryOps);

      expect(tree.isEmpty()).toBe(true);
      expect(tree.summary().utf16Len).toBe(0);
    });

    it("handles large documents", () => {
      const chunks = Array.from({ length: 10000 }, (_, i) => new CountItem(i));
      const tree = SumTree.fromItems(chunks, countSummaryOps);

      expect(tree.length()).toBe(10000);
      expect(tree.get(5000)?.value).toBe(5000);
      expect(tree.summary().count).toBe(10000);

      const invariants = tree.checkInvariants();
      expect(invariants.valid).toBe(true);
    });

    it("handles alternating insert and delete", () => {
      let tree = new SumTree<CountItem, CountSummary>(countSummaryOps, 4);

      for (let i = 0; i < 100; i++) {
        tree = tree.push(new CountItem(i));
        if (i % 3 === 0 && tree.length() > 1) {
          tree = tree.removeAt(0);
        }
      }

      const invariants = tree.checkInvariants();
      expect(invariants.valid).toBe(true);
    });
  });

  describe("branching factor comparison", () => {
    const sizes = [100, 1000];
    const factors = [4, 8, 16];

    for (const size of sizes) {
      for (const factor of factors) {
        it(`handles ${size} items with B=${factor}`, () => {
          const items = Array.from({ length: size }, (_, i) => new CountItem(i));
          const tree = SumTree.fromItems(items, countSummaryOps, factor);

          expect(tree.length()).toBe(size);

          const invariants = tree.checkInvariants();
          expect(invariants.valid).toBe(true);

          // Test random access
          const mid = Math.floor(size / 2);
          expect(tree.get(mid)?.value).toBe(mid);
        });
      }
    }
  });
});
