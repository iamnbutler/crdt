/**
 * LSD (Least Significant Digit) Radix Sort in pure TypeScript.
 *
 * Sorts fixed-width byte keys using counting sort on each byte position,
 * from least significant to most significant byte.
 *
 * Time: O(n × k) where k = key width in bytes
 * Space: O(n) for auxiliary arrays + O(256) for histogram
 */

import { KEY_SIZE } from "./key-encoding.js";

/**
 * LSD radix sort on encoded byte keys.
 * Sorts indices in-place based on the byte keys.
 *
 * @param keys - Flat buffer of encoded keys (n × KEY_SIZE bytes)
 * @param indices - Array of indices to sort (modified in-place)
 * @param n - Number of elements
 */
export function radixSortTS(keys: Uint8Array, indices: Uint32Array, n: number): void {
  if (n <= 1) return;

  const aux = new Uint32Array(n);
  const counts = new Uint32Array(256);

  // Process each byte position from least significant to most significant
  for (let bytePos = KEY_SIZE - 1; bytePos >= 0; bytePos--) {
    // Count phase
    counts.fill(0);
    for (let i = 0; i < n; i++) {
      const idx = indices[i]!;
      const byte = keys[idx * KEY_SIZE + bytePos]!;
      counts[byte]++;
    }

    // Prefix sum phase
    let total = 0;
    for (let i = 0; i < 256; i++) {
      const count = counts[i]!;
      counts[i] = total;
      total += count;
    }

    // Scatter phase
    for (let i = 0; i < n; i++) {
      const idx = indices[i]!;
      const byte = keys[idx * KEY_SIZE + bytePos]!;
      const dest = counts[byte]!;
      aux[dest] = idx;
      counts[byte] = dest + 1;
    }

    // Copy back
    indices.set(aux);
  }
}

/**
 * Optimized radix sort that skips byte positions where all values are identical.
 * Pre-scans each byte position and only sorts on positions with variation.
 */
export function radixSortTSOptimized(keys: Uint8Array, indices: Uint32Array, n: number): void {
  if (n <= 1) return;

  const aux = new Uint32Array(n);
  const counts = new Uint32Array(256);

  // Pre-scan: find which byte positions actually vary
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
    if (varies) {
      varyingPositions.push(bytePos);
    }
  }

  // Only sort on varying positions (LSD order - least significant first)
  for (const bytePos of varyingPositions) {
    counts.fill(0);

    for (let i = 0; i < n; i++) {
      const idx = indices[i]!;
      counts[keys[idx * KEY_SIZE + bytePos]!]++;
    }

    let total = 0;
    for (let i = 0; i < 256; i++) {
      const count = counts[i]!;
      counts[i] = total;
      total += count;
    }

    for (let i = 0; i < n; i++) {
      const idx = indices[i]!;
      const byte = keys[idx * KEY_SIZE + bytePos]!;
      aux[counts[byte]!] = idx;
      counts[byte]!++;
    }

    indices.set(aux);
  }
}
