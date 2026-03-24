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
    };
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

/** Dimension for seeking by item count (used for index-based operations). */
export const countDimension: Dimension<FragmentSummary, number> = {
  measure(_summary: FragmentSummary): number {
    return 1; // Each fragment counts as 1
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

/** Count newlines in a string. */
function countNewlines(text: string): number {
  let count = 0;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 0x0a) {
      count++;
    }
  }
  return count;
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
  const lines = countNewlines(text);
  const len = text.length;
  const base = baseLocator ?? locator;

  const summaryValue: FragmentSummary = visible
    ? {
        visibleLen: len,
        visibleLines: lines,
        deletedLen: 0,
        deletedLines: 0,
        maxInsertionId: insertionId,
        maxLocator: locator,
      }
    : {
        visibleLen: 0,
        visibleLines: 0,
        deletedLen: len,
        deletedLines: lines,
        maxInsertionId: insertionId,
        maxLocator: locator,
      };

  return {
    insertionId,
    insertionOffset,
    locator,
    baseLocator: base,
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
 * Split a fragment at the given local offset (relative to the fragment start).
 * Returns [left, right] fragments.
 *
 * Locator computation uses baseLocator (the original insertion's Locator):
 * - left keeps its current Locator
 * - right gets Locator [...baseLocator, 2 * rightInsertionOffset]
 *
 * Using baseLocator (not the current locator) ensures deterministic Locators:
 * a fragment at insertion offset k always gets the same Locator regardless of
 * how many times its parent fragment was split.
 *
 * The 2*offset scheme leaves room for inter-character inserts at 2*k-1.
 */
export function splitFragment(fragment: Fragment, localOffset: number): [Fragment, Fragment] {
  const leftText = fragment.text.slice(0, localOffset);
  const rightText = fragment.text.slice(localOffset);

  // BOTH parts get Locators computed from baseLocator for determinism.
  // A fragment at insertionOffset K always gets Locator [...baseLocator, 2*K],
  // except when K == 0 (the original insertion position), which uses baseLocator directly.
  // This ensures the same Locator regardless of split history.

  // Left: uses baseLocator if at offset 0, otherwise [...baseLocator, 2*offset]
  const leftInsertionOffset = fragment.insertionOffset;
  const leftLocator: Locator =
    leftInsertionOffset === 0
      ? fragment.baseLocator
      : { levels: [...fragment.baseLocator.levels, 2 * leftInsertionOffset] };

  const left = createFragment(
    fragment.insertionId,
    leftInsertionOffset,
    leftLocator,
    leftText,
    fragment.visible,
    fragment.deletions,
    fragment.baseLocator,
  );

  // Right: uses baseLocator if at offset 0, otherwise [...baseLocator, 2*offset]
  // (offset 0 can happen when splitting at position 0, creating an empty left part)
  const rightInsertionOffset = fragment.insertionOffset + localOffset;
  const rightLocator: Locator =
    rightInsertionOffset === 0
      ? fragment.baseLocator
      : { levels: [...fragment.baseLocator.levels, 2 * rightInsertionOffset] };

  const right = createFragment(
    fragment.insertionId,
    rightInsertionOffset,
    rightLocator,
    rightText,
    fragment.visible,
    fragment.deletions,
    fragment.baseLocator,
  );

  return [left, right];
}

/**
 * Create a new fragment that is a "deleted" version of the given fragment.
 * Adds the deleting operation's ID to the deletions set.
 */
export function deleteFragment(fragment: Fragment, deletionId: OperationId): Fragment {
  return createFragment(
    fragment.insertionId,
    fragment.insertionOffset,
    fragment.locator,
    fragment.text,
    false,
    [...fragment.deletions, deletionId],
    fragment.baseLocator,
  );
}

/**
 * Rebuild a fragment with updated visibility (used after undo/redo).
 */
export function withVisibility(fragment: Fragment, visible: boolean): Fragment {
  if (fragment.visible === visible) return fragment;
  return createFragment(
    fragment.insertionId,
    fragment.insertionOffset,
    fragment.locator,
    fragment.text,
    visible,
    fragment.deletions,
    fragment.baseLocator,
  );
}
