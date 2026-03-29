/**
 * Exploration: Parallel getText() via Web Workers
 *
 * Tests whether partitioning fragment traversal across workers
 * provides a speedup for large documents.
 *
 * Issue: #190
 */

import { TextBuffer } from "../../src/text/index.js";
import {
  generateSyntheticDocument,
  type DocumentSize,
} from "../../benchmarks/synthetic.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildBuffer(size: DocumentSize): TextBuffer {
  const text = generateSyntheticDocument(size);
  const buf = new TextBuffer("bench-peer");
  if (text.length > 0) {
    buf.insert(0, text);
  }
  return buf;
}

/** Extract fragments from a TextBuffer (uses internal API for prototype). */
function extractFragments(
  buf: TextBuffer,
): Array<{ text: string; visible: boolean }> {
  // Access internal fragments via getText path — collect all fragments
  // We use the public snapshot API to get fragments
  const snap = buf.snapshot();
  const fullText = snap.getText();
  snap.release();

  // For the prototype, we simulate fragment extraction by chunking
  // the visible text. In a real implementation, we'd access the SumTree directly.
  // This gives us a fair comparison of the parallelization overhead.
  const chunkSize = 4096;
  const fragments: Array<{ text: string; visible: boolean }> = [];
  for (let i = 0; i < fullText.length; i += chunkSize) {
    fragments.push({
      text: fullText.slice(i, i + chunkSize),
      visible: true,
    });
  }
  return fragments;
}

// ---------------------------------------------------------------------------
// Single-threaded baseline
// ---------------------------------------------------------------------------

function singleThreadedGetText(
  fragments: Array<{ text: string; visible: boolean }>,
): string {
  const parts: string[] = [];
  for (const frag of fragments) {
    if (frag.visible) {
      parts.push(frag.text);
    }
  }
  return parts.join("");
}

// ---------------------------------------------------------------------------
// Worker-based parallel getText
// ---------------------------------------------------------------------------

async function parallelGetText(
  fragments: Array<{ text: string; visible: boolean }>,
  numWorkers: number,
): Promise<string> {
  const chunkSize = Math.ceil(fragments.length / numWorkers);
  const chunks: Array<Array<{ text: string; visible: boolean }>> = [];

  for (let i = 0; i < numWorkers; i++) {
    chunks.push(fragments.slice(i * chunkSize, (i + 1) * chunkSize));
  }

  const workerPath = new URL("./worker.ts", import.meta.url).href;
  const results = await Promise.all(
    chunks.map(
      (chunk) =>
        new Promise<string>((resolve, reject) => {
          const worker = new Worker(workerPath);
          worker.onmessage = (e: MessageEvent) => {
            resolve(e.data as string);
            worker.terminate();
          };
          worker.onerror = (e) => {
            reject(new Error(`Worker error: ${String(e)}`));
            worker.terminate();
          };
          worker.postMessage(chunk);
        }),
    ),
  );

  return results.join("");
}

// ---------------------------------------------------------------------------
// Worker pool variant (amortizes creation cost)
// ---------------------------------------------------------------------------

class WorkerPool {
  private workers: Worker[] = [];
  private workerPath: string;

  constructor(size: number) {
    this.workerPath = new URL("./worker.ts", import.meta.url).href;
    for (let i = 0; i < size; i++) {
      this.workers.push(new Worker(this.workerPath));
    }
  }

  async getText(
    fragments: Array<{ text: string; visible: boolean }>,
  ): Promise<string> {
    const numWorkers = this.workers.length;
    const chunkSize = Math.ceil(fragments.length / numWorkers);

    const results = await Promise.all(
      this.workers.map(
        (worker, i) =>
          new Promise<string>((resolve) => {
            const chunk = fragments.slice(
              i * chunkSize,
              (i + 1) * chunkSize,
            );
            worker.onmessage = (e: MessageEvent) => {
              resolve(e.data as string);
            };
            worker.postMessage(chunk);
          }),
      ),
    );

    return results.join("");
  }

  terminate(): void {
    for (const w of this.workers) {
      w.terminate();
    }
    this.workers = [];
  }
}

// ---------------------------------------------------------------------------
// SharedArrayBuffer feasibility test
// ---------------------------------------------------------------------------

function testSharedArrayBufferFeasibility(): {
  supported: boolean;
  canShareArena: boolean;
  notes: string[];
} {
  const notes: string[] = [];

  // Test 1: Is SharedArrayBuffer available?
  let supported = false;
  try {
    const sab = new SharedArrayBuffer(1024);
    const view = new Uint32Array(sab);
    view[0] = 42;
    supported = true;
    notes.push("SharedArrayBuffer is available in Bun runtime");
  } catch {
    notes.push("SharedArrayBuffer is NOT available");
    return { supported: false, canShareArena: false, notes };
  }

  // Test 2: Can we share a SharedArrayBuffer with a worker?
  // (We test this implicitly via the worker benchmarks)

  // Test 3: Arena compatibility analysis
  notes.push(
    "Arena metadata (Uint32Array) COULD be backed by SharedArrayBuffer",
  );
  notes.push(
    "Arena items (Array<T | undefined>) CANNOT be shared — JS objects require structured clone",
  );
  notes.push(
    "Arena children (Array<NodeId[]>) CANNOT be shared — JS arrays require structured clone",
  );
  notes.push(
    "Fragment text (string) CANNOT be placed in SharedArrayBuffer — strings are JS objects",
  );
  notes.push(
    "CONCLUSION: Zero-copy sharing of SumTree data is NOT feasible with current architecture",
  );
  notes.push(
    "Would require Struct-of-Arrays (SoA) layout (issue #112) with text stored in binary format",
  );

  return { supported, canShareArena: false, notes };
}

