/**
 * Struct-of-Arrays Fragment Storage Benchmark
 *
 * Compares current object-per-fragment storage vs columnar SoA layout for:
 * 1. Memory usage
 * 2. Iteration speed
 * 3. Visibility filtering
 * 4. Text reconstruction
 */

import { bench, group, run } from "mitata";

// ---------------------------------------------------------------------------
// Current Implementation (Array of Objects)
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

// ---------------------------------------------------------------------------
// Struct-of-Arrays Implementation
// ---------------------------------------------------------------------------

/**
 * Columnar storage for fragments.
 * All arrays are indexed by fragment index (0 to count-1).
 */
class FragmentStore {
  // Capacity management
  private _count: number = 0;
  private _capacity: number;

  // OperationId fields (insertionId)
  insertionReplicaIds: Uint32Array;
  insertionCounters: Uint32Array;

  // Scalar fields
  insertionOffsets: Uint32Array;
  lengths: Uint32Array;
  visible: Uint8Array; // 0 = deleted, 1 = visible

  // Locator sort keys (Float64 encoded for fast comparison)
  locatorSortKeys: Float64Array;
  baseLocatorSortKeys: Float64Array;

  // Text storage (concatenated blob + offsets)
  private textBlob: string = "";
  textOffsets: Uint32Array;
  textLengths: Uint32Array;

  // Deletions (sparse - most fragments have 0-1 deletions)
  // Map from fragment index to array of deletion OperationIds
  deletions: Map<number, OperationId[]> = new Map();

  // For rare cases needing full Locator comparison
  private locatorLevels: Map<number, number[]> = new Map();
  private baseLocatorLevels: Map<number, number[]> = new Map();

  constructor(initialCapacity: number = 1024) {
    this._capacity = initialCapacity;
    this.insertionReplicaIds = new Uint32Array(initialCapacity);
    this.insertionCounters = new Uint32Array(initialCapacity);
    this.insertionOffsets = new Uint32Array(initialCapacity);
    this.lengths = new Uint32Array(initialCapacity);
    this.visible = new Uint8Array(initialCapacity);
    this.locatorSortKeys = new Float64Array(initialCapacity);
    this.baseLocatorSortKeys = new Float64Array(initialCapacity);
    this.textOffsets = new Uint32Array(initialCapacity);
    this.textLengths = new Uint32Array(initialCapacity);
  }

  get count(): number {
    return this._count;
  }

  private grow(): void {
    const newCapacity = this._capacity * 2;

    const newReplicaIds = new Uint32Array(newCapacity);
    newReplicaIds.set(this.insertionReplicaIds);
    this.insertionReplicaIds = newReplicaIds;

    const newCounters = new Uint32Array(newCapacity);
    newCounters.set(this.insertionCounters);
    this.insertionCounters = newCounters;

    const newOffsets = new Uint32Array(newCapacity);
    newOffsets.set(this.insertionOffsets);
    this.insertionOffsets = newOffsets;

    const newLengths = new Uint32Array(newCapacity);
    newLengths.set(this.lengths);
    this.lengths = newLengths;

    const newVisible = new Uint8Array(newCapacity);
    newVisible.set(this.visible);
    this.visible = newVisible;

    const newLocatorKeys = new Float64Array(newCapacity);
    newLocatorKeys.set(this.locatorSortKeys);
    this.locatorSortKeys = newLocatorKeys;

    const newBaseKeys = new Float64Array(newCapacity);
    newBaseKeys.set(this.baseLocatorSortKeys);
    this.baseLocatorSortKeys = newBaseKeys;

    const newTextOffsets = new Uint32Array(newCapacity);
    newTextOffsets.set(this.textOffsets);
    this.textOffsets = newTextOffsets;

    const newTextLengths = new Uint32Array(newCapacity);
    newTextLengths.set(this.textLengths);
    this.textLengths = newTextLengths;

    this._capacity = newCapacity;
  }

  /**
   * Add a fragment and return its index.
   */
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

    // Store full locator levels for rare deep comparison cases
    if (fragment.locator.levels.length > 4) {
      this.locatorLevels.set(idx, [...fragment.locator.levels]);
    }
    if (fragment.baseLocator.levels.length > 4) {
      this.baseLocatorLevels.set(idx, [...fragment.baseLocator.levels]);
    }

    // Append text to blob
    this.textOffsets[idx] = this.textBlob.length;
    this.textLengths[idx] = fragment.text.length;
    this.textBlob += fragment.text;

    if (fragment.deletions.length > 0) {
      this.deletions.set(idx, [...fragment.deletions]);
    }

