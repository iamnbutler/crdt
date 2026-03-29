/**
 * Locator: variable-length position identifiers for CRDT fragment ordering.
 *
 * Each level is a JS `number` (53-bit integer precision). The first element
 * of a new Locator is shifted right by 37 bits, leaving ~137 billion positions
 * for sequential insertions before depth growth is needed.
 *
 * Locators are compared lexicographically. `between(left, right)` produces
 * a Locator M such that left < M < right.
 */

import type { Locator } from "./types.js";

// 2^53 - 1 is Number.MAX_SAFE_INTEGER (the max integer a JS number can represent exactly)
const MAX_VALUE = Number.MAX_SAFE_INTEGER;

// ---------------------------------------------------------------------------
// Float64 sort key encoding
// ---------------------------------------------------------------------------
//
// Packs the first 3 levels of a Locator into a single Float64 number for
// fast comparison. Layout (52 bits of mantissa):
//   Level 0: 16 bits (max 65535) — matches the FIRST_LEVEL_SHIFT constraint
//   Level 1: 18 bits (max 262143) — covers most split/insert offsets
//   Level 2: 18 bits (max 262143)
//
// When a level value exceeds its encodable range, the sort key is set to
// the sentinel value -1 ("no sort key"). This forces fallback to exact
// comparison, avoiding incorrect ordering from clamped values.

/** Bit widths for each encoded level. */
const SORT_KEY_L1_SHIFT = 18;
const SORT_KEY_L0_SHIFT = 36; // 18 + 18
const SORT_KEY_L1_MAX = 262143; // (1 << 18) - 1
const SORT_KEY_L0_MAX = 65535; // (1 << 16) - 1

/** Sentinel indicating the sort key could not be computed (overflow). */
const SORT_KEY_OVERFLOW = -1;

// Precomputed constants to avoid repeated exponentiation in hot paths
const L0_MULTIPLIER = 2 ** SORT_KEY_L0_SHIFT; // 2^36
const L1_MULTIPLIER = 2 ** SORT_KEY_L1_SHIFT; // 2^18

/**
 * Compute a Float64 sort key from a Locator's levels.
 *
 * Returns a non-negative number that preserves lexicographic ordering for
 * locators whose first 3 levels fit within the bit-width limits. Returns
 * SORT_KEY_OVERFLOW (-1) if any level exceeds its range, forcing fallback
 * to exact comparison.
 *
 * Locators with > 3 levels that share the same first 3 levels produce the
 * same sort key (a safe tie resolved by exact comparison).
 */
export function computeSortKey(levels: ReadonlyArray<number>): number {
  const l0 = levels[0] ?? 0;
  if (l0 > SORT_KEY_L0_MAX) return SORT_KEY_OVERFLOW;

  const l1 = levels.length > 1 ? (levels[1] ?? 0) : 0;
  if (l1 > SORT_KEY_L1_MAX) return SORT_KEY_OVERFLOW;

  const l2 = levels.length > 2 ? (levels[2] ?? 0) : 0;
  if (l2 > SORT_KEY_L1_MAX) return SORT_KEY_OVERFLOW;

  return l0 * L0_MULTIPLIER + l1 * L1_MULTIPLIER + l2;
}

/**
 * Create a Locator with a precomputed sort key.
 */
export function createLocator(levels: ReadonlyArray<number>): Locator {
  return { levels, sortKey: computeSortKey(levels) };
}

// The right-shift for the first element: leave room for sequential insertions.
// >> 37 means the midpoint of the first level is ~2^15 = 32768.
const FIRST_LEVEL_SHIFT = 37;

/** Maximum number of levels in a Locator. */
const MAX_DEPTH = 16;

/** The minimum Locator — sorts before all others. */
export const MIN_LOCATOR: Locator = createLocator([0]);

/** The maximum Locator — sorts after all others. */
export const MAX_LOCATOR: Locator = createLocator([MAX_VALUE]);

