import { describe, expect, test } from "bun:test";
import { createFragment } from "./fragment.js";
import {
  createJitFragmentComparator,
  createJitLocatorComparator,
  jitCompareFragments,
  jitCompareLocators,
} from "./jit-comparator.js";
import { compareLocators } from "./locator.js";
import { replicaId } from "./types.js";
import type { Fragment, Locator, OperationId, ReplicaId } from "./types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function loc(...levels: number[]): Locator {
  return { levels };
}

function opId(rid: number, counter: number): OperationId {
  return { replicaId: replicaId(rid), counter };
}

function frag(locLevels: number[], rid: number, counter: number, offset = 0): Fragment {
  const id = opId(rid, counter);
  const locator = loc(...locLevels);
  return createFragment(id, offset, locator, "x", true);
}

// ---------------------------------------------------------------------------
// Locator comparator
// ---------------------------------------------------------------------------

describe("jitCompareLocators", () => {
  test("matches compareLocators for equal locators", () => {
    const a = loc(5, 10, 3);
    expect(jitCompareLocators(a, a)).toBe(0);
    expect(compareLocators(a, a)).toBe(0);
  });

  test("matches compareLocators for single-level", () => {
    expect(Math.sign(jitCompareLocators(loc(1), loc(2)))).toBe(
      Math.sign(compareLocators(loc(1), loc(2))),
    );
    expect(Math.sign(jitCompareLocators(loc(2), loc(1)))).toBe(
      Math.sign(compareLocators(loc(2), loc(1))),
    );
  });

  test("matches compareLocators for multi-level", () => {
    const cases: [Locator, Locator][] = [
      [loc(1, 2, 3), loc(1, 2, 4)],
      [loc(1, 3), loc(1, 2, 4)],
      [loc(1), loc(1, 0)],
      [loc(1, 0), loc(1)],
      [loc(0), loc(Number.MAX_SAFE_INTEGER)],
      [loc(5, 5, 5, 5), loc(5, 5, 5, 5)],
      [loc(5, 5, 5), loc(5, 5, 5, 0)],
    ];
    for (const [a, b] of cases) {
      expect(Math.sign(jitCompareLocators(a, b))).toBe(Math.sign(compareLocators(a, b)));
      expect(Math.sign(jitCompareLocators(b, a))).toBe(Math.sign(compareLocators(b, a)));
    }
  });

  test("prefix locator sorts before longer locator", () => {
    expect(jitCompareLocators(loc(5), loc(5, 3))).toBeLessThan(0);
    expect(jitCompareLocators(loc(5, 3), loc(5))).toBeGreaterThan(0);
  });

  test("handles empty-ish locators", () => {
    // Single-element locators
    expect(jitCompareLocators(loc(0), loc(0))).toBe(0);
    expect(jitCompareLocators(loc(0), loc(1))).toBeLessThan(0);
  });

  test("handles deep locators (up to 16 levels)", () => {
    const deep1 = loc(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16);
    const deep2 = loc(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 17);
    expect(jitCompareLocators(deep1, deep2)).toBeLessThan(0);
    expect(jitCompareLocators(deep2, deep1)).toBeGreaterThan(0);
    expect(jitCompareLocators(deep1, deep1)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Fragment comparator
// ---------------------------------------------------------------------------

describe("jitCompareFragments", () => {
  test("sorts by locator first", () => {
    const f1 = frag([1], 1, 0);
    const f2 = frag([2], 1, 0);
    expect(jitCompareFragments(f1, f2)).toBeLessThan(0);
    expect(jitCompareFragments(f2, f1)).toBeGreaterThan(0);
  });

  test("tie-breaks by replicaId when locators equal", () => {
    const f1 = frag([5], 1, 0);
    const f2 = frag([5], 2, 0);
    expect(jitCompareFragments(f1, f2)).toBeLessThan(0);
    expect(jitCompareFragments(f2, f1)).toBeGreaterThan(0);
  });

  test("tie-breaks by counter when locator and replicaId equal", () => {
    const f1 = frag([5], 1, 0);
    const f2 = frag([5], 1, 1);
    expect(jitCompareFragments(f1, f2)).toBeLessThan(0);
  });

  test("tie-breaks by insertionOffset for split parts", () => {
    const f1 = frag([5], 1, 0, 0);
    const f2 = frag([5], 1, 0, 3);
    expect(jitCompareFragments(f1, f2)).toBeLessThan(0);
  });

  test("equal fragments return 0", () => {
    const f1 = frag([5, 3], 1, 0, 2);
    expect(jitCompareFragments(f1, f1)).toBe(0);
  });

  test("sorts array of fragments correctly", () => {
    const fragments = [
      frag([3], 2, 0),
      frag([1], 1, 0),
      frag([3], 1, 0),
      frag([2], 1, 0),
      frag([1], 1, 0, 5),
      frag([1], 1, 0, 0),
    ];
    const sorted = [...fragments].sort(jitCompareFragments);
    // Expected order: loc[1] first, then within that by (rid, counter, offset)
    expect(sorted[0]?.locator.levels[0]).toBe(1);
    expect(sorted[1]?.locator.levels[0]).toBe(1);
    expect(sorted[2]?.locator.levels[0]).toBe(1);
    expect(sorted[3]?.locator.levels[0]).toBe(2);
    expect(sorted[4]?.locator.levels[0]).toBe(3);
    expect(sorted[5]?.locator.levels[0]).toBe(3);
    // The two loc[3] fragments should be ordered by replicaId
    expect(sorted[4]?.insertionId.replicaId).toBeLessThan(
      sorted[5]?.insertionId.replicaId as ReplicaId,
    );
  });
});

// ---------------------------------------------------------------------------
// Factory functions
// ---------------------------------------------------------------------------

describe("createJitLocatorComparator", () => {
  test("works with custom maxDepth", () => {
    const cmp = createJitLocatorComparator(4);
    expect(cmp(loc(1, 2, 3), loc(1, 2, 4))).toBeLessThan(0);
    expect(cmp(loc(1), loc(1))).toBe(0);
  });
});

describe("createJitFragmentComparator", () => {
  test("works with custom maxDepth", () => {
    const cmp = createJitFragmentComparator(4);
    const f1 = frag([1, 2], 1, 0);
    const f2 = frag([1, 3], 1, 0);
    expect(cmp(f1, f2)).toBeLessThan(0);
  });
});

// ---------------------------------------------------------------------------
// Consistency with original compareLocators across many random inputs
// ---------------------------------------------------------------------------

describe("JIT vs original consistency", () => {
  test("locator comparator matches original for 1000 random pairs", () => {
    for (let trial = 0; trial < 1000; trial++) {
      const aLen = 1 + Math.floor(Math.random() * 5);
      const bLen = 1 + Math.floor(Math.random() * 5);
      const a = loc(...Array.from({ length: aLen }, () => Math.floor(Math.random() * 1000)));
      const b = loc(...Array.from({ length: bLen }, () => Math.floor(Math.random() * 1000)));

      const original = Math.sign(compareLocators(a, b));
      const jit = Math.sign(jitCompareLocators(a, b));
      expect(jit).toBe(original);
    }
  });
});
