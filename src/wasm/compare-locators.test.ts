/**
 * Tests for WAT-based compareLocators implementation.
 *
 * This is a spike to validate whether hand-written WebAssembly can provide
 * performance gains over TypeScript for the compareLocators hot path.
 *
 * Reference: GitHub issue #113 (moonshot: Hand-written WebAssembly for tree operations)
 */

import { describe, test, expect, beforeAll } from "bun:test";
import { compareLocators as compareLocatorsTS } from "../text/locator.js";
import type { Locator } from "../text/types.js";
import {
  loadWasmModule,
  compareLocatorsWasm,
  encodeLocatorPair,
  type WasmExports,
} from "./compare-locators.js";

describe("WAT compareLocators", () => {
  let wasmExports: WasmExports;

  beforeAll(async () => {
    wasmExports = await loadWasmModule();
  });

  // Helper to create Locator from levels
  const loc = (levels: number[]): Locator => ({ levels });

  describe("correctness", () => {
    test("equal locators return 0", () => {
      const a = loc([100]);
      const b = loc([100]);

      const tsResult = compareLocatorsTS(a, b);
      const wasmResult = compareLocatorsWasm(wasmExports, a, b);

      expect(tsResult).toBe(0);
      expect(wasmResult).toBe(0);
    });

    test("a < b returns negative", () => {
      const a = loc([50]);
      const b = loc([100]);

      const tsResult = compareLocatorsTS(a, b);
      const wasmResult = compareLocatorsWasm(wasmExports, a, b);

      expect(tsResult).toBeLessThan(0);
      expect(wasmResult).toBeLessThan(0);
    });

    test("a > b returns positive", () => {
      const a = loc([100]);
      const b = loc([50]);

      const tsResult = compareLocatorsTS(a, b);
      const wasmResult = compareLocatorsWasm(wasmExports, a, b);

      expect(tsResult).toBeGreaterThan(0);
      expect(wasmResult).toBeGreaterThan(0);
    });

    test("multi-level: first level differs", () => {
      const a = loc([10, 20, 30]);
      const b = loc([20, 20, 30]);

      const tsResult = compareLocatorsTS(a, b);
      const wasmResult = compareLocatorsWasm(wasmExports, a, b);

      expect(tsResult).toBeLessThan(0);
      expect(wasmResult).toBeLessThan(0);
    });

    test("multi-level: second level differs", () => {
      const a = loc([10, 20, 30]);
      const b = loc([10, 30, 30]);

      const tsResult = compareLocatorsTS(a, b);
      const wasmResult = compareLocatorsWasm(wasmExports, a, b);

      expect(tsResult).toBeLessThan(0);
      expect(wasmResult).toBeLessThan(0);
    });

    test("multi-level: third level differs", () => {
      const a = loc([10, 20, 30]);
      const b = loc([10, 20, 40]);

      const tsResult = compareLocatorsTS(a, b);
      const wasmResult = compareLocatorsWasm(wasmExports, a, b);

      expect(tsResult).toBeLessThan(0);
      expect(wasmResult).toBeLessThan(0);
    });

    test("different lengths: shorter < longer when prefix matches", () => {
      const a = loc([10, 20]);
      const b = loc([10, 20, 30]);

      const tsResult = compareLocatorsTS(a, b);
      const wasmResult = compareLocatorsWasm(wasmExports, a, b);

      expect(tsResult).toBeLessThan(0);
      expect(wasmResult).toBeLessThan(0);
    });

    test("different lengths: longer > shorter when prefix matches", () => {
      const a = loc([10, 20, 30]);
      const b = loc([10, 20]);

      const tsResult = compareLocatorsTS(a, b);
      const wasmResult = compareLocatorsWasm(wasmExports, a, b);

      expect(tsResult).toBeGreaterThan(0);
      expect(wasmResult).toBeGreaterThan(0);
    });

    test("single level locators", () => {
      const cases: [Locator, Locator][] = [
        [loc([0]), loc([1])],
        [loc([1000]), loc([1000])],
        [loc([Number.MAX_SAFE_INTEGER]), loc([0])],
      ];

      for (const [a, b] of cases) {
        const tsResult = compareLocatorsTS(a, b);
        const wasmResult = compareLocatorsWasm(wasmExports, a, b);

        // Results should have same sign
        expect(Math.sign(wasmResult)).toBe(Math.sign(tsResult));
      }
    });

    test("edge case: empty locators", () => {
      const a = loc([]);
      const b = loc([]);

      const tsResult = compareLocatorsTS(a, b);
      const wasmResult = compareLocatorsWasm(wasmExports, a, b);

      expect(tsResult).toBe(0);
      expect(wasmResult).toBe(0);
    });

    test("edge case: one empty, one non-empty", () => {
      const a = loc([]);
      const b = loc([10]);

      const tsResult = compareLocatorsTS(a, b);
      const wasmResult = compareLocatorsWasm(wasmExports, a, b);

      expect(Math.sign(wasmResult)).toBe(Math.sign(tsResult));
    });

    test("four levels (max supported)", () => {
      const a = loc([10, 20, 30, 40]);
      const b = loc([10, 20, 30, 50]);

      const tsResult = compareLocatorsTS(a, b);
      const wasmResult = compareLocatorsWasm(wasmExports, a, b);

      expect(Math.sign(wasmResult)).toBe(Math.sign(tsResult));
    });

    test("large values near MAX_SAFE_INTEGER", () => {
      // The WAT implementation uses i64, so it can handle full 53-bit integers
      const large = 2 ** 40; // 40-bit value
      const a = loc([large]);
      const b = loc([large + 1]);

      const tsResult = compareLocatorsTS(a, b);
      const wasmResult = compareLocatorsWasm(wasmExports, a, b);

      expect(Math.sign(wasmResult)).toBe(Math.sign(tsResult));
    });
  });

  describe("encoding", () => {
    test("encodeLocatorPair produces correct buffer layout", () => {
      const a = loc([10, 20]);
      const b = loc([30, 40, 50]);

      const buffer = encodeLocatorPair(a, b);
      const view = new DataView(buffer);

      // Layout: [lenA (i32), lenB (i32), levelsA..., levelsB...]
      // Using Float64 for levels to preserve JS number precision
      expect(view.getInt32(0, true)).toBe(2); // lenA
      expect(view.getInt32(4, true)).toBe(3); // lenB
      expect(view.getFloat64(8, true)).toBe(10); // a.levels[0]
      expect(view.getFloat64(16, true)).toBe(20); // a.levels[1]
      expect(view.getFloat64(24, true)).toBe(30); // b.levels[0]
      expect(view.getFloat64(32, true)).toBe(40); // b.levels[1]
      expect(view.getFloat64(40, true)).toBe(50); // b.levels[2]
    });
  });
});
