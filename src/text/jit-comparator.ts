/**
 * JIT-compiled Locator comparators using `new Function()`.
 *
 * V8/Bun optimize monomorphic call sites and predictable branches.
 * By generating a comparator unrolled for a known max depth, we eliminate:
 * - The `Math.min()` call
 * - The loop and its branch mispredictions
 * - The `undefined` guard checks
 *
 * Falls back to the generic `compareLocators` when `new Function()` is
 * unavailable (CSP-restricted environments).
 *
 * @see https://github.com/iamnbutler/crdt/issues/114
 */

import type { Fragment, Locator } from "./types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A comparator function for Locators. */
export type LocatorCompareFn = (a: Locator, b: Locator) => number;

/** A comparator function for Fragments (full sort key). */
export type FragmentCompareFn = (a: Fragment, b: Fragment) => number;

// ---------------------------------------------------------------------------
// Generic (fallback) comparators
// ---------------------------------------------------------------------------

/**
 * Generic lexicographic Locator comparison — the baseline.
 * Used as fallback when JIT compilation is unavailable.
 */
export function compareLocatorsGeneric(a: Locator, b: Locator): number {
  const aLevels = a.levels;
  const bLevels = b.levels;
  const minLen = aLevels.length < bLevels.length ? aLevels.length : bLevels.length;
  for (let i = 0; i < minLen; i++) {
    const d = (aLevels[i] as number) - (bLevels[i] as number);
    if (d !== 0) return d;
  }
  return aLevels.length - bLevels.length;
}

/**
 * Generic fragment comparison — full sort key.
 */
export function compareFragmentsGeneric(a: Fragment, b: Fragment): number {
  const locCmp = compareLocatorsGeneric(a.locator, b.locator);
  if (locCmp !== 0) return locCmp;

  const aId = a.insertionId;
  const bId = b.insertionId;
  if (aId.replicaId !== bId.replicaId) return aId.replicaId - bId.replicaId;
  if (aId.counter !== bId.counter) return aId.counter - bId.counter;

  const offsetCmp = a.insertionOffset - b.insertionOffset;
  if (offsetCmp !== 0) return offsetCmp;

  return a.locator.levels.length - b.locator.levels.length;
}

// ---------------------------------------------------------------------------
// JIT compilation
// ---------------------------------------------------------------------------

/** Whether `new Function()` is available in this environment. */
let jitAvailable: boolean | undefined;

function canJIT(): boolean {
  if (jitAvailable !== undefined) return jitAvailable;
  try {
    const probe = new Function("return 42");
    jitAvailable = probe() === 42;
  } catch {
    jitAvailable = false;
  }
  return jitAvailable;
}

/**
 * Generate the body of an unrolled locator comparator for a given max depth.
 *
 * The generated function accesses `a.levels` and `b.levels` directly by index,
 * with explicit length checks to handle variable-depth locators.
 */
function generateLocatorCompareBody(maxDepth: number): string {
  const lines: string[] = [];
  lines.push("var al = a.levels, bl = b.levels;");
  lines.push("var aLen = al.length, bLen = bl.length;");
  lines.push("var d;");

  for (let i = 0; i < maxDepth; i++) {
    lines.push(`if (aLen <= ${i} || bLen <= ${i}) return aLen - bLen;`);
    lines.push(`d = al[${i}] - bl[${i}]; if (d !== 0) return d;`);
  }

  // Fallback loop for locators deeper than maxDepth
  lines.push("var minLen = aLen < bLen ? aLen : bLen;");
  lines.push(`for (var i = ${maxDepth}; i < minLen; i++) {`);
  lines.push("  d = al[i] - bl[i]; if (d !== 0) return d;");
  lines.push("}");
  lines.push("return aLen - bLen;");
  return lines.join("\n");
}

/**
 * Generate the body of a JIT-compiled fragment comparator.
 * Inlines the locator comparison to avoid an extra function call.
 */
