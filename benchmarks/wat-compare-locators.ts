/**
 * Benchmark: TypeScript vs WAT compareLocators
 *
 * This benchmark compares the performance of:
 * 1. TypeScript compareLocators (current implementation)
 * 2. Hand-written WAT compareLocators (spike for issue #113)
 *
 * The goal is to establish whether the WAT approach provides meaningful
 * performance gains that justify the complexity of hand-written WebAssembly.
 *
 * Reference: GitHub issue #113 (moonshot: Hand-written WebAssembly for tree operations)
 */

import { bench, group, run, summary } from "mitata";
import { compareLocators as compareLocatorsTS } from "../src/text/locator.js";
import type { Locator } from "../src/text/types.js";
import {
  loadWasmModule,
  compareLocatorsWasm,
  encodeLocatorPair,
  type WasmExports,
} from "../src/wasm/compare-locators.js";

const isCI = process.argv.includes("--ci");

// ---------------------------------------------------------------------------
// Test Data Generation
// ---------------------------------------------------------------------------

/** Create a Locator from levels array */
const loc = (levels: number[]): Locator => ({ levels });

/** Generate random Locator with 1-4 levels */
function randomLocator(): Locator {
  const depth = 1 + Math.floor(Math.random() * 4);
  const levels: number[] = [];
  for (let i = 0; i < depth; i++) {
    // Use values in realistic range (up to 2^40)
    levels.push(Math.floor(Math.random() * 2 ** 40));
  }
  return { levels };
}

/** Generate sequential Locators (simulates document order) */
function sequentialLocators(count: number): Locator[] {
  const result: Locator[] = [];
  let base = Math.floor(Math.random() * 2 ** 30);
  for (let i = 0; i < count; i++) {
    result.push(loc([base + i * 1000]));
  }
  return result;
}

