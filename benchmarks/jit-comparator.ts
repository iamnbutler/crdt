/**
 * Benchmark: JIT-compiled vs generic Locator/Fragment comparators.
 *
 * Tests the hypothesis from issue #114 that `new Function()`-generated
 * comparators with unrolled loops outperform the generic loop-based version.
 *
 * Run: bun run benchmarks/jit-comparator.ts
 */

import { bench, group, run, summary } from "mitata";
import {
  compareFragmentsGeneric,
  compareLocatorsGeneric,
  createFragmentComparator,
  createLocatorComparator,
  jitCompareFragments,
  jitCompareLocators,
} from "../src/text/jit-comparator.js";
import { compareLocators } from "../src/text/locator.js";
import { replicaId } from "../src/text/types.js";
import type { Fragment, FragmentSummary, Locator, OperationId } from "../src/text/types.js";

// ---------------------------------------------------------------------------
// Data generation
// ---------------------------------------------------------------------------

function randomLocator(maxDepth: number): Locator {
  const depth = 1 + Math.floor(Math.random() * maxDepth);
  const levels: number[] = [];
  for (let i = 0; i < depth; i++) {
    levels.push(Math.floor(Math.random() * 1_000_000));
  }
  return { levels };
}

function randomOpId(): OperationId {
  return {
    replicaId: replicaId(Math.floor(Math.random() * 10)),
    counter: Math.floor(Math.random() * 100_000),
  };
}

