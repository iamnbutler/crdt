/**
 * Tests for locatorBetween Case A and Case B edge cases.
 *
 * The algorithm has two distinct paths when producing a locator between
 * two multi-level locators that share a common prefix:
 *
 * Case A: right extends beyond the divergence level with a non-zero next value.
 *   → Produced locator becomes a sibling of right at the next level.
 *
 * Case B: right does not extend, or its next value is 0.
 *   → Produced locator uses the largest even value < rv as parent, then extends.
 *
 * Both cases must satisfy: left < result < right (the core invariant).
 */

import { describe, expect, test } from "bun:test";
import { compareLocators } from "./locator.js";
import { locatorBetween } from "./locator.js";

/** Assert left < result < right */
function assertBetween(
  left: { levels: number[] },
  right: { levels: number[] },
  result: { levels: ReadonlyArray<number> },
): void {
  expect(compareLocators(left, result)).toBeLessThan(0);
  expect(compareLocators(result, right)).toBeLessThan(0);
}

describe("locatorBetween – Case A (right extends with non-zero next value)", () => {
  test("basic Case A: right has 3 levels, diverges at level 1", () => {
    // left  = [5, 0]
    // right = [5, 3, 4]  ← right extends at level 2 with value 4 (> 0)
    // Expected result becomes a sibling of right: [5, 3, x] where x < 4
    const left = { levels: [5, 0] };
    const right = { levels: [5, 3, 4] };
    const result = locatorBetween(left, right);
    assertBetween(left, right, result);
    // Case A produces a result that shares right's prefix [5, 3]
    expect(result.levels[0]).toBe(5);
    expect(result.levels[1]).toBe(3);
    // The third level must be < right's third level (4)
    const thirdLevel = result.levels[2];
    expect(thirdLevel).toBeDefined();
    if (thirdLevel !== undefined) {
      expect(thirdLevel).toBeLessThan(4);
    }
  });

  test("Case A: rightNextVal is 1 (minimum non-zero)", () => {
    // right extends with value 1, so result gets right's level 1 prefix
    // and level 2 = 0 (rightNextVal - 1)
    const left = { levels: [5, 0] };
    const right = { levels: [5, 2, 1] };
    const result = locatorBetween(left, right);
    assertBetween(left, right, result);
    expect(result.levels[0]).toBe(5);
  });

  test("Case A: deeper nesting, diverges at level 2", () => {
    const left = { levels: [10, 0, 0] };
    const right = { levels: [10, 0, 4, 7] };
    const result = locatorBetween(left, right);
    assertBetween(left, right, result);
    expect(result.levels[0]).toBe(10);
    expect(result.levels[1]).toBe(0);
  });

  test("Case A: large next-level value", () => {
    const left = { levels: [1, 0] };
    const right = { levels: [1, 100, 9000] };
    const result = locatorBetween(left, right);
    assertBetween(left, right, result);
  });
});

describe("locatorBetween – Case B (right does not extend)", () => {
  test("basic Case B: odd rv, right has same depth as left", () => {
    // right = [5, 3] → rv=3 is odd → evenBeforeRv = 2
    const left = { levels: [5, 0] };
    const right = { levels: [5, 3] };
    const result = locatorBetween(left, right);
    assertBetween(left, right, result);
    // Result should have [5, 2, ...] (even value below 3)
    expect(result.levels[0]).toBe(5);
    expect(result.levels[1]).toBe(2);
  });

  test("Case B: even rv uses rv-2 as parent", () => {
    // right = [5, 4] → rv=4 is even → evenBeforeRv = 2
    const left = { levels: [5, 0] };
    const right = { levels: [5, 4] };
    const result = locatorBetween(left, right);
    assertBetween(left, right, result);
    expect(result.levels[0]).toBe(5);
    expect(result.levels[1]).toBe(2);
  });

  test("Case B: lv=0, rv=2 → evenBeforeRv=0, parentValue falls back to lv", () => {
    // evenBeforeRv = 0, which is NOT > lv (0), so parentValue = lv = 0
    const left = { levels: [5, 0] };
    const right = { levels: [5, 2] };
    const result = locatorBetween(left, right);
    assertBetween(left, right, result);
    // Result must still be strictly between left and right
    expect(result.levels[0]).toBe(5);
  });

  test("Case B: left extends beyond divergence level", () => {
    // left has more levels than the parent; result must sort after left
    const left = { levels: [5, 0, 200] };
    const right = { levels: [5, 3] };
    const result = locatorBetween(left, right);
    assertBetween(left, right, result);
  });

  test("Case B: left extends multiple levels beyond divergence", () => {
    const left = { levels: [5, 0, 200, 300] };
    const right = { levels: [5, 3] };
    const result = locatorBetween(left, right);
    assertBetween(left, right, result);
  });
});

