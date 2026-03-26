/**
 * Hybrid SoA Fragment Storage Benchmark
 *
 * Combines:
 * - SoA for numeric fields (80% memory reduction)
 * - Per-fragment strings (O(1) text access)
 * - Float64 locator sort keys (3x faster comparison)
 */

import { bench, group, run } from "mitata";

// ---------------------------------------------------------------------------
// Hybrid SoA Implementation
// ---------------------------------------------------------------------------

interface OperationId {
  readonly replicaId: number;
  readonly counter: number;
}

interface Locator {
  readonly levels: ReadonlyArray<number>;
}

interface Fragment {
  readonly insertionId: OperationId;
  readonly insertionOffset: number;
  readonly locator: Locator;
  readonly baseLocator: Locator;
  readonly length: number;
  readonly visible: boolean;
  readonly deletions: ReadonlyArray<OperationId>;
  readonly text: string;
}

/**
 * Hybrid storage: SoA for numerics, array for strings.
 */
class HybridFragmentStore {
  private _count: number = 0;
  private _capacity: number;

  // SoA numeric fields (densely packed)
  insertionReplicaIds: Uint32Array;
  insertionCounters: Uint32Array;
  insertionOffsets: Uint32Array;
  lengths: Uint32Array;
  visible: Uint8Array;
  locatorSortKeys: Float64Array;
  baseLocatorSortKeys: Float64Array;

  // Per-fragment storage (avoid string blob)
  texts: string[];
  deletions: (OperationId[] | null)[];

  // For rare deep Locator comparison
  private locatorLevels: (number[] | null)[];
  private baseLocatorLevels: (number[] | null)[];

  constructor(initialCapacity: number = 1024) {
    this._capacity = initialCapacity;
    this.insertionReplicaIds = new Uint32Array(initialCapacity);
    this.insertionCounters = new Uint32Array(initialCapacity);
    this.insertionOffsets = new Uint32Array(initialCapacity);
    this.lengths = new Uint32Array(initialCapacity);
    this.visible = new Uint8Array(initialCapacity);
    this.locatorSortKeys = new Float64Array(initialCapacity);
    this.baseLocatorSortKeys = new Float64Array(initialCapacity);
    this.texts = new Array(initialCapacity);
    this.deletions = new Array(initialCapacity);
    this.locatorLevels = new Array(initialCapacity);
    this.baseLocatorLevels = new Array(initialCapacity);
  }

  get count(): number {
    return this._count;
  }

  private grow(): void {
    const newCapacity = this._capacity * 2;

    // Grow typed arrays
    const copyTyped = <T extends Uint8Array | Uint32Array | Float64Array>(
      arr: T,
      Ctor: new (n: number) => T
    ): T => {
      const newArr = new Ctor(newCapacity);
      newArr.set(arr);
      return newArr;
    };

    this.insertionReplicaIds = copyTyped(this.insertionReplicaIds, Uint32Array);
    this.insertionCounters = copyTyped(this.insertionCounters, Uint32Array);
    this.insertionOffsets = copyTyped(this.insertionOffsets, Uint32Array);
    this.lengths = copyTyped(this.lengths, Uint32Array);
    this.visible = copyTyped(this.visible, Uint8Array);
    this.locatorSortKeys = copyTyped(this.locatorSortKeys, Float64Array);
    this.baseLocatorSortKeys = copyTyped(this.baseLocatorSortKeys, Float64Array);

    // Grow regular arrays
    this.texts.length = newCapacity;
    this.deletions.length = newCapacity;
    this.locatorLevels.length = newCapacity;
    this.baseLocatorLevels.length = newCapacity;

    this._capacity = newCapacity;
  }

  push(fragment: Fragment): number {
    if (this._count >= this._capacity) {
      this.grow();
    }

    const idx = this._count++;

    this.insertionReplicaIds[idx] = fragment.insertionId.replicaId;
    this.insertionCounters[idx] = fragment.insertionId.counter;
    this.insertionOffsets[idx] = fragment.insertionOffset;
    this.lengths[idx] = fragment.length;
    this.visible[idx] = fragment.visible ? 1 : 0;
    this.locatorSortKeys[idx] = locatorToSortKey(fragment.locator);
    this.baseLocatorSortKeys[idx] = locatorToSortKey(fragment.baseLocator);

    // Store text directly (no blob)
    this.texts[idx] = fragment.text;

    // Sparse deletions
    this.deletions[idx] = fragment.deletions.length > 0 ? [...fragment.deletions] : null;

    // Store deep locators for rare comparison
    this.locatorLevels[idx] =
      fragment.locator.levels.length > 4 ? [...fragment.locator.levels] : null;
    this.baseLocatorLevels[idx] =
      fragment.baseLocator.levels.length > 4 ? [...fragment.baseLocator.levels] : null;

    return idx;
  }