/**
 * Lexicographic comparison of two Locators.
 * Returns <0 if a < b, 0 if a === b, >0 if a > b.
 *
 * Uses a Float64 sort key as a fast path: if the sort keys differ, the
 * comparison is a single number subtraction. Falls through to exact
 * level-by-level comparison only when sort keys tie (rare in practice:
 * deep locators, large level values, or trailing-zero differences).
 */
export function compareLocators(a: Locator, b: Locator): number {
  // Fast path: compare precomputed Float64 sort keys.
  // Only use when both are present and valid (>= 0). Overflow (-1) or
  // undefined means we must use exact comparison.
  const ka = a.sortKey;
  const kb = b.sortKey;
  if (ka !== undefined && kb !== undefined && ka >= 0 && kb >= 0 && ka !== kb) {
    return ka - kb;
  }

  // Slow path: exact level-by-level comparison (sort keys tied)
  return compareLocatorsExact(a, b);
}

/**
 * Exact level-by-level lexicographic comparison. Used as fallback when
 * Float64 sort keys are equal.
 */
function compareLocatorsExact(a: Locator, b: Locator): number {
  const minLen = Math.min(a.levels.length, b.levels.length);
  for (let i = 0; i < minLen; i++) {
    const aLevel = a.levels[i];
    const bLevel = b.levels[i];
    if (aLevel !== undefined && bLevel !== undefined && aLevel !== bLevel) {
      return aLevel - bLevel;
    }
  }
  return a.levels.length - b.levels.length;
}

/**
 * Produce a Locator M between `left` and `right` such that left < M < right.
 *
 * Algorithm:
 * - At level 0 (top level): pick a midpoint if there's room
 * - At level >= 1: compute the equivalent inside-insert slot
 *
 * The split/inside-insert scheme reserves:
 * - Even values (0, 2, 4, ...) for split locators at offset k: 2*k
 * - Odd values (1, 3, 5, ...) for inside-insert locators at offset k: 2*k-1
 *
 * When inserting between split fragments [L, 2*k] and [L, 2*m], the semantic
 * position is "after offset k, before offset m" which is the inside-insert
 * slot at offset k+1: [L, 2*(k+1)-1] = [L, 2*k+1].
 *
 * This ensures boundary inserts and inside-inserts at the "same position"
 * get the same locator prefix, with tie-breaking by operation ID.
 */
