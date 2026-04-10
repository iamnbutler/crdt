/**
 * Locator Microbenchmarks
 *
 * Benchmarks for compareLocators and locatorBetween — hot paths in the CRDT
 * that are called during every insert, sort, and conflict resolution.
 *
 * Run: bun run bench:locator
 *
 * Reference: compareLocators is called O(k log n) times per fragment sort
 * and O(log n) times per tree seek, where k is fragment count.
 *
 * These benchmarks exist to validate the impact of Locator-related
 * optimizations (e.g., removing redundant undefined checks in compareLocators,
 * or caching depth-1 comparison paths).
 */

import { bench, group, run } from "mitata";
import {
  MAX_LOCATOR,
  MIN_LOCATOR,
  compareLocators,
  locatorBetween,
} from "../src/text/index.js";
import type { Locator } from "../src/text/index.js";

const isCI = process.argv.includes("--ci");

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

// The first level of a Locator is right-shifted by 37 bits.
// MAX_SAFE_INTEGER >> 37 = ~65535, so first-level values are ~0-65535.
const FIRST_LEVEL_MAX = Math.floor(Number.MAX_SAFE_INTEGER / 2 ** 37);

/** Depth-1 locators spread across the first-level range (typical new inserts). */
function makeDepth1(n: number): Locator[] {
  return Array.from({ length: n }, (_, i) => ({
    levels: [1 + Math.floor((i * FIRST_LEVEL_MAX) / n)],
  }));
}

/**
 * Depth-3 locators (parent locator + 2 split levels).
 * Realistic after a round of editing with splits.
 */
function makeDepth3(n: number): Locator[] {
  return Array.from({ length: n }, (_, i) => ({
    levels: [
      1 + Math.floor((i * FIRST_LEVEL_MAX) / n),
      2 * (i % 80), // split level 1
      2 * (i % 20), // split level 2
    ],
  }));
}

/** Deterministic Fisher-Yates shuffle (LCG seed) to produce unsorted arrays. */
function lcgShuffle<T>(arr: ReadonlyArray<T>, seed: number): T[] {
  const out = arr.slice();
  let s = seed | 0;
  for (let i = out.length - 1; i > 0; i--) {
    s = Math.imul(s, 1664525) + 1013904223;
    const j = (s >>> 0) % (i + 1);
    const tmp = out[i] as T;
    out[i] = out[j] as T;
    out[j] = tmp;
  }
  return out;
}

const D1_1K = makeDepth1(1000);
const D3_500 = makeDepth3(500);

// Pre-built shuffled arrays for sort benchmarks — cycling through 4 variants
// prevents mitata from measuring a mostly-sorted array after the first iteration.
const VARIANTS = 4;
const d1_100_variants = Array.from({ length: VARIANTS }, (_, i) =>
  lcgShuffle(D1_1K.slice(0, 100), i + 1),
);
const d3_100_variants = Array.from({ length: VARIANTS }, (_, i) =>
  lcgShuffle(D3_500.slice(0, 100), i + 1),
);
const d1_1000_variants = Array.from({ length: VARIANTS }, (_, i) =>
  lcgShuffle(D1_1K, i + 1),
);

// Pre-extract specific elements to avoid undefined handling in bench callbacks
const d1_equal_a: Locator = D1_1K[500] ?? MIN_LOCATOR;
const d1_equal_b: Locator = D1_1K[500] ?? MIN_LOCATOR;
const d1_diff_a: Locator = D1_1K[300] ?? MIN_LOCATOR;
const d1_diff_b: Locator = D1_1K[700] ?? MIN_LOCATOR;
const d3_equal_a: Locator = D3_500[200] ?? MIN_LOCATOR;
const d3_equal_b: Locator = D3_500[200] ?? MIN_LOCATOR;
const d3_diff_early_a: Locator = D3_500[50] ?? MIN_LOCATOR;
const d3_diff_early_b: Locator = D3_500[450] ?? MIN_LOCATOR;

// Locators for testing specific paths
const depth1_parent: Locator = { levels: [1000] };
const depth2_child: Locator = { levels: [1000, 6] }; // child of depth1_parent
const d3_same_prefix_a: Locator = { levels: [1000, 0, 4] };
const d3_same_prefix_b: Locator = { levels: [1000, 0, 8] };

