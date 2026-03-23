/**
 * Arena Allocator Benchmarks
 *
 * Benchmarks:
 * 1. AoS vs SoA layout comparison for tree traversal pattern
 * 2. Allocation throughput (target: millions/sec)
 * 3. Growth cost
 * 4. Mark-sweep GC cost
 */

import { AosArena, type Arena, NULL_NODE, SoaArena } from "../src/arena/index.ts";

// Benchmark configuration
const WARMUP_ITERATIONS = 3;
const BENCHMARK_ITERATIONS = 10;

interface BenchmarkResult {
  name: string;
  mean: number;
  stddev: number;
  min: number;
  max: number;
  opsPerSec?: number;
}

function formatResult(result: BenchmarkResult): string {
  const { name, mean, stddev, min, max, opsPerSec } = result;
  const meanMs = mean.toFixed(3);
  const stddevMs = stddev.toFixed(3);
  const minMs = min.toFixed(3);
  const maxMs = max.toFixed(3);

  let output = `${name}: ${meanMs}ms (±${stddevMs}ms) [${minMs}ms - ${maxMs}ms]`;
  if (opsPerSec !== undefined) {
    if (opsPerSec >= 1_000_000) {
      output += ` | ${(opsPerSec / 1_000_000).toFixed(2)}M ops/sec`;
    } else {
      output += ` | ${(opsPerSec / 1000).toFixed(2)}K ops/sec`;
    }
  }
  return output;
}

function runBenchmark(name: string, fn: () => void, ops?: number): BenchmarkResult {
  // Warmup
  for (let i = 0; i < WARMUP_ITERATIONS; i++) {
    fn();
  }

  // Benchmark
  const times: number[] = [];
  for (let i = 0; i < BENCHMARK_ITERATIONS; i++) {
    const start = performance.now();
    fn();
    times.push(performance.now() - start);
  }

  const mean = times.reduce((a, b) => a + b, 0) / times.length;
  const variance = times.reduce((sum, t) => sum + (t - mean) ** 2, 0) / times.length;
  const stddev = Math.sqrt(variance);
  const min = Math.min(...times);
  const max = Math.max(...times);

  return {
    name,
    mean,
    stddev,
    min,
    max,
    opsPerSec: ops !== undefined ? (ops / mean) * 1000 : undefined,
  };
}

// Build a binary tree in the arena
function buildTree(arena: Arena, depth: number): number {
  const root = arena.allocNode();
  arena.setSum(root, Math.random() * 100);

  const buildSubtree = (parent: number, d: number): void => {
    if (d === 0) {
      return;
    }

    const left = arena.allocNode();
    const right = arena.allocNode();

    arena.setLeft(parent, left);
    arena.setRight(parent, right);
    arena.setParent(left, parent);
    arena.setParent(right, parent);
    arena.setSum(left, Math.random() * 100);
    arena.setSum(right, Math.random() * 100);

    buildSubtree(left, d - 1);
    buildSubtree(right, d - 1);
  };

  buildSubtree(root, depth - 1);
  return root;
}

// Tree descent: walk from root, randomly choosing left/right
function treeDescendBenchmark(arena: Arena, root: number, iterations: number): number {
  let checksum = 0;

  for (let i = 0; i < iterations; i++) {
    let current = root;
    while (current !== NULL_NODE) {
      // Access multiple fields (cache locality test)
      const sum = arena.getSum(current);
      const flags = arena.getFlags(current);
      checksum += sum + flags;

      // Randomly go left or right
      const left = arena.getLeft(current);
      const right = arena.getRight(current);

      if (left === NULL_NODE && right === NULL_NODE) {
        break;
      }

      current = Math.random() < 0.5 ? left : right;
      if (current === NULL_NODE) {
        current = left !== NULL_NODE ? left : right;
      }
    }
  }

  return checksum;
}

// Bulk sum iteration (SoA advantage scenario)
function bulkSumBenchmark(arena: Arena, nodeCount: number): number {
  let total = 0;
  for (let i = 0; i < nodeCount; i++) {
    total += arena.getSum(i);
  }
  return total;
}

console.log("=".repeat(70));
console.log("Arena Allocator Benchmarks");
console.log("=".repeat(70));
console.log();

// -----------------------------------------------------------------
// Benchmark 1: Allocation Throughput
// -----------------------------------------------------------------
console.log("1. ALLOCATION THROUGHPUT");
console.log("-".repeat(70));

const ALLOC_COUNT = 100_000;

const aosAllocResult = runBenchmark(
  `AosArena: allocate ${ALLOC_COUNT.toLocaleString()} nodes`,
  () => {
    const arena = new AosArena(ALLOC_COUNT);
    for (let i = 0; i < ALLOC_COUNT; i++) {
      arena.allocNode();
    }
  },
  ALLOC_COUNT,
);
console.log(formatResult(aosAllocResult));

