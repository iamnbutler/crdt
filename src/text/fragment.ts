/**
 * Fragment and FragmentSummary
 *
 * A Fragment is the atomic unit of text in the CRDT. Fragments implement
 * `Summarizable<FragmentSummary>` so they can be stored in a SumTree ordered
 * by Locator.
 *
 * FragmentSummary is the monoid for the fragment SumTree, tracking visible and
 * deleted text metrics.
 */

import type { Dimension, Summary } from "../sum-tree/index.js";
import { MIN_LOCATOR, compareLocators } from "./locator.js";
import { MIN_OPERATION_ID, compareOperationIds } from "./types.js";
import type { Fragment, FragmentSummary, Locator, OperationId } from "./types.js";

// ---------------------------------------------------------------------------
// FragmentSummary monoid
// ---------------------------------------------------------------------------

/**
 * Monoid operations for FragmentSummary.
 * combine() sums all fields; identity() returns all zeros.
 */
export const fragmentSummaryOps: Summary<FragmentSummary> = {
  identity(): FragmentSummary {
    return {
      visibleLen: 0,
      visibleLines: 0,
      deletedLen: 0,
      deletedLines: 0,
      maxInsertionId: MIN_OPERATION_ID,
      maxLocator: MIN_LOCATOR,
      itemCount: 0,
    };
  },

  combine(left: FragmentSummary, right: FragmentSummary): FragmentSummary {
    return {
      visibleLen: left.visibleLen + right.visibleLen,
      visibleLines: left.visibleLines + right.visibleLines,
      deletedLen: left.deletedLen + right.deletedLen,
      deletedLines: left.deletedLines + right.deletedLines,
      maxInsertionId:
        compareOperationIds(left.maxInsertionId, right.maxInsertionId) >= 0
          ? left.maxInsertionId
          : right.maxInsertionId,
      maxLocator:
        compareLocators(left.maxLocator, right.maxLocator) >= 0
          ? left.maxLocator
          : right.maxLocator,
      itemCount: left.itemCount + right.itemCount,
    };
  },

  getItemCount(summary: FragmentSummary): number {
    return summary.itemCount;
  },
};

// ---------------------------------------------------------------------------
// Dimensions for seeking the fragment SumTree
// ---------------------------------------------------------------------------

/** Dimension for seeking by visible UTF-16 offset. */
export const visibleLenDimension: Dimension<FragmentSummary, number> = {
  measure(summary: FragmentSummary): number {
    return summary.visibleLen;
  },
  compare(a: number, b: number): number {
    return a - b;
  },
  add(a: number, b: number): number {
    return a + b;
  },
  zero(): number {
    return 0;
  },
};

/** Dimension for seeking by visible line count. */
export const visibleLinesDimension: Dimension<FragmentSummary, number> = {
  measure(summary: FragmentSummary): number {
    return summary.visibleLines;
  },
  compare(a: number, b: number): number {
    return a - b;
  },
  add(a: number, b: number): number {
    return a + b;
  },
  zero(): number {
    return 0;
  },
};

/**
 * Dimension for seeking by Locator.
 * Enables O(log n) position finding by Locator in the fragment tree.
 */
export const locatorDimension: Dimension<FragmentSummary, Locator> = {
  measure(summary: FragmentSummary): Locator {
    return summary.maxLocator;
  },
  compare(a: Locator, b: Locator): number {
    return compareLocators(a, b);
  },
  add(a: Locator, b: Locator): Locator {
    // For max-based dimensions, "add" returns the max
    return compareLocators(a, b) >= 0 ? a : b;
  },
  zero(): Locator {
    return MIN_LOCATOR;
  },
};

/**
 * Dimension for seeking by item count.
 * Enables cursor iteration through all fragments regardless of visibility.
 */
export const itemCountDimension: Dimension<FragmentSummary, number> = {
  measure(summary: FragmentSummary): number {
    return summary.itemCount;
  },
  compare(a: number, b: number): number {
    return a - b;
  },
  add(a: number, b: number): number {
    return a + b;
  },
  zero(): number {
    return 0;
  },
};

// ---------------------------------------------------------------------------
// Fragment construction
// ---------------------------------------------------------------------------

/** Count newlines in a string. Uses early-exit for the common no-newline case. */
function countNewlines(text: string): number {
  if (!text.includes("\n")) return 0;
  const matches = text.match(/\n/g);
  return matches !== null ? matches.length : 0;
}

