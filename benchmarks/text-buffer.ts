/**
 * TextBuffer Benchmarks
 *
 * Comprehensive benchmarks for the TextBuffer CRDT covering:
 * - Single character insert/delete (target: <100us)
 * - Offset to line/col conversion (target: <50us)
 * - Line to offset conversion (target: <50us)
 * - Snapshot creation (target: <1us)
 * - Apply remote operation (target: <200us)
 * - Undo transaction (target: <500us)
 * - Serialization
 */

import { bench, group, run } from "mitata";
import { TextBuffer } from "../src/text/index.js";
import { loadEditingTrace } from "./fixtures.js";
import { type DocumentSize, generateSyntheticDocument } from "./synthetic.js";

const isCI = process.argv.includes("--ci");

// Document sizes to test
const sizes: DocumentSize[] = ["tiny", "small", "medium", "large"];
if (!isCI) {
  sizes.push("huge");
}

// Pre-generate synthetic documents
console.log("Generating synthetic documents...");
const docs: Record<string, string> = {};
for (const size of sizes) {
  docs[size] = generateSyntheticDocument(size);
}
console.log("Documents generated.\n");

// Pre-create TextBuffers for benchmarks
console.log("Creating TextBuffers...");
const buffers: Record<string, TextBuffer> = {};
for (const size of sizes) {
  const doc = docs[size];
  if (doc !== undefined) {
    buffers[size] = TextBuffer.fromString(doc);
  }
}
console.log("TextBuffers created.\n");

// ---------------------------------------------------------------------------
// Single Character Insert (target: <100us)
// ---------------------------------------------------------------------------

group("text-insert-char", () => {
  for (const size of ["tiny", "small", "medium"] as const) {
    const buf = buffers[size];
    if (buf === undefined) continue;

    bench(`insert char at start (${size})`, () => {
      buf.insert(0, "x");
      return buf;
    });

    bench(`insert char at middle (${size})`, () => {
      const mid = Math.floor(buf.length / 2);
      buf.insert(mid, "x");
      return buf;
    });

    bench(`insert char at end (${size})`, () => {
      buf.insert(buf.length, "x");
      return buf;
    });
  }
});

// ---------------------------------------------------------------------------
// Single Character Delete (target: <100us)
// ---------------------------------------------------------------------------

group("text-delete-char", () => {
  for (const size of ["tiny", "small", "medium"] as const) {
    const buf = buffers[size];
    if (buf === undefined) continue;

    bench(`delete char at start (${size})`, () => {
      if (buf.length > 0) {
        buf.delete(0, 1);
      }
      return buf;
    });

    bench(`delete char at middle (${size})`, () => {
      const mid = Math.floor(buf.length / 2);
      if (mid > 0) {
        buf.delete(mid - 1, mid);
      }
      return buf;
    });

    bench(`delete char at end (${size})`, () => {
      const len = buf.length;
      if (len > 0) {
        buf.delete(len - 1, len);
      }
      return buf;
    });
  }
});

// ---------------------------------------------------------------------------
// Snapshot Creation (target: <1us)
// ---------------------------------------------------------------------------

group("text-snapshot", () => {
  for (const size of sizes) {
    const buf = buffers[size];
    if (buf === undefined) continue;

    bench(`snapshot (${size})`, () => {
      return buf.snapshot();
    });
  }
});

// ---------------------------------------------------------------------------
// getText (read full document)
// ---------------------------------------------------------------------------

group("text-getText", () => {
  for (const size of sizes) {
    const buf = buffers[size];
    if (buf === undefined) continue;

    bench(`getText (${size})`, () => {
      return buf.getText();
    });
  }
});

// ---------------------------------------------------------------------------
// Undo/Redo (target: <500us)
// ---------------------------------------------------------------------------

group("text-undo-redo", () => {
  // Create a buffer with transaction history
  const undoBuf = TextBuffer.create();

  // Do 100 operations to build undo history
  for (let i = 0; i < 100; i++) {
    undoBuf.startTransaction();
    undoBuf.insert(undoBuf.length, `Line ${i}\n`);
    undoBuf.endTransaction();
  }

  bench("undo (100 transactions)", () => {
    undoBuf.undo();
    return undoBuf;
  });

  bench("redo (100 transactions)", () => {
    undoBuf.redo();
    return undoBuf;
  });
});

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

