import { describe, expect, test } from "bun:test";
import { FragmentStore, fragmentHandle } from "./fragment-store.js";
import type { Locator } from "./types.js";
import { replicaId } from "./types.js";

const rid1 = replicaId(1);
const rid2 = replicaId(2);

function loc(...levels: number[]): Locator {
  return { levels };
}

describe("FragmentStore", () => {
  test("push and read back a single fragment", () => {
    const store = new FragmentStore(4);
    const h = store.push(rid1, 0, 0, loc(100), loc(100), "hello", true);

    expect(store.count).toBe(1);
    expect(store.replicaId(h)).toBe(rid1);
    expect(store.counter(h)).toBe(0);
    expect(store.insertionOffset(h)).toBe(0);
    expect(store.length(h)).toBe(5);
    expect(store.isVisible(h)).toBe(true);
    expect(store.text(h)).toBe("hello");
    expect(store.locator(h)).toEqual(loc(100));
    expect(store.baseLocator(h)).toEqual(loc(100));
    expect(store.deletions(h)).toEqual([]);
  });

  test("push multiple fragments", () => {
    const store = new FragmentStore(4);
    const h0 = store.push(rid1, 0, 0, loc(100), loc(100), "aaa", true);
    const h1 = store.push(rid1, 1, 0, loc(200), loc(200), "bbb", true);
    const h2 = store.push(rid2, 0, 0, loc(150), loc(150), "ccc", false);

    expect(store.count).toBe(3);
    expect(store.text(h0)).toBe("aaa");
    expect(store.text(h1)).toBe("bbb");
    expect(store.text(h2)).toBe("ccc");
    expect(store.isVisible(h2)).toBe(false);
  });

  test("auto-grows when capacity exceeded", () => {
    const store = new FragmentStore(2);
    expect(store.capacity).toBe(2);

    store.push(rid1, 0, 0, loc(1), loc(1), "a", true);
    store.push(rid1, 1, 0, loc(2), loc(2), "b", true);
    store.push(rid1, 2, 0, loc(3), loc(3), "c", true); // triggers grow

    expect(store.count).toBe(3);
    expect(store.capacity).toBe(4);
    expect(store.text(fragmentHandle(0))).toBe("a");
    expect(store.text(fragmentHandle(1))).toBe("b");
    expect(store.text(fragmentHandle(2))).toBe("c");
  });

  test("setVisible toggles visibility without allocation", () => {
    const store = new FragmentStore();
    const h = store.push(rid1, 0, 0, loc(100), loc(100), "line\nbreak", true);

    expect(store.isVisible(h)).toBe(true);
    const summary1 = store.summary(h);
    expect(summary1.visibleLen).toBe(10);
    expect(summary1.visibleLines).toBe(1);
    expect(summary1.deletedLen).toBe(0);

    store.setVisible(h, false);
    expect(store.isVisible(h)).toBe(false);
    const summary2 = store.summary(h);
    expect(summary2.visibleLen).toBe(0);
    expect(summary2.deletedLen).toBe(10);
    expect(summary2.deletedLines).toBe(1);

    store.setVisible(h, true);
    expect(store.isVisible(h)).toBe(true);
    const summary3 = store.summary(h);
    expect(summary3.visibleLen).toBe(10);
    expect(summary3.visibleLines).toBe(1);
  });

  test("setVisible is idempotent", () => {
    const store = new FragmentStore();
    const h = store.push(rid1, 0, 0, loc(1), loc(1), "x", true);
    store.setVisible(h, true); // no-op
    expect(store.isVisible(h)).toBe(true);
  });

  test("addDeletion marks fragment as deleted", () => {
    const store = new FragmentStore();
    const h = store.push(rid1, 0, 0, loc(1), loc(1), "abc", true);
    const delId = { replicaId: rid2, counter: 5 };
    store.addDeletion(h, delId);

    expect(store.isVisible(h)).toBe(false);
    expect(store.deletions(h)).toEqual([delId]);
  });

  test("sumVisibleLength sums only visible fragments", () => {
    const store = new FragmentStore();
    store.push(rid1, 0, 0, loc(1), loc(1), "hello", true); // 5
    store.push(rid1, 1, 0, loc(2), loc(2), "world!", true); // 6
    store.push(rid1, 2, 0, loc(3), loc(3), "hidden", false); // 0 (invisible)

    expect(store.sumVisibleLength()).toBe(11);
  });

  test("sumVisibleLines counts newlines in visible fragments", () => {
    const store = new FragmentStore();
    store.push(rid1, 0, 0, loc(1), loc(1), "a\nb\n", true); // 2 lines
    store.push(rid1, 1, 0, loc(2), loc(2), "c\n", false); // invisible
    store.push(rid1, 2, 0, loc(3), loc(3), "d\n", true); // 1 line

    expect(store.sumVisibleLines()).toBe(3);
  });

  test("getVisibleText concatenates visible texts", () => {
    const store = new FragmentStore();
    store.push(rid1, 0, 0, loc(1), loc(1), "hello ", true);
    store.push(rid1, 1, 0, loc(2), loc(2), "HIDDEN", false);
    store.push(rid1, 2, 0, loc(3), loc(3), "world", true);

    expect(store.getVisibleText()).toBe("hello world");
  });

  test("findAtVisibleOffset finds correct fragment", () => {
    const store = new FragmentStore();
    store.push(rid1, 0, 0, loc(1), loc(1), "abc", true); // offset 0-2
    store.push(rid1, 1, 0, loc(2), loc(2), "HIDDEN", false);
    store.push(rid1, 2, 0, loc(3), loc(3), "de", true); // offset 3-4

    const result0 = store.findAtVisibleOffset(0);
    expect(result0).toBeDefined();
    expect(result0?.handle).toBe(fragmentHandle(0));
    expect(result0?.localOffset).toBe(0);

    const result2 = store.findAtVisibleOffset(2);
    expect(result2).toBeDefined();
    expect(result2?.handle).toBe(fragmentHandle(0));
    expect(result2?.localOffset).toBe(2);

    const result3 = store.findAtVisibleOffset(3);
    expect(result3).toBeDefined();
    expect(result3?.handle).toBe(fragmentHandle(2));
    expect(result3?.localOffset).toBe(0);

    const result5 = store.findAtVisibleOffset(5);
    expect(result5).toBeUndefined();
  });

  test("summary produces correct FragmentSummary for visible fragment", () => {
    const store = new FragmentStore();
    const h = store.push(rid1, 42, 0, loc(500), loc(500), "hello\nworld", true);
    const s = store.summary(h);

    expect(s.visibleLen).toBe(11);
    expect(s.visibleLines).toBe(1);
    expect(s.deletedLen).toBe(0);
    expect(s.deletedLines).toBe(0);
    expect(s.maxInsertionId).toEqual({ replicaId: rid1, counter: 42 });
    expect(s.maxLocator).toEqual(loc(500));
    expect(s.itemCount).toBe(1);
  });

  test("summary produces correct FragmentSummary for deleted fragment", () => {
    const store = new FragmentStore();
    const h = store.push(rid1, 0, 0, loc(1), loc(1), "a\nb\nc", false);
    const s = store.summary(h);

    expect(s.visibleLen).toBe(0);
    expect(s.visibleLines).toBe(0);
    expect(s.deletedLen).toBe(5);
    expect(s.deletedLines).toBe(2);
    expect(s.itemCount).toBe(1);
  });

  test("asSummarizable creates SumTree-compatible wrapper", () => {
    const store = new FragmentStore();
    const h = store.push(rid1, 0, 0, loc(1), loc(1), "test", true);
    const wrapped = store.asSummarizable(h);

    expect(wrapped.handle).toBe(h);
    const s = wrapped.summary();
    expect(s.visibleLen).toBe(4);
    expect(s.itemCount).toBe(1);
  });

  test("compareByLocator sorts correctly", () => {
    const store = new FragmentStore();
    const h0 = store.push(rid1, 0, 0, loc(200), loc(200), "b", true);
    const h1 = store.push(rid1, 1, 0, loc(100), loc(100), "a", true);
    const h2 = store.push(rid2, 0, 0, loc(100), loc(100), "c", true); // same loc, diff replica

    expect(store.compareByLocator(h1, h0)).toBeLessThan(0); // loc(100) < loc(200)
    expect(store.compareByLocator(h0, h1)).toBeGreaterThan(0);

    // Same locator, tie-break by replicaId
    expect(store.compareByLocator(h1, h2)).toBeLessThan(0); // rid1 < rid2
  });

  test("split creates two child fragments", () => {
    const store = new FragmentStore();
    const h = store.push(rid1, 0, 0, loc(100), loc(100), "abcdef", true);

    const [left, right] = store.split(h, 3);

    expect(store.text(left)).toBe("abc");
    expect(store.text(right)).toBe("def");
    expect(store.length(left)).toBe(3);
    expect(store.length(right)).toBe(3);
    expect(store.isVisible(left)).toBe(true);
    expect(store.isVisible(right)).toBe(true);
    expect(store.replicaId(left)).toBe(rid1);
    expect(store.replicaId(right)).toBe(rid1);
    expect(store.insertionOffset(left)).toBe(0);
    expect(store.insertionOffset(right)).toBe(3);

    // Locators should be children of base locator
    expect(store.locator(left)).toEqual(loc(100, 0)); // [...base, 2*0]
    expect(store.locator(right)).toEqual(loc(100, 6)); // [...base, 2*3]
    expect(store.baseLocator(left)).toEqual(loc(100));
    expect(store.baseLocator(right)).toEqual(loc(100));
  });

  test("insertAt inserts at beginning", () => {
    const store = new FragmentStore();
    store.push(rid1, 0, 0, loc(200), loc(200), "second", true);
    store.insertAt(0, rid1, 1, 0, loc(100), loc(100), "first", true);

    expect(store.count).toBe(2);
    expect(store.text(fragmentHandle(0))).toBe("first");
    expect(store.text(fragmentHandle(1))).toBe("second");
    expect(store.locator(fragmentHandle(0))).toEqual(loc(100));
    expect(store.locator(fragmentHandle(1))).toEqual(loc(200));
  });

  test("insertAt inserts in middle", () => {
    const store = new FragmentStore();
    store.push(rid1, 0, 0, loc(100), loc(100), "first", true);
    store.push(rid1, 2, 0, loc(300), loc(300), "third", true);
    store.insertAt(1, rid1, 1, 0, loc(200), loc(200), "second", true);

    expect(store.count).toBe(3);
    expect(store.text(fragmentHandle(0))).toBe("first");
    expect(store.text(fragmentHandle(1))).toBe("second");
    expect(store.text(fragmentHandle(2))).toBe("third");
  });

  test("insertAt at end is equivalent to push", () => {
    const store = new FragmentStore();
    store.push(rid1, 0, 0, loc(100), loc(100), "first", true);
    store.insertAt(1, rid1, 1, 0, loc(200), loc(200), "second", true);

    expect(store.count).toBe(2);
    expect(store.text(fragmentHandle(1))).toBe("second");
  });

  test("insertAt rejects out-of-bounds index", () => {
    const store = new FragmentStore();
    expect(() => {
      store.insertAt(-1, rid1, 0, 0, loc(1), loc(1), "x", true);
    }).toThrow(RangeError);
    expect(() => {
      store.insertAt(1, rid1, 0, 0, loc(1), loc(1), "x", true);
    }).toThrow(RangeError);
  });

  test("memoryUsageBytes returns reasonable estimate", () => {
    const store = new FragmentStore(16);
    for (let i = 0; i < 10; i++) {
      store.push(rid1, i, 0, loc(i * 100), loc(i * 100), `text${i}`, true);
    }
    const usage = store.memoryUsageBytes();
    // TypedArrays: 7 arrays * 16 capacity * (4 or 1) bytes each
    // Plus text and locator bytes
    expect(usage).toBeGreaterThan(0);
    expect(usage).toBeLessThan(10000); // should be well under 10KB for 10 fragments
  });

  test("empty store", () => {
    const store = new FragmentStore();
    expect(store.count).toBe(0);
    expect(store.sumVisibleLength()).toBe(0);
    expect(store.sumVisibleLines()).toBe(0);
    expect(store.getVisibleText()).toBe("");
    expect(store.findAtVisibleOffset(0)).toBeUndefined();
  });

  test("handles fragments with empty text", () => {
    const store = new FragmentStore();
    const h = store.push(rid1, 0, 0, loc(1), loc(1), "", true);
    expect(store.length(h)).toBe(0);
    expect(store.text(h)).toBe("");
    expect(store.sumVisibleLength()).toBe(0);
  });

  test("stress: 10000 fragments", () => {
    const store = new FragmentStore(64);
    for (let i = 0; i < 10000; i++) {
      store.push(rid1, i, 0, loc(i), loc(i), `fragment${i}`, i % 3 !== 0);
    }
    expect(store.count).toBe(10000);

    // Verify some random access
    expect(store.text(fragmentHandle(0))).toBe("fragment0");
    expect(store.text(fragmentHandle(9999))).toBe("fragment9999");
    expect(store.isVisible(fragmentHandle(0))).toBe(false); // 0 % 3 === 0
    expect(store.isVisible(fragmentHandle(1))).toBe(true);

    // Verify visible text length
    const visLen = store.sumVisibleLength();
    expect(visLen).toBeGreaterThan(0);
  });
});
