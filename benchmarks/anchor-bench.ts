/**
 * Anchor Benchmarks
 *
 * Benchmarks:
 * 1. Single anchor resolution
 * 2. Batch anchor resolution (10K anchors, target: <5ms)
 * 3. Anchor creation throughput
 * 4. AnchorSet operations
 */

import {
  AnchorSet,
  Bias,
  type InsertionFragment,
  SimpleSnapshot,
  createAnchor,
  resolveAnchor,
} from "../src/anchor/index.ts";

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
    } else if (opsPerSec >= 1_000) {
      output += ` | ${(opsPerSec / 1000).toFixed(2)}K ops/sec`;
    } else {
      output += ` | ${opsPerSec.toFixed(2)} ops/sec`;
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

  const result: BenchmarkResult = {
    name,
    mean,
    stddev,
    min,
    max,
  };
  if (ops !== undefined) {
    result.opsPerSec = (ops / mean) * 1000;
  }
  return result;
}

/**
 * Create a document with many fragments to simulate a realistic editing scenario.
 */
function createLargeDocument(fragmentCount: number, charsPerFragment: number): SimpleSnapshot {
  const fragments: InsertionFragment[] = [];
  let fullText = "";

  for (let i = 0; i < fragmentCount; i++) {
    const text = "x".repeat(charsPerFragment);
    fragments.push({
      insertionId: { replicaId: 1, localSeq: i + 1 },
      startOffset: 0,
      endOffset: charsPerFragment,
      isDeleted: false,
      utf16Len: charsPerFragment,
    });
    fullText += text;
  }

  return new SimpleSnapshot(fragments, fullText);
}

/**
 * Create a document with interleaved fragments from multiple replicas.
 */
function createCollaborativeDocument(
  replicaCount: number,
  fragmentsPerReplica: number,
  charsPerFragment: number,
): SimpleSnapshot {
  const fragments: InsertionFragment[] = [];
  let fullText = "";
  const localSeqs: number[] = new Array<number>(replicaCount).fill(0);

  // Interleave fragments from different replicas
  for (let i = 0; i < fragmentsPerReplica; i++) {
    for (let r = 0; r < replicaCount; r++) {
      const text = String.fromCharCode(65 + (r % 26)).repeat(charsPerFragment);
      const currentSeq = localSeqs[r] ?? 0;
      localSeqs[r] = currentSeq + 1;
      fragments.push({
        insertionId: { replicaId: r + 1, localSeq: localSeqs[r] ?? 1 },
        startOffset: 0,
        endOffset: charsPerFragment,
        isDeleted: false,
        utf16Len: charsPerFragment,
      });
      fullText += text;
    }
  }

  return new SimpleSnapshot(fragments, fullText);
}

console.log("=".repeat(70));
console.log("Anchor Benchmarks");
console.log("=".repeat(70));
console.log();

// -----------------------------------------------------------------
// Benchmark 1: Single Anchor Creation and Resolution
// -----------------------------------------------------------------
console.log("1. SINGLE ANCHOR OPERATIONS");
console.log("-".repeat(70));

const singleDoc = createLargeDocument(1000, 100); // 100K chars, 1K fragments
console.log(`Document: ${singleDoc.length.toLocaleString()} chars, 1000 fragments`);

const SINGLE_OPS = 10_000;

const createResult = runBenchmark(
  `Create ${SINGLE_OPS.toLocaleString()} anchors`,
  () => {
    for (let i = 0; i < SINGLE_OPS; i++) {
      const offset = Math.floor(Math.random() * singleDoc.length);
      createAnchor(singleDoc, offset, i % 2 === 0 ? Bias.Left : Bias.Right);
    }
  },
  SINGLE_OPS,
);
console.log(formatResult(createResult));

// Pre-create anchors for resolution benchmark
const testAnchors = Array.from({ length: SINGLE_OPS }, (_, i) => {
  const offset = Math.floor(Math.random() * singleDoc.length);
  return createAnchor(singleDoc, offset, i % 2 === 0 ? Bias.Left : Bias.Right);
});

const resolveResult = runBenchmark(
  `Resolve ${SINGLE_OPS.toLocaleString()} anchors individually`,
  () => {
    for (const anchor of testAnchors) {
      resolveAnchor(singleDoc, anchor);
    }
  },
  SINGLE_OPS,
);
console.log(formatResult(resolveResult));

console.log();

// -----------------------------------------------------------------
// Benchmark 2: Batch Anchor Resolution (TARGET: <5ms for 10K)
// -----------------------------------------------------------------
console.log("2. BATCH ANCHOR RESOLUTION (target: <5ms for 10K)");
console.log("-".repeat(70));

const ANCHOR_COUNT = 10_000;

const batchDoc = createLargeDocument(1000, 100); // 100K chars
const anchorSet = new AnchorSet<number>();

// Add anchors distributed across the document
for (let i = 0; i < ANCHOR_COUNT; i++) {
  const offset = Math.floor((i / ANCHOR_COUNT) * batchDoc.length);
  const anchor = createAnchor(batchDoc, offset, i % 2 === 0 ? Bias.Left : Bias.Right);
  anchorSet.add(anchor, i);
}

console.log(`AnchorSet size: ${anchorSet.size.toLocaleString()} anchors`);

