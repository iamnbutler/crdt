import { bench, group, run, summary } from "mitata";
import {
  type CountSummary,
  SumTree,
  type Summarizable,
  countDimension,
  countSummaryOps,
} from "../src/sum-tree/index.js";
import { loadEditingTrace } from "./fixtures.js";
import { generateSyntheticDocument } from "./synthetic.js";
import type { DocumentSize } from "./synthetic.js";

const isCI = process.argv.includes("--ci");
const sizes: DocumentSize[] = ["tiny", "small", "medium", "large", "huge", "extreme"];

// Simple item for SumTree benchmarks
class CountItem implements Summarizable<CountSummary> {
  constructor(public value: number) {}
  summary(): CountSummary {
    return { count: 1 };
  }
}

// Pre-create trees for benchmarks
console.log("Creating test trees...");
const items10K = Array.from({ length: 10000 }, (_, i) => new CountItem(i));
const tree10K = SumTree.fromItems(items10K, countSummaryOps, 16);

const items100K = Array.from({ length: 100000 }, (_, i) => new CountItem(i));
const tree100K = SumTree.fromItems(items100K, countSummaryOps, 16);
console.log("Trees created.\n");

// Baseline benchmarks
summary(() => {
  bench("noop", () => {
    // intentionally empty - baseline measurement
  });

  bench("array push 1K", () => {
    const arr: number[] = [];
    for (let i = 0; i < 1000; i++) {
      arr.push(i);
    }
  });
});

// SumTree benchmarks
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
});

group("sum-tree-insert", () => {
  bench("insert at middle (10K tree)", () => {
    return tree10K.insertAt(5000, new CountItem(999));
  });

  bench("insert at middle (100K tree)", () => {
    return tree100K.insertAt(50000, new CountItem(999));
  });
});

group("sum-tree-delete", () => {
  bench("delete from 10K tree", () => {
    return tree10K.removeAt(5000);
  });

  bench("delete from 100K tree", () => {
    return tree100K.removeAt(50000);
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
