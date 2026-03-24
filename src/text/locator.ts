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

// The right-shift for the first element: leave room for sequential insertions.
// >> 37 means the midpoint of the first level is ~2^15 = 32768.
const FIRST_LEVEL_SHIFT = 37;

/** Maximum number of levels in a Locator. */
const MAX_DEPTH = 16;

/** The minimum Locator — sorts before all others. */
export const MIN_LOCATOR: Locator = { levels: [0] };

/** The maximum Locator — sorts after all others. */
export const MAX_LOCATOR: Locator = { levels: [MAX_VALUE] };

/**
 * Lexicographic comparison of two Locators.
 * Returns <0 if a < b, 0 if a === b, >0 if a > b.
 */
export function compareLocators(a: Locator, b: Locator): number {
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
 * 1. Find first index where left and right differ.
 * 2. If there's room between them (gap > 1), pick a midpoint.
 * 3. If not, extend to next level with a midpoint value.
 *
 * IMPORTANT: This function returns EVEN values for the last level to avoid
 * collision with inside inserts, which use ODD values (2*k-1 scheme).
 *
 * Throws if left >= right or if MAX_DEPTH would be exceeded.
 */
export function locatorBetween(left: Locator, right: Locator): Locator {
  const levels: number[] = [];

  // The effective max value for each level. The first level uses the shifted range.
  const maxForLevel = (depth: number): number => {
    return depth === 0 ? Math.floor(MAX_VALUE / 2 ** FIRST_LEVEL_SHIFT) : MAX_VALUE;
  };

  // Make value even (round down to nearest even number)
  const makeEven = (n: number): number => {
    return n % 2 === 0 ? n : n - 1;
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
      continue;
    }

    // Try to find an EVEN midpoint between lv and rv to avoid collision with
    // inside inserts (which use odd 2*k-1 values).
    if (rv - lv > 1) {
      // Compute midpoint, then round to nearest even number
      const mid = lv + Math.floor((rv - lv) / 2);
      const evenMid = mid % 2 === 0 ? mid : mid - 1;
      if (evenMid > lv && evenMid < rv) {
        levels.push(evenMid);
        return { levels };
      }
      // Try the next even after midpoint
      const nextEven = mid % 2 === 0 ? mid + 2 : mid + 1;
      if (nextEven > lv && nextEven < rv) {
        levels.push(nextEven);
        return { levels };
      }
      // Gap too small for an even number, need to go deeper (fall through)
    }

    // rv - lv <= 1, or no even number fits
    // We need to go deeper. Carry `lv` at this level and extend.
    levels.push(lv);

    // At the next level, left is "0" (just past lv) and right is MAX
    // Find midpoint of the next level
    const nextMax = maxForLevel(i + 1);
    const nextLeft = i + 1 < leftLen ? (left.levels[i + 1] ?? 0) : 0;

    if (levels.length >= MAX_DEPTH) {
      // At max depth, just pick next value after nextLeft (make it even)
      const next = nextLeft + 2; // +2 to ensure > nextLeft and even
      levels.push(makeEven(next));
      return { levels };
    }

    const nextMid = nextLeft + Math.floor((nextMax - nextLeft) / 2);
    levels.push(makeEven(nextMid) > nextLeft ? makeEven(nextMid) : nextMid);
    return { levels };
  }

  // Fallback: extend with an even midpoint at the next level
  if (levels.length < MAX_DEPTH) {
    const nextMax = maxForLevel(levels.length);
    levels.push(makeEven(Math.floor(nextMax / 2)));
  }

  return { levels };
}

/**
 * Check if two Locators are equal.
 */
export function locatorsEqual(a: Locator, b: Locator): boolean {
  return compareLocators(a, b) === 0;
}