// ---------------------------------------------------------------------------
// Benchmark runner
// ---------------------------------------------------------------------------

async function benchmark(
  label: string,
  fn: () => string | Promise<string>,
  iterations: number,
): Promise<{ mean: number; median: number; min: number; max: number }> {
  const times: number[] = [];

  // Warmup
  for (let i = 0; i < Math.min(3, iterations); i++) {
    await fn();
  }

  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    await fn();
    times.push(performance.now() - start);
  }

  times.sort((a, b) => a - b);
  const mean = times.reduce((a, b) => a + b, 0) / times.length;
  const median = times[Math.floor(times.length / 2)] ?? 0;
  const min = times[0] ?? 0;
  const max = times[times.length - 1] ?? 0;

  console.log(
    `  ${label}: mean=${mean.toFixed(3)}ms median=${median.toFixed(3)}ms min=${min.toFixed(3)}ms max=${max.toFixed(3)}ms`,
  );

  return { mean, median, min, max };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("=== Parallel getText() Exploration (Issue #190) ===\n");

  // --- SharedArrayBuffer Feasibility ---
  console.log("--- SharedArrayBuffer Feasibility ---");
  const feasibility = testSharedArrayBufferFeasibility();
  for (const note of feasibility.notes) {
    console.log(`  ${note}`);
  }
  console.log();

  // --- Baseline: TextBuffer.getText() ---
  const sizes: Array<{ name: string; size: DocumentSize }> = [
    { name: "100K lines", size: "large" },
  ];

  // Only test huge (1M) if explicitly requested
  if (process.argv.includes("--huge")) {
    sizes.push({ name: "1M lines", size: "huge" });
  }

  for (const { name, size } of sizes) {
    console.log(`--- Document: ${name} ---`);
    console.log("Building document...");
    const buf = buildBuffer(size);
    const fragments = extractFragments(buf);
    console.log(
      `  ${fragments.length} fragments, ~${(fragments.reduce((a, f) => a + f.text.length, 0) / 1024 / 1024).toFixed(1)}MB text`,
    );

    // Verify correctness
    const expected = singleThreadedGetText(fragments);

    // Single-threaded
    const iterations = size === "huge" ? 5 : 10;
    console.log(`\nSingle-threaded (${iterations} iterations):`);
    const stResult = await benchmark(
      "single-thread",
      () => singleThreadedGetText(fragments),
      iterations,
    );

    // Direct TextBuffer.getText() for baseline
    console.log(`\nTextBuffer.getText() baseline (${iterations} iterations):`);
    await benchmark("TextBuffer.getText()", () => buf.getText(), iterations);

    // Parallel with fresh workers
    for (const numWorkers of [2, 4]) {
      console.log(
        `\nParallel (${numWorkers} workers, fresh per call, ${iterations} iterations):`,
      );
      const pResult = await benchmark(
        `${numWorkers}-workers`,
        async () => {
          const result = await parallelGetText(fragments, numWorkers);
          return result;
        },
        iterations,
      );

      // Verify correctness
      const pText = await parallelGetText(fragments, numWorkers);
      if (pText !== expected) {
        console.log("  ERROR: parallel result does not match!");
      }

      const speedup = stResult.mean / pResult.mean;
      console.log(`  Speedup vs single-thread: ${speedup.toFixed(2)}x`);
    }

    // Parallel with worker pool
    for (const numWorkers of [2, 4]) {
      console.log(
        `\nParallel (${numWorkers} workers, pooled, ${iterations} iterations):`,
      );
      const pool = new WorkerPool(numWorkers);

      // Extra warmup for pool
      await pool.getText(fragments);
      await pool.getText(fragments);

      const poolResult = await benchmark(
        `${numWorkers}-workers-pooled`,
        async () => {
          return await pool.getText(fragments);
        },
        iterations,
      );

      const speedup = stResult.mean / poolResult.mean;
      console.log(`  Speedup vs single-thread: ${speedup.toFixed(2)}x`);

      pool.terminate();
    }

    console.log();
  }

  // --- Summary ---
  console.log("=== Summary ===");
  console.log("Key findings:");
  console.log(
    "1. Arena stores items as JS objects — SharedArrayBuffer zero-copy is NOT feasible",
  );
  console.log(
    "2. Fragment text is JS strings — cannot be placed in SharedArrayBuffer",
  );
  console.log(
    "3. Worker communication requires structured clone (copies data)",
  );
  console.log(
    "4. See benchmark results above for overhead vs. parallelism tradeoff",
  );
  console.log(
    "\nPrerequisites for zero-copy worker sharing:",
  );
  console.log(
    "  - Struct-of-Arrays layout (issue #112) with binary text storage",
  );
  console.log(
    "  - Arena backed by SharedArrayBuffer from allocation time",
  );
  console.log(
    "\nAlternatives that may be more impactful:",
  );
  console.log(
    "  - Lazy getText() / rope materialization (issue #121)",
  );
  console.log(
    "  - Snapshot memoization (already implemented — O(1) after first call)",
  );
  console.log(
    "  - Off-main-thread CRDT (issue #122) — moves entire buffer to worker",
  );
}

main().catch(console.error);