const soaAllocResult = runBenchmark(
  `SoaArena: allocate ${ALLOC_COUNT.toLocaleString()} nodes`,
  () => {
    const arena = new SoaArena(ALLOC_COUNT);
    for (let i = 0; i < ALLOC_COUNT; i++) {
      arena.allocNode();
    }
  },
  ALLOC_COUNT,
);
console.log(formatResult(soaAllocResult));

console.log();

// -----------------------------------------------------------------
// Benchmark 2: Allocation with Growth
// -----------------------------------------------------------------
console.log("2. ALLOCATION WITH GROWTH (from small initial capacity)");
console.log("-".repeat(70));

const GROW_ALLOC_COUNT = 50_000;

const aosGrowResult = runBenchmark(
  `AosArena: allocate ${GROW_ALLOC_COUNT.toLocaleString()} nodes (from 64)`,
  () => {
    const arena = new AosArena(64);
    for (let i = 0; i < GROW_ALLOC_COUNT; i++) {
      arena.allocNode();
    }
  },
  GROW_ALLOC_COUNT,
);
console.log(formatResult(aosGrowResult));

const soaGrowResult = runBenchmark(
  `SoaArena: allocate ${GROW_ALLOC_COUNT.toLocaleString()} nodes (from 64)`,
  () => {
    const arena = new SoaArena(64);
    for (let i = 0; i < GROW_ALLOC_COUNT; i++) {
      arena.allocNode();
    }
  },
  GROW_ALLOC_COUNT,
);
console.log(formatResult(soaGrowResult));

console.log();

// -----------------------------------------------------------------
// Benchmark 3: Tree Traversal (AoS vs SoA)
// -----------------------------------------------------------------
console.log("3. TREE TRAVERSAL (cache locality test)");
console.log("-".repeat(70));

const TREE_DEPTH = 15; // 2^15 - 1 = 32767 nodes
const TRAVERSE_ITERATIONS = 10_000;

// Pre-build trees
const aosTreeArena = new AosArena(65536);
const aosTreeRoot = buildTree(aosTreeArena, TREE_DEPTH);

const soaTreeArena = new SoaArena(65536);
const soaTreeRoot = buildTree(soaTreeArena, TREE_DEPTH);

console.log(`Tree size: ${aosTreeArena.nodeCount} nodes (depth ${TREE_DEPTH})`);
console.log(`Traverse iterations: ${TRAVERSE_ITERATIONS.toLocaleString()}`);

let aosChecksum = 0;
const aosTraverseResult = runBenchmark(
  "AosArena: tree descent (multi-field access)",
  () => {
    aosChecksum += treeDescendBenchmark(aosTreeArena, aosTreeRoot, TRAVERSE_ITERATIONS);
  },
  TRAVERSE_ITERATIONS,
);
console.log(formatResult(aosTraverseResult));

let soaChecksum = 0;
const soaTraverseResult = runBenchmark(
  "SoaArena: tree descent (multi-field access)",
  () => {
    soaChecksum += treeDescendBenchmark(soaTreeArena, soaTreeRoot, TRAVERSE_ITERATIONS);
  },
  TRAVERSE_ITERATIONS,
);
console.log(formatResult(soaTraverseResult));

// Prevent dead code elimination
if (aosChecksum === 0 && soaChecksum === 0) {
  console.log("(checksums used to prevent DCE)");
}

console.log();

// -----------------------------------------------------------------
// Benchmark 4: Bulk Iteration (SoA advantage scenario)
// -----------------------------------------------------------------
console.log("4. BULK SUM ITERATION (single-field access)");
console.log("-".repeat(70));

const BULK_COUNT = 100_000;

// Pre-allocate and set random sums
const aosBulkArena = new AosArena(BULK_COUNT);
const soaBulkArena = new SoaArena(BULK_COUNT);

for (let i = 0; i < BULK_COUNT; i++) {
  const aosIdx = aosBulkArena.allocNode();
  aosBulkArena.setSum(aosIdx, Math.random());

  const soaIdx = soaBulkArena.allocNode();
  soaBulkArena.setSum(soaIdx, Math.random());
}

console.log(`Node count: ${BULK_COUNT.toLocaleString()}`);

let aosBulkSum = 0;
const aosBulkResult = runBenchmark(
  "AosArena: bulk sum iteration",
  () => {
    aosBulkSum += bulkSumBenchmark(aosBulkArena, BULK_COUNT);
  },
  BULK_COUNT,
);
console.log(formatResult(aosBulkResult));

let soaBulkSum = 0;
const soaBulkResult = runBenchmark(
  "SoaArena: bulk sum iteration",
  () => {
    soaBulkSum += bulkSumBenchmark(soaBulkArena, BULK_COUNT);
  },
  BULK_COUNT,
);
console.log(formatResult(soaBulkResult));

// Also test SoaArena's sumAllNodes method
let soaSumAll = 0;
const soaSumAllResult = runBenchmark(
  "SoaArena: sumAllNodes() method",
  () => {
    soaSumAll += soaBulkArena.sumAllNodes();
  },
  BULK_COUNT,
);
console.log(formatResult(soaSumAllResult));

