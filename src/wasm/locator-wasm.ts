/**
 * TypeScript bindings for the hand-written WAT locator operations module.
 *
 * Handles encoding/decoding Locators to/from WASM linear memory and
 * provides batched operations that amortize JS↔WASM boundary cost.
 *
 * Memory regions (in WASM linear memory):
 *   0x00000 - 0x0FFFF : Haystack (sorted locator array for binary search)
 *   0x10000 - 0x1FFFF : Keys / input buffer
 *   0x20000 - 0x2FFFF : Output buffer (i32 results)
 *   0x30000 - 0x3FFFF : Offset table / scratch
 */

import type { Locator } from "../text/types.js";

// Memory region offsets (must match WAT module layout)
const HAYSTACK_OFFSET = 0x00000;
const KEYS_OFFSET = 0x80000;
const OUTPUT_OFFSET = 0xc0000;
const OFFSET_TABLE_OFFSET = 0xe0000;

/** Encoded locator size in bytes: 4 (length) + 8 * levels.length */
function encodedLocatorSize(loc: Locator): number {
  return 4 + 8 * loc.levels.length;
}

/** Write a locator to a DataView at a byte offset. Returns bytes written. */
function writeLocator(view: DataView, offset: number, loc: Locator): number {
  view.setInt32(offset, loc.levels.length, true); // little-endian
  for (let i = 0; i < loc.levels.length; i++) {
    const level = loc.levels[i];
    if (level !== undefined) {
      view.setFloat64(offset + 4 + i * 8, level, true);
    }
  }
  return 4 + 8 * loc.levels.length;
}

/** Read a locator from a DataView at a byte offset. Returns [locator, bytesRead]. */
function readLocator(view: DataView, offset: number): [Locator, number] {
  const length = view.getInt32(offset, true);
  const levels: number[] = [];
  for (let i = 0; i < length; i++) {
    levels.push(view.getFloat64(offset + 4 + i * 8, true));
  }
  return [{ levels }, 4 + 8 * length];
}

export interface LocatorWasmExports {
  memory: WebAssembly.Memory;
  batch_compare: (
    pairs_ptr: number,
    count: number,
    out_ptr: number,
  ) => void;
  batch_binary_search: (
    haystack_ptr: number,
    haystack_len: number,
    keys_ptr: number,
    keys_len: number,
    out_ptr: number,
    offset_table_ptr: number,
  ) => void;
  single_binary_search: (
    haystack_ptr: number,
    haystack_len: number,
    key_ptr: number,
    offset_table_ptr: number,
  ) => number;
  compare_locators_at: (a_ptr: number, b_ptr: number) => number;
}

export class LocatorWasm {
  private readonly exports: LocatorWasmExports;
  private readonly view: DataView;

  constructor(instance: WebAssembly.Instance) {
    this.exports = instance.exports as unknown as LocatorWasmExports;
    this.view = new DataView(this.exports.memory.buffer);
  }

  /**
   * Load the WASM module from a .wasm binary.
   */
  static async fromBinary(wasmBytes: ArrayBufferLike): Promise<LocatorWasm> {
    const { instance } = await WebAssembly.instantiate(wasmBytes);
    return new LocatorWasm(instance);
  }

  /**
   * Compare two locators. Returns -1, 0, or 1.
   * Note: For single comparisons, TypeScript is faster due to boundary overhead.
   * Use batchCompare for bulk operations.
   */
  compareSingle(a: Locator, b: Locator): number {
    const aOffset = KEYS_OFFSET;
    const aSize = writeLocator(this.view, aOffset, a);
    const bOffset = aOffset + aSize;
    writeLocator(this.view, bOffset, b);
    return this.exports.compare_locators_at(aOffset, bOffset);
  }

  /**
   * Compare N pairs of locators in a single WASM call.
   * This amortizes the JS↔WASM boundary cost over all pairs.
   * Returns array of -1, 0, or 1 values.
   */
  batchCompare(pairs: ReadonlyArray<[Locator, Locator]>): Int32Array {
    const pairsPtr = KEYS_OFFSET;
    let offset = pairsPtr;

    // Encode all pairs contiguously
    for (const [a, b] of pairs) {
      offset += writeLocator(this.view, offset, a);
      offset += writeLocator(this.view, offset, b);
    }

    this.exports.batch_compare(pairsPtr, pairs.length, OUTPUT_OFFSET);

    return new Int32Array(
      this.exports.memory.buffer,
      OUTPUT_OFFSET,
      pairs.length,
    );
  }

  /**
   * Load a sorted array of locators into the haystack region.
   * Call this once, then use batchSearch or singleSearch multiple times.
   * Returns the offset table pointer (for O(1) locator lookup by index).
   */
  loadHaystack(locators: ReadonlyArray<Locator>): void {
    let offset = HAYSTACK_OFFSET;
    const offsets: number[] = [];

    for (const loc of locators) {
      offsets.push(offset - HAYSTACK_OFFSET); // relative offset
      offset += writeLocator(this.view, offset, loc);
    }

    // Write offset table
    const offsetView = new Uint32Array(
      this.exports.memory.buffer,
      OFFSET_TABLE_OFFSET,
      locators.length,
    );
    for (let i = 0; i < offsets.length; i++) {
      const off = offsets[i];
      if (off !== undefined) {
        offsetView[i] = off;
      }
    }
  }

  /**
   * Search for multiple keys in the loaded haystack.
   * Returns insertion indices for each key.
   */
  batchSearch(
    haystackLen: number,
    keys: ReadonlyArray<Locator>,
  ): Int32Array {
    // Encode keys
    let offset = KEYS_OFFSET;
    for (const key of keys) {
      offset += writeLocator(this.view, offset, key);
    }

    this.exports.batch_binary_search(
      HAYSTACK_OFFSET,
      haystackLen,
      KEYS_OFFSET,
      keys.length,
      OUTPUT_OFFSET,
      OFFSET_TABLE_OFFSET,
    );

    return new Int32Array(
      this.exports.memory.buffer,
      OUTPUT_OFFSET,
      keys.length,
    );
  }

  /**
   * Search for a single key in the loaded haystack.
   */
  singleSearch(haystackLen: number, key: Locator): number {
    writeLocator(this.view, KEYS_OFFSET, key);
    return this.exports.single_binary_search(
      HAYSTACK_OFFSET,
      haystackLen,
      KEYS_OFFSET,
      OFFSET_TABLE_OFFSET,
    );
  }
}

// Re-export for convenience
export { writeLocator, readLocator, encodedLocatorSize };
export type { Locator };
