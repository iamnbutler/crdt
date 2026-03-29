/**
 * Struct-of-Arrays Fragment Storage Benchmarks
 *
 * Compares the hybrid SoA FragmentStore against the current object-per-fragment
 * approach used in the CRDT text buffer.
 *
 * Measures:
 * - Memory usage per fragment
 * - Sequential scan throughput (sumVisibleLength, getVisibleText)
 * - Random access latency
 * - Visibility toggle throughput
 * - Fragment sorting by locator
 * - Fragment search by visible offset
 *
 * @see https://github.com/iamnbutler/crdt/issues/112
 */

import { bench, group, run } from "mitata";
import { FragmentStore, fragmentHandle } from "../src/text/fragment-store.js";
import { createFragment } from "../src/text/fragment.js";
import type { Fragment, Locator, ReplicaId } from "../src/text/types.js";
import { replicaId } from "../src/text/types.js";

// ---------------------------------------------------------------------------
// Setup: create parallel object array and SoA store with identical data
// ---------------------------------------------------------------------------

const FRAGMENT_COUNT = 10_000;
const rid: ReplicaId = replicaId(1);

function makeLocator(i: number): Locator {
  return { levels: [i * 137] }; // spread out for realistic ordering
}

function makeText(i: number): string {
  // Mix of short and longer fragments, some with newlines
  if (i % 10 === 0) return `line${i}\n`;
  if (i % 7 === 0) return `word${i} `;
  return `t${i}`;
}

// --- Object Array (current approach) ---
console.log(`Creating ${FRAGMENT_COUNT.toLocaleString()} fragments...`);

const objectFragments: Fragment[] = [];
for (let i = 0; i < FRAGMENT_COUNT; i++) {
  const text = makeText(i);
  const loc = makeLocator(i);
  const visible = i % 5 !== 0; // 80% visible
  objectFragments.push(
    createFragment({ replicaId: rid, counter: i }, 0, loc, text, visible, [], loc),
  );
}

// --- SoA Store (hybrid approach) ---
const soaStore = new FragmentStore(FRAGMENT_COUNT);
for (let i = 0; i < FRAGMENT_COUNT; i++) {
  const text = makeText(i);
  const loc = makeLocator(i);
  const visible = i % 5 !== 0;
  soaStore.push(rid, i, 0, loc, loc, text, visible);
}

console.log("Fragments created.\n");

// ---------------------------------------------------------------------------
// Memory Comparison
// ---------------------------------------------------------------------------

function measureObjectMemory(): number {
  // Force GC
  if (typeof Bun !== "undefined" && typeof Bun.gc === "function") {
    Bun.gc(true);
  }
  const before = process.memoryUsage().heapUsed;

  const frags: Fragment[] = [];
  for (let i = 0; i < FRAGMENT_COUNT; i++) {
    const text = makeText(i);
    const loc = makeLocator(i);
    const visible = i % 5 !== 0;
    frags.push(createFragment({ replicaId: rid, counter: i }, 0, loc, text, visible, [], loc));
  }

  if (typeof Bun !== "undefined" && typeof Bun.gc === "function") {
    Bun.gc(true);
  }
  const after = process.memoryUsage().heapUsed;

  // Keep reference alive
  void frags[0];
  return after - before;
}

function measureSoAMemory(): number {
  if (typeof Bun !== "undefined" && typeof Bun.gc === "function") {
    Bun.gc(true);
  }
  const before = process.memoryUsage().heapUsed;

  const store = new FragmentStore(FRAGMENT_COUNT);
  for (let i = 0; i < FRAGMENT_COUNT; i++) {
    const text = makeText(i);
    const loc = makeLocator(i);
    const visible = i % 5 !== 0;
    store.push(rid, i, 0, loc, loc, text, visible);
  }

  if (typeof Bun !== "undefined" && typeof Bun.gc === "function") {
    Bun.gc(true);
  }
  const after = process.memoryUsage().heapUsed;

  void store.count;
  return after - before;
}

console.log("=== Memory Comparison ===");
const objMem = measureObjectMemory();
const soaMem = measureSoAMemory();
const soaEstimate = soaStore.memoryUsageBytes();
console.log(`Object Array:  ${(objMem / 1024 / 1024).toFixed(2)} MB (heap measurement)`);
console.log(`SoA Store:     ${(soaMem / 1024 / 1024).toFixed(2)} MB (heap measurement)`);
console.log(`SoA Estimate:  ${(soaEstimate / 1024 / 1024).toFixed(2)} MB (calculated)`);
if (objMem > 0) {
  console.log(`Reduction:     ${((1 - soaMem / objMem) * 100).toFixed(1)}%`);
}
console.log();

// ---------------------------------------------------------------------------
// Benchmarks
// ---------------------------------------------------------------------------

// Pre-compute random indices for random access benchmarks
const randomIndices = new Uint32Array(1000);
for (let i = 0; i < randomIndices.length; i++) {
  randomIndices[i] = Math.floor(Math.random() * FRAGMENT_COUNT);
}

