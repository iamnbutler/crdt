/**
 * WebAssembly (WAT) implementation of compareLocators.
 *
 * This is a spike to validate whether hand-written WebAssembly can provide
 * performance gains over TypeScript for the compareLocators hot path.
 *
 * The WAT module operates on linear memory with a specific layout:
 * - Offset 0: lenA (i32) - number of levels in locator A
 * - Offset 4: lenB (i32) - number of levels in locator B
 * - Offset 8: levelsA (f64[]) - levels of locator A as Float64
 * - Offset 8 + lenA*8: levelsB (f64[]) - levels of locator B as Float64
 *
 * Using f64 (Float64) for levels preserves JS number precision (53-bit integers).
 *
 * Reference: GitHub issue #113 (moonshot: Hand-written WebAssembly for tree operations)
 */

import type { Locator } from "../text/types.js";

// WAT source code - hand-written WebAssembly text format
const WAT_SOURCE = `
(module
  ;; Import memory from JS (shared for zero-copy data passing)
  (import "env" "memory" (memory 1))

  ;; Compare two Locators encoded in linear memory
  ;; Memory layout:
  ;;   [0]:  lenA (i32)
  ;;   [4]:  lenB (i32)
  ;;   [8]:  levelsA[0..lenA] (f64 each, 8 bytes)
  ;;   [8 + lenA*8]: levelsB[0..lenB] (f64 each, 8 bytes)
  ;;
  ;; Returns: <0 if A < B, 0 if A == B, >0 if A > B
  (func $compare_locators (export "compare_locators") (result i32)
    (local $lenA i32)
    (local $lenB i32)
    (local $minLen i32)
    (local $i i32)
    (local $offsetA i32)
    (local $offsetB i32)
    (local $levelA f64)
    (local $levelB f64)

    ;; Read lengths
    (local.set $lenA (i32.load (i32.const 0)))
    (local.set $lenB (i32.load (i32.const 4)))

    ;; minLen = min(lenA, lenB)
    (local.set $minLen
      (select
        (local.get $lenA)
        (local.get $lenB)
        (i32.lt_s (local.get $lenA) (local.get $lenB))
      )
    )

    ;; Calculate base offset for B: 8 + lenA * 8
    (local.set $offsetB
      (i32.add
        (i32.const 8)
        (i32.mul (local.get $lenA) (i32.const 8))
      )
    )

    ;; Loop through levels
    (local.set $i (i32.const 0))
    (block $done
      (loop $loop
        ;; Exit if i >= minLen
        (br_if $done (i32.ge_s (local.get $i) (local.get $minLen)))

        ;; offsetA = 8 + i * 8
        (local.set $offsetA
          (i32.add
            (i32.const 8)
            (i32.mul (local.get $i) (i32.const 8))
          )
        )

        ;; Load levels as f64
        (local.set $levelA (f64.load (local.get $offsetA)))
        (local.set $levelB
          (f64.load
            (i32.add
              (local.get $offsetB)
              (i32.mul (local.get $i) (i32.const 8))
            )
          )
        )

        ;; Compare levels
        (if (f64.ne (local.get $levelA) (local.get $levelB))
          (then
            ;; Return -1 if A < B, +1 if A > B
            (if (f64.lt (local.get $levelA) (local.get $levelB))
              (then (return (i32.const -1)))
              (else (return (i32.const 1)))
            )
          )
        )

        ;; i++
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $loop)
      )
    )

    ;; All compared levels equal, compare lengths
    (i32.sub (local.get $lenA) (local.get $lenB))
  )
)
`;

export interface WasmExports {
  compare_locators: () => number;
  memory: WebAssembly.Memory;
}

let cachedModule: WebAssembly.Module | null = null;
let cachedMemory: WebAssembly.Memory | null = null;

/**
 * Compile WAT to WASM binary using wabt.
 * Falls back to loading pre-compiled .wasm if wabt not available.
 */
async function compileWat(): Promise<ArrayBuffer> {
  try {
    // Try dynamic import of wabt
    const wabt = await import("wabt");
    const wabtModule = await wabt.default();
    const module = wabtModule.parseWat("compare-locators.wat", WAT_SOURCE);
    const { buffer } = module.toBinary({});
    module.destroy();
    return buffer.buffer as ArrayBuffer;
  } catch {
    // wabt not installed - try to load pre-compiled wasm
    // For now, throw an error with installation instructions
    throw new Error(
      "wabt package not found. Install with: bun add -d wabt\n" +
        "Or run: bun add -d wabt && bun test src/wasm/compare-locators.test.ts",
    );
  }
}

/**
 * Load and instantiate the WASM module.
 * Returns exports object with compare_locators function and shared memory.
 */
export async function loadWasmModule(): Promise<WasmExports> {
  // Create shared memory (1 page = 64KB, enough for locators)
  if (!cachedMemory) {
    cachedMemory = new WebAssembly.Memory({ initial: 1 });
  }

  if (!cachedModule) {
    const wasmBinary = await compileWat();
    cachedModule = await WebAssembly.compile(wasmBinary);
  }

  const instance = await WebAssembly.instantiate(cachedModule, {
    env: { memory: cachedMemory },
  });

  return {
    compare_locators: instance.exports["compare_locators"] as () => number,
    memory: cachedMemory,
  };
}

/**
 * Encode a pair of Locators into the shared memory buffer.
 * Returns the ArrayBuffer for inspection/testing.
 *
 * Layout:
 *   [0-3]:   lenA (i32, little-endian)
 *   [4-7]:   lenB (i32, little-endian)
 *   [8...]:  levelsA (f64[], little-endian)
 *   [...]:   levelsB (f64[], little-endian)
 */
export function encodeLocatorPair(a: Locator, b: Locator): ArrayBuffer {
  const lenA = a.levels.length;
  const lenB = b.levels.length;

  // Calculate buffer size: 2 i32s + (lenA + lenB) f64s
  const bufferSize = 8 + (lenA + lenB) * 8;
  const buffer = new ArrayBuffer(bufferSize);
  const view = new DataView(buffer);

  // Write lengths
  view.setInt32(0, lenA, true);
  view.setInt32(4, lenB, true);

  // Write levelsA
  let offset = 8;
  for (let i = 0; i < lenA; i++) {
    view.setFloat64(offset, a.levels[i] ?? 0, true);
    offset += 8;
  }

  // Write levelsB
  for (let i = 0; i < lenB; i++) {
    view.setFloat64(offset, b.levels[i] ?? 0, true);
    offset += 8;
  }

  return buffer;
}

/**
 * Compare two Locators using the WASM implementation.
 *
 * This function:
 * 1. Encodes both locators into WASM linear memory
 * 2. Calls the WASM compare_locators function
 * 3. Returns the comparison result
 */
export function compareLocatorsWasm(exports: WasmExports, a: Locator, b: Locator): number {
  const buffer = encodeLocatorPair(a, b);

  // Copy to WASM memory
  const wasmMemory = new Uint8Array(exports.memory.buffer);
  const srcArray = new Uint8Array(buffer);
  wasmMemory.set(srcArray, 0);

  // Call WASM function
  return exports.compare_locators();
}
