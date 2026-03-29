# WASM SIMD Radix Sort Spike — Analysis

## Summary

**Verdict: NO-GO for full-width WASM radix sort. CONDITIONAL GO for compact-key radix sort (pure TS).**

Radix sort with 125-byte keys (full Locator encoding) is 2× slower than JS `Array.sort()` at all tested sizes, whether in TypeScript or WASM. However, a compact encoding (34-byte keys, 3-level depth) beats JS sort at ≥10K fragments and is 2× faster at 50K.

The WASM boundary overhead makes WASM radix sort slower than its TypeScript equivalent — the bottleneck is memory bandwidth (many passes over data), not compute. SIMD would help the histogram phase but cannot overcome the fundamental O(n × k) cost where k = key width in bytes.

## Results

| N | JS sort | Compact radix | Full radix (TS) | WASM radix | Compact speedup |
|---|---------|---------------|-----------------|------------|-----------------|
| 1K | 0.14ms | 0.16ms | 0.65ms | 0.47ms | 0.9× |
| 5K | 0.69ms | 0.60ms | 2.05ms | 2.18ms | 1.1× |
| 10K | 1.65ms | 1.11ms | 3.95ms | 4.31ms | 1.5× |
| 50K | 10.98ms | 5.70ms | 19.98ms | 21.71ms | 1.9× |

## Key Findings

### 1. Breakeven Point

- **Full-width radix sort (125-byte keys):** No breakeven. JS `Array.sort()` wins at all sizes tested (1K–50K). The 125 byte passes per element create too much overhead vs. comparison-based O(n log n) with efficient cache-friendly TimSort.

- **Compact radix sort (34-byte keys):** Breakeven at ~5K fragments. At 10K it's 1.5× faster, at 50K it's 1.9× faster. The reduced key width (34 vs 125 passes) makes radix sort competitive.

### 2. Key Encoding Overhead

| N | Encode time | Sort-only time | Encode % of total |
|---|-------------|----------------|-------------------|
| 1K | 0.11ms | — | 17% |
| 5K | 0.18ms | — | 30% |
| 10K | 0.34ms | — | 31% |
| 50K | 1.53ms | — | 27% |

Key encoding is ~25-30% of the total radix sort time. Not the dominant cost, but not negligible.

### 3. WASM Binary Size

**403 bytes** — well under the 10KB target. A full radix sort with SIMD extensions would likely remain under 2KB.

### 4. WASM vs TypeScript Performance

Counterintuitively, WASM is slightly *slower* than TypeScript for this workload:

| N | TS radix (sort only) | WASM radix (sort only) |
|---|---------------------|----------------------|
| 1K | 0.48ms | 0.42ms |
| 5K | 1.88ms | 2.03ms |
| 10K | 3.66ms | 4.04ms |
| 50K | 18.46ms | 20.20ms |

At small N, WASM has a slight edge from avoiding JS overhead. At large N, the JS↔WASM memory copy dominates: copying n×125 bytes in + n×4 bytes out per sort call. The sort itself runs at similar speed since both compile to similar machine code.

### 5. SIMD Opportunity Assessment

WASM SIMD (`i64x2`, `v128`) could accelerate the histogram/counting phase by processing 16 bytes simultaneously. However:
- The histogram phase is ~20% of each pass
- Each pass also includes prefix-sum (sequential, not SIMD-friendly) and scatter (random-access, not SIMD-friendly)
- Net SIMD benefit estimate: 5-10% improvement per pass
- This would not change the overall verdict for full-width keys

## Recommendations

### Short Term
1. **Don't pursue WASM radix sort.** The JS↔WASM boundary cost and memory copies negate any advantage.
2. **Consider compact-key TS radix sort** for bulk operations that sort >5K fragments (e.g., initial document load, large merges). The 34-byte compact encoding with depth-3 coverage handles the vast majority of fragments correctly.

### Medium Term
3. **Integer-encoded Locators (#118)** would dramatically improve sorting: if Locators are stored as `BigUint64Array`, key encoding becomes a zero-copy view, eliminating the 25-30% encoding overhead.
4. **Hybrid sort**: use radix sort for the primary key (locator), then comparison sort for tiebreakers within equal-locator groups. This would reduce key width to just the locator bytes.

### Long Term
5. **Avoid bulk sorting entirely**: the O(log n) fragment insertion via SumTree seeking (planned in docs/plans/) eliminates the need for sorting entirely. Each fragment is inserted at the correct position via tree traversal, making the sort optimization moot.

## Files

| File | Purpose |
|------|---------|
| `key-encoding.ts` | Full 125-byte key encoding (Locator + tiebreakers) |
| `key-encoding-compact.ts` | Compact 34-byte key encoding (3-level depth) |
| `radix-sort-ts.ts` | TypeScript LSD radix sort (full + optimized variants) |
| `radix-sort.wat` | Hand-written WASM Text Format for radix sort pass |
| `radix-sort.wasm` | Compiled WASM binary (403 bytes) |
| `radix-sort-wasm.ts` | WASM loader and TypeScript wrapper |
| `compile-wat.ts` | WAT → WASM compiler script (uses wabt) |
| `build-wasm.ts` | Programmatic WASM binary builder (alternative to wabt) |
| `benchmark.ts` | Full benchmark suite |