// ---------------------------------------------------------------------------
// compareLocators benchmarks
// ---------------------------------------------------------------------------

group("locator-compare", () => {
  // Depth-1 equal: loop exits at length check (a.len == b.len, same value)
  bench("depth-1 equal", () => compareLocators(d1_equal_a, d1_equal_b));

  // Depth-1 different: returns at level 0 — the most common case
  bench("depth-1 different", () => compareLocators(d1_diff_a, d1_diff_b));

  // Prefix vs child: a=[1000], b=[1000, 6] — falls through to length diff
  bench("depth-1 vs depth-2 (prefix path)", () => compareLocators(depth1_parent, depth2_child));

  // Depth-3 equal: traverses all 3 levels before length check
  bench("depth-3 equal", () => compareLocators(d3_equal_a, d3_equal_b));

  // Depth-3 different at level 0: exits early (best case for depth-3)
  bench("depth-3 different at level 0", () => compareLocators(d3_diff_early_a, d3_diff_early_b));

  // Depth-3 different at level 2: must traverse all 3 levels (worst case for depth-3)
  bench("depth-3 different at level 2", () =>
    compareLocators(d3_same_prefix_a, d3_same_prefix_b),
  );
});

// ---------------------------------------------------------------------------
// locator-sort benchmarks
//
// Mirrors the sortFragments() calls in applyRemoteInsertDirect and
// applyRemoteDelete when splits occur. Input is always a fresh shuffled copy.
// ---------------------------------------------------------------------------

let sortVariant = 0;

group("locator-sort", () => {
  bench("sort 100 depth-1", () => {
    const arr = (d1_100_variants[sortVariant % VARIANTS] ?? D1_1K.slice(0, 100)).slice();
    arr.sort((a, b) => compareLocators(a, b));
    sortVariant++;
    return arr;
  });

  bench("sort 100 depth-3", () => {
    const arr = (d3_100_variants[sortVariant % VARIANTS] ?? D3_500.slice(0, 100)).slice();
    arr.sort((a, b) => compareLocators(a, b));
    sortVariant++;
    return arr;
  });

  if (!isCI) {
    bench("sort 1000 depth-1", () => {
      const arr = (d1_1000_variants[sortVariant % VARIANTS] ?? D1_1K.slice()).slice();
      arr.sort((a, b) => compareLocators(a, b));
      sortVariant++;
      return arr;
    });
  }
});

// ---------------------------------------------------------------------------
// locatorBetween benchmarks
//
// locatorBetween is called for every insert operation. The most common
// pattern is append (insert at end), which hits the fast depth-1 midpoint.
// ---------------------------------------------------------------------------

group("locator-between", () => {
  // Append: insert after the last item — fast path, returns depth-1
  bench("append (between last and MAX)", () =>
    locatorBetween({ levels: [32000] }, MAX_LOCATOR),
  );

  // Prepend: insert before the first item — fast path, returns depth-1
  bench("prepend (between MIN and first)", () =>
    locatorBetween(MIN_LOCATOR, { levels: [1000] }),
  );

  // Midpoint: ample room at level 0 — fast path, returns depth-1
  bench("midpoint depth-1 (ample space)", () =>
    locatorBetween({ levels: [1000] }, { levels: [50000] }),
  );

  // Adjacent depth-1: no room at level 0, must recurse to depth 2
  bench("adjacent depth-1 (goes deeper)", () =>
    locatorBetween({ levels: [100] }, { levels: [101] }),
  );

  // Between a parent and its child locator
  bench("between parent and child", () =>
    locatorBetween({ levels: [100] }, { levels: [100, 10] }),
  );

  // Depth-3 midpoint: typical post-split editing
  bench("midpoint depth-3", () =>
    locatorBetween({ levels: [1000, 4, 2] }, { levels: [1000, 4, 8] }),
  );

  // Depth-3 adjacent: no room, must go to depth 4
  bench("adjacent depth-3 (goes deeper)", () =>
    locatorBetween({ levels: [1000, 4, 6] }, { levels: [1000, 4, 8] }),
  );
});

await run();