function randomFragment(maxDepth: number): Fragment {
  const locator = randomLocator(maxDepth);
  const insertionId = randomOpId();
  return {
    locator,
    baseLocator: locator,
    insertionId,
    insertionOffset: Math.floor(Math.random() * 100),
    length: 1,
    visible: true,
    deletions: [],
    text: "x",
    summary(): FragmentSummary {
      return {
        visibleLen: 1,
        visibleLines: 0,
        deletedLen: 0,
        deletedLines: 0,
        maxInsertionId: insertionId,
        maxLocator: locator,
        itemCount: 1,
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Datasets
// ---------------------------------------------------------------------------

const PAIR_COUNT = 10_000;
const SORT_SIZE = 1_000;

// Locator pairs at different depths
const shallowPairs: Array<[Locator, Locator]> = [];
const mediumPairs: Array<[Locator, Locator]> = [];
const deepPairs: Array<[Locator, Locator]> = [];

for (let i = 0; i < PAIR_COUNT; i++) {
  shallowPairs.push([randomLocator(2), randomLocator(2)]);
  mediumPairs.push([randomLocator(5), randomLocator(5)]);
  deepPairs.push([randomLocator(12), randomLocator(12)]);
}

// Fragment arrays for sort benchmarks
function makeFragmentArray(size: number, maxDepth: number): Fragment[] {
  const arr: Fragment[] = [];
  for (let i = 0; i < size; i++) {
    arr.push(randomFragment(maxDepth));
  }
  return arr;
}

const fragmentsShallow = makeFragmentArray(SORT_SIZE, 3);
const fragmentsMedium = makeFragmentArray(SORT_SIZE, 6);
const fragmentsDeep = makeFragmentArray(SORT_SIZE, 12);

// ---------------------------------------------------------------------------
// Benchmarks
// ---------------------------------------------------------------------------

const jitD4 = createLocatorComparator(4);
const jitD16 = createLocatorComparator(16);
const jitFragD16 = createFragmentComparator(16);

summary(() => {
  group("Locator compare: shallow (depth 1-2)", () => {
    bench("original compareLocators", () => {
      let sum = 0;
      for (let i = 0; i < PAIR_COUNT; i++) {
        const [a, b] = shallowPairs[i] as [Locator, Locator];
        sum += compareLocators(a, b);
      }
      return sum;
    });

    bench("generic (optimized baseline)", () => {
      let sum = 0;
      for (let i = 0; i < PAIR_COUNT; i++) {
        const [a, b] = shallowPairs[i] as [Locator, Locator];
        sum += compareLocatorsGeneric(a, b);
      }
      return sum;
    });

    bench("JIT depth=4", () => {
      let sum = 0;
      for (let i = 0; i < PAIR_COUNT; i++) {
        const [a, b] = shallowPairs[i] as [Locator, Locator];
        sum += jitD4(a, b);
      }
      return sum;
    });

    bench("JIT depth=8 (default)", () => {
      let sum = 0;
      for (let i = 0; i < PAIR_COUNT; i++) {
        const [a, b] = shallowPairs[i] as [Locator, Locator];
        sum += jitCompareLocators(a, b);
      }
      return sum;
    });
  });

  group("Locator compare: medium (depth 1-5)", () => {
    bench("original compareLocators", () => {
      let sum = 0;
      for (let i = 0; i < PAIR_COUNT; i++) {
        const [a, b] = mediumPairs[i] as [Locator, Locator];
        sum += compareLocators(a, b);
      }
      return sum;
    });

    bench("generic (optimized baseline)", () => {
      let sum = 0;
      for (let i = 0; i < PAIR_COUNT; i++) {
        const [a, b] = mediumPairs[i] as [Locator, Locator];
        sum += compareLocatorsGeneric(a, b);
      }
      return sum;
    });

    bench("JIT depth=8 (default)", () => {
      let sum = 0;
      for (let i = 0; i < PAIR_COUNT; i++) {
        const [a, b] = mediumPairs[i] as [Locator, Locator];
        sum += jitCompareLocators(a, b);
      }
      return sum;
    });
  });

  group("Locator compare: deep (depth 1-12)", () => {
    bench("original compareLocators", () => {
      let sum = 0;
      for (let i = 0; i < PAIR_COUNT; i++) {
        const [a, b] = deepPairs[i] as [Locator, Locator];
        sum += compareLocators(a, b);
      }
      return sum;
    });

    bench("generic (optimized baseline)", () => {
      let sum = 0;
      for (let i = 0; i < PAIR_COUNT; i++) {
        const [a, b] = deepPairs[i] as [Locator, Locator];
        sum += compareLocatorsGeneric(a, b);
      }
      return sum;
    });

    bench("JIT depth=8 (default)", () => {
      let sum = 0;
      for (let i = 0; i < PAIR_COUNT; i++) {
        const [a, b] = deepPairs[i] as [Locator, Locator];
        sum += jitCompareLocators(a, b);
      }
      return sum;
    });

    bench("JIT depth=16", () => {
      let sum = 0;
      for (let i = 0; i < PAIR_COUNT; i++) {
        const [a, b] = deepPairs[i] as [Locator, Locator];
        sum += jitD16(a, b);
      }
      return sum;
    });
  });

  group(`Fragment sort: ${SORT_SIZE} items, shallow locators`, () => {
    bench("Array.sort + generic comparator", () => {
      const arr = [...fragmentsShallow];
      arr.sort(compareFragmentsGeneric);
      return arr[0];
    });

    bench("Array.sort + JIT comparator (d8)", () => {
      const arr = [...fragmentsShallow];
      arr.sort(jitCompareFragments);
      return arr[0];
    });
  });

  group(`Fragment sort: ${SORT_SIZE} items, medium locators`, () => {
    bench("Array.sort + generic comparator", () => {
      const arr = [...fragmentsMedium];
      arr.sort(compareFragmentsGeneric);
      return arr[0];
    });

    bench("Array.sort + JIT comparator (d8)", () => {
      const arr = [...fragmentsMedium];
      arr.sort(jitCompareFragments);
      return arr[0];
    });
  });

  group(`Fragment sort: ${SORT_SIZE} items, deep locators`, () => {
    bench("Array.sort + generic comparator", () => {
      const arr = [...fragmentsDeep];
      arr.sort(compareFragmentsGeneric);
      return arr[0];
    });

    bench("Array.sort + JIT comparator (d8)", () => {
      const arr = [...fragmentsDeep];
      arr.sort(jitCompareFragments);
      return arr[0];
    });

    bench("Array.sort + JIT comparator (d16)", () => {
      const arr = [...fragmentsDeep];
      arr.sort(jitFragD16);
      return arr[0];
    });
  });
});

run();
