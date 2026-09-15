// LZ4 block format, implemented here without runtime dependencies.
// https://github.com/lz4/lz4/blob/dev/doc/lz4_Block_format.md
const MAX_BLOCK = 64 * 1024 * 1024;

/** A bounded LZ4 block. Its uncompressed length lives in the CRDT frame. */
export function compressBlock(input: Uint8Array): Uint8Array {
  if (input.length > MAX_BLOCK) throw new RangeError("Update block exceeds 64 MiB");
  const output = new Uint8Array(input.length + Math.ceil(input.length / 255) + 16);
  const dictionary = new Int32Array(16384);
  const view = new DataView(input.buffer, input.byteOffset, input.byteLength);
  let offset = 0;
  let anchor = 0;
  let position = 1;
  const extra = (length: number): void => {
    let remaining = length;
    while (remaining >= 255) {
      output[offset++] = 255;
      remaining -= 255;
    }
    output[offset++] = remaining;
  };
  const hash = (word: number): number => Math.imul(word, 0x9e3779b1) >>> 18;
  if (input.length >= 4) dictionary[hash(view.getUint32(0, true))] = 1;
  while (position <= input.length - 12) {
    const word = view.getUint32(position, true);
    const key = hash(word);
    const match = (dictionary[key] ?? 0) - 1;
    dictionary[key] = position + 1;
    if (match < 0 || position - match > 65535 || view.getUint32(match, true) !== word) {
      position++;
      continue;
    }
    let length = 4;
    while (
      position + length < input.length - 5 &&
      input[match + length] === input[position + length]
    )
      length++;
    const literals = position - anchor;
    output[offset++] = (Math.min(literals, 15) << 4) | Math.min(length - 4, 15);
    if (literals >= 15) extra(literals - 15);
    if (literals < 32) {
      for (let i = anchor; i < position; i++) output[offset++] = input[i] ?? 0;
    } else {
      output.set(input.subarray(anchor, position), offset);
      offset += literals;
    }
    const distance = position - match;
    output[offset++] = distance & 255;
    output[offset++] = distance >>> 8;
    if (length >= 19) extra(length - 19);
    position += length;
    anchor = position;
    dictionary[hash(view.getUint32(position - 2, true))] = position - 1;
  }
  const tail = input.length - anchor;
  output[offset++] = Math.min(tail, 15) << 4;
  if (tail >= 15) extra(tail - 15);
  output.set(input.subarray(anchor), offset);
  return output.slice(0, offset + tail);
}

export function decompressBlock(input: Uint8Array, length: number): Uint8Array {
  if (!Number.isSafeInteger(length) || length < 0 || length > MAX_BLOCK)
    throw new RangeError("Invalid update block length");
  // LZ4 cannot expand more than about 255 bytes per encoded length byte.
  if (length > input.length * 255) throw new Error("Impossible update block length");
  const output = new Uint8Array(length);
  let offset = 0;
  let position = 0;
  const byte = (): number => {
    const value = input[offset++];
    if (value === undefined) throw new Error("Truncated compressed update");
    return value;
  };
  const extended = (base: number): number => {
    let size = base;
    if (base === 15) {
      let more: number;
      do {
        more = byte();
        size += more;
      } while (more === 255);
    }
    return size;
  };
  while (offset < input.length) {
    const token = byte();
    const literals = extended(token >>> 4);
    if (offset + literals > input.length || position + literals > length)
      throw new Error("Invalid compressed literal length");
    if (literals < 32) {
      const end = offset + literals;
      while (offset < end) output[position++] = input[offset++] ?? 0;
    } else {
      output.set(input.subarray(offset, offset + literals), position);
      offset += literals;
      position += literals;
    }
    if (offset === input.length) {
      if (position !== length || (length >= 5 && literals < 5))
        throw new Error("Invalid compressed block ending");
      return output;
    }
    const distance = byte() | (byte() << 8);
    if (distance === 0 || distance > position) throw new Error("Invalid compressed offset");
    const match = extended(token & 15) + 4;
    if (position > length - 12 || position + match > length - 5)
      throw new Error("Invalid compressed match length");
    const start = position - distance;
    const end = position + match;
    if (match < 64) {
      while (position < end) {
        output[position] = output[position - distance] ?? 0;
        position++;
      }
    } else {
      // Doubling copies correctly expand overlapping matches, including offset 1.
      while (position < end) {
        const count = Math.min(position - start, end - position);
        output.copyWithin(position, start, start + count);
        position += count;
      }
    }
  }
  throw new Error("Missing compressed block ending");
}
