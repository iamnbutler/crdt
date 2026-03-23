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
 */
export function createFragment(
  insertionId: OperationId,
  insertionOffset: number,
  locator: Locator,
  text: string,
  visible: boolean,
  deletions: ReadonlyArray<OperationId> = [],
): Fragment {
  const lines = countNewlines(text);
  const len = text.length;

  const summaryValue: FragmentSummary = visible
    ? {
        visibleLen: len,
        visibleLines: lines,
        deletedLen: 0,
        deletedLines: 0,
        maxInsertionId: insertionId,
      }
    : {
        visibleLen: 0,
        visibleLines: 0,
        deletedLen: len,
        deletedLines: lines,
        maxInsertionId: insertionId,
      };

  return {
    insertionId,
    insertionOffset,
    locator,
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
 * Returns [left, right] fragments. Both inherit the same locator, insertionId,
 * and deletions.
 */
export function splitFragment(fragment: Fragment, localOffset: number): [Fragment, Fragment] {
  const leftText = fragment.text.slice(0, localOffset);
  const rightText = fragment.text.slice(localOffset);

  const left = createFragment(
    fragment.insertionId,
    fragment.insertionOffset,
    fragment.locator,
    leftText,
    fragment.visible,
    fragment.deletions,
  );

  const right = createFragment(
    fragment.insertionId,
    fragment.insertionOffset + localOffset,
    fragment.locator,
    rightText,
    fragment.visible,
    fragment.deletions,
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
  );
}
