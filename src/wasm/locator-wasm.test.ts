import { describe, test, expect, beforeAll } from "bun:test";
import { LocatorWasm } from "./locator-wasm.js";
import { compileLocatorOps } from "./compile.js";
import { compareLocators } from "../text/locator.js";
import type { Locator } from "../text/types.js";

let wasm: LocatorWasm;

beforeAll(async () => {
  const binary = await compileLocatorOps();
  wasm = await LocatorWasm.fromBinary(binary.buffer);
});

// Helper to create locators
function loc(...levels: number[]): Locator {
  return { levels };
}

describe("compare_locators_at (single comparison)", () => {
  test("equal locators", () => {
    expect(wasm.compareSingle(loc(5), loc(5))).toBe(0);
    expect(wasm.compareSingle(loc(1, 2, 3), loc(1, 2, 3))).toBe(0);
  });

  test("first level differs", () => {
    expect(wasm.compareSingle(loc(1), loc(2))).toBe(-1);
    expect(wasm.compareSingle(loc(5), loc(3))).toBe(1);
  });

  test("deeper levels differ", () => {
    expect(wasm.compareSingle(loc(1, 2), loc(1, 3))).toBe(-1);
    expect(wasm.compareSingle(loc(1, 5), loc(1, 3))).toBe(1);
    expect(wasm.compareSingle(loc(1, 2, 3), loc(1, 2, 4))).toBe(-1);
  });

  test("different lengths, prefix equal", () => {
    expect(wasm.compareSingle(loc(1), loc(1, 2))).toBe(-1);
    expect(wasm.compareSingle(loc(1, 2), loc(1))).toBe(1);
    expect(wasm.compareSingle(loc(1, 2, 3), loc(1, 2))).toBe(1);
  });

  test("empty locators", () => {
    const empty = loc();
    expect(wasm.compareSingle(empty, empty)).toBe(0);
    expect(wasm.compareSingle(empty, loc(1))).toBe(-1);
    expect(wasm.compareSingle(loc(1), empty)).toBe(1);
  });

  test("large values (53-bit integers)", () => {
    const a = loc(Number.MAX_SAFE_INTEGER - 1);
    const b = loc(Number.MAX_SAFE_INTEGER);
    expect(wasm.compareSingle(a, b)).toBe(-1);
    expect(wasm.compareSingle(b, a)).toBe(1);
    expect(wasm.compareSingle(a, a)).toBe(0);
  });

  test("matches TypeScript compareLocators", () => {
    const locators: Locator[] = [
      loc(0),
      loc(1),
      loc(1, 0),
      loc(1, 1),
      loc(1, 1, 5),
      loc(2),
      loc(100),
      loc(100, 50, 25),
    ];

    for (let i = 0; i < locators.length; i++) {
      for (let j = 0; j < locators.length; j++) {
        const a = locators[i];
        const b = locators[j];
        if (a === undefined || b === undefined) continue;
        const tsResult = Math.sign(compareLocators(a, b));
        const wasmResult = wasm.compareSingle(a, b);
        expect(wasmResult).toBe(tsResult);
      }
    }
  });
});

describe("batch_compare", () => {
  test("batch of comparisons matches individual results", () => {
    const pairs: [Locator, Locator][] = [
      [loc(1), loc(2)],
      [loc(5), loc(5)],
      [loc(3, 1), loc(3, 2)],
      [loc(1, 2, 3), loc(1, 2)],
      [loc(0), loc(0)],
    ];

    const results = wasm.batchCompare(pairs);
    expect(results[0]).toBe(-1);
    expect(results[1]).toBe(0);
    expect(results[2]).toBe(-1);
    expect(results[3]).toBe(1);
    expect(results[4]).toBe(0);
  });

  test("empty batch", () => {
    const results = wasm.batchCompare([]);
    expect(results.length).toBe(0);
  });

  test("large batch matches TypeScript", () => {
    const pairs: [Locator, Locator][] = [];
    for (let i = 0; i < 1000; i++) {
      const depth = 1 + (i % 4);
      const a: number[] = [];
      const b: number[] = [];
      for (let d = 0; d < depth; d++) {
        a.push((i * 7 + d * 13) % 1000);
        b.push((i * 11 + d * 17) % 1000);
      }
      pairs.push([loc(...a), loc(...b)]);
    }

    const results = wasm.batchCompare(pairs);
    for (let i = 0; i < pairs.length; i++) {
      const pair = pairs[i];
      if (pair === undefined) continue;
      const [a, b] = pair;
      const expected = Math.sign(compareLocators(a, b));
      expect(results[i]).toBe(expected);
    }
  });
});

