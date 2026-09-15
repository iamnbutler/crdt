import { expect, test } from "bun:test";
import { compressBlock, decompressBlock } from "./compression.js";

test("LZ4 literal and overlapping-match vectors", () => {
  expect(decompressBlock(new Uint8Array([0]), 0)).toEqual(new Uint8Array());
  expect(decompressBlock(new Uint8Array([0x30, 97, 98, 99]), 3)).toEqual(
    new Uint8Array([97, 98, 99]),
  );
  // One literal, a 14-byte match at distance 1, and five final literals.
  const repeated = new Uint8Array([0x1a, 97, 1, 0, 0x50, 97, 97, 97, 97, 97]);
  expect(decompressBlock(repeated, 20)).toEqual(new Uint8Array(20).fill(97));
});

for (let seed = 1; seed <= 40; seed++) {
  test(`LZ4 preserves arbitrary bytes and repeated spans, seed ${seed}`, () => {
    let random = seed;
    const next = (): number => {
      random ^= random << 13;
      random ^= random >>> 17;
      random ^= random << 5;
      return random >>> 0;
    };
    for (const length of [seed - 1, 255 + seed, 4096 + seed, 70_000 + seed]) {
      const input = new Uint8Array(length);
      for (let i = 0; i < length; i++) {
        input[i] = next() % 3 === 0 ? next() & 255 : (input[Math.max(0, i - seed)] ?? 0);
      }
      const encoded = compressBlock(input);
      expect(decompressBlock(encoded, length)).toEqual(input);
    }
  });
}

test("LZ4 rejects invalid sizes, offsets, and truncated blocks", () => {
  const inputs = [
    new Uint8Array(),
    new Uint8Array([0x10]),
    new Uint8Array([0x10, 97, 0, 0]),
    new Uint8Array([0x10, 97, 2, 0]),
    new Uint8Array([0xf0, 255]),
  ];
  for (const input of inputs) expect(() => decompressBlock(input, 20)).toThrow();
  for (const length of [-1, 0.5, Number.MAX_SAFE_INTEGER, Number.NaN]) {
    expect(() => decompressBlock(new Uint8Array([0]), length)).toThrow();
  }
  const compressed = compressBlock(new Uint8Array(1000).fill(42));
  for (let length = 0; length < compressed.length; length++) {
    expect(() => decompressBlock(compressed.slice(0, length), 1000)).toThrow();
  }
});
