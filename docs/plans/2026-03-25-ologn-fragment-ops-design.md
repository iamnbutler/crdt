# O(log n) Fragment Operations

**Issue:** #33 (arch: O(n) SumTree rebuild on every operation)
**Related:** #32, #60
**Date:** 2026-03-25

## Goal

Eliminate the O(n) `fragmentsArray()` → `sortFragments()` → `setFragments()` cycle. Every insert and delete should be O(log n) regardless of whether splits occur.

**Target:** Editing trace (10K ops) from 2.87s → <100ms

**Competitive context:**
| Implementation | Current | Target |
|----------------|---------|--------|
| Loro | 20ms | — |
| Yjs | 17ms | — |
| @iamnbutler/crdt | 2.87s | <100ms |

## Current Architecture (The Problem)

Every insert with a split does:

```
insert(offset, text)
  → fragmentsArray()           // O(n) - copy all fragments to array
  → findInsertPosition()       // O(n) - linear scan
  → splitFragment()            // create left/right parts
  → sortFragments()            // O(n log n) - full sort
  → setFragments()             // O(n) - rebuild tree from array
```

For n sequential inserts, this gives **O(n²) total time**.

## New Architecture

### Core Insight

The SumTree already supports O(log n) operations:
- `insertAt(index, item)` / `insertAtMut(index, item)`
- `removeAt(index)`
- `cursor.seekTo(target, dimension)`
- `cursor.itemIndex()`

We're not using them. Instead, we extract to arrays and rebuild.

### New Primitive: `replaceAt`

For splits, we need to replace one fragment with 2-3 fragments atomically.

```typescript
// Immutable - returns new tree
replaceAt(index: number, items: T[]): SumTree<T, S>

// Mutable - modifies in place
replaceAtMut(index: number, items: T[]): void
```

**Semantics:**
- Remove item at `index`
- Insert `items` at that position (in order)
- Single traversal down, single rebalance up

**Why not 3 separate operations?**

`removeAt` + `insertAt` + `insertAt` + `insertAt` = 4 traversals, 4 rebalances. When you're doing 260K operations, that 4x constant factor costs seconds.

**Edge cases:**
- `items.length === 0`: equivalent to `removeAt(index)`
- `items.length === 1`: equivalent to `editAtIndex(index, () => items[0])`

### Local Insert Flow

**New flow (O(log n)):**

```typescript
insert(offset: number, text: string): InsertOperation {
  const cursor = this.fragments.cursor(visibleLenDimension);
  cursor.seekTo(offset);

  const frag = cursor.item();
  const index = cursor.itemIndex();
  const fragStart = cursor.startPosition();
  const localOffset = offset - fragStart;

  // Compute locator for new fragment
  const locator = this.computeLocator(cursor, localOffset);
  const newFrag = createFragment(opId, 0, locator, text, true);

  if (localOffset === 0) {
    // Insert before this fragment
    this.fragments.insertAtMut(index, newFrag);
  } else if (localOffset === frag.length) {
    // Insert after this fragment
    this.fragments.insertAtMut(index + 1, newFrag);
  } else {
    // Split required
    const [left, right] = splitFragment(frag, localOffset);
    this.fragments.replaceAtMut(index, [left, newFrag, right]);
  }

  return operation;
}
```

### Delete Flow

**New flow (O(k log n) where k = fragments touched):**

Walk backwards from end to start to avoid index tracking:

```typescript
delete(start: number, end: number): DeleteOperation {
  const cursor = this.fragments.cursor(visibleLenDimension);

  // Find all affected fragments
  cursor.seekTo(start);
  const startIndex = cursor.itemIndex();

  cursor.seekTo(end);
  const endIndex = cursor.itemIndex();

  // Walk backwards to avoid index shifting issues
  for (let i = endIndex; i >= startIndex; i--) {
    const frag = this.fragments.itemAt(i);
    // ... determine case and apply editAtIndex or replaceAtMut
  }

  return operation;
}
```

**Cases per fragment:**

| Case | Condition | Action |
|------|-----------|--------|
| Fully deleted | fragment entirely within range | `editAtIndex(i, markDeleted)` |
| Delete from start | keep end portion | `replaceAtMut(i, [deleted, keep])` |
| Delete from end | keep start portion | `replaceAtMut(i, [keep, deleted])` |
| Delete middle | keep both ends | `replaceAtMut(i, [keep, deleted, keep])` |

### Remote Insert Flow

Remote inserts arrive with a `Locator`. Insert at the correct sorted position:

```typescript
applyRemoteInsertDirect(op: InsertOperation): void {
  const cursor = this.fragments.cursor(locatorDimension);
  cursor.seekTo(op.locator);
  const index = cursor.itemIndex();

  const newFrag = createFragment(op.id, 0, op.locator, op.text, visible);
  this.fragments.insertAtMut(index, newFrag);
}
```

**Handling after/before splits:**

When `op.after` or `op.before` reference a mid-fragment position, split first:

```typescript
if (needsAfterSplit) {
  const idx = this.findFragmentIndexByOpId(op.after.insertionId);
  const [left, right] = splitFragment(frag, op.after.offset);
  this.fragments.replaceAtMut(idx, [left, right]);
}
```

**New dimension needed:** `insertionIdDimension` for O(log n) lookup by operation ID. The `maxInsertionId` field already exists in `FragmentSummary`.

## Implementation Phases

### Phase 1: SumTree Primitives ✅

**Files:** `src/sum-tree/index.ts`, `src/sum-tree/index.test.ts`

- [x] `replaceAt(index: number, items: T[]): SumTree<T, S>`
- [x] `replaceAtMut(index: number, items: T[]): void`
- [x] Tests: empty items, single item, multiple items, index bounds
- [x] Fixed `splitNodeIntoChunks` to handle arbitrary item counts (>2x branching factor)

### Phase 2: Cursor Helpers ✅

**Files:** `src/sum-tree/index.ts`

- [x] `cursor.startPosition(): D` — cumulative value before current item
- [x] `cursor.peekPrev(): T | undefined` — adjacent fragment access
- [x] `cursor.peekNext(): T | undefined`
- [x] Verify `itemIndex()` works after `seekTo()`

### Phase 3: Local Insert Rewrite 🚧

**Files:** `src/text/text-buffer.ts`

- [ ] Replace `findInsertPosition()` with cursor seek
- [ ] Replace split path with `replaceAtMut()`
- [ ] Replace non-split path with `insertAtMut()`
- [ ] Remove `fragmentsArray()` from insert path

**Benchmark checkpoint:** Expect 10-50x improvement on editing trace

**⚠️ BLOCKER:** Inserting split fragments individually at Locator positions causes incorrect ordering. When a fragment is split into [left, newFrag, right] and each is inserted at its Locator-sorted position, the resulting text ordering is wrong. This appears to be related to how child Locators from previous splits interact with new splits.

The naive approach of `replaceAtMut(fragIndex, [left, newFrag, right])` doesn't work because there may be OTHER fragments with Locators that need to interleave with the new fragments. But inserting each at `findTreeInsertIndex()` position also fails.

**Investigation needed:** Understanding the exact Locator ordering semantics when multiple splits have occurred at the same parent Locator.

### Phase 4: Delete Rewrite

**Files:** `src/text/text-buffer.ts`

- [ ] Replace linear scan with cursor seek + backwards walk
- [ ] Use `editAtIndex()` for full deletes
- [ ] Use `replaceAtMut()` for partial deletes
- [ ] Remove `fragmentsArray()` from delete path

### Phase 5: Remote Insert Rewrite

**Files:** `src/text/text-buffer.ts`, `src/text/fragment.ts`

- [ ] Add `insertionIdDimension` to fragment.ts
- [ ] Replace `findRefIndex()` with cursor seek by insertionId
- [ ] Replace `insertFragmentByLocator()` with cursor seek + `insertAtMut()`
- [ ] Remove `sortFragments()` — ordering maintained by insertion position

### Phase 6: Cleanup

- [ ] Remove or deprecate `sortFragments()`
- [ ] Remove or deprecate `fragmentsArray()` (keep for snapshots if needed)
- [ ] Remove `setFragments()` from hot paths
- [ ] Close issues #32, #33, #60

## Risks and Mitigations

**Risk:** Cursor `startPosition()` may not exist or work as expected.
**Mitigation:** The cursor tracks cumulative dimension values. We may need to expose this or compute it from `seekTo()` return value.

**Risk:** `replaceAtMut` is complex to implement correctly with rebalancing.
**Mitigation:** Start with immutable `replaceAt` built on existing primitives, then optimize.

**Risk:** Remote insert ordering edge cases.
**Mitigation:** Existing property tests cover convergence. Run full test suite after each phase.

## Success Criteria

- [ ] Editing trace (10K ops): <100ms (currently 2.87s)
- [ ] All 3909 tests passing
- [ ] No regression in other benchmarks
- [ ] Memory usage stable or improved
