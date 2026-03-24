# Benchmark Results - 2026-03-24

Platform: linux arm64
Runtime: node 22.22.1
CPU: ~3.74 GHz

## Critical Performance Issues Found

### TextBuffer Operations Are O(n) Instead of O(log n)

| Operation | Actual | Target | Slowdown |
|-----------|--------|--------|----------|
| Insert at start | 660µs | <100µs | **6.6x** |
| Insert at middle | 2.2ms | <100µs | **22x** |
| Delete char | 4.8ms | <100µs | **48x** |
| Snapshot | 162µs | <1µs | **162x** |

### Root Cause

Both `insertInternal()` and `deleteInternal()` bypass the SumTree's efficient O(log n) operations:

```typescript
// Current implementation - O(n) per operation
private deleteInternal(start: number, end: number): DeleteOperation {
  const frags = this.fragmentsArray();  // O(n) - materializes ALL fragments
  const newFrags: Fragment[] = [];
  // ... linear scan O(n) ...
  sortFragments(newFrags);              // O(n log n) sort
  this.fragments = SumTree.fromItems(newFrags, fragmentSummaryOps);  // O(n) rebuild
}
```

The SumTree already provides:
- `cursor()` with `visibleLenDimension` for O(log n) seeking
- `insertAt()` with path copying for O(log n) insertion
- `removeAt()` with path copying for O(log n) deletion

But TextBuffer ignores them entirely!

### Impact

For a document with 100K fragments:
- **Current**: Each char delete = 3 full passes = ~300K operations
- **Optimal**: Each char delete = O(log 100K) = ~17 operations

This is **17,600x slower** than it should be.

## Raw Benchmark Data

### text-insert-char
- insert char at start (tiny): 660.20 µs/iter
- insert char at middle (tiny): 1.84 ms/iter
- insert char at end (tiny): 1.98 ms/iter
- insert char at start (small): 687.59 µs/iter
- insert char at middle (small): 2.19 ms/iter
- insert char at end (small): 1.98 ms/iter
- insert char at start (medium): 701.31 µs/iter
- insert char at middle (medium): 2.40 ms/iter
- insert char at end (medium): 2.46 ms/iter

### text-delete-char
- delete char at start (tiny): 4.95 ms/iter
- delete char at middle (tiny): 4.65 ms/iter
- delete char at end (tiny): 4.59 ms/iter
- delete char at start (small): 4.45 ms/iter
- delete char at middle (small): 4.61 ms/iter
- delete char at end (small): 4.84 ms/iter
- delete char at start (medium): 4.61 ms/iter
- delete char at middle (medium): 4.85 ms/iter
- delete char at end (medium): 4.69 ms/iter

### text-snapshot
- snapshot (tiny): 162.25 µs/iter
- snapshot (small): 197.30 µs/iter
- snapshot (medium): 229.03 µs/iter
- snapshot (large): 33.78 µs/iter (O(1) achieved here!)
- snapshot (huge): 34.48 µs/iter

### text-getText
- getText (tiny): 1.19 ms/iter
- getText (small): 1.24 ms/iter
- getText (medium): 1.59 ms/iter
- getText (large): 78.99 ns/iter (cached)
- getText (huge): 65.15 ns/iter (cached)

### text-undo-redo
- undo (100 transactions): 3.71 ns/iter
- redo (100 transactions): 3.60 ns/iter

### sum-tree-seek (baseline - these ARE O(log n))
- seek in 10K tree: target <50µs
- seek in 100K tree: target <50µs

### sum-tree-insert (baseline - these ARE O(log n))
- insert at middle (10K tree): target <100µs
- insert at middle (100K tree): target <100µs

## Recommendation

Refactor TextBuffer to use SumTree's O(log n) cursor-based operations instead of materializing arrays. The infrastructure for efficient operations already exists in the codebase.