/** Build a Fragment with a pre-computed line count, avoiding redundant scanning. */
function buildFragment(
  insertionId: OperationId,
  insertionOffset: number,
  locator: Locator,
  baseLocator: Locator,
  text: string,
  visible: boolean,
  deletions: ReadonlyArray<OperationId>,
  lines: number,
): Fragment {
  const len = text.length;
  const summaryValue: FragmentSummary = visible
    ? {
        visibleLen: len,
        visibleLines: lines,
        deletedLen: 0,
        deletedLines: 0,
        maxInsertionId: insertionId,
        maxLocator: locator,
        itemCount: 1,
      }
    : {
        visibleLen: 0,
        visibleLines: 0,
        deletedLen: len,
        deletedLines: lines,
        maxInsertionId: insertionId,
        maxLocator: locator,
        itemCount: 1,
      };
  return {
    insertionId,
    insertionOffset,
    locator,
    baseLocator,
    length: len,
    visible,
    deletions,
    text,
    summary() {
      return summaryValue;
    },
  };
}

/**
 * Create a Fragment with a precomputed summary.
 *
 * @param baseLocator The Locator from the original InsertOperation. If not
 *   provided, defaults to the fragment's locator (for new insertions).
 */
export function createFragment(
  insertionId: OperationId,
  insertionOffset: number,
  locator: Locator,
  text: string,
  visible: boolean,
  deletions: ReadonlyArray<OperationId> = [],
  baseLocator?: Locator,
): Fragment {
  return buildFragment(
    insertionId,
    insertionOffset,
    locator,
    baseLocator ?? locator,
    text,
    visible,
    deletions,
    countNewlines(text),
  );
}

/**
 * Split a fragment at the given local offset (relative to the fragment start).
 * Returns [left, right] fragments.
 *
 * Locator computation makes split parts CHILDREN of the baseLocator (original
 * insertion's locator). This ensures DETERMINISTIC locators regardless of
 * operation application order:
 * 1. Split parts always have locators: [...baseLocator, 2*insertionOffset]
 * 2. Inside inserts have locators: [...baseLocator, 2*k-1]
 * 3. These interleave correctly: 2*0, 2*1-1, 2*1, 2*2-1, 2*2, ...
 *
 * Using baseLocator (not current locator) is critical for order independence:
 * if we used the current locator, repeated splits would nest deeper and deeper,
 * producing different locators depending on which splits happened first.
 */
export function splitFragment(fragment: Fragment, localOffset: number): [Fragment, Fragment] {
  const leftText = fragment.text.slice(0, localOffset);
  const rightText = fragment.text.slice(localOffset);

  // Use baseLocator to ensure deterministic split locators regardless of
  // previous splits. This is the KEY to order independence.
  const parentLocator = fragment.baseLocator;

  // Count newlines once for the left part; derive right count from the stored total
  // to avoid scanning rightText separately.
  const prevSummary = fragment.summary();
  const totalLines = prevSummary.visibleLines + prevSummary.deletedLines;
  const leftLines = countNewlines(leftText);
  const rightLines = totalLines - leftLines;

  // Left: [...baseLocator, 2*insertionOffset]
  const leftInsertionOffset = fragment.insertionOffset;
  const leftLocator: Locator = {
    levels: [...parentLocator.levels, 2 * leftInsertionOffset],
  };

  const left = buildFragment(
    fragment.insertionId,
    leftInsertionOffset,
    leftLocator,
    fragment.baseLocator,
    leftText,
    fragment.visible,
    fragment.deletions,
    leftLines,
  );

  // Right: [...baseLocator, 2*rightInsertionOffset]
  const rightInsertionOffset = fragment.insertionOffset + localOffset;
  const rightLocator: Locator = {
    levels: [...parentLocator.levels, 2 * rightInsertionOffset],
  };

  const right = buildFragment(
    fragment.insertionId,
    rightInsertionOffset,
    rightLocator,
    fragment.baseLocator,
    rightText,
    fragment.visible,
    fragment.deletions,
    rightLines,
  );

  return [left, right];
}

/**
 * Create a new fragment that is a "deleted" version of the given fragment.
 * Adds the deleting operation's ID to the deletions set.
 * Reuses the existing summary's line count to avoid rescanning unchanged text.
 */
export function deleteFragment(fragment: Fragment, deletionId: OperationId): Fragment {
  const prevSummary = fragment.summary();
  const lines = prevSummary.visibleLines + prevSummary.deletedLines;
  return buildFragment(
    fragment.insertionId,
    fragment.insertionOffset,
    fragment.locator,
    fragment.baseLocator,
    fragment.text,
    false,
    [...fragment.deletions, deletionId],
    lines,
  );
}

/**
 * Rebuild a fragment with updated visibility (used after undo/redo).
 * Reuses the existing summary's line count to avoid rescanning unchanged text.
 */
export function withVisibility(fragment: Fragment, visible: boolean): Fragment {
  if (fragment.visible === visible) return fragment;
  const prevSummary = fragment.summary();
  const lines = prevSummary.visibleLines + prevSummary.deletedLines;
  return buildFragment(
    fragment.insertionId,
    fragment.insertionOffset,
    fragment.locator,
    fragment.baseLocator,
    fragment.text,
    visible,
    fragment.deletions,
    lines,
  );
}