    return idx;
  }

  /**
   * Get text for a fragment by index.
   */
  getText(idx: number): string {
    const offset = this.textOffsets[idx];
    const len = this.textLengths[idx];
    return this.textBlob.slice(offset, offset + len);
  }

  /**
   * Get visible text length (sum of visible fragment lengths).
   */
  getVisibleLength(): number {
    let total = 0;
    for (let i = 0; i < this._count; i++) {
      if (this.visible[i] === 1) {
        total += this.lengths[i];
      }
    }
    return total;
  }

  /**
   * Reconstruct visible text.
   */
  getVisibleText(): string {
    const chunks: string[] = [];
    for (let i = 0; i < this._count; i++) {
      if (this.visible[i] === 1) {
        chunks.push(this.getText(i));
      }
    }
    return chunks.join("");
  }

  /**
   * Compare two fragments by locator sort key.
   */
  compareByLocator(a: number, b: number): number {
    const diff = this.locatorSortKeys[a] - this.locatorSortKeys[b];
    if (diff !== 0) return diff;

    // Sort key collision - need full comparison (rare)
    const aLevels = this.locatorLevels.get(a);
    const bLevels = this.locatorLevels.get(b);
    if (aLevels && bLevels) {
      return compareLocatorLevels(aLevels, bLevels);
    }
    return 0;
  }

  /**
   * Get approximate memory usage in bytes.
   */
  getMemoryUsage(): number {
    // TypedArrays
    const typedArrayBytes =
      this._capacity * 4 + // insertionReplicaIds
      this._capacity * 4 + // insertionCounters
      this._capacity * 4 + // insertionOffsets
      this._capacity * 4 + // lengths
      this._capacity * 1 + // visible
      this._capacity * 8 + // locatorSortKeys
      this._capacity * 8 + // baseLocatorSortKeys
      this._capacity * 4 + // textOffsets
      this._capacity * 4; // textLengths

    // Text blob (2 bytes per char in JS)
    const textBytes = this.textBlob.length * 2;

    // Sparse maps (rough estimate)
    const deletionsBytes = this.deletions.size * 50;
    const locatorLevelsBytes = this.locatorLevels.size * 100;

    return typedArrayBytes + textBytes + deletionsBytes + locatorLevelsBytes;
  }
}

// ---------------------------------------------------------------------------
// Helper Functions
// ---------------------------------------------------------------------------

function locatorToSortKey(loc: Locator): number {
  // Pack up to 4 levels into 52 bits of mantissa
  const BITS_PER_LEVEL = 13;
  const MAX_LEVEL_VALUE = (1 << BITS_PER_LEVEL) - 1;

  let result = 0;
  for (let i = 0; i < Math.min(loc.levels.length, 4); i++) {
    const level = Math.min(loc.levels[i] ?? 0, MAX_LEVEL_VALUE);
    result = result * (MAX_LEVEL_VALUE + 1) + level;
  }
  result = result * 16 + loc.levels.length;
  return result;
}

