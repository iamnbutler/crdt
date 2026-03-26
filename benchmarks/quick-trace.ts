import { TextBuffer } from "../src/text/index.js";
import { loadEditingTrace } from "./fixtures.js";

const trace = await loadEditingTrace();
if (!trace) {
  console.log("No trace found - run bun run fixtures:download");
  process.exit(1);
}

console.log(`Loaded editing trace: ${trace.operations.length.toLocaleString()} operations`);

// Warmup
const warmupBuf = TextBuffer.create();
for (let i = 0; i < 1000; i++) {
  warmupBuf.insert(warmupBuf.length, "x");
}

// Benchmark the full trace
const iterations = 3;
const times: number[] = [];

for (let i = 0; i < iterations; i++) {
  const start = performance.now();
  const buf = TextBuffer.create();
  for (const op of trace.operations) {
    if (op.deleteCount > 0 && buf.length > 0) {
      const startPos = Math.min(op.position, buf.length);
      const end = Math.min(op.position + op.deleteCount, buf.length);
      if (end > startPos) {
        buf.delete(startPos, end);
      }
    }
    if (op.insertText) {
      const pos = Math.min(op.position, buf.length);
      buf.insert(pos, op.insertText);
    }
  }
  const elapsed = performance.now() - start;
  times.push(elapsed);
  console.log(`Run ${i + 1}: ${elapsed.toFixed(0)}ms (final length: ${buf.length})`);
}

const avg = times.reduce((a, b) => a + b, 0) / times.length;
const min = Math.min(...times);
const max = Math.max(...times);

console.log("\nResults:");
console.log(`  Avg: ${avg.toFixed(0)}ms`);
console.log(`  Min: ${min.toFixed(0)}ms`);
console.log(`  Max: ${max.toFixed(0)}ms`);
console.log("  Target: <100ms (prev: 2.87s)");
