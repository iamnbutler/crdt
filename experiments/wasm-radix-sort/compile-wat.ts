/**
 * Compile WAT to WASM using the wabt npm package.
 */
import wabt from "wabt";

const watPath = new URL("./radix-sort.wat", import.meta.url).pathname;
const wasmPath = new URL("./radix-sort.wasm", import.meta.url).pathname;

const watSource = await Bun.file(watPath).text();
const wabtModule = await wabt();
const parsed = wabtModule.parseWat("radix-sort.wat", watSource, {
  simd: true,
  threads: false,
});
parsed.validate();
const { buffer } = parsed.toBinary({ write_debug_names: false });

await Bun.write(wasmPath, buffer);
console.log(`Compiled radix-sort.wasm: ${buffer.length} bytes`);

// Validate
const module = await WebAssembly.compile(buffer);
const instance = await WebAssembly.instantiate(module);
console.log("Exports:", Object.keys(instance.exports));
