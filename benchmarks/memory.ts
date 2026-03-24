/**
 * Memory Profiling Benchmarks
 *
 * Measures:
 * - Heap size growth with document size
 * - GC pause times
 * - Memory efficiency (bytes per character)
 */

import { TextBuffer } from "../src/text/index.js";
import { type DocumentSize, generateSyntheticDocument, getSizeConfig } from "./synthetic.js";

const isCI = process.argv.includes("--ci");

interface MemoryResult {
  size: DocumentSize;
  lines: number;
  chars: number;
  heapUsed: number;
  heapTotal: number;
  bytesPerChar: number;
  gcPauseMs: number;
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }
  if (bytes >= 1024) {
    return `${(bytes / 1024).toFixed(2)} KB`;
  }
  return `${bytes} B`;
}

function getMemoryUsage(): { heapUsed: number; heapTotal: number } {
  const usage = process.memoryUsage();
  return {
    heapUsed: usage.heapUsed,
    heapTotal: usage.heapTotal,
  };
}

function measureGCPause(): number {
  const start = performance.now();
  // Force full GC if available
  if (typeof Bun !== "undefined" && typeof Bun.gc === "function") {
    Bun.gc(true); // true = sync GC
  } else if (global.gc) {
    global.gc();
  }
  return performance.now() - start;
}

async function measureDocument(size: DocumentSize): Promise<MemoryResult> {
  // Force GC before measurement
  measureGCPause();

  const beforeMemory = getMemoryUsage();

  // Generate and load document
  const content = generateSyntheticDocument(size);
  const buffer = TextBuffer.fromString(content);

  const afterMemory = getMemoryUsage();
  const gcPauseMs = measureGCPause();

  const config = getSizeConfig(size);
  const chars = buffer.length;

  const heapGrowth = afterMemory.heapUsed - beforeMemory.heapUsed;
  const bytesPerChar = heapGrowth > 0 ? heapGrowth / chars : 0;

  return {
    size,
    lines: config.lines,
    chars,
    heapUsed: afterMemory.heapUsed,
    heapTotal: afterMemory.heapTotal,
    bytesPerChar,
    gcPauseMs,
  };
}

function printResult(result: MemoryResult): void {
  console.log(
    `  ${result.size.padEnd(10)} | ${result.lines.toLocaleString().padStart(12)} lines | ${result.chars.toLocaleString().padStart(12)} chars | ${formatBytes(result.heapUsed).padStart(10)} heap | ${result.bytesPerChar.toFixed(2).padStart(8)} bytes/char | ${result.gcPauseMs.toFixed(2).padStart(8)}ms GC`,
  );
}

async function main(): Promise<void> {
  console.log("Memory Profiling Results");
  console.log("=".repeat(100));
  console.log();

  const sizes: DocumentSize[] = isCI
    ? ["tiny", "small", "medium"]
    : ["tiny", "small", "medium", "large", "huge"];

  console.log("Document Memory Usage:");
  console.log("-".repeat(100));

  const results: MemoryResult[] = [];

  for (const size of sizes) {
    try {
      const result = await measureDocument(size);
      results.push(result);
      printResult(result);
    } catch (error) {
      console.log(
        `  ${size.padEnd(10)} | ERROR: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  console.log();
  console.log("=".repeat(100));
  console.log();

  // Summary statistics
  if (results.length > 0) {
    const avgBytesPerChar = results.reduce((sum, r) => sum + r.bytesPerChar, 0) / results.length;
    const avgGcPause = results.reduce((sum, r) => sum + r.gcPauseMs, 0) / results.length;

    console.log("Summary:");
    console.log(`  Average bytes per character: ${avgBytesPerChar.toFixed(2)}`);
    console.log(`  Average GC pause: ${avgGcPause.toFixed(2)}ms`);
    console.log();

    // Memory efficiency rating
    if (avgBytesPerChar < 10) {
      console.log("  Rating: EXCELLENT (< 10 bytes/char)");
    } else if (avgBytesPerChar < 50) {
      console.log("  Rating: GOOD (< 50 bytes/char)");
    } else if (avgBytesPerChar < 100) {
      console.log("  Rating: ACCEPTABLE (< 100 bytes/char)");
    } else {
      console.log("  Rating: NEEDS IMPROVEMENT (>= 100 bytes/char)");
    }
  }

  // Output JSON for CI
  if (isCI) {
    console.log();
    console.log("JSON Output:");
    console.log(JSON.stringify(results, null, 2));
  }
}

main().catch((err: unknown) => {
  console.error("Error:", err);
  process.exit(1);
});