/** Generate nested Locators (simulates concurrent edits) */
function nestedLocators(count: number): Locator[] {
  const result: Locator[] = [];
  for (let i = 0; i < count; i++) {
    const depth = 1 + (i % 4);
    const levels: number[] = [];
    for (let d = 0; d < depth; d++) {
      levels.push(1000 + d * 100 + i);
    }
    result.push({ levels });
  }
  return result;
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

console.log("Loading WASM module...");
const wasmExports = await loadWasmModule();
console.log("WASM module loaded.\n");

// Pre-generate test data
const N = 10000;
const randomLocs = Array.from({ length: N }, randomLocator);
const seqLocs = sequentialLocators(N);
const nestedLocs = nestedLocators(N);

// Pre-encode locator pairs for batch WASM comparison
const randomPairs = randomLocs.slice(0, N - 1).map((a, i) => {
  const b = randomLocs[i + 1]!;
  return { a, b, encoded: encodeLocatorPair(a, b) };
});

const seqPairs = seqLocs.slice(0, N - 1).map((a, i) => {
  const b = seqLocs[i + 1]!;
  return { a, b, encoded: encodeLocatorPair(a, b) };
});

// Single pair for hot-path measurement
const singleA = loc([1000000, 2000, 300]);
const singleB = loc([1000000, 2000, 400]);
const singleEncoded = encodeLocatorPair(singleA, singleB);

// WASM memory view for direct writes
const wasmMemory = new Uint8Array(wasmExports.memory.buffer);

// ---------------------------------------------------------------------------
// Benchmarks
// ---------------------------------------------------------------------------

summary(() => {
  bench("noop (baseline)", () => {
    // Measure benchmark overhead
  });
});

group("single-comparison", () => {
  bench("TS: single compare (3 levels)", () => {
    return compareLocatorsTS(singleA, singleB);
  });

  bench("WASM: single compare (3 levels) - full overhead", () => {
    return compareLocatorsWasm(wasmExports, singleA, singleB);
  });

  bench("WASM: single compare (3 levels) - pre-encoded", () => {
    // Copy pre-encoded buffer to WASM memory
    wasmMemory.set(new Uint8Array(singleEncoded), 0);
    return wasmExports.compare_locators();
  });
});

group("batch-random-locators", () => {
  bench("TS: compare 10K random locator pairs", () => {
    let sum = 0;
    for (let i = 0; i < randomPairs.length; i++) {
      const pair = randomPairs[i]!;
      sum += compareLocatorsTS(pair.a, pair.b);
    }
    return sum;
  });

  bench("WASM: compare 10K random locator pairs (full overhead)", () => {
    let sum = 0;
    for (let i = 0; i < randomPairs.length; i++) {
      const pair = randomPairs[i]!;
      sum += compareLocatorsWasm(wasmExports, pair.a, pair.b);
    }
    return sum;
  });

  bench("WASM: compare 10K random locator pairs (pre-encoded)", () => {
    let sum = 0;
    for (let i = 0; i < randomPairs.length; i++) {
      const pair = randomPairs[i]!;
      wasmMemory.set(new Uint8Array(pair.encoded), 0);
      sum += wasmExports.compare_locators();
    }
    return sum;
  });
});

group("batch-sequential-locators", () => {
  bench("TS: compare 10K sequential locator pairs", () => {
    let sum = 0;
    for (let i = 0; i < seqPairs.length; i++) {
      const pair = seqPairs[i]!;
      sum += compareLocatorsTS(pair.a, pair.b);
    }
    return sum;
  });

  bench("WASM: compare 10K sequential locator pairs (full overhead)", () => {
    let sum = 0;
    for (let i = 0; i < seqPairs.length; i++) {
      const pair = seqPairs[i]!;
      sum += compareLocatorsWasm(wasmExports, pair.a, pair.b);
    }
    return sum;
  });

  bench("WASM: compare 10K sequential locator pairs (pre-encoded)", () => {
    let sum = 0;
    for (let i = 0; i < seqPairs.length; i++) {
      const pair = seqPairs[i]!;
      wasmMemory.set(new Uint8Array(pair.encoded), 0);
      sum += wasmExports.compare_locators();
    }
    return sum;
  });
});

group("encoding-overhead", () => {
  bench("encode single locator pair (3 levels each)", () => {
    return encodeLocatorPair(singleA, singleB);
  });

  bench("encode + copy to WASM memory", () => {
    const buffer = encodeLocatorPair(singleA, singleB);
    wasmMemory.set(new Uint8Array(buffer), 0);
    return buffer;
  });
});

// ---------------------------------------------------------------------------
// Depth comparison (measure impact of locator depth)
// ---------------------------------------------------------------------------

group("depth-comparison-ts", () => {
  const depth1a = loc([1000]);
  const depth1b = loc([2000]);
  const depth2a = loc([1000, 100]);
  const depth2b = loc([1000, 200]);
  const depth3a = loc([1000, 100, 10]);
  const depth3b = loc([1000, 100, 20]);
  const depth4a = loc([1000, 100, 10, 1]);
  const depth4b = loc([1000, 100, 10, 2]);

  bench("TS: depth 1", () => compareLocatorsTS(depth1a, depth1b));
  bench("TS: depth 2", () => compareLocatorsTS(depth2a, depth2b));
  bench("TS: depth 3", () => compareLocatorsTS(depth3a, depth3b));
  bench("TS: depth 4", () => compareLocatorsTS(depth4a, depth4b));
});

group("depth-comparison-wasm", () => {
  const depth1a = loc([1000]);
  const depth1b = loc([2000]);
  const depth2a = loc([1000, 100]);
  const depth2b = loc([1000, 200]);
  const depth3a = loc([1000, 100, 10]);
  const depth3b = loc([1000, 100, 20]);
  const depth4a = loc([1000, 100, 10, 1]);
  const depth4b = loc([1000, 100, 10, 2]);

  // Pre-encode
  const enc1 = encodeLocatorPair(depth1a, depth1b);
  const enc2 = encodeLocatorPair(depth2a, depth2b);
  const enc3 = encodeLocatorPair(depth3a, depth3b);
  const enc4 = encodeLocatorPair(depth4a, depth4b);

  bench("WASM: depth 1 (pre-encoded)", () => {
    wasmMemory.set(new Uint8Array(enc1), 0);
    return wasmExports.compare_locators();
  });
  bench("WASM: depth 2 (pre-encoded)", () => {
    wasmMemory.set(new Uint8Array(enc2), 0);
    return wasmExports.compare_locators();
  });
  bench("WASM: depth 3 (pre-encoded)", () => {
    wasmMemory.set(new Uint8Array(enc3), 0);
    return wasmExports.compare_locators();
  });
  bench("WASM: depth 4 (pre-encoded)", () => {
    wasmMemory.set(new Uint8Array(enc4), 0);
    return wasmExports.compare_locators();
  });
});

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

console.log("Running benchmarks...\n");
console.log("Note: 'full overhead' includes JS→WASM encoding per call.");
console.log("      'pre-encoded' only measures WASM execution + memory copy.\n");

await run({
  format: isCI ? "json" : "mitata",
});
