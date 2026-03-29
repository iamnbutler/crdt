/**
 * Benchmark: Hand-written WAT locator operations vs TypeScript baseline.
 *
 * Tests three scenarios:
 * 1. Individual comparisons (expected: TS wins due to boundary overhead)
 * 2. Batched comparisons (expected: crossover point somewhere)
 * 3. Batched binary search (expected: WASM wins for large N with batching)
 */

import { bench, group, run } from "mitata";
import { LocatorWasm } from "../src/wasm/locator-wasm.js";
import { compileLocatorOps } from "../src/wasm/compile.js";
import { compareLocators } from "../src/text/locator.js";
import type { Locator } from "../src/text/types.js";

function loc(...levels: number[]): Locator {
  return { levels };
}

/** Generate N sorted locators with variable depth */
function generateSortedLocators(n: number): Locator[] {
  const result: Locator[] = [];
  for (let i = 0; i < n; i++) {
    const depth = 1 + (i % 4);
    const levels: number[] = [i * 10];
    for (let d = 1; d < depth; d++) {
      levels.push((i * 7 + d * 13) % 1000);
    }
    result.push({ levels });
  }
  return result;
}

/** Generate N random locator pairs for comparison */
function generatePairs(n: number): [Locator, Locator][] {
  const pairs: [Locator, Locator][] = [];
  for (let i = 0; i < n; i++) {
    const depthA = 1 + (i % 4);
    const depthB = 1 + ((i + 1) % 4);
    const a: number[] = [];
    const b: number[] = [];
    for (let d = 0; d < depthA; d++) a.push((i * 7 + d * 13) % 10000);
    for (let d = 0; d < depthB; d++) b.push((i * 11 + d * 17) % 10000);
    pairs.push([{ levels: a }, { levels: b }]);
  }
  return pairs;
}

/** TypeScript binary search (matches WASM semantics) */
function tsBinarySearch(haystack: Locator[], key: Locator): number {
  let lo = 0;
  let hi = haystack.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    const midLoc = haystack[mid];
    if (midLoc !== undefined && compareLocators(key, midLoc) <= 0) {
      hi = mid;
    } else {
      lo = mid + 1;
    }
  }
  return lo;
}

/** Create a fresh WASM instance (avoids shared state between benchmark groups) */
async function createWasm(): Promise<LocatorWasm> {
  const binary = await compileLocatorOps();
  return LocatorWasm.fromBinary(binary.buffer);
}

async function main() {
  const binary = await compileLocatorOps();
  console.log(`WASM module: ${binary.byteLength} bytes\n`);

  // ===== Scenario 1: Individual comparisons =====
  const wasm1 = await createWasm();
  const singlePairA = loc(42, 100, 7);
  const singlePairB = loc(42, 100, 9);

  group("Single comparison", () => {
    bench("TypeScript compareLocators", () => {
      compareLocators(singlePairA, singlePairB);
    });

    bench("WASM compareSingle", () => {
      wasm1.compareSingle(singlePairA, singlePairB);
    });
  });

  // ===== Scenario 2: Batched comparisons at various sizes =====
  // Use separate WASM instances to avoid memory conflicts
  for (const size of [10, 100, 1000, 5000]) {
    const wasmBatch = await createWasm();
    const pairs = generatePairs(size);

    group(`Batch compare ${size} pairs`, () => {
      bench("TypeScript (loop)", () => {
        for (const [a, b] of pairs) {
          compareLocators(a, b);
        }
      });

      bench("WASM (batch)", () => {
        wasmBatch.batchCompare(pairs);
      });
    });
  }

  // ===== Scenario 3: Binary search at various haystack sizes =====
  for (const haystackSize of [100, 1000, 10000]) {
    const haystack = generateSortedLocators(haystackSize);

    // Separate instances for single vs batch
    const wasmSingle = await createWasm();
    wasmSingle.loadHaystack(haystack);

    const wasmBatch = await createWasm();
    wasmBatch.loadHaystack(haystack);

    const numKeys = 100;
    const keys: Locator[] = [];
    for (let i = 0; i < numKeys; i++) {
      const depth = 1 + (i % 3);
      const levels: number[] = [
        Math.floor((i * haystackSize) / numKeys) * 10,
      ];
      for (let d = 1; d < depth; d++) levels.push((i * 11 + d) % 500);
      keys.push({ levels });
    }

    group(`Binary search: 100 keys in ${haystackSize} items`, () => {
      bench("TypeScript (100 searches)", () => {
        for (const key of keys) {
          tsBinarySearch(haystack, key);
        }
      });

      bench("WASM single_search × 100", () => {
        for (const key of keys) {
          wasmSingle.singleSearch(haystackSize, key);
        }
      });

      bench("WASM batch_search × 100", () => {
        wasmBatch.batchSearch(haystackSize, keys);
      });
    });
  }

  // ===== Scenario 4: Realistic editing trace pattern =====
  const docSize = 5000;
  const sortedDoc = generateSortedLocators(docSize);
  const wasmDoc = await createWasm();
  wasmDoc.loadHaystack(sortedDoc);

  const insertKeys: Locator[] = [];
  for (let i = 0; i < 100; i++) {
    insertKeys.push(
      loc(Math.floor(Math.random() * docSize * 10), i % 100),
    );
  }

  group(`Sequential inserts: find position in ${docSize}-item doc`, () => {
    bench("TypeScript binary search × 100", () => {
      for (const key of insertKeys) {
        tsBinarySearch(sortedDoc, key);
      }
    });

    bench("WASM batch search × 100", () => {
      wasmDoc.batchSearch(docSize, insertKeys);
    });
  });

  await run();
}

main().catch(console.error);