describe("binary search", () => {
  test("search in sorted array", () => {
    const haystack = [loc(1), loc(3), loc(5), loc(7), loc(9)];
    wasm.loadHaystack(haystack);

    // Exact matches
    expect(wasm.singleSearch(haystack.length, loc(1))).toBe(0);
    expect(wasm.singleSearch(haystack.length, loc(3))).toBe(1);
    expect(wasm.singleSearch(haystack.length, loc(9))).toBe(4);

    // Between values (insertion points)
    expect(wasm.singleSearch(haystack.length, loc(0))).toBe(0);
    expect(wasm.singleSearch(haystack.length, loc(2))).toBe(1);
    expect(wasm.singleSearch(haystack.length, loc(4))).toBe(2);
    expect(wasm.singleSearch(haystack.length, loc(10))).toBe(5);
  });

  test("search in empty array", () => {
    wasm.loadHaystack([]);
    expect(wasm.singleSearch(0, loc(5))).toBe(0);
  });

  test("search with multi-level locators", () => {
    const haystack = [
      loc(1, 0),
      loc(1, 5),
      loc(2, 0),
      loc(2, 3),
      loc(3, 0),
    ];
    wasm.loadHaystack(haystack);

    expect(wasm.singleSearch(haystack.length, loc(1, 0))).toBe(0);
    expect(wasm.singleSearch(haystack.length, loc(1, 3))).toBe(1);
    expect(wasm.singleSearch(haystack.length, loc(2, 1))).toBe(3);
    expect(wasm.singleSearch(haystack.length, loc(4))).toBe(5);
  });

  test("batch search", () => {
    const haystack = [
      loc(10),
      loc(20),
      loc(30),
      loc(40),
      loc(50),
    ];
    wasm.loadHaystack(haystack);

    const keys = [loc(5), loc(15), loc(25), loc(35), loc(50), loc(55)];
    const results = wasm.batchSearch(haystack.length, keys);

    expect(results[0]).toBe(0); // 5 < 10
    expect(results[1]).toBe(1); // 15 between 10 and 20
    expect(results[2]).toBe(2); // 25 between 20 and 30
    expect(results[3]).toBe(3); // 35 between 30 and 40
    expect(results[4]).toBe(4); // 50 == 50 (leftmost insertion point)
    expect(results[5]).toBe(5); // 55 > 50
  });

  test("matches TypeScript binary search for random data", () => {
    // Generate sorted locators
    const haystack: Locator[] = [];
    for (let i = 0; i < 200; i++) {
      haystack.push(loc(i * 5, (i * 3) % 100));
    }
    // Already sorted by construction since first level increases

    wasm.loadHaystack(haystack);

    // Generate random keys and verify
    for (let k = 0; k < 100; k++) {
      const key = loc(k * 10 + 2, (k * 7) % 100);

      // TypeScript binary search
      let lo = 0;
      let hi = haystack.length;
      while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        const midLoc = haystack[mid];
        if (midLoc !== undefined && compareLocators(key, midLoc) <= 0) {
          hi = mid;
        } else {
          lo = mid + 1;
        }
      }

      const wasmResult = wasm.singleSearch(haystack.length, key);
      expect(wasmResult).toBe(lo);
    }
  });
});
