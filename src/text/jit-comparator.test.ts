import { describe, expect, test } from "bun:test";
import {
  compareFragmentsGeneric,
  compareLocatorsGeneric,
  createFragmentComparator,
  createLocatorComparator,
  jitCompareFragments,
  jitCompareLocators,
  jitCompareLocatorsDeep,
} from "./jit-comparator.js";
import { compareLocators } from "./locator.js";
import { replicaId } from "./types.js";
import type { Fragment, FragmentSummary, Locator, OperationId } from "./types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function loc(...levels: number[]): Locator {
  return { levels };
}

function opId(replica: number, counter: number): OperationId {
  return { replicaId: replicaId(replica), counter };
}

function frag(locator: Locator, insertionId: OperationId, insertionOffset = 0): Fragment {
  return {
    locator,
    baseLocator: locator,
    insertionId,
    insertionOffset,
    length: 1,
    visible: true,
    deletions: [],
    text: "x",
    summary(): FragmentSummary {
      return {
        visibleLen: 1,
        visibleLines: 0,
        deletedLen: 0,
        deletedLines: 0,
        maxInsertionId: insertionId,
        maxLocator: locator,
        itemCount: 1,
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Locator comparator tests
// ---------------------------------------------------------------------------

describe("JIT locator comparator", () => {
  const comparators: Array<[string, (a: Locator, b: Locator) => number]> = [
    ["generic", compareLocatorsGeneric],
    ["jit-d8", jitCompareLocators],
    ["jit-d16", jitCompareLocatorsDeep],
    ["jit-d4 (custom)", createLocatorComparator(4)],
  ];

  for (const [name, cmp] of comparators) {
    describe(name, () => {
      test("equal locators", () => {
        expect(cmp(loc(1, 2, 3), loc(1, 2, 3))).toBe(0);
      });

      test("single level less", () => {
        expect(cmp(loc(1), loc(2))).toBeLessThan(0);
      });

      test("single level greater", () => {
        expect(cmp(loc(5), loc(3))).toBeGreaterThan(0);
      });

      test("multi-level comparison", () => {
        expect(cmp(loc(1, 2, 3), loc(1, 2, 4))).toBeLessThan(0);
        expect(cmp(loc(1, 3, 0), loc(1, 2, 9))).toBeGreaterThan(0);
      });

      test("shorter locator sorts before longer with same prefix", () => {
        expect(cmp(loc(1, 2), loc(1, 2, 3))).toBeLessThan(0);
      });

      test("longer locator sorts after shorter with same prefix", () => {
        expect(cmp(loc(1, 2, 3), loc(1, 2))).toBeGreaterThan(0);
      });

      test("empty levels", () => {
        expect(cmp(loc(), loc())).toBe(0);
        expect(cmp(loc(), loc(1))).toBeLessThan(0);
        expect(cmp(loc(1), loc())).toBeGreaterThan(0);
      });

      test("matches reference compareLocators", () => {
        const pairs: Array<[Locator, Locator]> = [
          [loc(0), loc(Number.MAX_SAFE_INTEGER)],
          [loc(1, 2, 3, 4, 5, 6, 7, 8), loc(1, 2, 3, 4, 5, 6, 7, 9)],
          [loc(10), loc(10, 0)],
          [loc(5, 5), loc(5, 5)],
          [loc(1, 0, 0, 0, 0), loc(1, 0, 0, 0, 1)],
        ];
        for (const [a, b] of pairs) {
          expect(Math.sign(cmp(a, b))).toBe(Math.sign(compareLocators(a, b)));
          expect(Math.sign(cmp(b, a))).toBe(Math.sign(compareLocators(b, a)));
        }
      });
    });
  }
});

// ---------------------------------------------------------------------------
// Fragment comparator tests
// ---------------------------------------------------------------------------

describe("JIT fragment comparator", () => {
  const comparators: Array<[string, (a: Fragment, b: Fragment) => number]> = [
    ["generic", compareFragmentsGeneric],
    ["jit-d8", jitCompareFragments],
    ["jit-d8 (custom)", createFragmentComparator(8)],
  ];

  for (const [name, cmp] of comparators) {
    describe(name, () => {
      test("different locators", () => {
        const a = frag(loc(1), opId(1, 1));
        const b = frag(loc(2), opId(1, 1));
        expect(cmp(a, b)).toBeLessThan(0);
        expect(cmp(b, a)).toBeGreaterThan(0);
      });

      test("same locator, different operation ID (replicaId)", () => {
        const a = frag(loc(5, 3), opId(1, 1));
        const b = frag(loc(5, 3), opId(2, 1));
        expect(cmp(a, b)).toBeLessThan(0);
      });

      test("same locator, different operation ID (counter)", () => {
        const a = frag(loc(5, 3), opId(1, 1));
        const b = frag(loc(5, 3), opId(1, 2));
        expect(cmp(a, b)).toBeLessThan(0);
      });

      test("same locator and opId, different offset", () => {
        const a = frag(loc(5, 3), opId(1, 1), 0);
        const b = frag(loc(5, 3), opId(1, 1), 5);
        expect(cmp(a, b)).toBeLessThan(0);
      });

      test("equal fragments", () => {
        const a = frag(loc(5, 3), opId(1, 1), 0);
        const b = frag(loc(5, 3), opId(1, 1), 0);
        expect(cmp(a, b)).toBe(0);
      });

      test("sort produces same order as generic", () => {
        const frags = [
          frag(loc(3, 1), opId(2, 5), 0),
          frag(loc(1, 2), opId(1, 1), 0),
          frag(loc(3, 1), opId(1, 3), 0),
          frag(loc(1, 2), opId(1, 1), 3),
          frag(loc(2), opId(3, 1), 0),
        ];

        const sortedGeneric = [...frags].sort(compareFragmentsGeneric);
        const sortedJIT = [...frags].sort(cmp);

        for (let i = 0; i < frags.length; i++) {
          expect(sortedJIT[i]).toBe(sortedGeneric[i]);
        }
      });
    });
  }
});
