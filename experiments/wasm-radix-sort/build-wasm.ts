/**
 * Builds a WASM binary for LSD radix sort programmatically.
 *
 * The WASM module operates on shared linear memory:
 *   - Keys buffer at offset 0: n × KEY_SIZE bytes
 *   - Indices at keys_end: n × 4 bytes (uint32)
 *   - Aux buffer at indices_end: n × 4 bytes (uint32)
 *   - Counts at aux_end: 256 × 4 bytes = 1024 bytes
 *
 * Exports:
 *   - memory: WebAssembly.Memory
 *   - radix_sort(n: i32, key_size: i32, keys_ptr: i32, indices_ptr: i32, aux_ptr: i32, counts_ptr: i32): void
 */

// WASM binary encoding helpers
function encodeU32(n: number): number[] {
  const bytes: number[] = [];
  let val = n;
  do {
    let byte = val & 0x7f;
    val >>>= 7;
    if (val !== 0) byte |= 0x80;
    bytes.push(byte);
  } while (val !== 0);
  return bytes;
}

function encodeI32(n: number): number[] {
  const bytes: number[] = [];
  let val = n;
  let more = true;
  while (more) {
    let byte = val & 0x7f;
    val >>= 7;
    if ((val === 0 && (byte & 0x40) === 0) || (val === -1 && (byte & 0x40) !== 0)) {
      more = false;
    } else {
      byte |= 0x80;
    }
    bytes.push(byte);
  }
  return bytes;
}

function section(id: number, contents: number[]): number[] {
  return [id, ...encodeU32(contents.length), ...contents];
}

function vec(items: number[][]): number[] {
  const flat = items.flat();
  return [...encodeU32(items.length), ...flat];
}

/**
 * Build a minimal WASM module with a scalar radix sort function.
 *
 * We use WAT-equivalent logic but emit raw bytes to avoid needing wat2wasm.
 * The function implements LSD radix sort processing each byte position.
 */