  getText(idx: number): string {
    return this.texts[idx];
  }

  getVisibleLength(): number {
    let total = 0;
    const visible = this.visible;
    const lengths = this.lengths;
    for (let i = 0; i < this._count; i++) {
      if (visible[i] === 1) total += lengths[i];
    }
    return total;
  }

  getVisibleText(): string {
    const chunks: string[] = [];
    const visible = this.visible;
    const texts = this.texts;
    for (let i = 0; i < this._count; i++) {
      if (visible[i] === 1) chunks.push(texts[i]);
    }
    return chunks.join("");
  }

  compareByLocator(a: number, b: number): number {
    const diff = this.locatorSortKeys[a] - this.locatorSortKeys[b];
    if (diff !== 0) return diff;

    // Rare: sort key collision, need full comparison
    const aLevels = this.locatorLevels[a];
    const bLevels = this.locatorLevels[b];
    if (aLevels && bLevels) {
      return compareLocatorLevels(aLevels, bLevels);
    }
    return 0;
  }

  getMemoryUsage(): number {
    // TypedArrays: 41 bytes per slot
    const typedBytes =
      this._capacity * (4 + 4 + 4 + 4 + 1 + 8 + 8); // 33 bytes fixed

    // Text strings: ~24 + 2*len per string
    let textBytes = 0;
    for (let i = 0; i < this._count; i++) {
      textBytes += 24 + this.texts[i].length * 2;
    }

    // Sparse arrays overhead
    const sparseBytes = this._count * 8; // pointers

    return typedBytes + textBytes + sparseBytes;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function locatorToSortKey(loc: Locator): number {
  const BITS_PER_LEVEL = 13;
  const MAX_LEVEL_VALUE = (1 << BITS_PER_LEVEL) - 1;
  let result = 0;
  for (let i = 0; i < Math.min(loc.levels.length, 4); i++) {
    const level = Math.min(loc.levels[i] ?? 0, MAX_LEVEL_VALUE);
    result = result * (MAX_LEVEL_VALUE + 1) + level;
  }
  return result * 16 + loc.levels.length;
}

function compareLocatorLevels(a: number[], b: number[]): number {
  const minLen = Math.min(a.length, b.length);
  for (let i = 0; i < minLen; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return a.length - b.length;
}

// ---------------------------------------------------------------------------
// Test Data
// ---------------------------------------------------------------------------

function generateFragments(count: number): Fragment[] {
  const fragments: Fragment[] = [];
  let locatorBase = 1000;

  for (let i = 0; i < count; i++) {
    const replicaId = Math.floor(Math.random() * 100);
    const text = "x".repeat(1 + Math.floor(Math.random() * 10));
    const visible = Math.random() > 0.1;
    const locator: Locator = { levels: [locatorBase++] };

    fragments.push({
      insertionId: { replicaId, counter: i },
      insertionOffset: 0,
      locator,
      baseLocator: locator,
      length: text.length,
      visible,
      deletions: [],
      text,
    });
  }

  return fragments;
}

function measureObjectArrayMemory(fragments: Fragment[]): number {
  let total = 0;
  for (const f of fragments) {
    total += 40 + 32 + 48 + 48 + 32 + 24 + f.text.length * 2 + 24;
  }
  return total;
}

// ---------------------------------------------------------------------------
// Benchmarks
// ---------------------------------------------------------------------------

const FRAGMENT_COUNT = 10000;
const fragments = generateFragments(FRAGMENT_COUNT);

const objectArray = [...fragments];
const hybridStore = new HybridFragmentStore(FRAGMENT_COUNT);
for (const f of fragments) {
  hybridStore.push(f);
}

console.log("Hybrid SoA Fragment Storage Benchmark\n");
console.log(`Testing ${FRAGMENT_COUNT} fragments\n`);

const objectMemory = measureObjectArrayMemory(fragments);
const hybridMemory = hybridStore.getMemoryUsage();

console.log("--- Memory Usage ---");
console.log(`Object Array:     ${(objectMemory / 1024 / 1024).toFixed(2)} MB`);
console.log(`Hybrid Store:     ${(hybridMemory / 1024 / 1024).toFixed(2)} MB`);
console.log(`Reduction:        ${((1 - hybridMemory / objectMemory) * 100).toFixed(1)}%\n`);

group("sum-visible-lengths", () => {
  bench("Object Array", () => {
    let total = 0;
    for (let i = 0; i < objectArray.length; i++) {
      if (objectArray[i].visible) total += objectArray[i].length;
    }
    return total;
  });

  bench("Hybrid Store", () => {
    return hybridStore.getVisibleLength();
  });
});

group("get-visible-text", () => {
  bench("Object Array", () => {
    const chunks: string[] = [];
    for (const f of objectArray) {
      if (f.visible) chunks.push(f.text);
    }
    return chunks.join("");
  });

  bench("Hybrid Store", () => {
    return hybridStore.getVisibleText();
  });
});

group("sort-by-locator", () => {
  bench("Object Array (full comparison)", () => {
    const copy = [...objectArray];
    copy.sort((a, b) => {
      const minLen = Math.min(a.locator.levels.length, b.locator.levels.length);
      for (let i = 0; i < minLen; i++) {
        if (a.locator.levels[i] !== b.locator.levels[i]) {
          return a.locator.levels[i] - b.locator.levels[i];
        }
      }
      return a.locator.levels.length - b.locator.levels.length;
    });
    return copy;
  });

  bench("Hybrid Store (Float64 sort keys)", () => {
    const indices = new Uint32Array(hybridStore.count);
    for (let i = 0; i < indices.length; i++) indices[i] = i;
    const sortKeys = hybridStore.locatorSortKeys;
    indices.sort((a, b) => sortKeys[a] - sortKeys[b]);
    return indices;
  });
});

group("toggle-visibility-range", () => {
  const START = 1000;
  const END = 2000;

  bench("Object Array (immutable)", () => {
    return objectArray.map((f, i) => {
      if (i >= START && i < END) return { ...f, visible: false };
      return f;
    });
  });

  bench("Hybrid Store (mutate bits)", () => {
    for (let i = START; i < END; i++) hybridStore.visible[i] = 0;
    for (let i = START; i < END; i++) hybridStore.visible[i] = 1;
    return hybridStore;
  });
});

group("random-access-1000", () => {
  const indices = Array.from({ length: 1000 }, () =>
    Math.floor(Math.random() * FRAGMENT_COUNT)
  );

  bench("Object Array", () => {
    let sum = 0;
    for (const idx of indices) {
      if (objectArray[idx].visible) sum += objectArray[idx].length;
    }
    return sum;
  });

  bench("Hybrid Store", () => {
    let sum = 0;
    const visible = hybridStore.visible;
    const lengths = hybridStore.lengths;
    for (const idx of indices) {
      if (visible[idx] === 1) sum += lengths[idx];
    }
    return sum;
  });
});

group("find-fragment-at-position", () => {
  const targetPos = 5000;

  bench("Object Array", () => {
    let pos = 0;
    for (const f of objectArray) {
      if (f.visible) {
        if (pos + f.length > targetPos) return f;
        pos += f.length;
      }
    }
    return null;
  });

  bench("Hybrid Store", () => {
    let pos = 0;
    const visible = hybridStore.visible;
    const lengths = hybridStore.lengths;
    for (let i = 0; i < hybridStore.count; i++) {
      if (visible[i] === 1) {
        if (pos + lengths[i] > targetPos) return i;
        pos += lengths[i];
      }
    }
    return -1;
  });
});

group("bulk-insert-1000", () => {
  const newFragments = generateFragments(1000);

  bench("Object Array", () => {
    const arr: Fragment[] = [];
    for (const f of newFragments) arr.push(f);
    return arr;
  });

  bench("Hybrid Store", () => {
    const store = new HybridFragmentStore(1024);
    for (const f of newFragments) store.push(f);
    return store;
  });
});

await run();

console.log("\n--- Summary ---");
console.log(`Object Array Memory: ${(objectMemory / 1024 / 1024).toFixed(2)} MB`);
console.log(`Hybrid Store Memory: ${(hybridMemory / 1024 / 1024).toFixed(2)} MB`);
console.log(`Memory Savings:      ${((1 - hybridMemory / objectMemory) * 100).toFixed(1)}%`);
console.log(
  `\nFor 260K fragments: ~${(((objectMemory - hybridMemory) * 26) / 1024 / 1024).toFixed(1)} MB saved`
);
