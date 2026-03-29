/**
 * Comprehensive Benchmark Suite for @iamnbutler/crdt
 *
 * Performance Targets:
 * - Single char insert: <100us, O(log n)
 * - Single char delete: <100us, O(log n)
 * - Offset -> line/col: <50us, O(log n)
 * - Line -> offset: <50us, O(log n)
 * - Snapshot creation: <1us, O(1)
 * - Apply remote op: <200us, O(log n)
 * - Undo transaction: <500us, O(k log n)
 * - Serialize 1M lines: <50ms, O(n)
 * - Kleppmann trace (260K ops): <2s
 */

import { bench, group, run, summary } from "mitata";
import {
  type CountSummary,
  SumTree,
  type Summarizable,
  type TextSummary,
  countDimension,
  countSummaryOps,
  lineDimension,
  textSummaryOps,
} from "../src/sum-tree/index.js";
import { TextBuffer } from "../src/text/index.js";
import { OperationBatcher } from "../src/text/operation-batcher.js";
import { loadEditingTrace } from "./fixtures.js";
import { type DocumentSize, generateSyntheticDocument } from "./synthetic.js";

const isCI = process.argv.includes("--ci");

// Document sizes for benchmarks
const sizes: DocumentSize[] = isCI
  ? ["tiny", "small", "medium", "large"]
  : ["tiny", "small", "medium", "large", "huge"];

// ---------------------------------------------------------------------------
// Setup: Create test data
// ---------------------------------------------------------------------------

// Simple item for SumTree benchmarks
class CountItem implements Summarizable<CountSummary> {
  constructor(public value: number) {}
  summary(): CountSummary {
    return { count: 1 };
  }
}

// Text chunk for line-based benchmarks
class TextChunk implements Summarizable<TextSummary> {
  constructor(public text: string) {}
  summary(): TextSummary {
    let lines = 0;
    let lastLineLen = 0;
    let lastLineBytes = 0;
    const encoder = new TextEncoder();
    const bytes = encoder.encode(this.text).length;

    for (let i = 0; i < this.text.length; i++) {
      if (this.text[i] === "\n") {
        lines++;
        lastLineLen = 0;
        lastLineBytes = 0;
      } else {
        lastLineLen++;
        lastLineBytes += encoder.encode(this.text[i] ?? "").length;
      }
    }

    return { lines, utf16Len: this.text.length, bytes, lastLineLen, lastLineBytes };
  }
}

console.log("Preparing benchmark data...\n");

// Pre-create SumTrees
const tree10K = SumTree.fromItems(
  Array.from({ length: 10000 }, (_, i) => new CountItem(i)),
  countSummaryOps,
  16,
);

const tree100K = SumTree.fromItems(
  Array.from({ length: 100000 }, (_, i) => new CountItem(i)),
  countSummaryOps,
  16,
);

let tree1M: SumTree<CountItem, CountSummary> | undefined;
if (!isCI) {
  tree1M = SumTree.fromItems(
    Array.from({ length: 1000000 }, (_, i) => new CountItem(i)),
    countSummaryOps,
    16,
  );
}

// Pre-create text tree for line-based seeks
const textTree10K = SumTree.fromItems(
  Array.from({ length: 10000 }, (_, i) => new TextChunk(`Line ${i}: sample content\n`)),
  textSummaryOps,
  16,
);

// Trees with different branching factors for comparison
const treeB8 = SumTree.fromItems(
  Array.from({ length: 100000 }, (_, i) => new CountItem(i)),
  countSummaryOps,
  8,
);

const treeB16 = SumTree.fromItems(
  Array.from({ length: 100000 }, (_, i) => new CountItem(i)),
  countSummaryOps,
  16,
);

const treeB32 = SumTree.fromItems(
  Array.from({ length: 100000 }, (_, i) => new CountItem(i)),
  countSummaryOps,
  32,
);

// Pre-create TextBuffers
const textBuffers: Record<string, TextBuffer> = {};
for (const size of sizes) {
  textBuffers[size] = TextBuffer.fromString(generateSyntheticDocument(size));
}

