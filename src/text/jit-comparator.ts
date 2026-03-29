/**
 * JIT-compiled comparators for Locators and Fragments.
 *
 * V8 (and other JS engines) optimize monomorphic call sites much better than
 * polymorphic ones. By generating specialized comparator functions with
 * `new Function()`, we produce code with predictable branch patterns and
 * inlined property access that the JIT can optimize aggressively.
 *
 * The generated comparators unroll the locator level-comparison loop for a
 * known maximum depth, eliminating the overhead of `Math.min`, loop counters,
 * and dynamic array bounds checking.
 *
 * Falls back to plain functions when `new Function()` is unavailable (e.g.,
 * CSP-restricted environments with `script-src` lacking `'unsafe-eval'`).
 */

import type { Fragment, Locator } from "./types.js";

/** Comparator signature for locators. */
export type LocatorCompareFn = (a: Locator, b: Locator) => number;

/** Comparator signature for fragments (used in sorting). */
export type FragmentCompareFn = (a: Fragment, b: Fragment) => number;

// ---------------------------------------------------------------------------
// Fallback (non-JIT) comparators — identical logic to locator.ts / text-buffer.ts
// ---------------------------------------------------------------------------

/** Fallback locator comparator (no JIT). */
function fallbackCompareLocators(a: Locator, b: Locator): number {
  const aLevels = a.levels;
  const bLevels = b.levels;
  const minLen = aLevels.length < bLevels.length ? aLevels.length : bLevels.length;
  for (let i = 0; i < minLen; i++) {
    const d = (aLevels[i] as number) - (bLevels[i] as number);
    if (d !== 0) return d;
  }
  return aLevels.length - bLevels.length;
}

/** Fallback fragment comparator (no JIT). */
function fallbackCompareFragments(a: Fragment, b: Fragment): number {
  // Locator comparison
  const aLoc = a.locator.levels;
  const bLoc = b.locator.levels;
  const minLen = aLoc.length < bLoc.length ? aLoc.length : bLoc.length;
  for (let i = 0; i < minLen; i++) {
    const d = (aLoc[i] as number) - (bLoc[i] as number);
    if (d !== 0) return d;
  }
  const locCmp = aLoc.length - bLoc.length;
  if (locCmp !== 0) return locCmp;

  // Operation ID tie-break
  const ridCmp = a.insertionId.replicaId - b.insertionId.replicaId;
  if (ridCmp !== 0) return ridCmp;
  const ctrCmp = a.insertionId.counter - b.insertionId.counter;
  if (ctrCmp !== 0) return ctrCmp;

  // Insertion offset (split parts)
  const offCmp = a.insertionOffset - b.insertionOffset;
  if (offCmp !== 0) return offCmp;

  // Locator length (children after parent)
  return a.locator.levels.length - b.locator.levels.length;
}

// ---------------------------------------------------------------------------
// JIT code generation
// ---------------------------------------------------------------------------

/** Maximum locator depth — matches MAX_DEPTH in locator.ts. */
const MAX_DEPTH = 16;

/**
 * Generate the body of an unrolled locator comparison function.
 *
 * The generated code accesses `a.levels[i]` and `b.levels[i]` directly for
 * each level 0..maxDepth-1, breaking early when one side runs out of levels.
 */
function generateLocatorCompareBody(maxDepth: number): string {
  const lines: string[] = [];
  lines.push("var aL = a.levels, bL = b.levels;");
  lines.push("var aLen = aL.length, bLen = bL.length;");

  for (let i = 0; i < maxDepth; i++) {
    // Early exit: if both arrays are shorter than i+1, comparison is done
    lines.push(`if (aLen <= ${i}) return bLen <= ${i} ? 0 : -1;`);
    lines.push(`if (bLen <= ${i}) return 1;`);
    lines.push(`var d${i} = aL[${i}] - bL[${i}];`);
    lines.push(`if (d${i} !== 0) return d${i};`);
  }

  // If both arrays have more than maxDepth levels and all matched, compare lengths
  lines.push("return aLen - bLen;");
  return lines.join("\n");
}

/**
 * Generate the body of an unrolled fragment comparison function.
 *
 * Inlines: locator comparison → operation ID → insertion offset → locator length.
 * This eliminates all function-call overhead in the sort comparator.
 */
