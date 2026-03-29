/**
 * Benchmarks comparing SkipList vs SumTree.
 *
 * Tests the core hypothesis from issue #116:
 * - Random insertion: ~same as SumTree
 * - Sequential insertion (typing): O(1) amortized with finger search
 * - Range queries (iteration): faster due to cache locality
 */

import { bench, group, run } from "mitata";
import {
  type CountSummary,
  SumTree,
  type Summarizable,
  countDimension,
  countSummaryOps,
} from "../src/sum-tree/index.js";
import { SkipList } from "../src/skip-list/index.js";

// Simple item for benchmarks
class CountItem implements Summarizable<CountSummary> {
  constructor(public value: number) {}

  summary(): CountSummary {
    return { count: 1 };
  }
}

function compareCountItems(a: CountItem, b: CountItem): number {
  return a.value - b.value;
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

const isCI = process.argv.includes("--ci");

const SMALL = 1_000;
const MEDIUM = 10_000;
const LARGE = 100_000;

function createSumTree(size: number): SumTree<CountItem, CountSummary> {
  const items = Array.from({ length: size }, (_, i) => new CountItem(i));
  return SumTree.fromItems(items, countSummaryOps, 16);
}

function createSkipList(size: number): SkipList<CountItem, CountSummary> {
  const items = Array.from({ length: size }, (_, i) => new CountItem(i));
  return SkipList.fromSortedItems(items, countSummaryOps);
}

console.log("Creating test data structures...");

const sumTreeSmall = createSumTree(SMALL);
const sumTreeMedium = createSumTree(MEDIUM);
const sumTreeLarge = createSumTree(LARGE);

const skipListSmall = createSkipList(SMALL);
const skipListMedium = createSkipList(MEDIUM);
const skipListLarge = createSkipList(LARGE);

console.log("Data structures created. Starting benchmarks...\n");

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

group("construction - fromItems/fromSorted", () => {
  bench("SumTree 1K", () => {
    const items = Array.from({ length: SMALL }, (_, i) => new CountItem(i));
    return SumTree.fromItems(items, countSummaryOps, 16);
  });

  bench("SkipList 1K", () => {
    const items = Array.from({ length: SMALL }, (_, i) => new CountItem(i));
    return SkipList.fromSortedItems(items, countSummaryOps);
  });

  bench("SumTree 10K", () => {
    const items = Array.from({ length: MEDIUM }, (_, i) => new CountItem(i));
    return SumTree.fromItems(items, countSummaryOps, 16);
  });

  bench("SkipList 10K", () => {
    const items = Array.from({ length: MEDIUM }, (_, i) => new CountItem(i));
    return SkipList.fromSortedItems(items, countSummaryOps);
  });

  if (!isCI) {
    bench("SumTree 100K", () => {
      const items = Array.from({ length: LARGE }, (_, i) => new CountItem(i));
      return SumTree.fromItems(items, countSummaryOps, 16);
    });

    bench("SkipList 100K", () => {
      const items = Array.from({ length: LARGE }, (_, i) => new CountItem(i));
      return SkipList.fromSortedItems(items, countSummaryOps);
    });
  }
});

// ---------------------------------------------------------------------------
// Sequential insertion (the key CRDT workload: simulates typing)
// ---------------------------------------------------------------------------

group("sequential insert (typing simulation)", () => {
  bench("SumTree pushMut 1K", () => {
    const tree = new SumTree<CountItem, CountSummary>(countSummaryOps);
    for (let i = 0; i < SMALL; i++) {
      tree.pushMut(new CountItem(i));
    }
    return tree;
  });

  bench("SkipList pushBack 1K", () => {
    const list = new SkipList<CountItem, CountSummary>(countSummaryOps);
    for (let i = 0; i < SMALL; i++) {
      list.pushBack(new CountItem(i));
    }
    return list;
  });

  bench("SkipList finger insert 1K", () => {
    const list = new SkipList<CountItem, CountSummary>(countSummaryOps);
    for (let i = 0; i < SMALL; i++) {
      list.insertNearFinger(new CountItem(i), compareCountItems);
    }
    return list;
  });

  bench("SumTree pushMut 10K", () => {
    const tree = new SumTree<CountItem, CountSummary>(countSummaryOps);
    for (let i = 0; i < MEDIUM; i++) {
      tree.pushMut(new CountItem(i));
    }
    return tree;
  });

  bench("SkipList pushBack 10K", () => {
    const list = new SkipList<CountItem, CountSummary>(countSummaryOps);
    for (let i = 0; i < MEDIUM; i++) {
      list.pushBack(new CountItem(i));
    }
    return list;
  });

  bench("SkipList finger insert 10K", () => {
    const list = new SkipList<CountItem, CountSummary>(countSummaryOps);
    for (let i = 0; i < MEDIUM; i++) {
      list.insertNearFinger(new CountItem(i), compareCountItems);
    }
    return list;
  });
});

// ---------------------------------------------------------------------------
// Random insertion (general CRDT workload)
// ---------------------------------------------------------------------------

group("random ordered insert", () => {
  // Pre-generate random sequences for fair comparison
  const randomSmall = Array.from({ length: SMALL }, () => Math.floor(Math.random() * 1_000_000));
  const randomMedium = Array.from({ length: MEDIUM }, () =>
    Math.floor(Math.random() * 1_000_000),
  );

  bench("SumTree random insert 1K", () => {
    const tree = new SumTree<CountItem, CountSummary>(countSummaryOps);
    for (let i = 0; i < SMALL; i++) {
      tree.pushMut(new CountItem(randomSmall[i] ?? 0));
    }
    return tree;
  });

  bench("SkipList random insert 1K", () => {
    const list = new SkipList<CountItem, CountSummary>(countSummaryOps);
    for (let i = 0; i < SMALL; i++) {
      list.insertOrdered(new CountItem(randomSmall[i] ?? 0), compareCountItems);
    }
    return list;
  });

  bench("SumTree random insert 10K", () => {
    const tree = new SumTree<CountItem, CountSummary>(countSummaryOps);
    for (let i = 0; i < MEDIUM; i++) {
      tree.pushMut(new CountItem(randomMedium[i] ?? 0));
    }
    return tree;
  });

  bench("SkipList random insert 10K", () => {
    const list = new SkipList<CountItem, CountSummary>(countSummaryOps);
    for (let i = 0; i < MEDIUM; i++) {
      list.insertOrdered(new CountItem(randomMedium[i] ?? 0), compareCountItems);
    }
    return list;
  });
});

// ---------------------------------------------------------------------------
// Seek (finding position by index)
// ---------------------------------------------------------------------------

group("seek by count dimension", () => {
  bench("SumTree seek 1K", () => {
    const cursor = sumTreeSmall.cursor(countDimension);
    cursor.seekForward(500, "right");
    return cursor.item();
  });

  bench("SkipList seek 1K", () => {
    const cursor = skipListSmall.cursor(countDimension);
    cursor.reset();
    cursor.seekForward(500);
    return cursor.item();
  });

  bench("SumTree seek 10K", () => {
    const cursor = sumTreeMedium.cursor(countDimension);
    cursor.seekForward(5000, "right");
    return cursor.item();
  });

  bench("SkipList seek 10K", () => {
    const cursor = skipListMedium.cursor(countDimension);
    cursor.reset();
    cursor.seekForward(5000);
    return cursor.item();
  });

  bench("SumTree seek 100K", () => {
    const cursor = sumTreeLarge.cursor(countDimension);
    cursor.seekForward(50000, "right");
    return cursor.item();
  });

  bench("SkipList seek 100K", () => {
    const cursor = skipListLarge.cursor(countDimension);
    cursor.reset();
    cursor.seekForward(50000);
    return cursor.item();
  });
});

// ---------------------------------------------------------------------------
// Iteration (full scan - tests cache locality)
// ---------------------------------------------------------------------------

group("full iteration", () => {
  bench("SumTree iterate 1K", () => {
    let sum = 0;
    sumTreeSmall.forEach((item) => {
      sum += item.value;
    });
    return sum;
  });

  bench("SkipList iterate 1K", () => {
    let sum = 0;
    skipListSmall.forEach((item) => {
      sum += item.value;
    });
    return sum;
  });

  bench("SumTree iterate 10K", () => {
    let sum = 0;
    sumTreeMedium.forEach((item) => {
      sum += item.value;
    });
    return sum;
  });

  bench("SkipList iterate 10K", () => {
    let sum = 0;
    skipListMedium.forEach((item) => {
      sum += item.value;
    });
    return sum;
  });

  bench("SumTree iterate 100K", () => {
    let sum = 0;
    sumTreeLarge.forEach((item) => {
      sum += item.value;
    });
    return sum;
  });

  bench("SkipList iterate 100K", () => {
    let sum = 0;
    skipListLarge.forEach((item) => {
      sum += item.value;
    });
    return sum;
  });
});

// ---------------------------------------------------------------------------
// Summary query
// ---------------------------------------------------------------------------

group("total summary", () => {
  bench("SumTree summary 1K", () => sumTreeSmall.summary());
  bench("SkipList summary 1K", () => skipListSmall.summary());
  bench("SumTree summary 10K", () => sumTreeMedium.summary());
  bench("SkipList summary 10K", () => skipListMedium.summary());
  bench("SumTree summary 100K", () => sumTreeLarge.summary());
  bench("SkipList summary 100K", () => skipListLarge.summary());
});

await run();
