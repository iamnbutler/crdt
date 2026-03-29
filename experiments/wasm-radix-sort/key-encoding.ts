/**
 * Key encoding for radix sort of CRDT fragments.
 *
 * Flattens the multi-level comparison (Locator → OperationId → insertionOffset → depth)
 * into fixed-width byte keys suitable for LSD radix sort.
 *
 * Encoding layout (big-endian for lexicographic byte comparison):
 *   - Locator levels: MAX_DEPTH × 8 bytes = 128 bytes (padded with 0s)
 *   - ReplicaId: 4 bytes (uint32)
 *   - Counter: 4 bytes (uint32)
 *   - InsertionOffset: 4 bytes (uint32)
 *   - Locator depth: 1 byte (uint8)
 *   Total: 141 bytes per key
 *
 * Because Locator levels are 53-bit integers and we need lexicographic byte
 * ordering, each level is stored as 7 bytes (big-endian, top bits first).
 * This avoids the overhead of full 8-byte encoding while covering the full
 * 53-bit range (2^53 - 1 < 2^56).
 */

const MAX_DEPTH = 16;
const BYTES_PER_LEVEL = 7; // 7 bytes covers 56 bits, enough for 53-bit safe integers
const LOCATOR_BYTES = MAX_DEPTH * BYTES_PER_LEVEL; // 112 bytes
const REPLICA_ID_BYTES = 4;
const COUNTER_BYTES = 4;
const OFFSET_BYTES = 4;
const DEPTH_BYTES = 1;

/** Total bytes per sort key. */
export const KEY_SIZE =
  LOCATOR_BYTES + REPLICA_ID_BYTES + COUNTER_BYTES + OFFSET_BYTES + DEPTH_BYTES; // 125 bytes

export interface SortableFragment {
  readonly locator: { readonly levels: ReadonlyArray<number> };
  readonly insertionId: { readonly replicaId: number; readonly counter: number };
  readonly insertionOffset: number;
}

/**
 * Encode a fragment's sort key into a Uint8Array at the given offset.
 */
export function encodeKey(buf: Uint8Array, offset: number, frag: SortableFragment): void {
  let pos = offset;

  // Encode locator levels (big-endian, 7 bytes each)
  const levels = frag.locator.levels;
  for (let i = 0; i < MAX_DEPTH; i++) {
    const val = i < levels.length ? (levels[i] ?? 0) : 0;
    // Write 7 bytes big-endian (bits 48..0 of the 53-bit value)
    buf[pos] = (val / 2 ** 48) & 0xff;
    buf[pos + 1] = (val / 2 ** 40) & 0xff;
    buf[pos + 2] = (val / 2 ** 32) & 0xff;
    buf[pos + 3] = (val >>> 24) & 0xff;
    buf[pos + 4] = (val >>> 16) & 0xff;
    buf[pos + 5] = (val >>> 8) & 0xff;
    buf[pos + 6] = val & 0xff;
    pos += BYTES_PER_LEVEL;
  }

  // ReplicaId (4 bytes big-endian)
  const rid = frag.insertionId.replicaId;
  buf[pos] = (rid >>> 24) & 0xff;
  buf[pos + 1] = (rid >>> 16) & 0xff;
  buf[pos + 2] = (rid >>> 8) & 0xff;
  buf[pos + 3] = rid & 0xff;
  pos += REPLICA_ID_BYTES;

  // Counter (4 bytes big-endian)
  const ctr = frag.insertionId.counter;
  buf[pos] = (ctr >>> 24) & 0xff;
  buf[pos + 1] = (ctr >>> 16) & 0xff;
  buf[pos + 2] = (ctr >>> 8) & 0xff;
  buf[pos + 3] = ctr & 0xff;
  pos += COUNTER_BYTES;

  // InsertionOffset (4 bytes big-endian)
  const off = frag.insertionOffset;
  buf[pos] = (off >>> 24) & 0xff;
  buf[pos + 1] = (off >>> 16) & 0xff;
  buf[pos + 2] = (off >>> 8) & 0xff;
  buf[pos + 3] = off & 0xff;
  pos += OFFSET_BYTES;

  // Locator depth (1 byte)
  buf[pos] = levels.length & 0xff;
}

/**
 * Encode all fragments' sort keys into a single buffer.
 * Returns the key buffer and the original indices.
 */
export function encodeKeys(frags: ReadonlyArray<SortableFragment>): {
  keys: Uint8Array;
  indices: Uint32Array;
} {
  const n = frags.length;
  const keys = new Uint8Array(n * KEY_SIZE);
  const indices = new Uint32Array(n);

  for (let i = 0; i < n; i++) {
    encodeKey(keys, i * KEY_SIZE, frags[i]!);
    indices[i] = i;
  }

  return { keys, indices };
}

/**
 * Compare two encoded keys byte-by-byte (for validation).
 */
export function compareKeys(keys: Uint8Array, aIdx: number, bIdx: number): number {
  const aOff = aIdx * KEY_SIZE;
  const bOff = bIdx * KEY_SIZE;
  for (let i = 0; i < KEY_SIZE; i++) {
    const diff = (keys[aOff + i] ?? 0) - (keys[bOff + i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}