group("sum-visible-lengths", () => {
  bench("object-array", () => {
    let sum = 0;
    for (let i = 0; i < objectFragments.length; i++) {
      const f = objectFragments[i];
      if (f?.visible) sum += f.length;
    }
    return sum;
  });

  bench("soa-store", () => {
    return soaStore.sumVisibleLength();
  });
});

group("get-visible-text", () => {
  bench("object-array", () => {
    const chunks: string[] = [];
    for (let i = 0; i < objectFragments.length; i++) {
      const f = objectFragments[i];
      if (f?.visible) chunks.push(f.text);
    }
    return chunks.join("");
  });

  bench("soa-store", () => {
    return soaStore.getVisibleText();
  });
});

group("toggle-visibility-range", () => {
  // Toggle visibility of 1000 fragments
  bench("object-array", () => {
    const replaced: Fragment[] = [];
    for (let i = 0; i < 1000; i++) {
      const f = objectFragments[i];
      if (f === undefined) continue;
      replaced.push(
        createFragment(
          f.insertionId,
          f.insertionOffset,
          f.locator,
          f.text,
          !f.visible,
          [...f.deletions],
          f.baseLocator,
        ),
      );
    }
    // Restore
    for (let i = 0; i < 1000; i++) {
      const r = replaced[i];
      if (r !== undefined) objectFragments[i] = r;
    }
    return replaced.length;
  });

  bench("soa-store", () => {
    for (let i = 0; i < 1000; i++) {
      const h = fragmentHandle(i);
      soaStore.setVisible(h, !soaStore.isVisible(h));
    }
    // Restore
    for (let i = 0; i < 1000; i++) {
      const h = fragmentHandle(i);
      soaStore.setVisible(h, !soaStore.isVisible(h));
    }
    return 1000;
  });
});

group("random-access-1000", () => {
  bench("object-array", () => {
    let sum = 0;
    for (let i = 0; i < randomIndices.length; i++) {
      const idx = randomIndices[i] ?? 0;
      const f = objectFragments[idx];
      if (f !== undefined) sum += f.length;
    }
    return sum;
  });

  bench("soa-store", () => {
    let sum = 0;
    for (let i = 0; i < randomIndices.length; i++) {
      const idx = randomIndices[i] ?? 0;
      sum += soaStore.length(fragmentHandle(idx));
    }
    return sum;
  });
});

group("find-fragment-at-position", () => {
  const targetOffset = Math.floor(soaStore.sumVisibleLength() / 2);

  bench("object-array", () => {
    let acc = 0;
    for (let i = 0; i < objectFragments.length; i++) {
      const f = objectFragments[i];
      if (f?.visible) {
        if (acc + f.length > targetOffset) return i;
        acc += f.length;
      }
    }
    return -1;
  });

  bench("soa-store", () => {
    return soaStore.findAtVisibleOffset(targetOffset);
  });
});

group("compute-summary-1000", () => {
  bench("object-array", () => {
    let totalVisLen = 0;
    for (let i = 0; i < 1000; i++) {
      const frag = objectFragments[i];
      if (frag === undefined) continue;
      const s = frag.summary();
      totalVisLen += s.visibleLen;
    }
    return totalVisLen;
  });

  bench("soa-store", () => {
    let totalVisLen = 0;
    for (let i = 0; i < 1000; i++) {
      const s = soaStore.summary(fragmentHandle(i));
      totalVisLen += s.visibleLen;
    }
    return totalVisLen;
  });
});

group("sort-by-locator", () => {
  // Sort a copy of indices
  const indices = Array.from({ length: FRAGMENT_COUNT }, (_, i) => i);

  bench("object-array", () => {
    const copy = [...indices];
    copy.sort((a, b) => {
      const fa = objectFragments[a];
      const fb = objectFragments[b];
      if (fa === undefined || fb === undefined) return 0;
      const locCmp = (fa.locator.levels[0] ?? 0) - (fb.locator.levels[0] ?? 0);
      if (locCmp !== 0) return locCmp;
      return fa.insertionId.counter - fb.insertionId.counter;
    });
    return copy[0];
  });

  bench("soa-store", () => {
    const copy = [...indices];
    copy.sort((a, b) => soaStore.compareByLocator(fragmentHandle(a), fragmentHandle(b)));
    return copy[0];
  });
});

group("bulk-insert-1000", () => {
  bench("object-array", () => {
    const frags: Fragment[] = [];
    for (let i = 0; i < 1000; i++) {
      frags.push(
        createFragment(
          { replicaId: rid, counter: i + FRAGMENT_COUNT },
          0,
          makeLocator(i),
          `new${i}`,
          true,
        ),
      );
    }
    return frags.length;
  });

  bench("soa-store", () => {
    const store = new FragmentStore(1024);
    for (let i = 0; i < 1000; i++) {
      store.push(rid, i + FRAGMENT_COUNT, 0, makeLocator(i), makeLocator(i), `new${i}`, true);
    }
    return store.count;
  });
});

await run();