function compareLocatorLevels(a: number[], b: number[]): number {
  const minLen = Math.min(a.length, b.length);
  for (let i = 0; i < minLen; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return a.length - b.length;
}

// ---------------------------------------------------------------------------
// Test Data Generation
// ---------------------------------------------------------------------------

function generateFragments(count: number): Fragment[] {
  const fragments: Fragment[] = [];
  let locatorBase = 1000;

  for (let i = 0; i < count; i++) {
    const replicaId = Math.floor(Math.random() * 100);
    const text = "x".repeat(1 + Math.floor(Math.random() * 10));
    const visible = Math.random() > 0.1; // 90% visible
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

// ---------------------------------------------------------------------------
// Memory Measurement
// ---------------------------------------------------------------------------

function measureObjectArrayMemory(fragments: Fragment[]): number {
  // Rough estimate based on V8 object sizes
  let total = 0;
  for (const f of fragments) {
    // Object overhead: ~40 bytes
    // OperationId: ~32 bytes (object + 2 numbers)
    // Locator: ~48 bytes (object + array + numbers)
    // BaseLocator: ~48 bytes
    // Scalars: ~32 bytes
    // String: ~24 + 2*length bytes
    // Deletions array: ~24 bytes (empty)
    total += 40 + 32 + 48 + 48 + 32 + 24 + f.text.length * 2 + 24;
  }
  return total;
}

// ---------------------------------------------------------------------------
// Benchmarks
// ---------------------------------------------------------------------------

const FRAGMENT_COUNT = 10000;
const fragments = generateFragments(FRAGMENT_COUNT);

// Pre-build both representations
const objectArray = [...fragments];
const soaStore = new FragmentStore(FRAGMENT_COUNT);
for (const f of fragments) {
  soaStore.push(f);
}

console.log("Struct-of-Arrays Fragment Storage Benchmark\n");
console.log(`Testing ${FRAGMENT_COUNT} fragments\n`);

// Memory comparison
const objectMemory = measureObjectArrayMemory(fragments);
const soaMemory = soaStore.getMemoryUsage();

console.log("--- Memory Usage ---");
console.log(`Object Array:     ${(objectMemory / 1024 / 1024).toFixed(2)} MB`);
console.log(`SoA Store:        ${(soaMemory / 1024 / 1024).toFixed(2)} MB`);
console.log(`Reduction:        ${((1 - soaMemory / objectMemory) * 100).toFixed(1)}%\n`);

// --- Iteration Benchmarks ---
group("sum-visible-lengths", () => {
  bench("Object Array (for-of)", () => {
    let total = 0;
    for (const f of objectArray) {
      if (f.visible) total += f.length;
    }
    return total;
  });

  bench("Object Array (for-i)", () => {
    let total = 0;
    for (let i = 0; i < objectArray.length; i++) {
      if (objectArray[i].visible) total += objectArray[i].length;
    }
    return total;
  });

  bench("SoA Store", () => {
    return soaStore.getVisibleLength();
  });

  bench("SoA Store (manual inline)", () => {
    let total = 0;
    const visible = soaStore.visible;
    const lengths = soaStore.lengths;
    const count = soaStore.count;
    for (let i = 0; i < count; i++) {
      if (visible[i] === 1) total += lengths[i];
    }
    return total;
  });
});

// --- Text Reconstruction ---
group("get-visible-text", () => {
  bench("Object Array", () => {
    const chunks: string[] = [];
    for (const f of objectArray) {
      if (f.visible) chunks.push(f.text);
    }
    return chunks.join("");
  });

  bench("SoA Store", () => {
    return soaStore.getVisibleText();
  });
});

// --- Sorting by Locator ---
group("sort-by-locator", () => {
  bench("Object Array", () => {
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

  bench("SoA Store (sort indices)", () => {
    const indices = new Uint32Array(soaStore.count);
    for (let i = 0; i < indices.length; i++) indices[i] = i;

    const sortKeys = soaStore.locatorSortKeys;
    indices.sort((a, b) => sortKeys[a] - sortKeys[b]);
    return indices;
  });

  bench("SoA Store (argsort on Float64Array)", () => {
    // Create array of [index, key] pairs and sort
    const pairs: [number, number][] = [];
    for (let i = 0; i < soaStore.count; i++) {
      pairs.push([i, soaStore.locatorSortKeys[i]]);
    }
    pairs.sort((a, b) => a[1] - b[1]);
    return pairs.map((p) => p[0]);
  });
});

// --- Visibility Toggle (simulating delete) ---
group("toggle-visibility-range", () => {
  const START = 1000;
  const END = 2000;

  bench("Object Array (create new)", () => {
    // Immutable: create new array with modified fragments
    return objectArray.map((f, i) => {
      if (i >= START && i < END) {
        return { ...f, visible: false };
      }
      return f;
    });
  });

  bench("SoA Store (mutate in place)", () => {
    // Mutable: just flip bits
    for (let i = START; i < END; i++) {
      soaStore.visible[i] = 0;
    }
    // Reset for next iteration
    for (let i = START; i < END; i++) {
      soaStore.visible[i] = 1;
    }
    return soaStore;
  });
});

// --- Bulk Insert Performance ---
group("bulk-insert-1000", () => {
  const newFragments = generateFragments(1000);

  bench("Object Array (push)", () => {
    const arr: Fragment[] = [];
    for (const f of newFragments) {
      arr.push(f);
    }
    return arr;
  });

  bench("SoA Store (push)", () => {
    const store = new FragmentStore(1024);
    for (const f of newFragments) {
      store.push(f);
    }
    return store;
  });
});

// --- Access Pattern: Random Read ---
group("random-access-1000", () => {
  const indices = Array.from({ length: 1000 }, () =>
    Math.floor(Math.random() * FRAGMENT_COUNT)
  );

  bench("Object Array", () => {
    let sum = 0;
    for (const idx of indices) {
      const f = objectArray[idx];
      if (f.visible) sum += f.length;
    }
    return sum;
  });

  bench("SoA Store", () => {
    let sum = 0;
    const visible = soaStore.visible;
    const lengths = soaStore.lengths;
    for (const idx of indices) {
      if (visible[idx] === 1) sum += lengths[idx];
    }
    return sum;
  });
});

// --- Realistic Workload: Find Fragment at Position ---
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

  bench("SoA Store", () => {
    let pos = 0;
    const visible = soaStore.visible;
    const lengths = soaStore.lengths;
    const count = soaStore.count;
    for (let i = 0; i < count; i++) {
      if (visible[i] === 1) {
        if (pos + lengths[i] > targetPos) return i;
        pos += lengths[i];
      }
    }
    return -1;
  });
});

await run();

// Final summary
console.log("\n--- Summary ---");
console.log(`Object Array Memory: ${(objectMemory / 1024 / 1024).toFixed(2)} MB`);
console.log(`SoA Store Memory:    ${(soaMemory / 1024 / 1024).toFixed(2)} MB`);
console.log(`Memory Savings:      ${((1 - soaMemory / objectMemory) * 100).toFixed(1)}%`);
console.log(
  `\nFor 10K fragments, SoA saves ~${((objectMemory - soaMemory) / 1024).toFixed(0)} KB`
);
console.log(
  `Extrapolated for 260K fragments (editing trace): ~${(((objectMemory - soaMemory) * 26) / 1024 / 1024).toFixed(1)} MB saved`
);
