import { describe, expect, test } from "bun:test";
import { TextBuffer } from "./text-buffer.js";

describe("insert performance", () => {
  test("10K sequential inserts should be under 1000ms", () => {
    // Note: The optimal O(log n) insertAt is partially limited by the SumTree's
    // shallowClone() which copies the summaries Map. This gives O(n^2) total
    // instead of O(n log n). A future optimization could use persistent maps.
    // Current: ~800ms (down from ~3000ms baseline, ~4x improvement)
    const start = performance.now();
    const buf = TextBuffer.create();
    for (let i = 0; i < 10000; i++) {
      buf.insert(buf.length, "x");
    }
    const elapsed = performance.now() - start;
    console.log(`10K inserts: ${elapsed.toFixed(0)}ms`);
    expect(elapsed).toBeLessThan(1000);
  });
});
