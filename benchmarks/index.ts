import { bench, group, run, summary } from "mitata";
import { loadEditingTrace } from "./fixtures.js";
import { generateSyntheticDocument } from "./synthetic.js";
import type { DocumentSize } from "./synthetic.js";

const isCI = process.argv.includes("--ci");
const sizes: DocumentSize[] = ["tiny", "small", "medium", "large", "huge", "extreme"];

// Placeholder benchmarks - will be replaced with actual CRDT benchmarks
summary(() => {
  bench("noop", () => {
    // intentionally empty - baseline measurement
  });

  bench("array push", () => {
    const arr: number[] = [];
    for (let i = 0; i < 1000; i++) {
      arr.push(i);
    }
  });
});

// Kleppmann editing trace benchmark placeholder
group("editing-trace", () => {
  bench("load trace", async () => {
    await loadEditingTrace();
  });
});

// Synthetic document benchmarks placeholder
group("synthetic-documents", () => {
  for (const size of sizes) {
    bench(`generate ${size}`, () => {
      generateSyntheticDocument(size);
    });
  }
});

// Run benchmarks
await run({
  format: isCI ? "json" : "mitata",
});
