/**
 * Benchmarks comparing persistent (COW) vs mutable SumTree operations.
 *
 * Measures:
 * - Path-copy insert vs mutable insert
 * - Branching (O(1) fork) cost
 * - Version handle creation/release overhead
 * - Structural sharing memory efficiency
 * - Sequential version chain throughput
 */

import { bench, group, run } from "mitata";
import {
  type CountSummary,
  SumTree,
  type Summarizable,
  countSummaryOps,
} from "../src/sum-tree/index.js";
import { PersistentTree } from "../src/sum-tree/persistent.js";

class CountItem implements Summarizable<CountSummary> {
  constructor(public value: number) {}
  summary(): CountSummary {
    return { count: 1 };
  }
}

const isCI = process.argv.includes("--ci");

// Tree sizes
const SMALL = 1_000;
const MEDIUM = 10_000;
const LARGE = 100_000;

// Pre-build trees
console.log("Building test trees for persistent benchmarks...");

function buildSumTree(size: number): SumTree<CountItem, CountSummary> {
  const items = Array.from({ length: size }, (_, i) => new CountItem(i));
  return SumTree.fromItems(items, countSummaryOps, 16);
}

function buildPersistentTree(size: number): PersistentTree<CountItem, CountSummary> {
  const pt = new PersistentTree<CountItem, CountSummary>(countSummaryOps);
  const items = Array.from({ length: size }, (_, i) => new CountItem(i));
  const tree = SumTree.fromItems(items, countSummaryOps, 16);
  pt.advanceTo(tree, "initial-bulk");
  return pt;
}

const sumTreeSmall = buildSumTree(SMALL);
const sumTreeMedium = buildSumTree(MEDIUM);
const sumTreeLarge = buildSumTree(LARGE);

const ptSmall = buildPersistentTree(SMALL);
const ptMedium = buildPersistentTree(MEDIUM);
const ptLarge = buildPersistentTree(LARGE);

console.log("Trees built. Starting persistent benchmarks...\n");

// ---------------------------------------------------------------------------
// Compare: immutable insert (path copy) vs mutable insert
// ---------------------------------------------------------------------------

group("persistent-vs-mutable-insert", () => {
  bench("immutable insertAt middle (1K)", () => {
    return sumTreeSmall.insertAt(500, new CountItem(999));
  });

  bench("mutable insertAtMut middle (1K)", () => {
    // Clone first to avoid accumulating items
    const tree = buildSumTree(SMALL);
    tree.insertAtMut(500, new CountItem(999));
    return tree;
  });

  bench("immutable insertAt middle (10K)", () => {
    return sumTreeMedium.insertAt(5000, new CountItem(999));
  });

  bench("immutable insertAt middle (100K)", () => {
    return sumTreeLarge.insertAt(50000, new CountItem(999));
  });
});

// ---------------------------------------------------------------------------
// PersistentTree: version creation throughput
// ---------------------------------------------------------------------------

group("persistent-version-creation", () => {
  bench("PersistentTree.push (1K base)", () => {
    // Measure cost of creating a new version via push
    const pt = buildPersistentTree(SMALL);
    pt.push(new CountItem(999));
    return pt;
  });

  bench("PersistentTree.push (10K base)", () => {
    const pt = buildPersistentTree(MEDIUM);
    pt.push(new CountItem(999));
    return pt;
  });

  bench("PersistentTree.insertAt middle (10K base)", () => {
    const pt = buildPersistentTree(MEDIUM);
    pt.insertAt(5000, new CountItem(999));
    return pt;
  });
});

// ---------------------------------------------------------------------------
// Branching cost (O(1) fork)
// ---------------------------------------------------------------------------

group("branching", () => {
  bench("branch from 1K tree", () => {
    return ptSmall.branch();
  });

  bench("branch from 10K tree", () => {
    return ptMedium.branch();
  });

  bench("branch from 100K tree", () => {
    return ptLarge.branch();
  });

  bench("createHandle (1K tree)", () => {
    const h = ptSmall.createHandle();
    h.release();
    return h;
  });

  bench("createHandle (100K tree)", () => {
    const h = ptLarge.createHandle();
    h.release();
    return h;
  });
});

// ---------------------------------------------------------------------------
// Sequential version chain: create many versions and verify sharing
// ---------------------------------------------------------------------------

group("version-chain", () => {
  bench("100 sequential inserts with version tracking", () => {
    const pt = new PersistentTree<CountItem, CountSummary>(countSummaryOps);
    for (let i = 0; i < 100; i++) {
      pt.push(new CountItem(i));
    }
    return pt.tree.length();
  });

  bench("100 sequential inserts raw SumTree (baseline)", () => {
    let tree = new SumTree<CountItem, CountSummary>(countSummaryOps);
    for (let i = 0; i < 100; i++) {
      tree = tree.push(new CountItem(i));
    }
    return tree.length();
  });

  bench("100 sequential mutable inserts (baseline)", () => {
    const tree = new SumTree<CountItem, CountSummary>(countSummaryOps);
    for (let i = 0; i < 100; i++) {
      tree.pushMut(new CountItem(i));
    }
    return tree.length();
  });
});

// ---------------------------------------------------------------------------
// Time travel / rewind cost
// ---------------------------------------------------------------------------

group("time-travel", () => {
  // Build a tree with version history
  const ptTimeTravel = new PersistentTree<CountItem, CountSummary>(countSummaryOps);
  for (let i = 0; i < 100; i++) {
    ptTimeTravel.push(new CountItem(i));
  }
  const earlyVersion = ptTimeTravel.history()[50]; // version ~50 steps back

  bench("rewindTo (O(1) pointer swap)", () => {
    if (earlyVersion !== undefined) {
      ptTimeTravel.rewindTo(earlyVersion);
      // rewind back to latest for next iteration
      const latest = ptTimeTravel.history()[0];
      if (latest !== undefined && latest !== earlyVersion) {
        ptTimeTravel.rewindTo(latest);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Structural sharing measurement (not a bench, but prints stats)
// ---------------------------------------------------------------------------

console.log("\n--- Structural Sharing Analysis ---");

function measureSharing(treeSize: number, numVersions: number): void {
  const pt = new PersistentTree<CountItem, CountSummary>(countSummaryOps);
  const items = Array.from({ length: treeSize }, (_, i) => new CountItem(i));
  const baseTree = SumTree.fromItems(items, countSummaryOps, 16);
  pt.advanceTo(baseTree, "base");

  const handles = [];
  for (let i = 0; i < numVersions; i++) {
    handles.push(pt.createHandle(`v${i}`));
    pt.push(new CountItem(treeSize + i));
  }

  const stats = pt.stats();
  const naiveNodes = treeSize * numVersions;
  const sharingRatio = 1 - stats.arenaAllocated / naiveNodes;

  console.log(
    `  ${treeSize} items, ${numVersions} versions: ` +
      `${stats.arenaAllocated} arena nodes ` +
      `(vs ${naiveNodes} naive, ${(sharingRatio * 100).toFixed(1)}% sharing)`,
  );

  for (const h of handles) {
    h.release();
  }
}

measureSharing(1_000, 10);
measureSharing(1_000, 100);
measureSharing(10_000, 10);
measureSharing(10_000, 100);
if (!isCI) {
  measureSharing(100_000, 10);
  measureSharing(100_000, 100);
}

console.log("");

// Run benchmarks
await run({
  format: isCI ? "json" : "mitata",
});