export function buildRadixSortWasm(): Uint8Array {
  // We'll write the WAT as a string and use a simpler approach:
  // Since we can't compile WAT, we'll build a minimal WASM module
  // that exposes memory and a radix sort function.

  // For the spike, we use a hybrid approach: the WASM module provides
  // just the inner counting/scatter loop, while the outer byte-position
  // loop is driven from JS. This minimizes WASM complexity while still
  // measuring the JS↔WASM boundary cost.

  const bytes: number[] = [];

  // Magic + version
  bytes.push(0x00, 0x61, 0x73, 0x6d); // \0asm
  bytes.push(0x01, 0x00, 0x00, 0x00); // version 1

  // Type section: define function signatures
  // Type 0: (i32, i32, i32, i32, i32, i32) -> void  [radix_sort_pass]
  // Type 1: () -> void  [for start, if needed]
  // Section order must be: Type(1), Function(3), Memory(5), Export(7), Code(10)

  const typeSection = section(
    1,
    vec([
      // Type 0: fn(n, byte_pos, key_size, keys_ptr, indices_ptr, aux_ptr) -> ()
      [0x60, ...encodeU32(6), 0x7f, 0x7f, 0x7f, 0x7f, 0x7f, 0x7f, ...encodeU32(0)],
    ]),
  );
  bytes.push(...typeSection);

  // Function section: 1 function of type 0
  const funcSection = section(
    3,
    vec([
      [0x00], // function 0 uses type 0
    ]),
  );
  bytes.push(...funcSection);

  // Memory section: 1 memory, min 256 pages (16MB), no max
  const memSection = section(
    5,
    vec([
      [0x00, ...encodeU32(256)], // min 256 pages
    ]),
  );
  bytes.push(...memSection);

  // Export section: export memory and function
  const exportSection = section(7, [
    ...encodeU32(2),
    // Export "memory"
    ...encodeU32(6),
    ...Array.from("memory", (c) => c.charCodeAt(0)),
    0x02, // memory export
    ...encodeU32(0), // memory index 0
    // Export "radix_sort_pass"
    ...encodeU32(15),
    ...Array.from("radix_sort_pass", (c) => c.charCodeAt(0)),
    0x00, // function export
    ...encodeU32(0), // function index 0
  ]);
  bytes.push(...exportSection);

  // Code section: function body for radix_sort_pass
  // Parameters:
  //   local 0: n (i32)
  //   local 1: byte_pos (i32)
  //   local 2: key_size (i32)
  //   local 3: keys_ptr (i32)
  //   local 4: indices_ptr (i32)
  //   local 5: aux_ptr (i32)
  // Locals:
  //   local 6: counts_ptr (i32) - allocated after aux
  //   local 7: i (loop counter)
  //   local 8: idx (current index value)
  //   local 9: byte_val (current byte)
  //   local 10: total (prefix sum accumulator)
  //   local 11: count_tmp

  // Build the function body as WASM bytecode
  const body: number[] = [];

  // Declare 6 additional locals (all i32)
  body.push(...encodeU32(1)); // 1 local declaration group
  body.push(...encodeU32(6), 0x7f); // 6 locals of type i32

  // counts_ptr = aux_ptr + n * 4
  // local.get 5 (aux_ptr)
  // local.get 0 (n)
  // i32.const 4
  // i32.mul
  // i32.add
  // local.set 6
  body.push(0x20, ...encodeU32(5)); // local.get aux_ptr
  body.push(0x20, ...encodeU32(0)); // local.get n
  body.push(0x41, ...encodeI32(4)); // i32.const 4
  body.push(0x6c); // i32.mul
  body.push(0x6a); // i32.add
  body.push(0x21, ...encodeU32(6)); // local.set counts_ptr

  // Zero counts: memset(counts_ptr, 0, 1024)
  // Use memory.fill if available, otherwise loop
  // For simplicity, use a loop
  // i = 0
  body.push(0x41, ...encodeI32(0)); // i32.const 0
  body.push(0x21, ...encodeU32(7)); // local.set i

  // block + loop for zeroing counts
  body.push(0x02, 0x40); // block void
  body.push(0x03, 0x40); // loop void

  // if i >= 256, break
  body.push(0x20, ...encodeU32(7)); // local.get i
  body.push(0x41, ...encodeI32(256)); // i32.const 256
  body.push(0x4d); // i32.ge_u
  body.push(0x0d, ...encodeU32(1)); // br_if 1 (break outer block)

  // store 0 at counts_ptr + i * 4
  body.push(0x20, ...encodeU32(6)); // local.get counts_ptr
  body.push(0x20, ...encodeU32(7)); // local.get i
  body.push(0x41, ...encodeI32(4)); // i32.const 4
  body.push(0x6c); // i32.mul
  body.push(0x6a); // i32.add
  body.push(0x41, ...encodeI32(0)); // i32.const 0
  body.push(0x36, ...encodeU32(2), ...encodeU32(0)); // i32.store align=4 offset=0

  // i++
  body.push(0x20, ...encodeU32(7)); // local.get i
  body.push(0x41, ...encodeI32(1)); // i32.const 1
  body.push(0x6a); // i32.add
  body.push(0x21, ...encodeU32(7)); // local.set i

  body.push(0x0c, ...encodeU32(0)); // br 0 (continue loop)
  body.push(0x0b); // end loop
  body.push(0x0b); // end block

  // COUNT PHASE: for i = 0..n: counts[keys[indices[i] * key_size + byte_pos]]++
  body.push(0x41, ...encodeI32(0)); // i32.const 0
  body.push(0x21, ...encodeU32(7)); // local.set i

  body.push(0x02, 0x40); // block void
  body.push(0x03, 0x40); // loop void

  body.push(0x20, ...encodeU32(7)); // local.get i
  body.push(0x20, ...encodeU32(0)); // local.get n
  body.push(0x4d); // i32.ge_u
  body.push(0x0d, ...encodeU32(1)); // br_if 1

  // idx = load32(indices_ptr + i * 4)
  body.push(0x20, ...encodeU32(4)); // local.get indices_ptr
  body.push(0x20, ...encodeU32(7)); // local.get i
  body.push(0x41, ...encodeI32(4)); // i32.const 4
  body.push(0x6c); // i32.mul
  body.push(0x6a); // i32.add
  body.push(0x28, ...encodeU32(2), ...encodeU32(0)); // i32.load align=4 offset=0
  body.push(0x21, ...encodeU32(8)); // local.set idx

  // byte_val = load8_u(keys_ptr + idx * key_size + byte_pos)
  body.push(0x20, ...encodeU32(3)); // local.get keys_ptr
  body.push(0x20, ...encodeU32(8)); // local.get idx
  body.push(0x20, ...encodeU32(2)); // local.get key_size
  body.push(0x6c); // i32.mul
  body.push(0x6a); // i32.add
  body.push(0x20, ...encodeU32(1)); // local.get byte_pos
  body.push(0x6a); // i32.add
  body.push(0x2d, ...encodeU32(0), ...encodeU32(0)); // i32.load8_u align=1 offset=0
  body.push(0x21, ...encodeU32(9)); // local.set byte_val

  // counts[byte_val]++ : store32(counts_ptr + byte_val * 4, load32(counts_ptr + byte_val * 4) + 1)
  // addr = counts_ptr + byte_val * 4
  body.push(0x20, ...encodeU32(6)); // local.get counts_ptr
  body.push(0x20, ...encodeU32(9)); // local.get byte_val
  body.push(0x41, ...encodeI32(4)); // i32.const 4
  body.push(0x6c); // i32.mul
  body.push(0x6a); // i32.add
  // duplicate address for store (push addr twice)
  body.push(0x22, ...encodeU32(11)); // local.tee count_tmp (save addr)

  body.push(0x20, ...encodeU32(11)); // local.get count_tmp (addr)
  body.push(0x28, ...encodeU32(2), ...encodeU32(0)); // i32.load
  body.push(0x41, ...encodeI32(1)); // i32.const 1
  body.push(0x6a); // i32.add
  body.push(0x36, ...encodeU32(2), ...encodeU32(0)); // i32.store

  // i++
  body.push(0x20, ...encodeU32(7)); // local.get i
  body.push(0x41, ...encodeI32(1)); // i32.const 1
  body.push(0x6a); // i32.add
  body.push(0x21, ...encodeU32(7)); // local.set i

  body.push(0x0c, ...encodeU32(0)); // br 0
  body.push(0x0b); // end loop
  body.push(0x0b); // end block

  // PREFIX SUM PHASE: running total over counts[0..255]
  body.push(0x41, ...encodeI32(0)); // i32.const 0
  body.push(0x21, ...encodeU32(10)); // local.set total = 0
  body.push(0x41, ...encodeI32(0)); // i32.const 0
  body.push(0x21, ...encodeU32(7)); // local.set i = 0

  body.push(0x02, 0x40); // block
  body.push(0x03, 0x40); // loop

  body.push(0x20, ...encodeU32(7)); // local.get i
  body.push(0x41, ...encodeI32(256)); // i32.const 256
  body.push(0x4d); // i32.ge_u
  body.push(0x0d, ...encodeU32(1)); // br_if 1

  // addr = counts_ptr + i * 4
  body.push(0x20, ...encodeU32(6)); // local.get counts_ptr
  body.push(0x20, ...encodeU32(7)); // local.get i
  body.push(0x41, ...encodeI32(4)); // i32.const 4
  body.push(0x6c); // i32.mul
  body.push(0x6a); // i32.add
  body.push(0x22, ...encodeU32(11)); // local.tee count_tmp (addr)

  // count_val = load32(addr)
  body.push(0x20, ...encodeU32(11)); // local.get addr
  body.push(0x28, ...encodeU32(2), ...encodeU32(0)); // i32.load
  body.push(0x21, ...encodeU32(8)); // local.set idx (reuse as count_val)

  // store32(addr, total)
  body.push(0x20, ...encodeU32(11)); // local.get addr
  body.push(0x20, ...encodeU32(10)); // local.get total
  body.push(0x36, ...encodeU32(2), ...encodeU32(0)); // i32.store

  // total += count_val
  body.push(0x20, ...encodeU32(10)); // local.get total
  body.push(0x20, ...encodeU32(8)); // local.get count_val (idx)
  body.push(0x6a); // i32.add
  body.push(0x21, ...encodeU32(10)); // local.set total

  // i++
  body.push(0x20, ...encodeU32(7)); // local.get i
  body.push(0x41, ...encodeI32(1)); // i32.const 1
  body.push(0x6a); // i32.add
  body.push(0x21, ...encodeU32(7)); // local.set i

  body.push(0x0c, ...encodeU32(0)); // br 0
  body.push(0x0b); // end loop
  body.push(0x0b); // end block

  // SCATTER PHASE: for i = 0..n: aux[counts[byte]++] = indices[i]
  body.push(0x41, ...encodeI32(0)); // i32.const 0
  body.push(0x21, ...encodeU32(7)); // local.set i = 0

  body.push(0x02, 0x40); // block
  body.push(0x03, 0x40); // loop

  body.push(0x20, ...encodeU32(7)); // local.get i
  body.push(0x20, ...encodeU32(0)); // local.get n
  body.push(0x4d); // i32.ge_u
  body.push(0x0d, ...encodeU32(1)); // br_if 1

  // idx = load32(indices_ptr + i * 4)
  body.push(0x20, ...encodeU32(4)); // local.get indices_ptr
  body.push(0x20, ...encodeU32(7)); // local.get i
  body.push(0x41, ...encodeI32(4)); // i32.const 4
  body.push(0x6c); // i32.mul
  body.push(0x6a); // i32.add
  body.push(0x28, ...encodeU32(2), ...encodeU32(0)); // i32.load
  body.push(0x21, ...encodeU32(8)); // local.set idx

  // byte_val = load8_u(keys_ptr + idx * key_size + byte_pos)
  body.push(0x20, ...encodeU32(3)); // local.get keys_ptr
  body.push(0x20, ...encodeU32(8)); // local.get idx
  body.push(0x20, ...encodeU32(2)); // local.get key_size
  body.push(0x6c); // i32.mul
  body.push(0x6a); // i32.add
  body.push(0x20, ...encodeU32(1)); // local.get byte_pos
  body.push(0x6a); // i32.add
  body.push(0x2d, ...encodeU32(0), ...encodeU32(0)); // i32.load8_u
  body.push(0x21, ...encodeU32(9)); // local.set byte_val

  // dest = load32(counts_ptr + byte_val * 4)
  body.push(0x20, ...encodeU32(6)); // local.get counts_ptr
  body.push(0x20, ...encodeU32(9)); // local.get byte_val
  body.push(0x41, ...encodeI32(4)); // i32.const 4
  body.push(0x6c); // i32.mul
  body.push(0x6a); // i32.add
  body.push(0x22, ...encodeU32(11)); // local.tee count_tmp (counts addr)

  body.push(0x20, ...encodeU32(11)); // load addr for reading dest
  body.push(0x28, ...encodeU32(2), ...encodeU32(0)); // i32.load -> dest
  body.push(0x21, ...encodeU32(10)); // local.set total (reuse as dest)

  // store32(aux_ptr + dest * 4, idx)
  body.push(0x20, ...encodeU32(5)); // local.get aux_ptr
  body.push(0x20, ...encodeU32(10)); // local.get dest
  body.push(0x41, ...encodeI32(4)); // i32.const 4
  body.push(0x6c); // i32.mul
  body.push(0x6a); // i32.add
  body.push(0x20, ...encodeU32(8)); // local.get idx
  body.push(0x36, ...encodeU32(2), ...encodeU32(0)); // i32.store

  // counts[byte_val]++ = dest + 1
  body.push(0x20, ...encodeU32(11)); // local.get counts addr
  body.push(0x20, ...encodeU32(10)); // local.get dest
  body.push(0x41, ...encodeI32(1)); // i32.const 1
  body.push(0x6a); // i32.add
  body.push(0x36, ...encodeU32(2), ...encodeU32(0)); // i32.store

  // i++
  body.push(0x20, ...encodeU32(7)); // local.get i
  body.push(0x41, ...encodeI32(1)); // i32.const 1
  body.push(0x6a); // i32.add
  body.push(0x21, ...encodeU32(7)); // local.set i

  body.push(0x0c, ...encodeU32(0)); // br 0
  body.push(0x0b); // end loop
  body.push(0x0b); // end block

  // COPY BACK: memcpy(indices_ptr, aux_ptr, n * 4)
  body.push(0x41, ...encodeI32(0)); // i32.const 0
  body.push(0x21, ...encodeU32(7)); // local.set i = 0

  body.push(0x02, 0x40); // block
  body.push(0x03, 0x40); // loop

  body.push(0x20, ...encodeU32(7)); // local.get i
  body.push(0x20, ...encodeU32(0)); // local.get n
  body.push(0x4d); // i32.ge_u
  body.push(0x0d, ...encodeU32(1)); // br_if 1

  // store32(indices_ptr + i * 4, load32(aux_ptr + i * 4))
  body.push(0x20, ...encodeU32(4)); // local.get indices_ptr
  body.push(0x20, ...encodeU32(7)); // local.get i
  body.push(0x41, ...encodeI32(4)); // i32.const 4
  body.push(0x6c); // i32.mul
  body.push(0x6a); // i32.add

  body.push(0x20, ...encodeU32(5)); // local.get aux_ptr
  body.push(0x20, ...encodeU32(7)); // local.get i
  body.push(0x41, ...encodeI32(4)); // i32.const 4
  body.push(0x6c); // i32.mul
  body.push(0x6a); // i32.add
  body.push(0x28, ...encodeU32(2), ...encodeU32(0)); // i32.load

  body.push(0x36, ...encodeU32(2), ...encodeU32(0)); // i32.store

  // i++
  body.push(0x20, ...encodeU32(7)); // local.get i
  body.push(0x41, ...encodeI32(1)); // i32.const 1
  body.push(0x6a); // i32.add
  body.push(0x21, ...encodeU32(7)); // local.set i

  body.push(0x0c, ...encodeU32(0)); // br 0
  body.push(0x0b); // end loop
  body.push(0x0b); // end block

  body.push(0x0b); // end function

  // Code section
  const codeSection = section(10, [
    ...encodeU32(1), // 1 function body
    ...encodeU32(body.length),
    ...body,
  ]);
  bytes.push(...codeSection);

  return new Uint8Array(bytes);
}

// Build and write if run directly
if (import.meta.main) {
  const wasm = buildRadixSortWasm();
  await Bun.write("experiments/wasm-radix-sort/radix-sort.wasm", wasm);
  console.log(`Built radix-sort.wasm: ${wasm.length} bytes`);

  // Validate it compiles
  try {
    const module = await WebAssembly.compile(wasm);
    console.log("WASM module compiled successfully");
    const instance = await WebAssembly.instantiate(module);
    console.log("WASM module instantiated successfully");
    console.log("Exports:", Object.keys(instance.exports));
  } catch (e) {
    console.error("WASM compilation failed:", e);
  }
}
