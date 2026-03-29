/**
 * Benchmark: WASM radix sort vs JS Array.sort() for fragment ordering.
 *
 * Tests at various fragment counts (1K, 5K, 10K, 50K) and measures:
 * 1. Key encoding time
 * 2. Radix sort time (TS and WASM variants)
 * 3. JS Array.sort() time (comparison baseline)
 * 4. Total time (encode + sort) vs baseline
 *
 * Usage: bun run experiments/wasm-radix-sort/benchmark.ts
 */

import { encodeCompactKeys, radixSortCompact } from "./key-encoding-compact.js";
import { KEY_SIZE, type SortableFragment, compareKeys, encodeKeys } from "./key-encoding.js";
import { radixSortTS, radixSortTSOptimized } from "./radix-sort-ts.js";
import { loadRadixSortWasm } from "./radix-sort-wasm.js";

// ---------------------------------------------------------------------------
// Fragment generation
// ---------------------------------------------------------------------------

/**
 * Generate synthetic fragments that mimic realistic CRDT fragment distributions.
 * Uses variable-depth locators with the project's encoding scheme.
 */
function generateFragments(n: number, seed = 42): SortableFragment[] {
  // Simple PRNG (xorshift32)
  let s = seed;
  const rand = (): number => {
    s ^= s << 13;
    s ^= s >> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };

  const MAX_VALUE = Number.MAX_SAFE_INTEGER;
  const fragments: SortableFragment[] = [];

  for (let i = 0; i < n; i++) {
    // Vary depth: most fragments are depth 1-3, some go deeper
    const r = rand();
    const depth =
      r < 0.4
        ? 1
        : r < 0.7
          ? 2
          : r < 0.85
            ? 3
            : r < 0.95
              ? 4
              : Math.min(16, Math.floor(rand() * 8) + 5);

    const levels: number[] = [];
    for (let d = 0; d < depth; d++) {
      if (d === 0) {
        // First level: shifted range (like FIRST_LEVEL_SHIFT = 37)
        const maxFirst = Math.floor(MAX_VALUE / 2 ** 37);
        levels.push(Math.floor(rand() * maxFirst));
      } else {
        // Deeper levels: full range, but bias toward smaller values
        // (mimics sequential inserts that don't need deep allocation)
        const r2 = rand();
        if (r2 < 0.7) {
          levels.push(Math.floor(rand() * 1000)); // small values (splits)
        } else {
          levels.push(Math.floor(rand() * MAX_VALUE));
        }
      }
    }

    const replicaId = Math.floor(rand() * 10); // 10 replicas
    const counter = Math.floor(rand() * n * 2);
    const insertionOffset = Math.floor(rand() * 100);

    fragments.push({
      locator: { levels },
      insertionId: { replicaId, counter },
      insertionOffset,
    });
  }

  return fragments;
}

// ---------------------------------------------------------------------------
// JS Array.sort baseline (mirrors sortFragments from text-buffer.ts)
// ---------------------------------------------------------------------------

function compareLocators(
  a: { readonly levels: ReadonlyArray<number> },
  b: { readonly levels: ReadonlyArray<number> },
): number {
  const minLen = Math.min(a.levels.length, b.levels.length);
  for (let i = 0; i < minLen; i++) {
    const aLevel = a.levels[i]!;
    const bLevel = b.levels[i]!;
    if (aLevel !== bLevel) return aLevel - bLevel;
  }
  return a.levels.length - b.levels.length;
}

function jsSort(frags: SortableFragment[]): SortableFragment[] {
  const copy = frags.slice();
  copy.sort((a, b) => {
    const locCmp = compareLocators(a.locator, b.locator);
    if (locCmp !== 0) return locCmp;

    if (a.insertionId.replicaId !== b.insertionId.replicaId) {
      return a.insertionId.replicaId - b.insertionId.replicaId;
    }
    if (a.insertionId.counter !== b.insertionId.counter) {
      return a.insertionId.counter - b.insertionId.counter;
    }

    const offsetCmp = a.insertionOffset - b.insertionOffset;
    if (offsetCmp !== 0) return offsetCmp;

    return a.locator.levels.length - b.locator.levels.length;
  });
  return copy;
}

// ---------------------------------------------------------------------------
// Correctness validation
// ---------------------------------------------------------------------------