export function locatorBetween(left: Locator, right: Locator): Locator {
  const levels: number[] = [];

  // The effective max value for each level. The first level uses the shifted range.
  const maxForLevel = (depth: number): number => {
    return depth === 0 ? Math.floor(MAX_VALUE / 2 ** FIRST_LEVEL_SHIFT) : MAX_VALUE;
  };

  const leftLen = left.levels.length;
  const rightLen = right.levels.length;
  const maxLen = Math.max(leftLen, rightLen);

  for (let i = 0; i < Math.min(maxLen, MAX_DEPTH); i++) {
    const lv = i < leftLen ? (left.levels[i] ?? 0) : 0;
    const rv = i < rightLen ? (right.levels[i] ?? maxForLevel(i) + 1) : maxForLevel(i) + 1;

    if (lv === rv) {
      // Same at this level, carry it forward and look deeper
      levels.push(lv);

      // Special case: if left is now exhausted but right continues, we're
      // trying to insert between a locator and its child. There's no integer
      // room at this level. We need to go deeper from left with a value
      // LESS than right's next level.
      if (i + 1 === leftLen && i + 1 < rightLen) {
        const rightNextVal = right.levels[i + 1] ?? 0;
        if (rightNextVal > 0 && levels.length < MAX_DEPTH) {
          // Insert value just below right's next level
          levels.push(rightNextVal - 1);
          if (levels.length < MAX_DEPTH) {
            levels.push(MAX_VALUE - 1);
          }
          return createLocator(levels);
        }
        // rightNextVal is 0, need to go even deeper - continue the loop
      }
      continue;
    }

    // At level 0, we can safely pick a midpoint (no split/inside-insert collision)
    if (i === 0 && rv - lv > 1) {
      const mid = lv + Math.floor((rv - lv) / 2);
      levels.push(mid);
      return createLocator(levels);
    }

    // At level >= 1: go deeper to avoid collision with inside-inserts and splits.
    //
    // The split/inside-insert scheme reserves:
    // - Even values (0, 2, 4, ...) for split locators at position k/2
    // - Odd values (1, 3, 5, ...) for inside-insert locators at position (k+1)/2
    //
    // We must NOT use any value directly at this level (would collide).
    // Strategy depends on whether right extends beyond this level:
    //
    // Case A: right extends (has more levels)
    //   - Use rv as parent (same prefix as right up to level i)
    //   - Go deeper with a value LESS than right's next level
    //   - Example: between([.., 5, 0], [..., 5, 2, MAX-1]) → [..., 5, 2, MAX-2]
    //
    // Case B: right doesn't extend
    //   - Use the rightmost even value < rv (or lv if no such even exists)
    //   - Go deeper with MAX-1
    //   - Example: between([.., 5, 0], [..., 5, 3]) → [..., 5, 2, MAX-1]
    //
    // Why this matters: when a fragment splits, children stay with their parent.
    // Case A ensures we stay with the same parent as right.
    // Case B ensures we stay with the rightmost split position before right.
    const nextLevel = i + 1;
    // Case A: right extends with a non-zero next value, and rv > lv
    // This lets us become a sibling of right at the next level
    const rightNextVal = nextLevel < rightLen ? (right.levels[nextLevel] ?? 0) : 0;
    if (nextLevel < rightLen && rv > lv && rightNextVal > 0) {
      // Use rv as parent, go just before right's next level value
      levels.push(rv);
      if (levels.length < MAX_DEPTH) {
        levels.push(rightNextVal - 1);
      }
    } else {
      // Case B: right doesn't extend OR rv == lv
      // Use rightmost even < rv as parent
      const evenBeforeRv = rv % 2 === 0 ? rv - 2 : rv - 1;
      const parentValue = evenBeforeRv > lv ? evenBeforeRv : lv;
      levels.push(parentValue);

      if (levels.length < MAX_DEPTH) {
        // Check if left extends beyond this level
        const nextLeftIdx = levels.length;
        if (nextLeftIdx < leftLen) {
          // Left has more levels. We need to sort AFTER left.
          // Copy left's remaining levels, then increment the last to go "just after"
          for (let j = nextLeftIdx; j < leftLen && levels.length < MAX_DEPTH; j++) {
            levels.push(left.levels[j] ?? 0);
          }
          if (levels.length < MAX_DEPTH) {
            const lastIdx = levels.length - 1;
            const lastVal = levels[lastIdx];
            if (lastVal !== undefined && lastVal < MAX_VALUE) {
              // Can safely increment
              levels[lastIdx] = lastVal + 1;
            } else if (levels.length < MAX_DEPTH) {
              // Can't increment (at MAX_VALUE), go deeper
              levels.push(MAX_VALUE - 1);
            }
          }
        } else {
          // Left doesn't extend here. Use a very large value to avoid
          // collision with splits (which use small values 0, 2, 4, ...).
          levels.push(MAX_VALUE - 1);
        }
      }
    }
    return createLocator(levels);
  }

  // Fallback: extend with a midpoint at the next level
  if (levels.length < MAX_DEPTH) {
    const nextMax = maxForLevel(levels.length);
    levels.push(Math.floor(nextMax / 2));
  }

  return createLocator(levels);
}

/**
 * Check if two Locators are equal.
 */
export function locatorsEqual(a: Locator, b: Locator): boolean {
  return compareLocators(a, b) === 0;
}
