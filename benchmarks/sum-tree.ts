import { bench, group, run } from "mitata";
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

// Simple item for count-based benchmarks
class CountItem implements Summarizable<CountSummary> {
  constructor(public value: number) {}

  summary(): CountSummary {
    return { count: 1 };
  }
}

// Text chunk item for text-based benchmarks
class TextChunk implements Summarizable<TextSummary> {
  constructor(public text: string) {}

  summary(): TextSummary {
    let lines = 0;
    let lastLineLen = 0;
    let lastLineBytes = 0;

    const encoder = new TextEncoder();
    const bytes = encoder.encode(this.text).length;

    for (let i = 0; i < this.text.length; i++) {
      const char = this.text[i];
      if (char === "\n") {
        lines++;
        lastLineLen = 0;
        lastLineBytes = 0;
      } else {
        lastLineLen++;
        lastLineBytes += encoder.encode(char ?? "").length;
      }
    }

    return {
      lines,
      utf16Len: this.text.length,
      bytes,
      lastLineLen,
      lastLineBytes,
    };
  }
}

// Pre-generate test data
function createCountTree(size: number, branchingFactor: number): SumTree<CountItem, CountSummary> {
  const items = Array.from({ length: size }, (_, i) => new CountItem(i));
  return SumTree.fromItems(items, countSummaryOps, branchingFactor);
}

function createTextTree(
  lineCount: number,
  branchingFactor: number,
): SumTree<TextChunk, TextSummary> {
  const items: TextChunk[] = [];
  for (let i = 0; i < lineCount; i++) {
    items.push(new TextChunk(`Line ${i}: This is some sample text content.\n`));
  }
  return SumTree.fromItems(items, textSummaryOps, branchingFactor);
}

const isCI = process.argv.includes("--ci");

// Test sizes
const SMALL_SIZE = 1_000;
const MEDIUM_SIZE = 10_000;
const LARGE_SIZE = 100_000;
const HUGE_SIZE = 1_000_000;

// Pre-create trees for benchmarks (avoids creation overhead in bench)
console.log("Creating test trees...");

const treeSmall = createCountTree(SMALL_SIZE, 16);
const treeMedium = createCountTree(MEDIUM_SIZE, 16);
const treeLarge = createCountTree(LARGE_SIZE, 16);

// For the 1M tree, we only create it once since it takes time
let treeHuge: SumTree<CountItem, CountSummary> | undefined;
if (!isCI) {
  treeHuge = createCountTree(HUGE_SIZE, 16);
}

const textTreeMedium = createTextTree(MEDIUM_SIZE, 16);

// Trees with different branching factors
const treeB8 = createCountTree(LARGE_SIZE, 8);
const treeB16 = createCountTree(LARGE_SIZE, 16);
const treeB32 = createCountTree(LARGE_SIZE, 32);

console.log("Trees created. Starting benchmarks...\n");

// Benchmark: Seek by item count (position)
group("seek", () => {
  bench("seek in 1K tree", () => {
    const cursor = treeSmall.cursor(countDimension);
    cursor.seekForward(500, "right");
    return cursor.item();
  });

  bench("seek in 10K tree", () => {
    const cursor = treeMedium.cursor(countDimension);
    cursor.seekForward(5000, "right");
    return cursor.item();
  });

  bench("seek in 100K tree", () => {
    const cursor = treeLarge.cursor(countDimension);
    cursor.seekForward(50000, "right");
    return cursor.item();
  });

  if (treeHuge) {
    bench("seek in 1M tree (target: <50μs)", () => {
      const cursor = treeHuge?.cursor(countDimension);
      cursor?.seekForward(500000, "right");
      return cursor?.item();
    });
  }
});

// Benchmark: Seek by line number
group("seek-by-line", () => {
  bench("seek by line in 10K lines", () => {
    const cursor = textTreeMedium.cursor(lineDimension);
    cursor.seekForward(5000, "right");
    return cursor.item();
  });
});

// Benchmark: Insert with path copy
group("insert", () => {
  bench("insert at end (1K tree)", () => {
    return treeSmall.push(new CountItem(999));
  });

  bench("insert at middle (1K tree)", () => {
    return treeSmall.insertAt(500, new CountItem(999));
  });

  bench("insert at end (10K tree)", () => {
    return treeMedium.push(new CountItem(999));
  });

  bench("insert at middle (10K tree)", () => {
    return treeMedium.insertAt(5000, new CountItem(999));
  });

  bench("insert at end (100K tree) (target: <100μs)", () => {
    return treeLarge.push(new CountItem(999));
  });

  bench("insert at middle (100K tree)", () => {
    return treeLarge.insertAt(50000, new CountItem(999));
  });
});

// Benchmark: Delete with path copy
group("delete", () => {
  bench("delete from 1K tree", () => {
    return treeSmall.removeAt(500);
  });

  bench("delete from 10K tree", () => {
    return treeMedium.removeAt(5000);
  });

  bench("delete from 100K tree", () => {
    return treeLarge.removeAt(50000);
  });
});

// Benchmark: Branching factor comparison
group("branching-factor", () => {
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

// Benchmark: Tree construction
group("construction", () => {
  bench("build 1K tree", () => {
    const items = Array.from({ length: 1000 }, (_, i) => new CountItem(i));
    return SumTree.fromItems(items, countSummaryOps, 16);
  });

  bench("build 10K tree", () => {
    const items = Array.from({ length: 10000 }, (_, i) => new CountItem(i));
    return SumTree.fromItems(items, countSummaryOps, 16);
  });
});

// Benchmark: Slice and concat
group("slice-concat", () => {
  bench("slice 10K tree at middle", () => {
    return treeMedium.slice(5000);
  });

  bench("concat two 5K trees", () => {
    const [left, right] = treeMedium.slice(5000);
    return SumTree.concat(left, right);
  });
});

// Benchmark: Cursor iteration
group("cursor-iteration", () => {
  bench("iterate 1K items with next()", () => {
    const cursor = treeSmall.cursor(countDimension);
    let count = 0;
    while (cursor.item() !== undefined) {
      count++;
      cursor.next();
    }
    return count;
  });
});

// Run benchmarks
await run({
  format: isCI ? "json" : "mitata",
});