// Prevent DCE
if (aosBulkSum === 0 && soaBulkSum === 0 && soaSumAll === 0) {
  console.log("(sums used to prevent DCE)");
}

console.log();

// -----------------------------------------------------------------
// Benchmark 5: Free and Reuse
// -----------------------------------------------------------------
console.log("5. FREE AND REUSE CYCLE");
console.log("-".repeat(70));

const REUSE_COUNT = 50_000;

const aosFreeReuseResult = runBenchmark(
  `AosArena: free/reuse ${REUSE_COUNT.toLocaleString()} nodes`,
  () => {
    const arena = new AosArena(REUSE_COUNT);
    const nodes: number[] = [];

    // Allocate all
    for (let i = 0; i < REUSE_COUNT; i++) {
      nodes.push(arena.allocNode());
    }

    // Free all
    for (const idx of nodes) {
      arena.freeNode(idx);
    }

    // Reallocate all
    for (let i = 0; i < REUSE_COUNT; i++) {
      arena.allocNode();
    }
  },
  REUSE_COUNT * 3, // alloc + free + realloc
);
console.log(formatResult(aosFreeReuseResult));

const soaFreeReuseResult = runBenchmark(
  `SoaArena: free/reuse ${REUSE_COUNT.toLocaleString()} nodes`,
  () => {
    const arena = new SoaArena(REUSE_COUNT);
    const nodes: number[] = [];

    // Allocate all
    for (let i = 0; i < REUSE_COUNT; i++) {
      nodes.push(arena.allocNode());
    }

    // Free all
    for (const idx of nodes) {
      arena.freeNode(idx);
    }

    // Reallocate all
    for (let i = 0; i < REUSE_COUNT; i++) {
      arena.allocNode();
    }
  },
  REUSE_COUNT * 3,
);
console.log(formatResult(soaFreeReuseResult));

console.log();

// -----------------------------------------------------------------
// Benchmark 6: Mark-Sweep GC
// -----------------------------------------------------------------
console.log("6. MARK-SWEEP GC");
console.log("-".repeat(70));

const GC_COUNT = 50_000;

const aosGcResult = runBenchmark(
  `AosArena: mark-sweep ${GC_COUNT.toLocaleString()} nodes (50% marked)`,
  () => {
    const arena = new AosArena(GC_COUNT);
    const nodes: number[] = [];

    for (let i = 0; i < GC_COUNT; i++) {
      nodes.push(arena.allocNode());
    }

    // Mark every other node
    for (let i = 0; i < nodes.length; i += 2) {
      arena.markNode(nodes[i]);
    }

    arena.sweep();
  },
  GC_COUNT,
);
console.log(formatResult(aosGcResult));

const soaGcResult = runBenchmark(
  `SoaArena: mark-sweep ${GC_COUNT.toLocaleString()} nodes (50% marked)`,
  () => {
    const arena = new SoaArena(GC_COUNT);
    const nodes: number[] = [];

    for (let i = 0; i < GC_COUNT; i++) {
      nodes.push(arena.allocNode());
    }

    // Mark every other node
    for (let i = 0; i < nodes.length; i += 2) {
      arena.markNode(nodes[i]);
    }

    arena.sweep();
  },
  GC_COUNT,
);
console.log(formatResult(soaGcResult));

console.log();

// -----------------------------------------------------------------
// Summary
// -----------------------------------------------------------------
console.log("=".repeat(70));
console.log("SUMMARY");
console.log("=".repeat(70));
console.log();

const traverseRatio = soaTraverseResult.mean / aosTraverseResult.mean;
const bulkRatio = aosBulkResult.mean / soaBulkResult.mean;
const allocRatio = soaAllocResult.mean / aosAllocResult.mean;

console.log("Tree Traversal (cache locality matters):");
if (aosTraverseResult.mean < soaTraverseResult.mean) {
  console.log(`  AoS is ${traverseRatio.toFixed(2)}x FASTER for tree descent`);
} else {
  console.log(`  SoA is ${(1 / traverseRatio).toFixed(2)}x FASTER for tree descent`);
}

console.log();
console.log("Bulk Iteration (single-field access):");
if (soaBulkResult.mean < aosBulkResult.mean) {
  console.log(`  SoA is ${bulkRatio.toFixed(2)}x FASTER for bulk sum`);
} else {
  console.log(`  AoS is ${(1 / bulkRatio).toFixed(2)}x FASTER for bulk sum`);
}

console.log();
console.log("Allocation Throughput:");
if (aosAllocResult.mean < soaAllocResult.mean) {
  console.log(`  AoS is ${allocRatio.toFixed(2)}x FASTER for allocation`);
} else {
  console.log(`  SoA is ${(1 / allocRatio).toFixed(2)}x FASTER for allocation`);
}

console.log();
console.log("Recommendation:");
console.log("  For tree-based data structures (like SumTree) where the hot path");
console.log("  is tree descent accessing multiple fields per node, AoS layout");
console.log("  is expected to provide better cache locality.");
console.log();
console.log("  However, if bulk iteration over a single field is common,");
console.log("  SoA may be preferable.");
console.log();
