/**
 * Benchmark: Float64 sort key encoding for Locator comparison.
 *
 * Measures the speedup from using precomputed Float64 sort keys vs
 * full level-by-level comparison. Tests both comparison and sorting
 * workloads across different locator depths and distributions.
 *
 * The "baseline" uses plain Locator objects without sortKey.
 * The "optimized" uses createLocator which precomputes the sortKey.
 */

import { bench, group, run, summary } from "mitata";
import { compareLocators, createLocator, locatorBetween } from "../src/text/locator.js";
import type { Locator } from "../src/text/types.js";

// ---------------------------------------------------------------------------
// Test data generation
// ---------------------------------------------------------------------------

/**
 * Exact level-by-level comparison (baseline without sort key fast path).
 * This is a copy of the original compareLocators before the optimization.
 */
function compareLocatorsBaseline(a: Locator, b: Locator): number {
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

/** Generate N sequential locators using locatorBetween (realistic distribution). */
function generateSequentialLocators(n: number): Locator[] {
  const locators: Locator[] = [];
  const min: Locator = { levels: [0] };
  const max: Locator = { levels: [Number.MAX_SAFE_INTEGER] };

  let prev = locatorBetween(min, max);
  locators.push(prev);

  for (let i = 1; i < n; i++) {
    const next = locatorBetween(prev, max);
    locators.push(next);
    prev = next;
  }
  return locators;
}

/** Generate N random locators with varying depths (1-3 levels). */
function generateMixedDepthLocators(n: number): Locator[] {
  const locators: Locator[] = [];
  for (let i = 0; i < n; i++) {
    const depth = 1 + Math.floor(Math.random() * 3);
    const levels: number[] = [];
    for (let d = 0; d < depth; d++) {
      if (d === 0) {
        levels.push(Math.floor(Math.random() * 65535));
      } else {
        levels.push(Math.floor(Math.random() * 100000));
      }
    }
    locators.push(createLocator(levels));
  }
  return locators;
}

/** Strip sort keys from locators to create baseline versions. */
function stripSortKeys(locators: Locator[]): Locator[] {
  return locators.map((l) => ({ levels: l.levels }));
}

// ---------------------------------------------------------------------------
// Benchmarks
// ---------------------------------------------------------------------------

const N = 10_000;

// Sequential locators (from locatorBetween — already have sort keys)
const sequentialWithKeys = generateSequentialLocators(N);
const sequentialNoKeys = stripSortKeys(sequentialWithKeys);

// Mixed depth locators
const mixedWithKeys = generateMixedDepthLocators(N);
const mixedNoKeys = stripSortKeys(mixedWithKeys);

// Comparison benchmarks: 10K adjacent pair comparisons
summary(() => {
  group("Compare 10K adjacent pairs (sequential locators)", () => {
    bench("baseline (no sort key)", () => {
      let sum = 0;
      for (let i = 0; i < N - 1; i++) {
        const a = sequentialNoKeys[i];
        const b = sequentialNoKeys[i + 1];
        if (a !== undefined && b !== undefined) {
          sum += compareLocatorsBaseline(a, b);
        }
      }
      return sum;
    });

    bench("optimized (Float64 sort key)", () => {
      let sum = 0;
      for (let i = 0; i < N - 1; i++) {
        const a = sequentialWithKeys[i];
        const b = sequentialWithKeys[i + 1];
        if (a !== undefined && b !== undefined) {
          sum += compareLocators(a, b);
        }
      }
      return sum;
    });
  });
});

summary(() => {
  group("Compare 10K adjacent pairs (mixed depth locators)", () => {
    bench("baseline (no sort key)", () => {
      let sum = 0;
      for (let i = 0; i < N - 1; i++) {
        const a = mixedNoKeys[i];
        const b = mixedNoKeys[i + 1];
        if (a !== undefined && b !== undefined) {
          sum += compareLocatorsBaseline(a, b);
        }
      }
      return sum;
    });

    bench("optimized (Float64 sort key)", () => {
      let sum = 0;
      for (let i = 0; i < N - 1; i++) {
        const a = mixedWithKeys[i];
        const b = mixedWithKeys[i + 1];
        if (a !== undefined && b !== undefined) {
          sum += compareLocators(a, b);
        }
      }
      return sum;
    });
  });
});

// Sorting benchmarks
summary(() => {
  group("Sort 10K locators (sequential)", () => {
    bench("baseline (no sort key)", () => {
      const arr = [...sequentialNoKeys];
      arr.sort(compareLocatorsBaseline);
    });

    bench("optimized (Float64 sort key)", () => {
      const arr = [...sequentialWithKeys];
      arr.sort(compareLocators);
    });
  });
});

summary(() => {
  group("Sort 10K locators (shuffled mixed depth)", () => {
    const shuffledWithKeys = [...mixedWithKeys].sort(() => Math.random() - 0.5);
    const shuffledNoKeys = [...mixedNoKeys].sort(() => Math.random() - 0.5);

    bench("baseline (no sort key)", () => {
      const arr = [...shuffledNoKeys];
      arr.sort(compareLocatorsBaseline);
    });

    bench("optimized (Float64 sort key)", () => {
      const arr = [...shuffledWithKeys];
      arr.sort(compareLocators);
    });
  });
});

await run();