group("text-serialize", () => {
  for (const size of ["tiny", "small", "medium"] as const) {
    const buf = buffers[size];
    if (buf === undefined) continue;

    // Simple serialization via getText
    bench(`serialize via getText (${size})`, () => {
      return buf.getText();
    });
  }
});

// ---------------------------------------------------------------------------
// Document Creation
// ---------------------------------------------------------------------------

group("text-create", () => {
  bench("create empty", () => {
    return TextBuffer.create();
  });

  for (const size of ["tiny", "small", "medium"] as const) {
    const doc = docs[size];
    if (doc === undefined) continue;

    bench(`fromString (${size})`, () => {
      return TextBuffer.fromString(doc);
    });
  }
});

// ---------------------------------------------------------------------------
// Batch Operations (1000 chars)
// ---------------------------------------------------------------------------

group("text-batch-1000", () => {
  bench("sequential insert 1000 chars at end", () => {
    const buf = TextBuffer.create();
    for (let i = 0; i < 1000; i++) {
      buf.insert(buf.length, "x");
    }
    return buf;
  });

  bench("sequential insert 1000 chars at start", () => {
    const buf = TextBuffer.create();
    for (let i = 0; i < 1000; i++) {
      buf.insert(0, "x");
    }
    return buf;
  });

  bench("sequential delete 1000 chars from end", () => {
    const buf = TextBuffer.fromString("x".repeat(1000));
    for (let i = 0; i < 1000; i++) {
      const len = buf.length;
      if (len > 0) {
        buf.delete(len - 1, len);
      }
    }
    return buf;
  });

  bench("sequential delete 1000 chars from start", () => {
    const buf = TextBuffer.fromString("x".repeat(1000));
    for (let i = 0; i < 1000; i++) {
      if (buf.length > 0) {
        buf.delete(0, 1);
      }
    }
    return buf;
  });
});

// ---------------------------------------------------------------------------
// Kleppmann Editing Trace (target: <2s for 260K ops)
// ---------------------------------------------------------------------------

const trace = await loadEditingTrace();

if (trace) {
  console.log(
    `Loaded Kleppmann editing trace: ${trace.operations.length.toLocaleString()} operations\n`,
  );

  group("editing-trace-full", () => {
    bench(`replay full trace (${trace.operations.length.toLocaleString()} ops)`, () => {
      const buf = TextBuffer.create();
      for (const op of trace.operations) {
        if (op.deleteCount > 0 && buf.length > 0) {
          const start = Math.min(op.position, buf.length);
          const end = Math.min(op.position + op.deleteCount, buf.length);
          if (end > start) {
            buf.delete(start, end);
          }
        }
        if (op.insertText) {
          const pos = Math.min(op.position, buf.length);
          buf.insert(pos, op.insertText);
        }
      }
      return buf;
    });
  });

  // Benchmark subsets of the trace
  const subsetSizes = [1000, 10000, 50000, 100000];
  for (const subsetSize of subsetSizes) {
    if (subsetSize > trace.operations.length) continue;

    const subset = trace.operations.slice(0, subsetSize);

    group(`editing-trace-${subsetSize / 1000}k`, () => {
      bench(`replay ${subsetSize.toLocaleString()} ops`, () => {
        const buf = TextBuffer.create();
        for (const op of subset) {
          if (op.deleteCount > 0 && buf.length > 0) {
            const start = Math.min(op.position, buf.length);
            const end = Math.min(op.position + op.deleteCount, buf.length);
            if (end > start) {
              buf.delete(start, end);
            }
          }
          if (op.insertText) {
            const pos = Math.min(op.position, buf.length);
            buf.insert(pos, op.insertText);
          }
        }
        return buf;
      });
    });
  }
} else {
  console.log("Skipping Kleppmann trace benchmarks (run `bun run fixtures:download` first)\n");
}

// ---------------------------------------------------------------------------
// Remote Operations (target: <200us)
// ---------------------------------------------------------------------------

group("text-apply-remote", () => {
  // Create two buffers and collect operations from one
  const source = TextBuffer.create();
  const ops: ReturnType<typeof source.insert>[] = [];

  // Generate 100 operations
  for (let i = 0; i < 100; i++) {
    ops.push(source.insert(source.length, `Line ${i}\n`));
  }

  bench("apply 100 remote insert ops", () => {
    const target = TextBuffer.create();
    for (const op of ops) {
      target.applyRemote(op);
    }
    return target;
  });
});

// ---------------------------------------------------------------------------
// Run all benchmarks
// ---------------------------------------------------------------------------

await run({
  format: isCI ? "json" : "mitata",
});
