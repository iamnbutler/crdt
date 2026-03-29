(module
  ;; Hand-written WAT for batched locator operations.
  ;;
  ;; Memory layout (2MB = 32 pages):
  ;;   0x00000 - 0x7FFFF : Locator store (sorted array for binary search, 512KB)
  ;;   0x80000 - 0xBFFFF : Search keys / input buffer (256KB)
  ;;   0xC0000 - 0xDFFFF : Output buffer (i32 results, 128KB)
  ;;   0xE0000 - 0xFFFFF : Offset table / scratch (128KB)
  ;;
  ;; Locator encoding (in linear memory):
  ;;   Each locator is encoded as:
  ;;     [i32 length] [f64 level_0] [f64 level_1] ... [f64 level_{n-1}]
  ;;   Total bytes per locator: 4 + 8 * length
  ;;   Max locator size: 4 + 8 * 16 = 132 bytes
  ;;
  ;; We use f64 for levels because JS Locator levels are 53-bit integers
  ;; stored as JS numbers (f64). Using f64 avoids precision loss.

  (memory (export "memory") 32)  ;; 32 pages = 2MB

  ;; =========================================================================
  ;; compare_locators: Compare two locators at given byte offsets.
  ;; Returns: -1 if a < b, 0 if a == b, 1 if a > b
  ;; =========================================================================
  (func $compare_locators (param $a_ptr i32) (param $b_ptr i32) (result i32)
    (local $a_len i32)
    (local $b_len i32)
    (local $min_len i32)
    (local $i i32)
    (local $a_val f64)
    (local $b_val f64)

    ;; Load lengths
    (local.set $a_len (i32.load (local.get $a_ptr)))
    (local.set $b_len (i32.load (local.get $b_ptr)))

    ;; min_len = min(a_len, b_len)
    (local.set $min_len (local.get $a_len))
    (if (i32.lt_s (local.get $b_len) (local.get $a_len))
      (then (local.set $min_len (local.get $b_len)))
    )

    ;; Compare level by level
    (local.set $i (i32.const 0))
    (block $break
      (loop $loop
        (br_if $break (i32.ge_s (local.get $i) (local.get $min_len)))

        ;; a_val = f64.load(a_ptr + 4 + i * 8)
        (local.set $a_val
          (f64.load (i32.add
            (local.get $a_ptr)
            (i32.add (i32.const 4) (i32.mul (local.get $i) (i32.const 8)))
          ))
        )
        ;; b_val = f64.load(b_ptr + 4 + i * 8)
        (local.set $b_val
          (f64.load (i32.add
            (local.get $b_ptr)
            (i32.add (i32.const 4) (i32.mul (local.get $i) (i32.const 8)))
          ))
        )

        ;; if a_val < b_val return -1
        (if (f64.lt (local.get $a_val) (local.get $b_val))
          (then (return (i32.const -1)))
        )
        ;; if a_val > b_val return 1
        (if (f64.gt (local.get $a_val) (local.get $b_val))
          (then (return (i32.const 1)))
        )

        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $loop)
      )
    )

    ;; All compared levels equal; compare lengths
    (if (i32.lt_s (local.get $a_len) (local.get $b_len))
      (then (return (i32.const -1)))
    )
    (if (i32.gt_s (local.get $a_len) (local.get $b_len))
      (then (return (i32.const 1)))
    )
    (i32.const 0)
  )

  ;; =========================================================================
  ;; batch_compare: Compare N pairs of locators.
  ;; Pairs are laid out sequentially at pairs_ptr: [locA_0, locB_0, locA_1, ...]
  ;; Each locator is length-prefixed as described above.
  ;; Results written to out_ptr as N i32 values (-1, 0, or 1).
  ;; =========================================================================
  (func (export "batch_compare")
    (param $pairs_ptr i32)  ;; start of pair data
    (param $count i32)      ;; number of pairs
    (param $out_ptr i32)    ;; output buffer for results
    (local $i i32)
    (local $ptr i32)
    (local $a_ptr i32)
    (local $b_ptr i32)
    (local $a_size i32)
    (local $b_size i32)
    (local $result i32)

    (local.set $ptr (local.get $pairs_ptr))
    (local.set $i (i32.const 0))

    (block $break
      (loop $loop
        (br_if $break (i32.ge_s (local.get $i) (local.get $count)))

        ;; a_ptr = current ptr
        (local.set $a_ptr (local.get $ptr))
        ;; a_size = 4 + 8 * a_len
        (local.set $a_size
          (i32.add (i32.const 4)
            (i32.mul (i32.const 8) (i32.load (local.get $a_ptr)))
          )
        )

        ;; b_ptr = a_ptr + a_size
        (local.set $b_ptr (i32.add (local.get $a_ptr) (local.get $a_size)))
        ;; b_size = 4 + 8 * b_len
        (local.set $b_size
          (i32.add (i32.const 4)
            (i32.mul (i32.const 8) (i32.load (local.get $b_ptr)))
          )
        )

        ;; Compare and store result
        (local.set $result (call $compare_locators (local.get $a_ptr) (local.get $b_ptr)))
        (i32.store
          (i32.add (local.get $out_ptr) (i32.mul (local.get $i) (i32.const 4)))
          (local.get $result)
        )

        ;; Advance ptr past both locators
        (local.set $ptr (i32.add (local.get $b_ptr) (local.get $b_size)))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $loop)
      )
    )
  )

  ;; =========================================================================
  ;; get_locator_at_index: Get byte offset of the i-th locator in a packed
  ;; array starting at base_ptr.
  ;; =========================================================================
  (func $get_locator_at_index (param $base_ptr i32) (param $index i32) (result i32)
    (local $ptr i32)
    (local $j i32)

    (local.set $ptr (local.get $base_ptr))
    (local.set $j (i32.const 0))
    (block $break
      (loop $loop
        (br_if $break (i32.ge_s (local.get $j) (local.get $index)))
        ;; Advance ptr by locator size: 4 + 8 * len
        (local.set $ptr
          (i32.add (local.get $ptr)
            (i32.add (i32.const 4)
              (i32.mul (i32.const 8) (i32.load (local.get $ptr)))
            )
          )
        )
        (local.set $j (i32.add (local.get $j) (i32.const 1)))
        (br $loop)
      )
    )
    (local.get $ptr)
  )

  ;; =========================================================================
  ;; batch_binary_search: Find insertion points for M keys in a sorted array
  ;; of N locators. The entire search runs in WASM — no JS boundary crossing.
  ;;
  ;; haystack_ptr: packed sorted locators (N items)
  ;; haystack_len: N
  ;; keys_ptr: packed search keys (M items)
  ;; keys_len: M
  ;; out_ptr: M i32 results (insertion indices)
  ;;
  ;; For the hot-path case, we also support an offset table to avoid O(n)
  ;; scanning to find the i-th locator. If offset_table_ptr is non-zero,
  ;; it points to N i32 byte offsets for haystack items.
  ;; =========================================================================
  (func (export "batch_binary_search")
    (param $haystack_ptr i32)
    (param $haystack_len i32)
    (param $keys_ptr i32)
    (param $keys_len i32)
    (param $out_ptr i32)
    (param $offset_table_ptr i32)  ;; 0 = no offset table
    (local $k i32)
    (local $key_ptr i32)
    (local $key_size i32)
    (local $lo i32)
    (local $hi i32)
    (local $mid i32)
    (local $mid_ptr i32)
    (local $cmp i32)

    (local.set $key_ptr (local.get $keys_ptr))
    (local.set $k (i32.const 0))

    (block $outer_break
      (loop $outer_loop
        (br_if $outer_break (i32.ge_s (local.get $k) (local.get $keys_len)))

        ;; Binary search for this key
        (local.set $lo (i32.const 0))
        (local.set $hi (local.get $haystack_len))

        (block $search_done
          (loop $search_loop
            (br_if $search_done (i32.ge_s (local.get $lo) (local.get $hi)))

            ;; mid = (lo + hi) >>> 1
            (local.set $mid
              (i32.shr_u (i32.add (local.get $lo) (local.get $hi)) (i32.const 1))
            )

            ;; Get pointer to haystack[mid]
            (if (i32.ne (local.get $offset_table_ptr) (i32.const 0))
              (then
                ;; Use offset table: haystack_ptr + offsets[mid]
                (local.set $mid_ptr
                  (i32.add (local.get $haystack_ptr)
                    (i32.load (i32.add
                      (local.get $offset_table_ptr)
                      (i32.mul (local.get $mid) (i32.const 4))
                    ))
                  )
                )
              )
              (else
                ;; Linear scan to find mid-th locator
                (local.set $mid_ptr
                  (call $get_locator_at_index (local.get $haystack_ptr) (local.get $mid))
                )
              )
            )

            ;; Compare key vs haystack[mid]
            (local.set $cmp
              (call $compare_locators (local.get $key_ptr) (local.get $mid_ptr))
            )

            (if (i32.le_s (local.get $cmp) (i32.const 0))
              (then (local.set $hi (local.get $mid)))
              (else (local.set $lo (i32.add (local.get $mid) (i32.const 1))))
            )

            (br $search_loop)
          )
        )

        ;; Store result: insertion point = lo
        (i32.store
          (i32.add (local.get $out_ptr) (i32.mul (local.get $k) (i32.const 4)))
          (local.get $lo)
        )

        ;; Advance key_ptr to next key
        (local.set $key_size
          (i32.add (i32.const 4)
            (i32.mul (i32.const 8) (i32.load (local.get $key_ptr)))
          )
        )
        (local.set $key_ptr (i32.add (local.get $key_ptr) (local.get $key_size)))
        (local.set $k (i32.add (local.get $k) (i32.const 1)))
        (br $outer_loop)
      )
    )
  )

  ;; =========================================================================
  ;; single_binary_search: Find insertion point for one key.
  ;; Simpler API for testing & single-op use.
  ;; =========================================================================
  (func (export "single_binary_search")
    (param $haystack_ptr i32)
    (param $haystack_len i32)
    (param $key_ptr i32)
    (param $offset_table_ptr i32)
    (result i32)
    (local $lo i32)
    (local $hi i32)
    (local $mid i32)
    (local $mid_ptr i32)
    (local $cmp i32)

    (local.set $lo (i32.const 0))
    (local.set $hi (local.get $haystack_len))

    (block $done
      (loop $loop
        (br_if $done (i32.ge_s (local.get $lo) (local.get $hi)))

        (local.set $mid
          (i32.shr_u (i32.add (local.get $lo) (local.get $hi)) (i32.const 1))
        )

        (if (i32.ne (local.get $offset_table_ptr) (i32.const 0))
          (then
            (local.set $mid_ptr
              (i32.add (local.get $haystack_ptr)
                (i32.load (i32.add
                  (local.get $offset_table_ptr)
                  (i32.mul (local.get $mid) (i32.const 4))
                ))
              )
            )
          )
          (else
            (local.set $mid_ptr
              (call $get_locator_at_index (local.get $haystack_ptr) (local.get $mid))
            )
          )
        )

        (local.set $cmp
          (call $compare_locators (local.get $key_ptr) (local.get $mid_ptr))
        )

        (if (i32.le_s (local.get $cmp) (i32.const 0))
          (then (local.set $hi (local.get $mid)))
          (else (local.set $lo (i32.add (local.get $mid) (i32.const 1))))
        )

        (br $loop)
      )
    )

    (local.get $lo)
  )

  ;; =========================================================================
  ;; compare_locators_at: Compare two locators by direct pointers (exported).
  ;; Useful for testing individual comparisons.
  ;; =========================================================================
  (func (export "compare_locators_at") (param $a_ptr i32) (param $b_ptr i32) (result i32)
    (call $compare_locators (local.get $a_ptr) (local.get $b_ptr))
  )
)