function generateFragmentCompareBody(maxDepth: number): string {
  // Wrap the unrolled locator comparison in a do-while(false) so `break` works
  const lines = [
    "do {",
    "  var al = a.locator.levels, bl = b.locator.levels;",
    "  var aLen = al.length, bLen = bl.length;",
    "  var minLen = aLen < bLen ? aLen : bLen;",
    "  var d;",
  ];

  for (let i = 0; i < maxDepth; i++) {
    lines.push(`  if (${i} >= minLen) { d = aLen - bLen; if (d !== 0) return d; break; }`);
    lines.push(`  d = al[${i}] - bl[${i}]; if (d !== 0) return d;`);
  }

  // Fallback loop for locators deeper than maxDepth
  lines.push(`  for (var i = ${maxDepth}; i < minLen; i++) {`);
  lines.push("    d = al[i] - bl[i]; if (d !== 0) return d;");
  lines.push("  }");
  lines.push("  d = aLen - bLen; if (d !== 0) return d;");
  lines.push("} while (false);");

  // Operation ID comparison
  lines.push("var aId = a.insertionId, bId = b.insertionId;");
  lines.push("if (aId.replicaId !== bId.replicaId) return aId.replicaId - bId.replicaId;");
  lines.push("if (aId.counter !== bId.counter) return aId.counter - bId.counter;");

  // Insertion offset
  lines.push("d = a.insertionOffset - b.insertionOffset;");
  lines.push("if (d !== 0) return d;");

  // Final tie-break: locator depth
  lines.push("return a.locator.levels.length - b.locator.levels.length;");

  return lines.join("\n");
}

/**
 * Create a JIT-compiled locator comparator optimized for locators up to
 * `maxDepth` levels deep. Falls back to the generic comparator if JIT
 * is unavailable.
 *
 * @param maxDepth - Maximum expected locator depth. Locators deeper than
 *   this are still compared correctly (via length tie-break), but won't
 *   benefit from unrolling.
 */
export function createLocatorComparator(maxDepth = 8): LocatorCompareFn {
  if (!canJIT()) return compareLocatorsGeneric;

  const body = generateLocatorCompareBody(maxDepth);
  const fn = new Function("a", "b", body) as LocatorCompareFn;

  // Add sourceURL for better stack traces
  try {
    const bodyWithSourceURL = `${body}\n//# sourceURL=crdt-jit-locator-compare-d${maxDepth}.js`;
    return new Function("a", "b", bodyWithSourceURL) as LocatorCompareFn;
  } catch {
    return fn;
  }
}

/**
 * Create a JIT-compiled fragment comparator with the locator comparison
 * inlined (no function-call overhead for the locator part).
 *
 * @param maxDepth - Maximum expected locator depth for unrolling.
 */
export function createFragmentComparator(maxDepth = 8): FragmentCompareFn {
  if (!canJIT()) return compareFragmentsGeneric;

  const body = generateFragmentCompareBody(maxDepth);
  try {
    const bodyWithSourceURL = `${body}\n//# sourceURL=crdt-jit-fragment-compare-d${maxDepth}.js`;
    return new Function("a", "b", bodyWithSourceURL) as FragmentCompareFn;
  } catch {
    return compareFragmentsGeneric;
  }
}

// ---------------------------------------------------------------------------
// Pre-built comparators for common depths
// ---------------------------------------------------------------------------

/** JIT-compiled locator comparator for depth <= 8 (covers most documents). */
export const jitCompareLocators: LocatorCompareFn = createLocatorComparator(8);

/** JIT-compiled locator comparator for deep documents (depth <= 16). */
export const jitCompareLocatorsDeep: LocatorCompareFn = createLocatorComparator(16);

/** JIT-compiled fragment comparator for depth <= 8. */
export const jitCompareFragments: FragmentCompareFn = createFragmentComparator(8);