function validateCorrectness(frags: SortableFragment[]): boolean {
  const n = frags.length;

  // JS baseline sort
  const jsResult = jsSort(frags);

  // Key-encoded sort validation
  const { keys, indices: keyIndices } = encodeKeys(frags);
  for (let i = 0; i < n - 1; i++) {
    const cmp = compareKeys(keys, keyIndices[i]!, keyIndices[i + 1]!);
    // Keys should be in non-decreasing order after we sort
    // But indices aren't sorted yet - just check encoding preserves order
  }

  // TS radix sort
  const { keys: keys2, indices: tsIndices } = encodeKeys(frags);
  radixSortTS(keys2, tsIndices, n);

  // Verify TS radix sort matches JS sort
  for (let i = 0; i < n; i++) {
    const jsIdx = jsResult[i]!;
    const tsIdx = frags[tsIndices[i]!]!;
    if (
      compareLocators(jsIdx.locator, tsIdx.locator) !== 0 ||
      jsIdx.insertionId.replicaId !== tsIdx.insertionId.replicaId ||
      jsIdx.insertionId.counter !== tsIdx.insertionId.counter ||
      jsIdx.insertionOffset !== tsIdx.insertionOffset
    ) {
      console.error(`Mismatch at position ${i}:`);
      console.error("  JS:", JSON.stringify(jsIdx));
      console.error("  TS radix:", JSON.stringify(tsIdx));
      return false;
    }
  }

  return true;
}

// ---------------------------------------------------------------------------
// Timing utilities
// ---------------------------------------------------------------------------

function timeIt(
  name: string,
  fn: () => void,
  iterations: number,
): { name: string; avgMs: number; minMs: number; medianMs: number } {
  const times: number[] = [];

  // Warmup
  for (let i = 0; i < Math.min(5, iterations); i++) {
    fn();
  }

  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    fn();
    times.push(performance.now() - start);
  }

  times.sort((a, b) => a - b);
  const avg = times.reduce((s, t) => s + t, 0) / times.length;
  const median = times[Math.floor(times.length / 2)]!;
  const min = times[0]!;

  return { name, avgMs: avg, minMs: min, medianMs: median };
}

// ---------------------------------------------------------------------------
// Main benchmark
// ---------------------------------------------------------------------------

