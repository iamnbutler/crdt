import { describe, expect, test } from "bun:test";
import {
  type CountSummary,
  type Summarizable,
  countDimension,
  countSummaryOps,
} from "../sum-tree/index.js";
import { SkipList } from "./index.js";

// Simple item for testing
class CountItem implements Summarizable<CountSummary> {
  constructor(readonly value: number) {}

  summary(): CountSummary {
    return { count: 1 };
  }
}

function compareCountItems(a: CountItem, b: CountItem): number {
  return a.value - b.value;
}

describe("SkipList", () => {
  describe("basic operations", () => {
    test("starts empty", () => {
      const list = new SkipList<CountItem, CountSummary>(countSummaryOps);
      expect(list.length).toBe(0);
      expect(list.isEmpty()).toBe(true);
    });

    test("insert single item", () => {
      const list = new SkipList<CountItem, CountSummary>(countSummaryOps);
      list.insertOrdered(new CountItem(42), compareCountItems);
      expect(list.length).toBe(1);
      expect(list.isEmpty()).toBe(false);
    });

    test("insert multiple items in order", () => {
      const list = new SkipList<CountItem, CountSummary>(countSummaryOps);
      for (let i = 0; i < 10; i++) {
        list.insertOrdered(new CountItem(i), compareCountItems);
      }
      expect(list.length).toBe(10);

      const items = list.toArray();
      for (let i = 0; i < 10; i++) {
        expect(items[i]?.value).toBe(i);
      }
    });

    test("insert items in reverse order", () => {
      const list = new SkipList<CountItem, CountSummary>(countSummaryOps);
      for (let i = 9; i >= 0; i--) {
        list.insertOrdered(new CountItem(i), compareCountItems);
      }
      expect(list.length).toBe(10);

      const items = list.toArray();
      for (let i = 0; i < 10; i++) {
        expect(items[i]?.value).toBe(i);
      }
    });

    test("insert items in random order", () => {
      const list = new SkipList<CountItem, CountSummary>(countSummaryOps);
      const values = [5, 3, 8, 1, 9, 2, 7, 4, 6, 0];
      for (const v of values) {
        list.insertOrdered(new CountItem(v), compareCountItems);
      }
      expect(list.length).toBe(10);

      const items = list.toArray();
      for (let i = 0; i < 10; i++) {
        expect(items[i]?.value).toBe(i);
      }
    });
  });

  describe("removal", () => {
    test("remove from middle", () => {
      const list = new SkipList<CountItem, CountSummary>(countSummaryOps);
      for (let i = 0; i < 5; i++) {
        list.insertOrdered(new CountItem(i), compareCountItems);
      }

      const removed = list.remove((item) => 2 - item.value);
      expect(removed?.value).toBe(2);
      expect(list.length).toBe(4);

      const items = list.toArray();
      expect(items.map((i) => i.value)).toEqual([0, 1, 3, 4]);
    });

    test("remove first item", () => {
      const list = new SkipList<CountItem, CountSummary>(countSummaryOps);
      for (let i = 0; i < 5; i++) {
        list.insertOrdered(new CountItem(i), compareCountItems);
      }

      const removed = list.remove((item) => 0 - item.value);
      expect(removed?.value).toBe(0);
      expect(list.length).toBe(4);

      const items = list.toArray();
      expect(items.map((i) => i.value)).toEqual([1, 2, 3, 4]);
    });

    test("remove last item", () => {
      const list = new SkipList<CountItem, CountSummary>(countSummaryOps);
      for (let i = 0; i < 5; i++) {
        list.insertOrdered(new CountItem(i), compareCountItems);
      }

      const removed = list.remove((item) => 4 - item.value);
      expect(removed?.value).toBe(4);
      expect(list.length).toBe(4);

      const items = list.toArray();
      expect(items.map((i) => i.value)).toEqual([0, 1, 2, 3]);
    });

    test("remove nonexistent item returns undefined", () => {
      const list = new SkipList<CountItem, CountSummary>(countSummaryOps);
      for (let i = 0; i < 5; i++) {
        list.insertOrdered(new CountItem(i), compareCountItems);
      }

      const removed = list.remove((item) => 99 - item.value);
      expect(removed).toBeUndefined();
      expect(list.length).toBe(5);
    });
  });

  describe("summary", () => {
    test("empty list has identity summary", () => {
      const list = new SkipList<CountItem, CountSummary>(countSummaryOps);
      expect(list.summary()).toEqual({ count: 0 });
    });

    test("summary reflects all items", () => {
      const list = new SkipList<CountItem, CountSummary>(countSummaryOps);
      for (let i = 0; i < 10; i++) {
        list.insertOrdered(new CountItem(i), compareCountItems);
      }
      expect(list.summary()).toEqual({ count: 10 });
    });

    test("summary updates after removal", () => {
      const list = new SkipList<CountItem, CountSummary>(countSummaryOps);
      for (let i = 0; i < 10; i++) {
        list.insertOrdered(new CountItem(i), compareCountItems);
      }
      list.remove((item) => 5 - item.value);
      expect(list.summary()).toEqual({ count: 9 });
    });
  });

  describe("pushBack", () => {
    test("builds sorted list from sorted input", () => {
      const list = new SkipList<CountItem, CountSummary>(countSummaryOps);
      for (let i = 0; i < 100; i++) {
        list.pushBack(new CountItem(i));
      }
      expect(list.length).toBe(100);

      const items = list.toArray();
      for (let i = 0; i < 100; i++) {
        expect(items[i]?.value).toBe(i);
      }
    });
  });

  describe("fromSortedItems", () => {
    test("builds from sorted array", () => {
      const items = Array.from({ length: 50 }, (_, i) => new CountItem(i));
      const list = SkipList.fromSortedItems(items, countSummaryOps);
      expect(list.length).toBe(50);

      const result = list.toArray();
      for (let i = 0; i < 50; i++) {
        expect(result[i]?.value).toBe(i);
      }
    });
  });

  describe("cursor", () => {
    test("iterates all items", () => {
      const list = new SkipList<CountItem, CountSummary>(countSummaryOps);
      for (let i = 0; i < 10; i++) {
        list.insertOrdered(new CountItem(i), compareCountItems);
      }

      const cursor = list.cursor(countDimension);
      cursor.reset();
      const items: number[] = [];
      while (!cursor.atEnd) {
        const item = cursor.item();
        if (item !== undefined) {
          items.push(item.value);
        }
        cursor.next();
      }
      expect(items).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    });

    test("seekForward finds target", () => {
      const list = new SkipList<CountItem, CountSummary>(countSummaryOps);
      for (let i = 0; i < 100; i++) {
        list.pushBack(new CountItem(i));
      }

      const cursor = list.cursor(countDimension);
      cursor.reset();
      const found = cursor.seekForward(50);
      expect(found).toBe(true);
      const item = cursor.item();
      expect(item).toBeDefined();
      // The item should be at or near position 50
      expect(item?.value).toBeGreaterThanOrEqual(49);
      expect(item?.value).toBeLessThanOrEqual(51);
    });

    test("suffix returns remaining items", () => {
      const list = new SkipList<CountItem, CountSummary>(countSummaryOps);
      for (let i = 0; i < 10; i++) {
        list.pushBack(new CountItem(i));
      }

      const cursor = list.cursor(countDimension);
      cursor.reset();
      // Advance a few items
      cursor.next();
      cursor.next();
      cursor.next();
      const suffix = cursor.suffix();
      expect(suffix.length).toBeGreaterThanOrEqual(7);
    });
  });

  describe("finger search", () => {
    test("sequential insert with finger is correct", () => {
      const list = new SkipList<CountItem, CountSummary>(countSummaryOps);
      // Simulate sequential typing: insert 0, 1, 2, 3, ...
      for (let i = 0; i < 100; i++) {
        list.insertNearFinger(new CountItem(i), compareCountItems);
      }
      expect(list.length).toBe(100);

      const items = list.toArray();
      for (let i = 0; i < 100; i++) {
        expect(items[i]?.value).toBe(i);
      }
    });

    test("finger insert with interleaved positions", () => {
      const list = new SkipList<CountItem, CountSummary>(countSummaryOps);
      // Insert even numbers first
      for (let i = 0; i < 20; i += 2) {
        list.insertNearFinger(new CountItem(i), compareCountItems);
      }
      // Then odd numbers (each near the previous even)
      for (let i = 1; i < 20; i += 2) {
        list.insertNearFinger(new CountItem(i), compareCountItems);
      }
      expect(list.length).toBe(20);

      const items = list.toArray();
      for (let i = 0; i < 20; i++) {
        expect(items[i]?.value).toBe(i);
      }
    });
  });

  describe("invariants", () => {
    test("maintains invariants after random operations", () => {
      const list = new SkipList<CountItem, CountSummary>(countSummaryOps);

      // Insert 100 random items
      const values: number[] = [];
      for (let i = 0; i < 100; i++) {
        const v = Math.floor(Math.random() * 1000);
        values.push(v);
        list.insertOrdered(new CountItem(v), compareCountItems);
      }

      const violations = list.checkInvariants();
      expect(violations).toEqual([]);

      // Remove 50 items
      values.sort((a, b) => a - b);
      for (let i = 0; i < 50; i++) {
        const v = values[i];
        if (v !== undefined) {
          list.remove((item) => v - item.value);
        }
      }

      const violations2 = list.checkInvariants();
      expect(violations2).toEqual([]);
    });
  });

  describe("capacity growth", () => {
    test("handles more items than initial capacity", () => {
      const list = new SkipList<CountItem, CountSummary>(countSummaryOps);
      // Default capacity is 1024, insert 2000
      for (let i = 0; i < 2000; i++) {
        list.pushBack(new CountItem(i));
      }
      expect(list.length).toBe(2000);

      const items = list.toArray();
      expect(items[0]?.value).toBe(0);
      expect(items[1999]?.value).toBe(1999);
    });
  });

  describe("edge cases", () => {
    test("single item operations", () => {
      const list = new SkipList<CountItem, CountSummary>(countSummaryOps);
      list.insertOrdered(new CountItem(42), compareCountItems);
      expect(list.toArray().map((i) => i.value)).toEqual([42]);

      const removed = list.remove((item) => 42 - item.value);
      expect(removed?.value).toBe(42);
      expect(list.length).toBe(0);
      expect(list.isEmpty()).toBe(true);
    });

    test("duplicate values", () => {
      const list = new SkipList<CountItem, CountSummary>(countSummaryOps);
      for (let i = 0; i < 5; i++) {
        list.insertOrdered(new CountItem(10), compareCountItems);
      }
      expect(list.length).toBe(5);

      const items = list.toArray();
      for (const item of items) {
        expect(item.value).toBe(10);
      }
    });

    test("large sequential insert", () => {
      const list = new SkipList<CountItem, CountSummary>(countSummaryOps);
      const N = 10_000;
      for (let i = 0; i < N; i++) {
        list.pushBack(new CountItem(i));
      }
      expect(list.length).toBe(N);

      // Spot check
      const items = list.toArray();
      expect(items[0]?.value).toBe(0);
      expect(items[N - 1]?.value).toBe(N - 1);
      expect(items[Math.floor(N / 2)]?.value).toBe(Math.floor(N / 2));
    });
  });
});
