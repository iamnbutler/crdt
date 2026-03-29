/**
 * Benchmark: SoA FragmentStore vs plain Fragment objects
 *
 * Measures memory usage and operation throughput for the two storage layouts.
 */

import { bench, group, run, summary } from "mitata";
import { FragmentStore, createStoredFragment } from "../src/text/fragment-store.js";
import { createFragment } from "../src/text/fragment.js";
import type { Locator, OperationId, ReplicaId } from "../src/text/types.js";

// Helpers
function rid(n: number): ReplicaId {
  // biome-ignore lint/suspicious/noExplicitAny: branded type construction
  return n as any;
}

function opId(replicaId: number, counter: number): OperationId {
  return { replicaId: rid(replicaId), counter };
}

function loc(...levels: number[]): Locator {
  return { levels };
}

const N = 10_000;

// Pre-generate test data
const texts = Array.from({ length: N }, (_, i) => `fragment_${i}_text`);
const opIds = Array.from({ length: N }, (_, i) => opId(1, i));
const locators = Array.from({ length: N }, (_, i) => loc(i * 100));

// ---------------------------------------------------------------------------
// Memory comparison
// ---------------------------------------------------------------------------

console.log("=== Memory Comparison ===\n");

// Measure object array memory
const beforeObj = process.memoryUsage().heapUsed;
const objFragments = [];
for (let i = 0; i < N; i++) {
  objFragments.push(
    createFragment(opIds[i] as OperationId, 0, locators[i] as Locator, texts[i] as string, true),
  );
}
const afterObj = process.memoryUsage().heapUsed;
const objMemory = afterObj - beforeObj;

// Measure SoA store memory
const beforeSoA = process.memoryUsage().heapUsed;
const store = new FragmentStore(N);
const soaRefs = [];
for (let i = 0; i < N; i++) {
  soaRefs.push(
    createStoredFragment(
      store,
      opIds[i] as OperationId,
      0,
      locators[i] as Locator,
      texts[i] as string,
      true,
    ),
  );
}
const afterSoA = process.memoryUsage().heapUsed;
const soaMemory = afterSoA - beforeSoA;

console.log(`Object array (${N} fragments): ${(objMemory / 1024 / 1024).toFixed(2)} MB`);
console.log(`SoA store   (${N} fragments): ${(soaMemory / 1024 / 1024).toFixed(2)} MB`);
console.log(`Memory reduction: ${((1 - soaMemory / objMemory) * 100).toFixed(1)}%`);
console.log(
  `Per-fragment: Object=${(objMemory / N).toFixed(0)} bytes, SoA=${(soaMemory / N).toFixed(0)} bytes\n`,
);

// ---------------------------------------------------------------------------
// Throughput benchmarks
// ---------------------------------------------------------------------------

summary(() => {
  group("scan-visibility", () => {
    bench("object-array", () => {
      let count = 0;
      for (let i = 0; i < objFragments.length; i++) {
        if ((objFragments[i] as { visible: boolean }).visible) count++;
      }
      return count;
    });

    bench("soa-typed-array", () => {
      let count = 0;
      const vis = store.visibilityArray;
      for (let i = 0; i < N; i++) {
        if (vis[i] === 1) count++;
      }
      return count;
    });
  });
});

summary(() => {
  group("random-access-1000", () => {
    const indices = Array.from({ length: 1000 }, () => Math.floor(Math.random() * N));

    bench("object-array", () => {
      let sum = 0;
      for (const idx of indices) {
        const f = objFragments[idx];
        if (f !== undefined) sum += f.length;
      }
      return sum;
    });

    bench("soa-store", () => {
      let sum = 0;
      for (const idx of indices) {
        const r = soaRefs[idx];
        if (r !== undefined) sum += r.length;
      }
      return sum;
    });
  });
});

summary(() => {
  group("sum-visible-lengths", () => {
    bench("object-array", () => {
      let sum = 0;
      for (const f of objFragments) {
        if (f.visible) sum += f.length;
      }
      return sum;
    });

    bench("soa-store", () => {
      let sum = 0;
      const vis = store.visibilityArray;
      for (let i = 0; i < N; i++) {
        if (vis[i] === 1) {
          const ref = soaRefs[i];
          if (ref !== undefined) sum += store.getLength(ref.handle);
        }
      }
      return sum;
    });
  });
});

summary(() => {
  group("toggle-visibility-batch", () => {
    bench("object-array-rebuild", () => {
      // Must rebuild fragments (immutable)
      const newFrags = [];
      for (let i = 0; i < 100; i++) {
        const f = objFragments[i] as ReturnType<typeof createFragment>;
        newFrags.push(
          createFragment(
            f.insertionId,
            f.insertionOffset,
            f.locator,
            f.text,
            !f.visible,
            f.deletions,
            f.baseLocator,
          ),
        );
      }
      return newFrags.length;
    });

    bench("soa-in-place", () => {
      // Direct typed array write (O(1) per fragment)
      for (let i = 0; i < 100; i++) {
        const ref = soaRefs[i];
        if (ref !== undefined) {
          store.setVisible(ref.handle, !store.isVisible(ref.handle));
        }
      }
    });
  });
});

summary(() => {
  group("allocate-1000", () => {
    bench("object-array", () => {
      const frags = [];
      for (let i = 0; i < 1000; i++) {
        frags.push(createFragment(opId(1, i), 0, loc(i), "x", true));
      }
      return frags.length;
    });

    bench("soa-store", () => {
      const tempStore = new FragmentStore(1024);
      const refs = [];
      for (let i = 0; i < 1000; i++) {
        refs.push(createStoredFragment(tempStore, opId(1, i), 0, loc(i), "x", true));
      }
      return refs.length;
    });
  });
});

await run();