// Load editing trace
const editingTrace = await loadEditingTrace();

console.log("Setup complete. Starting benchmarks...\n");

// ---------------------------------------------------------------------------
// Baseline
// ---------------------------------------------------------------------------

summary(() => {
  bench("noop (baseline)", () => {
    // Intentionally empty - measures benchmark overhead
  });

  bench("Date.now()", () => {
    return Date.now();
  });
});

// ---------------------------------------------------------------------------
// SumTree: Seek Operations (target: <50us for O(log n))
// ---------------------------------------------------------------------------

group("sum-tree-seek", () => {
  bench("seek in 10K tree", () => {
    const cursor = tree10K.cursor(countDimension);
    cursor.seekForward(5000, "right");
    return cursor.item();
  });

  bench("seek in 100K tree", () => {
    const cursor = tree100K.cursor(countDimension);
    cursor.seekForward(50000, "right");
    return cursor.item();
  });

  if (tree1M) {
    bench("seek in 1M tree (target: <50us)", () => {
      const cursor = tree1M?.cursor(countDimension);
      cursor?.seekForward(500000, "right");
      return cursor?.item();
    });
  }
});

group("sum-tree-seek-by-line", () => {
  bench("seek by line in 10K lines", () => {
    const cursor = textTree10K.cursor(lineDimension);
    cursor.seekForward(5000, "right");
    return cursor.item();
  });
});

// ---------------------------------------------------------------------------
// SumTree: Insert Operations (target: <100us)
// ---------------------------------------------------------------------------

group("sum-tree-insert", () => {
  bench("insert at middle (10K tree)", () => {
    return tree10K.insertAt(5000, new CountItem(999));
  });

  bench("insert at middle (100K tree) (target: <100us)", () => {
    return tree100K.insertAt(50000, new CountItem(999));
  });

  if (tree1M) {
    bench("insert at middle (1M tree)", () => {
      return tree1M?.insertAt(500000, new CountItem(999));
    });
  }
});

// ---------------------------------------------------------------------------
// SumTree: Delete Operations (target: <100us)
// ---------------------------------------------------------------------------

group("sum-tree-delete", () => {
  bench("delete from 10K tree", () => {
    return tree10K.removeAt(5000);
  });

  bench("delete from 100K tree (target: <100us)", () => {
    return tree100K.removeAt(50000);
  });
});

// ---------------------------------------------------------------------------
// Branching Factor Comparison (B=8 vs B=16 vs B=32)
// ---------------------------------------------------------------------------

group("branching-factor-seek", () => {
  bench("seek 100K with B=8", () => {
    const cursor = treeB8.cursor(countDimension);
    cursor.seekForward(50000, "right");
    return cursor.item();
  });

  bench("seek 100K with B=16", () => {
    const cursor = treeB16.cursor(countDimension);
    cursor.seekForward(50000, "right");
    return cursor.item();
  });

  bench("seek 100K with B=32", () => {
    const cursor = treeB32.cursor(countDimension);
    cursor.seekForward(50000, "right");
    return cursor.item();
  });
});

group("branching-factor-insert", () => {
  bench("insert 100K with B=8", () => {
    return treeB8.insertAt(50000, new CountItem(999));
  });

  bench("insert 100K with B=16", () => {
    return treeB16.insertAt(50000, new CountItem(999));
  });

  bench("insert 100K with B=32", () => {
    return treeB32.insertAt(50000, new CountItem(999));
  });
});

// ---------------------------------------------------------------------------
// TextBuffer: Single Character Insert (target: <100us)
// ---------------------------------------------------------------------------

group("text-insert-char", () => {
  for (const size of ["tiny", "small", "medium"] as const) {
    const buf = textBuffers[size];
    if (!buf) continue;

    bench(`insert char at end (${size})`, () => {
      buf.insert(buf.length, "x");
      return buf;
    });

    bench(`insert char at middle (${size})`, () => {
      buf.insert(Math.floor(buf.length / 2), "x");
      return buf;
    });
  }
});

