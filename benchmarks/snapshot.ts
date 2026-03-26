/**
 * Benchmarks for O(1) snapshot creation and release.
 *
 * Target performance:
 * - Snapshot creation: <1us for <10 replicas
 * - Snapshot release + reclamation: <10us
 */

import { bench, group, run, summary } from "mitata";
import { TextBuffer } from "../src/text/text-buffer.js";
import { generateSyntheticDocument } from "./synthetic.js";

const isCI = process.argv.includes("--ci");

// Pre-generate documents of various sizes
console.log("Generating test documents...");

const tinyDoc = generateSyntheticDocument("tiny"); // 100 lines
const smallDoc = generateSyntheticDocument("small"); // 1K lines
const mediumDoc = generateSyntheticDocument("medium"); // 10K lines

// Create buffers
const tinyBuffer = TextBuffer.fromString(tinyDoc);
const smallBuffer = TextBuffer.fromString(smallDoc);
const mediumBuffer = TextBuffer.fromString(mediumDoc);

console.log(`Tiny buffer: ${tinyBuffer.length} chars`);
console.log(`Small buffer: ${smallBuffer.length} chars`);
console.log(`Medium buffer: ${mediumBuffer.length} chars`);
console.log("");

// Snapshot creation benchmarks
summary(() => {
  group("snapshot-creation", () => {
    bench("snapshot() tiny (100 lines)", () => {
      const snap = tinyBuffer.snapshot({ maxAgeMs: 0 });
      snap.release();
    });

    bench("snapshot() small (1K lines)", () => {
      const snap = smallBuffer.snapshot({ maxAgeMs: 0 });
      snap.release();
    });

    bench("snapshot() medium (10K lines)", () => {
      const snap = mediumBuffer.snapshot({ maxAgeMs: 0 });
      snap.release();
    });
  });
});

// Snapshot release benchmarks
group("snapshot-release", () => {
  bench("release() tiny buffer", () => {
    const snap = tinyBuffer.snapshot({ maxAgeMs: 0 });
    snap.release();
  });

  bench("release() small buffer", () => {
    const snap = smallBuffer.snapshot({ maxAgeMs: 0 });
    snap.release();
  });

  bench("release() medium buffer", () => {
    const snap = mediumBuffer.snapshot({ maxAgeMs: 0 });
    snap.release();
  });
});

// Multiple concurrent snapshots
group("concurrent-snapshots", () => {
  bench("create 10 snapshots", () => {
    const snaps = [];
    for (let i = 0; i < 10; i++) {
      snaps.push(smallBuffer.snapshot({ maxAgeMs: 0 }));
    }
    for (const snap of snaps) {
      snap.release();
    }
  });

  bench("create 100 snapshots", () => {
    const snaps = [];
    for (let i = 0; i < 100; i++) {
      snaps.push(smallBuffer.snapshot({ maxAgeMs: 0 }));
    }
    for (const snap of snaps) {
      snap.release();
    }
  });
});

// Snapshot read operations (to verify O(n) read vs O(1) creation)
group("snapshot-read", () => {
  const tinySnap = tinyBuffer.snapshot({ maxAgeMs: 0 });
  const smallSnap = smallBuffer.snapshot({ maxAgeMs: 0 });
  const mediumSnap = mediumBuffer.snapshot({ maxAgeMs: 0 });

  bench("getText() tiny", () => {
    return tinySnap.getText();
  });

  bench("getText() small", () => {
    return smallSnap.getText();
  });

  bench("getText() medium", () => {
    return mediumSnap.getText();
  });

  bench("length (O(1) via summary) tiny", () => {
    return tinySnap.length;
  });

  bench("length (O(1) via summary) small", () => {
    return smallSnap.length;
  });

  bench("length (O(1) via summary) medium", () => {
    return mediumSnap.length;
  });
});

// Garbage collection benchmarks
group("garbage-collection", () => {
  bench("collectGarbage() after 10 edit cycles", () => {
    const buf = TextBuffer.fromString("initial content for gc test");

    // Create edit cycles with snapshots
    for (let i = 0; i < 10; i++) {
      buf.insert(0, `edit${i} `);
      const snap = buf.snapshot({ maxAgeMs: 0 });
      snap.release();
    }

    return buf.collectGarbage();
  });

  bench("collectGarbage() after 100 edit cycles", () => {
    const buf = TextBuffer.fromString("initial content for gc test");

    // Create edit cycles with snapshots
    for (let i = 0; i < 100; i++) {
      buf.insert(0, `e${i}`);
      const snap = buf.snapshot({ maxAgeMs: 0 });
      snap.release();
    }

    return buf.collectGarbage();
  });
});

// Arena utilization monitoring
group("arena-monitoring", () => {
  bench("arenaUtilization()", () => {
    return smallBuffer.arenaUtilization();
  });
});

// Structural sharing verification
group("structural-sharing", () => {
  bench("snapshot after small edit", () => {
    const buf = TextBuffer.fromString(smallDoc);
    buf.insert(0, "X");
    const snap = buf.snapshot({ maxAgeMs: 0 });
    snap.release();
    return buf.arenaUtilization().allocated;
  });
});

// Run benchmarks
await run({
  format: isCI ? "json" : "mitata",
});
