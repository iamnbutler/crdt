/**
 * Compact key encoding that reduces key width by only encoding
 * a fixed shallow depth (3 levels instead of 16).
 *
 * This trades correctness for speed: fragments deeper than MAX_COMPACT_DEPTH
 * need a fallback comparison sort. The hypothesis is that most fragments
 * have shallow locators (depth 1-3), so the compact key handles the majority.
 *
 * Layout (big-endian):
 *   - Locator levels: 3 × 7 bytes = 21 bytes
 *   - ReplicaId: 4 bytes
 *   - Counter: 4 bytes
 *   - InsertionOffset: 4 bytes
 *   - Depth: 1 byte
 *   Total: 34 bytes (vs 125 for full encoding)
 */

const COMPACT_DEPTH = 3;
const BYTES_PER_LEVEL = 7;
const LOCATOR_BYTES = COMPACT_DEPTH * BYTES_PER_LEVEL; // 21
const REPLICA_ID_BYTES = 4;
const COUNTER_BYTES = 4;
const OFFSET_BYTES = 4;
const DEPTH_BYTES = 1;

export const COMPACT_KEY_SIZE =
  LOCATOR_BYTES + REPLICA_ID_BYTES + COUNTER_BYTES + OFFSET_BYTES + DEPTH_BYTES; // 34 bytes

export interface SortableFragment {
  readonly locator: { readonly levels: ReadonlyArray<number> };
  readonly insertionId: { readonly replicaId: number; readonly counter: number };
  readonly insertionOffset: number;
}

export function encodeCompactKey(buf: Uint8Array, offset: number, frag: SortableFragment): void {
  let pos = offset;
  const levels = frag.locator.levels;

  for (let i = 0; i < COMPACT_DEPTH; i++) {
    const val = i < levels.length ? (levels[i] ?? 0) : 0;
    buf[pos] = (val / 2 ** 48) & 0xff;
    buf[pos + 1] = (val / 2 ** 40) & 0xff;
    buf[pos + 2] = (val / 2 ** 32) & 0xff;
    buf[pos + 3] = (val >>> 24) & 0xff;
    buf[pos + 4] = (val >>> 16) & 0xff;
    buf[pos + 5] = (val >>> 8) & 0xff;
    buf[pos + 6] = val & 0xff;
    pos += BYTES_PER_LEVEL;
  }

  const rid = frag.insertionId.replicaId;
  buf[pos] = (rid >>> 24) & 0xff;
  buf[pos + 1] = (rid >>> 16) & 0xff;
  buf[pos + 2] = (rid >>> 8) & 0xff;
  buf[pos + 3] = rid & 0xff;
  pos += REPLICA_ID_BYTES;

  const ctr = frag.insertionId.counter;
  buf[pos] = (ctr >>> 24) & 0xff;
  buf[pos + 1] = (ctr >>> 16) & 0xff;
  buf[pos + 2] = (ctr >>> 8) & 0xff;
  buf[pos + 3] = ctr & 0xff;
  pos += COUNTER_BYTES;

  const off = frag.insertionOffset;
  buf[pos] = (off >>> 24) & 0xff;
  buf[pos + 1] = (off >>> 16) & 0xff;
  buf[pos + 2] = (off >>> 8) & 0xff;
  buf[pos + 3] = off & 0xff;
  pos += OFFSET_BYTES;

  buf[pos] = levels.length & 0xff;
}

export function encodeCompactKeys(frags: ReadonlyArray<SortableFragment>): {
  keys: Uint8Array;
  indices: Uint32Array;
} {
  const n = frags.length;
  const keys = new Uint8Array(n * COMPACT_KEY_SIZE);
  const indices = new Uint32Array(n);

  for (let i = 0; i < n; i++) {
    encodeCompactKey(keys, i * COMPACT_KEY_SIZE, frags[i]!);
    indices[i] = i;
  }

  return { keys, indices };
}

/**
 * LSD radix sort for compact keys.
 */
export function radixSortCompact(keys: Uint8Array, indices: Uint32Array, n: number): void {
  if (n <= 1) return;

  const aux = new Uint32Array(n);
  const counts = new Uint32Array(256);

  for (let bytePos = COMPACT_KEY_SIZE - 1; bytePos >= 0; bytePos--) {
    counts.fill(0);
    for (let i = 0; i < n; i++) {
      counts[keys[indices[i]! * COMPACT_KEY_SIZE + bytePos]!]++;
    }

    let total = 0;
    for (let i = 0; i < 256; i++) {
      const count = counts[i]!;
      counts[i] = total;
      total += count;
    }

    for (let i = 0; i < n; i++) {
      const idx = indices[i]!;
      const byte = keys[idx * COMPACT_KEY_SIZE + bytePos]!;
      aux[counts[byte]!] = idx;
      counts[byte]!++;
    }

    indices.set(aux);
  }
}