// ---------------------------------------------------------------------------
// TextBuffer: Single Character Delete (target: <100us)
// ---------------------------------------------------------------------------

group("text-delete-char", () => {
  for (const size of ["tiny", "small", "medium"] as const) {
    const buf = textBuffers[size];
    if (!buf) continue;

    bench(`delete char from end (${size})`, () => {
      if (buf.length > 0) {
        buf.delete(buf.length - 1, buf.length);
      }
      return buf;
    });

    bench(`delete char from middle (${size})`, () => {
      const mid = Math.floor(buf.length / 2);
      if (mid > 0) {
        buf.delete(mid - 1, mid);
      }
      return buf;
    });
  }
});

// ---------------------------------------------------------------------------
// TextBuffer: Snapshot Creation (target: <1us)
// ---------------------------------------------------------------------------

group("text-snapshot", () => {
  for (const size of ["tiny", "small", "medium"] as const) {
    const buf = textBuffers[size];
    if (!buf) continue;

    bench(`snapshot (${size}) (target: <1us)`, () => {
      return buf.snapshot();
    });
  }
});

// ---------------------------------------------------------------------------
// TextBuffer: Undo/Redo (target: <500us)
// ---------------------------------------------------------------------------

group("text-undo-redo", () => {
  // Create buffer with transaction history
  const undoBuf = TextBuffer.create();
  for (let i = 0; i < 100; i++) {
    undoBuf.startTransaction();
    undoBuf.insert(undoBuf.length, `Line ${i}\n`);
    undoBuf.endTransaction();
  }

  bench("undo transaction (target: <500us)", () => {
    undoBuf.undo();
    return undoBuf;
  });

  bench("redo transaction (target: <500us)", () => {
    undoBuf.redo();
    return undoBuf;
  });
});

// ---------------------------------------------------------------------------
// TextBuffer: Document Creation / Serialization
// ---------------------------------------------------------------------------

group("text-create", () => {
  bench("create empty", () => {
    return TextBuffer.create();
  });

  for (const size of ["tiny", "small", "medium"] as const) {
    bench(`fromString (${size})`, () => {
      return TextBuffer.fromString(generateSyntheticDocument(size));
    });
  }
});

group("text-serialize", () => {
  for (const size of sizes) {
    const buf = textBuffers[size];
    if (!buf) continue;

    bench(`getText (${size})`, () => {
      return buf.getText();
    });
  }
});

// ---------------------------------------------------------------------------
// TextBuffer: Batch Operations (1000 chars)
// ---------------------------------------------------------------------------

group("text-batch-1000", () => {
  bench("insert 1000 chars at end", () => {
    const buf = TextBuffer.create();
    for (let i = 0; i < 1000; i++) {
      buf.insert(buf.length, "x");
    }
    return buf;
  });

  bench("insert 1000 chars at start", () => {
    const buf = TextBuffer.create();
    for (let i = 0; i < 1000; i++) {
      buf.insert(0, "x");
    }
    return buf;
  });
});

// ---------------------------------------------------------------------------
// Kleppmann Editing Trace (target: <2s for 260K ops)
// ---------------------------------------------------------------------------

