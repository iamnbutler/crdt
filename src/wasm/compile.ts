/**
 * Compile WAT to WASM binary using wabt.
 * Used both as a build script and imported by tests/benchmarks.
 */

import wabt from "wabt";
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";

const WASM_DIR = dirname(new URL(import.meta.url).pathname);

export async function compileWat(
  watPath: string,
): Promise<Uint8Array> {
  const wabtModule = await wabt();
  const watSource = readFileSync(watPath, "utf-8");
  const module = wabtModule.parseWat(watPath, watSource);
  module.validate();
  const { buffer } = module.toBinary({});
  module.destroy();
  return buffer;
}

export async function compileLocatorOps(): Promise<Uint8Array> {
  return compileWat(join(WASM_DIR, "locator-ops.wat"));
}

/**
 * Build script entry point: compile all WAT files to .wasm.
 */
async function main() {
  const watFile = join(WASM_DIR, "locator-ops.wat");
  const wasmFile = join(WASM_DIR, "locator-ops.wasm");

  console.log(`Compiling ${watFile}...`);
  const binary = await compileWat(watFile);
  writeFileSync(wasmFile, binary);
  console.log(`Wrote ${wasmFile} (${binary.byteLength} bytes)`);
}

// Run as script
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
