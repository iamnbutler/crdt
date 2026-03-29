/**
 * WASM radix sort wrapper.
 *
 * Loads the hand-built WASM module and provides a TypeScript interface
 * that handles memory layout and JS↔WASM data marshaling.
 */

import { KEY_SIZE } from "./key-encoding.js";

interface RadixSortWasmExports {
  memory: WebAssembly.Memory;
  radix_sort_pass: (
    n: number,
    bytePos: number,
    keySize: number,
    keysPtr: number,
    indicesPtr: number,
    auxPtr: number,
  ) => void;
}

export interface RadixSortWasmInstance {
  /**
   * Sort indices by their encoded keys using WASM radix sort.
   * Modifies indices in-place.
   */
  sort: (keys: Uint8Array, indices: Uint32Array, n: number) => void;

  /** The WASM memory for direct access if needed. */
  memory: WebAssembly.Memory;
}

/**
 * Load and instantiate the WASM radix sort module.
 */
export async function loadRadixSortWasm(): Promise<RadixSortWasmInstance> {
  const wasmPath = new URL("./radix-sort.wasm", import.meta.url).pathname;
  const wasmBytes = await Bun.file(wasmPath).arrayBuffer();
  const module = await WebAssembly.compile(wasmBytes);
  const instance = await WebAssembly.instantiate(module);
  const exports = instance.exports as unknown as RadixSortWasmExports;

  return {
    memory: exports.memory,

    sort(keys: Uint8Array, indices: Uint32Array, n: number): void {
      if (n <= 1) return;

      // Memory layout:
      //   0                    : keys (n × KEY_SIZE bytes)
      //   keysEnd              : indices (n × 4 bytes)
      //   indicesEnd           : aux (n × 4 bytes)
      //   auxEnd               : counts (256 × 4 = 1024 bytes, allocated by WASM)
      const keysBytes = n * KEY_SIZE;
      // Align indices to 4-byte boundary
      const keysBytesAligned = (keysBytes + 3) & ~3;
      const indicesBytes = n * 4;
      const auxBytes = n * 4;
      const countsBytes = 1024;
      const totalBytes = keysBytesAligned + indicesBytes + auxBytes + countsBytes;

      // Ensure memory is large enough
      const currentPages = exports.memory.buffer.byteLength / 65536;
      const neededPages = Math.ceil(totalBytes / 65536);
      if (neededPages > currentPages) {
        exports.memory.grow(neededPages - currentPages);
      }

      const keysPtr = 0;
      const indicesPtr = keysBytesAligned;
      const auxPtr = indicesPtr + indicesBytes;

      // Copy data into WASM memory
      const memBuf = new Uint8Array(exports.memory.buffer);
      memBuf.set(keys.subarray(0, keysBytes), keysPtr);

      const memIndices = new Uint32Array(exports.memory.buffer, indicesPtr, n);
      memIndices.set(indices.subarray(0, n));

      // Run radix sort pass for each byte position (LSD order)
      for (let bytePos = KEY_SIZE - 1; bytePos >= 0; bytePos--) {
        exports.radix_sort_pass(n, bytePos, KEY_SIZE, keysPtr, indicesPtr, auxPtr);
      }

      // Copy sorted indices back
      const resultIndices = new Uint32Array(exports.memory.buffer, indicesPtr, n);
      indices.set(resultIndices);
    },
  };
}

/**
 * WASM sort with skip optimization: pre-scan for varying byte positions
 * in JS, only call WASM for those positions.
 */
export function createOptimizedWasmSort(
  wasmInstance: RadixSortWasmInstance,
  exports: RadixSortWasmExports,
) {
  return function sortOptimized(keys: Uint8Array, indices: Uint32Array, n: number): void {
    if (n <= 1) return;

    // Pre-scan in JS to find varying byte positions
    const varyingPositions: number[] = [];
    for (let bytePos = KEY_SIZE - 1; bytePos >= 0; bytePos--) {
      const firstByte = keys[indices[0]! * KEY_SIZE + bytePos]!;
      let varies = false;
      for (let i = 1; i < n; i++) {
        if (keys[indices[i]! * KEY_SIZE + bytePos] !== firstByte) {
          varies = true;
          break;
        }
      }
      if (varies) varyingPositions.push(bytePos);
    }

    if (varyingPositions.length === 0) return;

    // Setup WASM memory
    const keysBytes = n * KEY_SIZE;
    const indicesBytes = n * 4;
    const auxBytes = n * 4;
    const countsBytes = 1024;
    const totalBytes = keysBytes + indicesBytes + auxBytes + countsBytes;

    const mem = wasmInstance.memory;
    const currentPages = mem.buffer.byteLength / 65536;
    const neededPages = Math.ceil(totalBytes / 65536);
    if (neededPages > currentPages) {
      mem.grow(neededPages - currentPages);
    }

    const keysPtr = 0;
    const indicesPtr = keysBytes;
    const auxPtr = indicesPtr + indicesBytes;

    const memBuf = new Uint8Array(mem.buffer);
    memBuf.set(keys.subarray(0, keysBytes), keysPtr);
    new Uint32Array(mem.buffer, indicesPtr, n).set(indices.subarray(0, n));

    // Only sort on varying positions
    const radixSortPass = (exports as unknown as RadixSortWasmExports).radix_sort_pass;
    for (const bytePos of varyingPositions) {
      radixSortPass(n, bytePos, KEY_SIZE, keysPtr, indicesPtr, auxPtr);
    }

    indices.set(new Uint32Array(mem.buffer, indicesPtr, n));
  };
}