if (editingTrace) {
  console.log(
    `Loaded editing trace: ${editingTrace.operations.length.toLocaleString()} operations\n`,
  );

  // Subset benchmarks for quick iterations
  group("editing-trace-subsets", () => {
    for (const count of [1000, 10000, 50000]) {
      if (count > editingTrace.operations.length) continue;
      const subset = editingTrace.operations.slice(0, count);

      bench(`replay ${count.toLocaleString()} ops`, () => {
        const buf = TextBuffer.create();
        for (const op of subset) {
          if (op.deleteCount > 0 && buf.length > 0) {
            const start = Math.min(op.position, buf.length);
            const end = Math.min(op.position + op.deleteCount, buf.length);
            if (end > start) buf.delete(start, end);
          }
          if (op.insertText) {
            buf.insert(Math.min(op.position, buf.length), op.insertText);
          }
        }
        return buf;
      });
    }
  });

  // Full trace benchmark (only run in non-CI mode due to time)
  if (!isCI) {
    group("editing-trace-full", () => {
      bench(
        `replay full trace (${editingTrace.operations.length.toLocaleString()} ops) (target: <2s)`,
        () => {
          const buf = TextBuffer.create();
          for (const op of editingTrace.operations) {
            if (op.deleteCount > 0 && buf.length > 0) {
              const start = Math.min(op.position, buf.length);
              const end = Math.min(op.position + op.deleteCount, buf.length);
              if (end > start) buf.delete(start, end);
            }
            if (op.insertText) {
              buf.insert(Math.min(op.position, buf.length), op.insertText);
            }
          }
          return buf;
        },
      );
    });
  }
  // ---------------------------------------------------------------------------
  // Batched trace replay (OperationBatcher coalescing)
  // ---------------------------------------------------------------------------

  group("editing-trace-batched", () => {
    for (const count of [1000, 10000, 50000]) {
      if (count > editingTrace.operations.length) continue;
      const subset = editingTrace.operations.slice(0, count);

      bench(`batched replay ${count.toLocaleString()} ops`, () => {
        const buf = TextBuffer.create();
        const batcher = new OperationBatcher(buf, { flushDelay: 0, maxBatchSize: 200 });
        for (const op of subset) {
          if (op.deleteCount > 0) {
            const len = batcher.getLength();
            if (len > 0) {
              const start = Math.min(op.position, len);
              const end = Math.min(op.position + op.deleteCount, len);
              if (end > start) batcher.delete(start, end);
            }
          }
          if (op.insertText) {
            const len = batcher.getLength();
            batcher.insert(Math.min(op.position, len), op.insertText);
          }
        }
        batcher.flush();
        return buf;
      });
    }
  });

  if (!isCI) {
    group("editing-trace-batched-full", () => {
      bench(
        `batched replay full trace (${editingTrace.operations.length.toLocaleString()} ops)`,
        () => {
          const buf = TextBuffer.create();
          const batcher = new OperationBatcher(buf, { flushDelay: 0, maxBatchSize: 200 });
          for (const op of editingTrace.operations) {
            if (op.deleteCount > 0) {
              const len = batcher.getLength();
              if (len > 0) {
                const start = Math.min(op.position, len);
                const end = Math.min(op.position + op.deleteCount, len);
                if (end > start) batcher.delete(start, end);
              }
            }
            if (op.insertText) {
              const len = batcher.getLength();
              batcher.insert(Math.min(op.position, len), op.insertText);
            }
          }
          batcher.flush();
          return buf;
        },
      );
    });
  }
} else {
  console.log("Skipping editing trace benchmarks. Run `bun run fixtures:download` first.\n");
}

// ---------------------------------------------------------------------------
// Apply Remote Operations (target: <200us)
// ---------------------------------------------------------------------------

group("text-apply-remote", () => {
  // Generate operations from source buffer
  const source = TextBuffer.create();
  const ops: ReturnType<typeof source.insert>[] = [];
  for (let i = 0; i < 100; i++) {
    ops.push(source.insert(source.length, `Line ${i}\n`));
  }

  bench("apply 100 remote insert ops (target: <200us each)", () => {
    const target = TextBuffer.create();
    for (const op of ops) {
      target.applyRemote(op);
    }
    return target;
  });
});

// ---------------------------------------------------------------------------
// Synthetic Document Generation
// ---------------------------------------------------------------------------

group("synthetic-generation", () => {
  for (const size of ["tiny", "small", "medium"] as const) {
    bench(`generate ${size} document`, () => {
      return generateSyntheticDocument(size);
    });
  }
});

// ---------------------------------------------------------------------------
// Run Benchmarks
// ---------------------------------------------------------------------------

await run({
  format: isCI ? "json" : "mitata",
});
