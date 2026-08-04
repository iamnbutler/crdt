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
import type { Fragment } from "../src/text/index.js";
import { TextBuffer, replicaId, sortFragments } from "../src/text/index.js";
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
// Fragment Bulk Sort
//
// Baseline for bulk fragment sorting (see issue #187). Whenever a split or a
// remote insert forces a canonical re-order, TextBuffer runs
// `sortFragments()` (Array.sort with `compareFragmentsForSort`) over the whole
// fragment list and then `setFragments()`, which rebuilds the SumTree
// (`SumTree.fromItems`) *and* the `_fragmentIds` index. These benchmarks
// isolate those three costs so alternative sorting strategies have something
// concrete to beat.
//
// The comparator walks locator levels, so its cost scales with locator depth,
// not just fragment count. The corpora below are built by real editing so the
// depth distribution is representative (~6 levels at 1K, ~12 at 50K).
//
// Baseline as of 2026-08, bun 1.3.14 on arm64-linux @ ~3 GHz (avg/iter):
//
//   frags | sort (sorted) | sort (shuffled) | rebuild only | sort + rebuild
//   ------|---------------|-----------------|--------------|---------------
//     1K  |      37.5 us  |         315 us  |      120 us  |        462 us
//    10K  |      1.10 ms  |        7.94 ms  |     3.39 ms  |       12.2 ms
//    50K  |      18.8 ms  |         111 ms  |     45.2 ms  |        156 ms
//
// So the headline number for #117: sorting 10K fragments from scratch costs
// ~8 ms, and the tree rebuild that follows adds ~3 ms on top.
// ---------------------------------------------------------------------------

/** Deterministic PRNG so corpora are identical across runs. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Build a maximally fragmented fragment list in canonical order.
 *
 * Models `replicas` peers editing offline and then merging: each peer performs
 * single-character inserts at random offsets (every insert yields one
 * fragment), and the merged state is the concatenation of every peer's
 * fragments in canonical order. Peers that never synced produce overlapping
 * locators, so the merged list also exercises the comparator's operation-ID
 * tie-break — roughly a quarter of adjacent pairs share a locator.
 *
 * Building each peer separately is also what keeps setup affordable: local
 * inserts get more expensive as a buffer grows, so four buffers of n/4
 * fragments cost far less than one buffer of n.
 */
function buildFragmentCorpus(count: number, replicas: number): Fragment[] {
  const frags: Fragment[] = [];

  for (let r = 0; r < replicas; r++) {
    const rand = mulberry32(0x5eed + r * 7919);
    const buf = TextBuffer.create(replicaId(r + 1));
    const share = Math.floor(count / replicas) + (r < count % replicas ? 1 : 0);

    for (let i = 0; i < share; i++) {
      const pos = buf.length === 0 ? 0 : Math.floor(rand() * (buf.length + 1));
      buf.insert(pos, "x");
    }

    frags.push(...buf.fragmentList());
  }

  sortFragments(frags);
  return frags;
}

/** Fisher-Yates shuffle with a fixed seed. */
function shuffled(frags: Fragment[]): Fragment[] {
  const out = [...frags];
  const rand = mulberry32(0xd1ce);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const a = out[i];
    const b = out[j];
    if (a !== undefined && b !== undefined) {
      out[i] = b;
      out[j] = a;
    }
  }
  return out;
}

const fragmentCounts = [1_000, 10_000, 50_000];

console.log("Building fragment corpora for bulk sort benchmarks...");
const corpora = new Map<number, { canonical: Fragment[]; scrambled: Fragment[] }>();
for (const count of fragmentCounts) {
  const canonical = buildFragmentCorpus(count, 4);
  corpora.set(count, { canonical, scrambled: shuffled(canonical) });
  console.log(`  ${count.toLocaleString()} fragments ready`);
}
console.log("Fragment corpora ready.\n");

group("fragment-bulk-sort", () => {
  for (const count of fragmentCounts) {
    const corpus = corpora.get(count);
    if (corpus === undefined) continue;
    const { canonical, scrambled } = corpus;
    const label = count.toLocaleString();

    // Each bench copies its input first, because sortFragments sorts in place
    // and would otherwise measure an already-sorted array from iteration 2 on.
    // The copy is an O(n) memcpy of object references — negligible next to the
    // comparator work, but it is inside the timed region.

    // Already in canonical order: the common case, and TimSort's best case
    // since it detects the single ascending run.
    bench(`sort ${label} frags (already sorted)`, () => {
      const frags = [...canonical];
      sortFragments(frags);
      return frags;
    });

    // Fully scrambled: worst case, ~n log n comparator calls.
    bench(`sort ${label} frags (shuffled)`, () => {
      const frags = [...scrambled];
      sortFragments(frags);
      return frags;
    });

    // Target buffer for the rebuild benches, created outside the timed region.
    // replaceFragments swaps in a fresh SumTree each call, so repeating it with
    // the same fragments is idempotent.
    const target = TextBuffer.create();

    // Tree rebuild only: SumTree.fromItems + _fragmentIds index rebuild.
    bench(`rebuild tree from ${label} frags`, () => {
      target.replaceFragments(canonical);
      return target;
    });

    // The full path TextBuffer takes after a split or remote insert:
    // sortFragments + setFragments.
    bench(`sort + rebuild ${label} frags (shuffled)`, () => {
      const frags = [...scrambled];
      sortFragments(frags);
      target.replaceFragments(frags);
      return target;
    });
  }
});

// ---------------------------------------------------------------------------
// Run all benchmarks
// ---------------------------------------------------------------------------

await run({
  format: isCI ? "json" : "mitata",
});
