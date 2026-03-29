(module
  ;; Memory: 256 pages (16MB) - enough for ~100K fragments with 125-byte keys
  (memory (export "memory") 256)

  ;; radix_sort_pass: one pass of LSD radix sort for a given byte position.
  ;; Reads indices, sorts by one byte of the key, writes result back to indices.
  ;;
  ;; Params:
  ;;   n         - number of elements
  ;;   byte_pos  - which byte of the key to sort on
  ;;   key_size  - size of each key in bytes
  ;;   keys_ptr  - pointer to keys buffer (n × key_size bytes)
  ;;   indices_ptr - pointer to indices (n × 4 bytes, uint32)
  ;;   aux_ptr   - pointer to auxiliary buffer (n × 4 bytes, uint32)
  ;;
  ;; Layout: counts buffer is at aux_ptr + n*4 (256 × 4 = 1024 bytes)
  (func (export "radix_sort_pass")
    (param $n i32) (param $byte_pos i32) (param $key_size i32)
    (param $keys_ptr i32) (param $indices_ptr i32) (param $aux_ptr i32)

    (local $counts_ptr i32)
    (local $i i32)
    (local $idx i32)
    (local $byte_val i32)
    (local $total i32)
    (local $count_val i32)
    (local $addr i32)
    (local $dest i32)

    ;; counts_ptr = aux_ptr + n * 4
    (local.set $counts_ptr
      (i32.add (local.get $aux_ptr)
               (i32.mul (local.get $n) (i32.const 4))))

    ;; === ZERO COUNTS ===
    (local.set $i (i32.const 0))
    (block $break_zero
      (loop $loop_zero
        (br_if $break_zero (i32.ge_u (local.get $i) (i32.const 256)))
        (i32.store
          (i32.add (local.get $counts_ptr) (i32.mul (local.get $i) (i32.const 4)))
          (i32.const 0))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $loop_zero)
      )
    )

    ;; === COUNT PHASE ===
    ;; for i = 0..n: counts[keys[indices[i] * key_size + byte_pos]]++
    (local.set $i (i32.const 0))
    (block $break_count
      (loop $loop_count
        (br_if $break_count (i32.ge_u (local.get $i) (local.get $n)))

        ;; idx = indices[i]
        (local.set $idx
          (i32.load
            (i32.add (local.get $indices_ptr)
                     (i32.mul (local.get $i) (i32.const 4)))))

        ;; byte_val = keys[idx * key_size + byte_pos]
        (local.set $byte_val
          (i32.load8_u
            (i32.add
              (i32.add (local.get $keys_ptr)
                       (i32.mul (local.get $idx) (local.get $key_size)))
              (local.get $byte_pos))))

        ;; counts[byte_val]++
        (local.set $addr
          (i32.add (local.get $counts_ptr)
                   (i32.mul (local.get $byte_val) (i32.const 4))))
        (i32.store (local.get $addr)
          (i32.add (i32.load (local.get $addr)) (i32.const 1)))

        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $loop_count)
      )
    )

    ;; === PREFIX SUM PHASE ===
    ;; Convert counts to cumulative offsets
    (local.set $total (i32.const 0))
    (local.set $i (i32.const 0))
    (block $break_prefix
      (loop $loop_prefix
        (br_if $break_prefix (i32.ge_u (local.get $i) (i32.const 256)))

        (local.set $addr
          (i32.add (local.get $counts_ptr)
                   (i32.mul (local.get $i) (i32.const 4))))

        ;; count_val = counts[i]
        (local.set $count_val (i32.load (local.get $addr)))

        ;; counts[i] = total
        (i32.store (local.get $addr) (local.get $total))

        ;; total += count_val
        (local.set $total
          (i32.add (local.get $total) (local.get $count_val)))

        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $loop_prefix)
      )
    )

    ;; === SCATTER PHASE ===
    ;; for i = 0..n: aux[counts[byte]++] = indices[i]
    (local.set $i (i32.const 0))
    (block $break_scatter
      (loop $loop_scatter
        (br_if $break_scatter (i32.ge_u (local.get $i) (local.get $n)))

        ;; idx = indices[i]
        (local.set $idx
          (i32.load
            (i32.add (local.get $indices_ptr)
                     (i32.mul (local.get $i) (i32.const 4)))))

        ;; byte_val = keys[idx * key_size + byte_pos]
        (local.set $byte_val
          (i32.load8_u
            (i32.add
              (i32.add (local.get $keys_ptr)
                       (i32.mul (local.get $idx) (local.get $key_size)))
              (local.get $byte_pos))))

        ;; addr = &counts[byte_val]
        (local.set $addr
          (i32.add (local.get $counts_ptr)
                   (i32.mul (local.get $byte_val) (i32.const 4))))

        ;; dest = counts[byte_val]
        (local.set $dest (i32.load (local.get $addr)))

        ;; aux[dest] = idx
        (i32.store
          (i32.add (local.get $aux_ptr)
                   (i32.mul (local.get $dest) (i32.const 4)))
          (local.get $idx))

        ;; counts[byte_val]++
        (i32.store (local.get $addr)
          (i32.add (local.get $dest) (i32.const 1)))

        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $loop_scatter)
      )
    )

    ;; === COPY BACK ===
    ;; memcpy(indices, aux, n * 4)
    (local.set $i (i32.const 0))
    (block $break_copy
      (loop $loop_copy
        (br_if $break_copy (i32.ge_u (local.get $i) (local.get $n)))

        (i32.store
          (i32.add (local.get $indices_ptr)
                   (i32.mul (local.get $i) (i32.const 4)))
          (i32.load
            (i32.add (local.get $aux_ptr)
                     (i32.mul (local.get $i) (i32.const 4)))))

        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $loop_copy)
      )
    )
  )
)