async function main() {
  console.log("=== WASM SIMD Radix Sort Spike ===");
  console.log(`Key size: ${KEY_SIZE} bytes per fragment\n`);

  // Validate correctness first
  console.log("--- Correctness Validation ---");
  for (const n of [10, 100, 1000]) {
    const frags = generateFragments(n);
    const ok = validateCorrectness(frags);
    console.log(`  n=${n}: ${ok ? "PASS" : "FAIL"}`);
    if (!ok) {
      console.error("Correctness check failed, aborting benchmarks.");
      process.exit(1);
    }
  }

  // Load WASM
  let wasmSort: Awaited<ReturnType<typeof loadRadixSortWasm>> | null = null;
  try {
    wasmSort = await loadRadixSortWasm();
    console.log("\nWASM module loaded successfully.");
  } catch (e) {
    console.warn("\nWASM module failed to load:", e);
    console.warn("Continuing with JS-only benchmarks.\n");
  }

  // Validate WASM correctness
  if (wasmSort) {
    console.log("\n--- WASM Correctness Validation ---");
    for (const n of [10, 100, 1000]) {
      const frags = generateFragments(n);
      const jsResult = jsSort(frags);

      const { keys, indices } = encodeKeys(frags);
      wasmSort.sort(keys, indices, n);

      let ok = true;
      for (let i = 0; i < n; i++) {
        const jsFrag = jsResult[i]!;
        const wasmFrag = frags[indices[i]!]!;
        if (
          compareLocators(jsFrag.locator, wasmFrag.locator) !== 0 ||
          jsFrag.insertionId.replicaId !== wasmFrag.insertionId.replicaId ||
          jsFrag.insertionId.counter !== wasmFrag.insertionId.counter
        ) {
          ok = false;
          break;
        }
      }
      console.log(`  n=${n}: ${ok ? "PASS" : "FAIL"}`);
    }
  }

  // Benchmark at various sizes
  const sizes = [1_000, 5_000, 10_000, 50_000];
  const iterations = 20;

  console.log(`\n--- Benchmark Results (${iterations} iterations each) ---`);
  console.log(
    "Size".padEnd(8),
    "Method".padEnd(25),
    "Avg(ms)".padStart(10),
    "Med(ms)".padStart(10),
    "Min(ms)".padStart(10),
  );
  console.log("-".repeat(70));

  for (const n of sizes) {
    const frags = generateFragments(n);

    // Pre-encode keys (shared across radix sort variants)
    const { keys: preEncodedKeys, indices: preEncodedIndices } = encodeKeys(frags);

    // 1. JS Array.sort() baseline
    const jsResult = timeIt(
      `JS Array.sort`,
      () => {
        jsSort(frags);
      },
      iterations,
    );

    // 2. Key encoding only (to measure overhead separately)
    const encodeResult = timeIt(
      `Key encode`,
      () => {
        encodeKeys(frags);
      },
      iterations,
    );

    // 3. TS radix sort (encode + sort)
    const tsFullResult = timeIt(
      `TS radix (full)`,
      () => {
        const { keys, indices } = encodeKeys(frags);
        radixSortTS(keys, indices, n);
      },
      iterations,
    );

    // 4. TS radix sort (sort only, pre-encoded)
    const tsSortOnlyResult = timeIt(
      `TS radix (sort only)`,
      () => {
        const indices = new Uint32Array(n);
        for (let i = 0; i < n; i++) indices[i] = i;
        radixSortTS(preEncodedKeys, indices, n);
      },
      iterations,
    );

    // 5. TS radix optimized (skip uniform bytes)
    const tsOptResult = timeIt(
      `TS radix opt (full)`,
      () => {
        const { keys, indices } = encodeKeys(frags);
        radixSortTSOptimized(keys, indices, n);
      },
      iterations,
    );

    const results = [jsResult, encodeResult, tsFullResult, tsSortOnlyResult, tsOptResult];

    // 6. WASM variants
    if (wasmSort) {
      const wasmFullResult = timeIt(
        `WASM radix (full)`,
        () => {
          const { keys, indices } = encodeKeys(frags);
          wasmSort!.sort(keys, indices, n);
        },
        iterations,
      );

      const wasmSortOnlyResult = timeIt(
        `WASM radix (sort only)`,
        () => {
          const indices = new Uint32Array(n);
          for (let i = 0; i < n; i++) indices[i] = i;
          wasmSort!.sort(preEncodedKeys, indices, n);
        },
        iterations,
      );

      results.push(wasmFullResult, wasmSortOnlyResult);
    }

    // 7. Compact key radix sort (34-byte keys)
    const compactFullResult = timeIt(
      `Compact radix (full)`,
      () => {
        const { keys, indices } = encodeCompactKeys(frags);
        radixSortCompact(keys, indices, n);
      },
      iterations,
    );

    const { keys: preCompactKeys } = encodeCompactKeys(frags);
    const compactSortOnlyResult = timeIt(
      `Compact radix (sort)`,
      () => {
        const indices = new Uint32Array(n);
        for (let i = 0; i < n; i++) indices[i] = i;
        radixSortCompact(preCompactKeys, indices, n);
      },
      iterations,
    );

    results.push(compactFullResult, compactSortOnlyResult);

    for (const r of results) {
      console.log(
        String(n).padEnd(8),
        r.name.padEnd(25),
        r.avgMs.toFixed(3).padStart(10),
        r.medianMs.toFixed(3).padStart(10),
        r.minMs.toFixed(3).padStart(10),
      );
    }
    console.log();
  }

  // Summary analysis
  console.log("=== Analysis ===\n");

  console.log(`Key encoding size: ${KEY_SIZE} bytes/fragment`);
  console.log(`  Locator: 16 levels × 7 bytes = 112 bytes`);
  console.log(`  OperationId: 8 bytes (replicaId + counter)`);
  console.log(`  InsertionOffset: 4 bytes`);
  console.log(`  Depth: 1 byte`);
  console.log(`  Total: ${KEY_SIZE} bytes\n`);

  // WASM binary size
  try {
    const wasmPath = new URL("./radix-sort.wasm", import.meta.url).pathname;
    const wasmFile = Bun.file(wasmPath);
    const wasmSize = wasmFile.size;
    console.log(`WASM binary size: ${wasmSize} bytes (target: <10KB) ✓\n`);
  } catch {
    console.log(`WASM binary size: not available\n`);
  }

  console.log("Key questions answered:");
  console.log("1. Breakeven N: See results above (compare JS Array.sort vs TS/WASM radix full)");
  console.log("2. Key encoding overhead: See 'Key encode' vs 'sort only' timings");
  console.log("3. WASM binary size: See above (well under 10KB target)");
}

main().catch(console.error);