describe("locatorBetween – left exhausted while right continues", () => {
  test("left is prefix of right: right has one extra level (non-zero)", () => {
    // At level 0: equal, left is exhausted (leftLen=1), right continues with value 3
    // Special case: push rightNextVal-1 = 2, then MAX_VALUE-1
    const left = { levels: [5] };
    const right = { levels: [5, 3] };
    const result = locatorBetween(left, right);
    assertBetween(left, right, result);
  });

  test("left is prefix of right: right's next value is 1", () => {
    const left = { levels: [5] };
    const right = { levels: [5, 1] };
    const result = locatorBetween(left, right);
    assertBetween(left, right, result);
  });

  test("left is prefix of right: right's next value is 0 (fall-through to deeper)", () => {
    // rightNextVal = 0 → does NOT enter the special case; loop continues
    const left = { levels: [5] };
    const right = { levels: [5, 0, 10] };
    const result = locatorBetween(left, right);
    assertBetween(left, right, result);
  });

  test("deeper prefix match: shared [5, 0], left exhausted, right continues", () => {
    const left = { levels: [5, 0] };
    const right = { levels: [5, 0, 8] };
    const result = locatorBetween(left, right);
    assertBetween(left, right, result);
  });
});

describe("locatorBetween – ordering invariant across mixed cases", () => {
  test("inserting between Case A result and right still satisfies ordering", () => {
    const left = { levels: [5, 0] };
    const right = { levels: [5, 3, 4] };
    const mid = locatorBetween(left, right);
    assertBetween(left, right, mid);

    // Insert again between mid and right
    const mid2 = locatorBetween(mid, right);
    assertBetween(mid, right, mid2);
  });

  test("inserting between left and Case B result still satisfies ordering", () => {
    const left = { levels: [5, 0] };
    const right = { levels: [5, 3] };
    const mid = locatorBetween(left, right);
    assertBetween(left, right, mid);

    // Insert between left and mid
    const mid2 = locatorBetween(left, mid);
    assertBetween(left, mid, mid2);
  });

  test("chain of insertions in multi-level context stays ordered (within MAX_DEPTH)", () => {
    // Sequential insertions from a multi-level starting point.
    // The algorithm has MAX_DEPTH=16; we stay well within that to avoid
    // the known limitation where depth-exhausted locators can become equal.
    const leftBase = { levels: [5, 0] };
    const rightBase = { levels: [5, 100] };
    let current = leftBase;
    const all: { levels: ReadonlyArray<number> }[] = [leftBase];

    for (let i = 0; i < 10; i++) {
      const next = locatorBetween(current, rightBase);
      assertBetween(current, rightBase, next);
      all.push(next);
      current = next;
    }

    // Verify full ordering
    for (let i = 1; i < all.length; i++) {
      const prev = all[i - 1];
      const curr = all[i];
      if (prev !== undefined && curr !== undefined) {
        expect(compareLocators(prev, curr)).toBeLessThan(0);
      }
    }
  });

  test("result depth stays within MAX_DEPTH (16) across case variations", () => {
    const pairs: [{ levels: number[] }, { levels: number[] }][] = [
      [{ levels: [5, 0] }, { levels: [5, 3, 4] }],
      [{ levels: [5, 0] }, { levels: [5, 3] }],
      [{ levels: [5] }, { levels: [5, 3] }],
      [{ levels: [5, 0, 200] }, { levels: [5, 3] }],
    ];

    for (const [left, right] of pairs) {
      const result = locatorBetween(left, right);
      expect(result.levels.length).toBeLessThanOrEqual(16);
      assertBetween(left, right, result);
    }
  });
});
