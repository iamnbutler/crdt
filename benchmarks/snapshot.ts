/**
 * Snapshot benchmarks for O(1) creation and release.
 *
 * Target: <1μs for snapshot creation with <10 replicas
 */

import { bench, group, run, summary } from "mitata";
import { TextBuffer } from "../src/text/text-buffer.js";
import { generateSyntheticDocument } from "./synthetic.js";

const isCI = process.argv.includes("--ci");

// Pre-create buffers of various sizes
console.log("Creating test buffers...");

const smallDoc = generateSyntheticDocument("tiny"); // ~100 lines
const mediumDoc = generateSyntheticDocument("small"); // ~1K lines
const largeDoc = generateSyntheticDocument("medium"); // ~10K lines

const smallBuffer = TextBuffer.fromString(smallDoc);
const mediumBuffer = TextBuffer.fromString(mediumDoc);
const largeBuffer = TextBuffer.fromString(largeDoc);

// Create buffers with many edits (more fragments)
const editedBuffer = TextBuffer.fromString(smallDoc);
for (let i = 0; i < 100; i++) {
  editedBuffer.insert(i * 10, "x");
}

// Create buffer with simulated multi-replica scenario
// (more version vector entries)
const multiReplicaBuffers: TextBuffer[] = [];
for (let i = 0; i < 10; i++) {
  const buf = TextBuffer.create();
  buf.insert(0, `Replica ${i}`);
  multiReplicaBuffers.push(buf);
}

console.log("Buffers created.\n");

// Snapshot creation benchmarks
summary(() => {
  bench("baseline noop", () => {
    // empty baseline
  });
});

group("snapshot-creation", () => {
  bench("snapshot small buffer (~100 lines)", () => {
    const snap = smallBuffer.snapshot({ maxAgeMs: 0, enableLeakDetection: false });
    return snap;
  });

  bench("snapshot medium buffer (~1K lines)", () => {
    const snap = mediumBuffer.snapshot({ maxAgeMs: 0, enableLeakDetection: false });
    return snap;
  });

  bench("snapshot large buffer (~10K lines)", () => {
    const snap = largeBuffer.snapshot({ maxAgeMs: 0, enableLeakDetection: false });
    return snap;
  });

  bench("snapshot edited buffer (many fragments)", () => {
    const snap = editedBuffer.snapshot({ maxAgeMs: 0, enableLeakDetection: false });
    return snap;
  });
});

group("snapshot-release", () => {
  bench("release small snapshot", () => {
    const snap = smallBuffer.snapshot({ maxAgeMs: 0, enableLeakDetection: false });
    return snap.release();
  });

  bench("release medium snapshot", () => {
    const snap = mediumBuffer.snapshot({ maxAgeMs: 0, enableLeakDetection: false });
    return snap.release();
  });

  bench("release large snapshot", () => {
    const snap = largeBuffer.snapshot({ maxAgeMs: 0, enableLeakDetection: false });
    return snap.release();
  });
});

group("snapshot-access", () => {
  // Pre-create snapshots
  const smallSnap = smallBuffer.snapshot({ maxAgeMs: 0, enableLeakDetection: false });
  const mediumSnap = mediumBuffer.snapshot({ maxAgeMs: 0, enableLeakDetection: false });
  const largeSnap = largeBuffer.snapshot({ maxAgeMs: 0, enableLeakDetection: false });

  bench("get length (small)", () => {
    return smallSnap.length;
  });

  bench("get length (medium)", () => {
    return mediumSnap.length;
  });

  bench("get length (large)", () => {
    return largeSnap.length;
  });

  bench("get lineCount (small)", () => {
    return smallSnap.lineCount;
  });

  bench("get lineCount (large)", () => {
    return largeSnap.lineCount;
  });
});

group("snapshot-isolation", () => {
  // Benchmark taking multiple snapshots before/after edits
  bench("create-edit-create cycle", () => {
    const buf = TextBuffer.fromString("Hello, world!");
    const snap1 = buf.snapshot({ maxAgeMs: 0, enableLeakDetection: false });

    buf.insert(0, "!");
    const snap2 = buf.snapshot({ maxAgeMs: 0, enableLeakDetection: false });

    snap1.release();
    snap2.release();
  });

  bench("multiple snapshots sharing state", () => {
    const buf = TextBuffer.fromString(smallDoc);
    const snapshots: ReturnType<typeof buf.snapshot>[] = [];

    // Take 10 snapshots
    for (let i = 0; i < 10; i++) {
      snapshots.push(buf.snapshot({ maxAgeMs: 0, enableLeakDetection: false }));
    }

    // Release all
    for (const snap of snapshots) {
      snap.release();
    }
  });
});

// Run benchmarks
await run({
  format: isCI ? "json" : "mitata",
});