function generateFragmentCompareBody(maxDepth: number): string {
  const lines: string[] = [];

  // Locator comparison (inlined)
  lines.push("var aL = a.locator.levels, bL = b.locator.levels;");
  lines.push("var aLen = aL.length, bLen = bL.length;");
  lines.push("var minLen = aLen < bLen ? aLen : bLen;");

  // Unrolled loop for common depths, then dynamic loop for deeper
  const unrollDepth = Math.min(maxDepth, 6); // Unroll first 6 levels (covers >99% of cases)
  for (let i = 0; i < unrollDepth; i++) {
    lines.push(`if (minLen > ${i}) {`);
    lines.push(`  var d${i} = aL[${i}] - bL[${i}];`);
    lines.push(`  if (d${i} !== 0) return d${i};`);
    lines.push("}");
  }

  // Dynamic loop for remaining levels (rare: depth > 6)
  if (maxDepth > unrollDepth) {
    lines.push(`for (var i = ${unrollDepth}; i < minLen; i++) {`);
    lines.push("  var dd = aL[i] - bL[i];");
    lines.push("  if (dd !== 0) return dd;");
    lines.push("}");
  }

  // Locator length comparison
  lines.push("var locCmp = aLen - bLen;");
  lines.push("if (locCmp !== 0) return locCmp;");

  // Operation ID tie-break (inlined)
  lines.push("var ridCmp = a.insertionId.replicaId - b.insertionId.replicaId;");
  lines.push("if (ridCmp !== 0) return ridCmp;");
  lines.push("var ctrCmp = a.insertionId.counter - b.insertionId.counter;");
  lines.push("if (ctrCmp !== 0) return ctrCmp;");

  // Insertion offset
  lines.push("var offCmp = a.insertionOffset - b.insertionOffset;");
  lines.push("if (offCmp !== 0) return offCmp;");

  // Locator length (children after parent) — same as locCmp but included
  // for completeness since locCmp was already 0 at this point
  lines.push("return 0;");

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Factory functions
// ---------------------------------------------------------------------------

/**
 * Create a JIT-compiled locator comparator.
 *
 * @param maxDepth Maximum locator depth to unroll for (default: MAX_DEPTH).
 * @returns A fast comparator function, or the fallback if JIT is unavailable.
 */
export function createJitLocatorComparator(maxDepth: number = MAX_DEPTH): LocatorCompareFn {
  try {
    const body = generateLocatorCompareBody(maxDepth);
    const factory = new Function("a", "b", body) as LocatorCompareFn;

    // Sanity check: verify it works on a trivial case
    const test1 = { levels: [1] };
    const test2 = { levels: [2] };
    if (factory(test1, test2) >= 0 || factory(test2, test1) <= 0 || factory(test1, test1) !== 0) {
      return fallbackCompareLocators;
    }
    return factory;
  } catch {
    // CSP or other restriction — use fallback
    return fallbackCompareLocators;
  }
}

/**
 * Create a JIT-compiled fragment comparator for use in sortFragments and
 * binary search insertion.
 *
 * @param maxDepth Maximum locator depth to unroll for (default: MAX_DEPTH).
 * @returns A fast comparator function, or the fallback if JIT is unavailable.
 */
export function createJitFragmentComparator(maxDepth: number = MAX_DEPTH): FragmentCompareFn {
  try {
    const body = generateFragmentCompareBody(maxDepth);
    const factory = new Function("a", "b", body) as FragmentCompareFn;

    // Sanity check with minimal fragment-like objects
    const frag1 = {
      locator: { levels: [1] },
      insertionId: { replicaId: 1, counter: 0 },
      insertionOffset: 0,
    };
    const frag2 = {
      locator: { levels: [2] },
      insertionId: { replicaId: 1, counter: 0 },
      insertionOffset: 0,
    };
    // biome-ignore lint/suspicious/noExplicitAny: sanity check uses minimal mock objects
    const f1 = frag1 as any;
    // biome-ignore lint/suspicious/noExplicitAny: sanity check uses minimal mock objects
    const f2 = frag2 as any;
    if (factory(f1, f2) >= 0 || factory(f2, f1) <= 0 || factory(f1, f1) !== 0) {
      return fallbackCompareFragments;
    }
    return factory;
  } catch {
    // CSP or other restriction — use fallback
    return fallbackCompareFragments;
  }
}

// ---------------------------------------------------------------------------
// Module-level singleton comparators (generated once at import time)
// ---------------------------------------------------------------------------

/**
 * JIT-compiled locator comparator, ready to use.
 * Falls back to a plain function in CSP-restricted environments.
 */
export const jitCompareLocators: LocatorCompareFn = createJitLocatorComparator(MAX_DEPTH);

/**
 * JIT-compiled fragment comparator, ready to use.
 * Falls back to a plain function in CSP-restricted environments.
 */
export const jitCompareFragments: FragmentCompareFn = createJitFragmentComparator(MAX_DEPTH);