const batchResolveResult = runBenchmark(
  `Batch resolve ${ANCHOR_COUNT.toLocaleString()} anchors (resolveAll)`,
  () => {
    anchorSet.resolveAll(batchDoc);
  },
  ANCHOR_COUNT,
);
console.log(formatResult(batchResolveResult));

// Check if we meet the target
const targetMet = batchResolveResult.mean < 5;
console.log();
console.log(
  targetMet
    ? `✓ TARGET MET: ${batchResolveResult.mean.toFixed(2)}ms < 5ms`
    : `✗ TARGET MISSED: ${batchResolveResult.mean.toFixed(2)}ms >= 5ms`,
);

console.log();

// -----------------------------------------------------------------
// Benchmark 3: Collaborative Document (Many Replicas)
// -----------------------------------------------------------------
console.log("3. COLLABORATIVE DOCUMENT (multiple replicas)");
console.log("-".repeat(70));

const collabDoc = createCollaborativeDocument(10, 100, 100); // 10 replicas, 1K fragments total
console.log(`Document: ${collabDoc.length.toLocaleString()} chars, 10 replicas`);

const collabSet = new AnchorSet<string>();
for (let i = 0; i < ANCHOR_COUNT; i++) {
  const offset = Math.floor((i / ANCHOR_COUNT) * collabDoc.length);
  const anchor = createAnchor(collabDoc, offset, Bias.Left);
  collabSet.add(anchor, `cursor-${i}`);
}

const collabResolveResult = runBenchmark(
  `Batch resolve ${ANCHOR_COUNT.toLocaleString()} anchors (collaborative)`,
  () => {
    collabSet.resolveAll(collabDoc);
  },
  ANCHOR_COUNT,
);
console.log(formatResult(collabResolveResult));

console.log();

// -----------------------------------------------------------------
// Benchmark 4: AnchorSet Operations
// -----------------------------------------------------------------
console.log("4. ANCHOR SET OPERATIONS");
console.log("-".repeat(70));

const OP_COUNT = 10_000;

const addResult = runBenchmark(
  `Add ${OP_COUNT.toLocaleString()} entries`,
  () => {
    const set = new AnchorSet<number>();
    for (let i = 0; i < OP_COUNT; i++) {
      const offset = Math.floor(Math.random() * batchDoc.length);
      const anchor = createAnchor(batchDoc, offset, Bias.Left);
      set.add(anchor, i);
    }
  },
  OP_COUNT,
);
console.log(formatResult(addResult));

// Pre-populate for remove benchmark
const removeSet = new AnchorSet<number>();
const ids: number[] = [];
for (let i = 0; i < OP_COUNT; i++) {
  const offset = Math.floor(Math.random() * batchDoc.length);
  const anchor = createAnchor(batchDoc, offset, Bias.Left);
  ids.push(removeSet.add(anchor, i));
}

const removeResult = runBenchmark(
  `Remove ${OP_COUNT.toLocaleString()} entries`,
  () => {
    for (const id of ids) {
      removeSet.remove(id);
    }
    // Re-add for next iteration
    ids.length = 0;
    for (let i = 0; i < OP_COUNT; i++) {
      const offset = Math.floor(Math.random() * batchDoc.length);
      const anchor = createAnchor(batchDoc, offset, Bias.Left);
      ids.push(removeSet.add(anchor, i));
    }
  },
  OP_COUNT,
);
console.log(formatResult(removeResult));

console.log();

// -----------------------------------------------------------------
// Benchmark 5: Large Documents
// -----------------------------------------------------------------
console.log("5. SCALING WITH DOCUMENT SIZE");
console.log("-".repeat(70));

const sizes = [
  { fragments: 100, chars: 100 }, // 10K chars
  { fragments: 1000, chars: 100 }, // 100K chars
  { fragments: 10000, chars: 100 }, // 1M chars
];

for (const { fragments, chars } of sizes) {
  const doc = createLargeDocument(fragments, chars);
  const set = new AnchorSet<number>();

  // Add 1K anchors distributed across the document
  for (let i = 0; i < 1000; i++) {
    const offset = Math.floor((i / 1000) * doc.length);
    const anchor = createAnchor(doc, offset, Bias.Left);
    set.add(anchor, i);
  }

  const result = runBenchmark(
    `${(fragments * chars / 1000).toFixed(0)}K chars, ${fragments} frags, 1K anchors`,
    () => {
      set.resolveAll(doc);
    },
    1000,
  );
  console.log(formatResult(result));
}

console.log();

// -----------------------------------------------------------------
// Summary
// -----------------------------------------------------------------
console.log("=".repeat(70));
console.log("SUMMARY");
console.log("=".repeat(70));
console.log();

console.log("Performance characteristics:");
console.log(`  - Single anchor creation: ${((createResult.opsPerSec ?? 0) / 1000).toFixed(0)}K ops/sec`);
console.log(`  - Single anchor resolution: ${((resolveResult.opsPerSec ?? 0) / 1000).toFixed(0)}K ops/sec`);
console.log(`  - Batch resolution (10K): ${batchResolveResult.mean.toFixed(2)}ms`);
console.log();

if (targetMet) {
  console.log("✓ All performance targets met!");
} else {
  console.log("✗ Some performance targets missed - consider optimization");
}

console.log();
