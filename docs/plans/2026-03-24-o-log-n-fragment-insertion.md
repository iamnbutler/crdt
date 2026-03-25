# O(log n) Fragment Insertion Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Reduce insert complexity from O(n) to O(log n) per operation, achieving <100ms for 10K sequential inserts.

**Architecture:** Add `maxLocator` to FragmentSummary enabling O(log n) tree traversal by Locator. Both local and remote inserts will find their Locator-ordered position via tree traversal, then use `SumTree.insertAt()` for O(log n) insertion. Critical invariant: fragments must ALWAYS be in Locator order.

**Tech Stack:** TypeScript, Bun test runner, SumTree B-tree with path copying

**Current State:** 7 pre-existing Convergence test failures (seeds: 129, 189, 299, 391, 456, 462, 486). Do not regress beyond these.

---

## Task 1: Add maxLocator to FragmentSummary

**Files:**
- Modify: `src/text/types.ts:126-132` (FragmentSummary interface)
- Modify: `src/text/fragment.ts:24-47` (fragmentSummaryOps)
- Modify: `src/text/fragment.ts:114-128` (createFragment summary computation)

**Step 1: Update FragmentSummary type**

In `src/text/types.ts`, add `maxLocator` field:

```typescript
export interface FragmentSummary {
  readonly visibleLen: number;
  readonly visibleLines: number;
  readonly deletedLen: number;
  readonly deletedLines: number;
  readonly maxInsertionId: OperationId;
  readonly maxLocator: Locator;  // ADD THIS
}
```

**Step 2: Update fragmentSummaryOps identity**

In `src/text/fragment.ts`, update the identity function:

```typescript
import { MIN_LOCATOR, compareLocators } from "./locator.js";

export const fragmentSummaryOps: Summary<FragmentSummary> = {
  identity(): FragmentSummary {
    return {
      visibleLen: 0,
      visibleLines: 0,
      deletedLen: 0,
      deletedLines: 0,
      maxInsertionId: MIN_OPERATION_ID,
      maxLocator: MIN_LOCATOR,  // ADD THIS
    };
  },
  // ...
```

**Step 3: Update fragmentSummaryOps combine**

```typescript
  combine(left: FragmentSummary, right: FragmentSummary): FragmentSummary {
    return {
      visibleLen: left.visibleLen + right.visibleLen,
      visibleLines: left.visibleLines + right.visibleLines,
      deletedLen: left.deletedLen + right.deletedLen,
      deletedLines: left.deletedLines + right.deletedLines,
      maxInsertionId:
        compareOperationIds(left.maxInsertionId, right.maxInsertionId) >= 0
          ? left.maxInsertionId
          : right.maxInsertionId,
      maxLocator:
        compareLocators(left.maxLocator, right.maxLocator) >= 0
          ? left.maxLocator
          : right.maxLocator,  // ADD THIS
    };
  },
```

**Step 4: Update createFragment to include maxLocator in summary**

In `src/text/fragment.ts`, update the summary computation in `createFragment`:

```typescript
  const summaryValue: FragmentSummary = visible
    ? {
        visibleLen: len,
        visibleLines: lines,
        deletedLen: 0,
        deletedLines: 0,
        maxInsertionId: insertionId,
        maxLocator: locator,  // ADD THIS
      }
    : {
        visibleLen: 0,
        visibleLines: 0,
        deletedLen: len,
        deletedLines: lines,
        maxInsertionId: insertionId,
        maxLocator: locator,  // ADD THIS
      };
```

**Step 5: Run tests to verify no regression**

```bash
bun test src/text/text-buffer.test.ts --timeout 10000
```

Expected: Same pass/fail count as before (no new failures).

**Step 6: Commit**

```bash
git add src/text/types.ts src/text/fragment.ts
git commit -m "feat(text): add maxLocator to FragmentSummary for O(log n) seeking"
```

---

## Task 2: Create Locator Dimension for SumTree Seeking

**Files:**
- Modify: `src/text/fragment.ts` (add locatorDimension)
- Create: `src/text/fragment.test.ts` (test the dimension)

**Step 1: Write test for locatorDimension**

Create `src/text/fragment.test.ts`:

```typescript
import { describe, expect, test } from "bun:test";
import { SumTree } from "../sum-tree/index.js";
import { createFragment, fragmentSummaryOps, locatorDimension } from "./fragment.js";
import { compareLocators } from "./locator.js";
import type { Fragment, Locator, OperationId } from "./types.js";
import { replicaId } from "./types.js";

function makeOpId(counter: number): OperationId {
  return { replicaId: replicaId(1), counter };
}

function makeLocator(...levels: number[]): Locator {
  return { levels };
}

describe("locatorDimension", () => {
  test("measure returns fragment locator", () => {
    const frag = createFragment(makeOpId(1), 0, makeLocator(100), "hello", true);
    const measured = locatorDimension.measure(frag.summary());
    expect(compareLocators(measured, makeLocator(100))).toBe(0);
  });

  test("cursor can seek to locator position in tree", () => {
    // Create fragments with locators [10], [20], [30]
    const frags = [
      createFragment(makeOpId(1), 0, makeLocator(10), "a", true),
      createFragment(makeOpId(2), 0, makeLocator(20), "b", true),
      createFragment(makeOpId(3), 0, makeLocator(30), "c", true),
    ];

    const tree = SumTree.fromItems(frags, fragmentSummaryOps);
    const cursor = tree.cursor(locatorDimension);

    // Seek to locator [15] - should land at fragment with [20]
    cursor.seekForward(makeLocator(15), "right");
    const item = cursor.item();
    expect(item).not.toBeNull();
    expect(compareLocators(item!.locator, makeLocator(20))).toBe(0);
  });
});
```

**Step 2: Run test to verify it fails**

```bash
bun test src/text/fragment.test.ts -t "locatorDimension"
```

Expected: FAIL - `locatorDimension` is not exported.

**Step 3: Implement locatorDimension**

In `src/text/fragment.ts`, add after the existing dimensions:

```typescript
import { MIN_LOCATOR, compareLocators } from "./locator.js";
import type { Locator } from "./types.js";

/**
 * Dimension for seeking by Locator.
 * Enables O(log n) position finding by Locator in the fragment tree.
 */
export const locatorDimension: Dimension<FragmentSummary, Locator> = {
  measure(summary: FragmentSummary): Locator {
    return summary.maxLocator;
  },
  compare(a: Locator, b: Locator): number {
    return compareLocators(a, b);
  },
  add(a: Locator, b: Locator): Locator {
    // For max-based dimensions, "add" returns the max
    return compareLocators(a, b) >= 0 ? a : b;
  },
  zero(): Locator {
    return MIN_LOCATOR;
  },
};
```

**Step 4: Run test to verify it passes**

```bash
bun test src/text/fragment.test.ts -t "locatorDimension"
```

Expected: PASS

**Step 5: Run full test suite to verify no regression**

```bash
bun test --timeout 10000 2>&1 | grep -E "(pass|fail)" | tail -3
```

Expected: Same 7 failures as before.

**Step 6: Commit**

```bash
git add src/text/fragment.ts src/text/fragment.test.ts
git commit -m "feat(text): add locatorDimension for O(log n) Locator seeking"
```

---

## Task 3: Add findInsertIndexByLocator Helper

**Files:**
- Modify: `src/text/text-buffer.ts` (add helper method)
- Modify: `src/text/fragment.test.ts` (add integration test)

**Step 1: Write test for findInsertIndexByLocator**

Add to `src/text/fragment.test.ts`:

```typescript
import { TextBuffer } from "./text-buffer.js";

describe("findInsertIndexByLocator", () => {
  test("finds correct index for locator between existing fragments", () => {
    const buf = TextBuffer.create();
    buf.insert(0, "abc");  // Creates one fragment

    // Access internal method via any cast for testing
    const frags = (buf as any).fragmentsArray();
    expect(frags.length).toBeGreaterThan(0);

    // The new locator should find position based on comparison
    const testLocator = makeLocator(Number.MAX_SAFE_INTEGER);
    const index = (buf as any).findInsertIndexByLocator(testLocator);
    expect(index).toBe(frags.length); // Should be at end for max locator
  });
});
```

**Step 2: Run test to verify it fails**

```bash
bun test src/text/fragment.test.ts -t "findInsertIndexByLocator"
```

Expected: FAIL - method doesn't exist.

**Step 3: Implement findInsertIndexByLocator**

In `src/text/text-buffer.ts`, add method to TextBuffer class:

```typescript
import { locatorDimension } from "./fragment.js";

// Add this method to the TextBuffer class:

/**
 * Find the index where a fragment with the given locator should be inserted.
 * Uses O(log n) tree traversal via locatorDimension.
 */
private findInsertIndexByLocator(locator: Locator): number {
  if (this.fragments.isEmpty()) {
    return 0;
  }

  const cursor = this.fragments.cursor(locatorDimension);
  cursor.seekForward(locator, "right");

  if (cursor.atEnd) {
    return this.fragments.length();
  }

  // Get the item index from cursor position
  // The cursor is at the first item with locator >= target
  return cursor.itemIndex();
}
```

**Step 4: Add itemIndex to Cursor (if not present)**

Check if `cursor.itemIndex()` exists. If not, we need to add it to the SumTree Cursor class.

In `src/sum-tree/index.ts`, add to Cursor class:

```typescript
/**
 * Get the 0-based item index of the current cursor position.
 * Returns the number of items before the current position.
 */
itemIndex(): number {
  if (this._atEnd) {
    return this.tree.length();
  }

  let index = 0;
  const arena = this.tree.getArena();

  for (let i = 0; i < this.stack.length; i++) {
    const entry = this.stack[i];
    if (entry === undefined) continue;

    // Count items in all siblings before current index
    for (let j = 0; j < entry.childIndex; j++) {
      if (arena.isLeaf(entry.nodeId)) {
        // Each position before childIndex is one item
        index++;
      } else {
        const childId = arena.getChild(entry.nodeId, j);
        if (childId !== INVALID_NODE_ID) {
          index += this.tree.countItems(childId);
        }
      }
    }
  }

  return index;
}
```

Also add `countItems` as a public method on SumTree:

```typescript
/**
 * Count items in a subtree (public wrapper).
 */
countItems(nodeId: NodeId): number {
  return this.countItemsRecursive(nodeId);
}

private countItemsRecursive(nodeId: NodeId): number {
  if (this.arena.isLeaf(nodeId)) {
    return this.arena.getCount(nodeId);
  }

  let count = 0;
  const children = this.arena.getChildren(nodeId);
  for (const childId of children) {
    count += this.countItemsRecursive(childId);
  }
  return count;
}
```

**Step 5: Run test to verify it passes**

```bash
bun test src/text/fragment.test.ts -t "findInsertIndexByLocator"
```

Expected: PASS

**Step 6: Commit**

```bash
git add src/text/text-buffer.ts src/sum-tree/index.ts
git commit -m "feat(text): add findInsertIndexByLocator for O(log n) position lookup"
```

---

## Task 4: Rewrite insertInternal for O(log n)

**Files:**
- Modify: `src/text/text-buffer.ts:702-739` (insertInternal method)

**Step 1: Write benchmark test to measure improvement**

Create `src/text/perf.test.ts`:

```typescript
import { describe, expect, test } from "bun:test";
import { TextBuffer } from "./text-buffer.js";

describe("insert performance", () => {
  test("10K sequential inserts should be under 500ms", () => {
    const start = performance.now();
    const buf = TextBuffer.create();
    for (let i = 0; i < 10000; i++) {
      buf.insert(buf.length, "x");
    }
    const elapsed = performance.now() - start;
    console.log(`10K inserts: ${elapsed.toFixed(0)}ms`);
    expect(elapsed).toBeLessThan(500); // Generous initial target
  });
});
```

**Step 2: Run baseline test**

```bash
bun test src/text/perf.test.ts -t "10K sequential"
```

Expected: FAIL (~2600ms, well over 500ms).

**Step 3: Rewrite insertInternal**

Replace the `insertInternal` method in `src/text/text-buffer.ts`:

```typescript
private insertInternal(offset: number, text: string): InsertOperation {
  const opId = this.clock.tick();
  observeVersion(this._version, this._replicaId, opId.counter);

  // Record in active (explicit) transaction or implicit (time-based) group
  if (this.activeTransaction !== null) {
    this.activeTransaction.operationIds.push(opId);
  } else {
    this.recordImplicitOp(opId, "insert");
  }

  // Step 1: Find the visible position and compute the new Locator
  const { locator, afterRef, beforeRef, splitFragments } =
    this.computeInsertLocator(offset);

  // Step 2: Apply any splits that were needed
  for (const { oldIndex, left, right } of splitFragments) {
    // Remove old fragment and insert split parts
    this.fragments = this.fragments.removeAt(oldIndex);
    this.fragments = this.fragments.insertAt(oldIndex, right);
    this.fragments = this.fragments.insertAt(oldIndex, left);
  }

  // Step 3: Create the new fragment
  const newFrag = createFragment(opId, 0, locator, text, true);

  // Step 4: Find insert position by Locator (O(log n))
  const insertIndex = this.findInsertIndexByLocator(locator);

  // Step 5: Insert at that position (O(log n))
  this.fragments = this.fragments.insertAt(insertIndex, newFrag);

  // Step 6: Update fragment ID index
  this.addToFragmentIndex(opId);

  return {
    type: "insert",
    id: opId,
    text,
    after: afterRef,
    before: beforeRef,
    version: cloneVersionVector(this._version),
    locator,
  };
}

/**
 * Compute the Locator for a new insert at the given visible offset.
 * Also handles splitting fragments if the insert is inside one.
 * Returns the locator and any splits that need to be applied.
 */
private computeInsertLocator(offset: number): {
  locator: Locator;
  afterRef: { insertionId: OperationId; offset: number };
  beforeRef: { insertionId: OperationId; offset: number };
  splitFragments: Array<{ oldIndex: number; left: Fragment; right: Fragment }>;
} {
  if (this.fragments.isEmpty()) {
    return {
      locator: locatorBetween(MIN_LOCATOR, MAX_LOCATOR),
      afterRef: { insertionId: MIN_OPERATION_ID, offset: 0 },
      beforeRef: { insertionId: MAX_OPERATION_ID, offset: 0 },
      splitFragments: [],
    };
  }

  // Seek to visible offset using cursor
  const cursor = this.fragments.cursor(visibleLenDimension);
  cursor.seekForward(offset, "right");

  if (cursor.atEnd) {
    // Insert at end
    const lastIdx = this.fragments.length() - 1;
    const lastFrag = this.fragments.get(lastIdx);
    return {
      locator: locatorBetween(lastFrag?.locator ?? MIN_LOCATOR, MAX_LOCATOR),
      afterRef: lastFrag
        ? { insertionId: lastFrag.insertionId, offset: lastFrag.insertionOffset + lastFrag.length }
        : { insertionId: MIN_OPERATION_ID, offset: 0 },
      beforeRef: { insertionId: MAX_OPERATION_ID, offset: 0 },
      splitFragments: [],
    };
  }

  const currentIndex = cursor.itemIndex();
  const currentFrag = cursor.item();
  if (!currentFrag) {
    return {
      locator: locatorBetween(MIN_LOCATOR, MAX_LOCATOR),
      afterRef: { insertionId: MIN_OPERATION_ID, offset: 0 },
      beforeRef: { insertionId: MAX_OPERATION_ID, offset: 0 },
      splitFragments: [],
    };
  }

  const positionInTree = cursor.position;
  const localOffset = offset - positionInTree;

  // If at the start of this fragment, insert between prev and current
  if (localOffset === 0) {
    const prevFrag = currentIndex > 0 ? this.fragments.get(currentIndex - 1) : null;
    return {
      locator: locatorBetween(prevFrag?.locator ?? MIN_LOCATOR, currentFrag.locator),
      afterRef: prevFrag
        ? { insertionId: prevFrag.insertionId, offset: prevFrag.insertionOffset + prevFrag.length }
        : { insertionId: MIN_OPERATION_ID, offset: 0 },
      beforeRef: { insertionId: currentFrag.insertionId, offset: currentFrag.insertionOffset },
      splitFragments: [],
    };
  }

  // Insert is inside this fragment - need to split
  if (currentFrag.visible && localOffset > 0 && localOffset < currentFrag.length) {
    const [left, right] = splitFragment(currentFrag, localOffset);

    // Compute locator using 2*k-1 scheme for inside inserts
    const k = right.insertionOffset;
    const insertLocator: Locator = {
      levels: [...currentFrag.baseLocator.levels, 2 * k - 1],
    };

    return {
      locator: insertLocator,
      afterRef: { insertionId: left.insertionId, offset: left.insertionOffset + left.length },
      beforeRef: { insertionId: right.insertionId, offset: right.insertionOffset },
      splitFragments: [{ oldIndex: currentIndex, left, right }],
    };
  }

  // Insert at end of this fragment
  const nextFrag = this.fragments.get(currentIndex + 1);
  return {
    locator: locatorBetween(currentFrag.locator, nextFrag?.locator ?? MAX_LOCATOR),
    afterRef: { insertionId: currentFrag.insertionId, offset: currentFrag.insertionOffset + currentFrag.length },
    beforeRef: nextFrag
      ? { insertionId: nextFrag.insertionId, offset: nextFrag.insertionOffset }
      : { insertionId: MAX_OPERATION_ID, offset: 0 },
    splitFragments: [],
  };
}

/** Add fragment ID to index. */
private addToFragmentIndex(id: OperationId): void {
  let counters = this._fragmentIds.get(id.replicaId);
  if (counters === undefined) {
    counters = new Set();
    this._fragmentIds.set(id.replicaId, counters);
  }
  counters.add(id.counter);
}
```

**Step 4: Import visibleLenDimension if not already imported**

At the top of `text-buffer.ts`, ensure:

```typescript
import {
  createFragment,
  deleteFragment,
  fragmentSummaryOps,
  locatorDimension,
  splitFragment,
  visibleLenDimension,
  withVisibility,
} from "./fragment.js";
```

**Step 5: Run correctness tests**

```bash
bun test src/text/text-buffer.test.ts --timeout 10000
```

Expected: Same pass/fail as before.

**Step 6: Run performance test**

```bash
bun test src/text/perf.test.ts -t "10K sequential"
```

Expected: PASS (under 500ms).

**Step 7: Run property tests**

```bash
bun test src/text/property-tests.test.ts --timeout 30000 2>&1 | grep -E "(pass|fail)" | tail -3
```

Expected: Same 7 Convergence failures, no new failures.

**Step 8: Commit**

```bash
git add src/text/text-buffer.ts src/text/fragment.ts src/text/perf.test.ts
git commit -m "perf(text): O(log n) insertInternal using SumTree.insertAt"
```

---

## Task 5: Rewrite applyRemoteInsertDirect for O(log n)

**Files:**
- Modify: `src/text/text-buffer.ts:1015-1046` (applyRemoteInsertDirect method)

**Step 1: Write test for remote insert performance**

Add to `src/text/perf.test.ts`:

```typescript
describe("remote insert performance", () => {
  test("applying 1K remote ops should be under 100ms", () => {
    const source = TextBuffer.create(replicaId(1));
    const ops: Operation[] = [];

    for (let i = 0; i < 1000; i++) {
      ops.push(source.insert(source.length, "x"));
    }

    const target = TextBuffer.create(replicaId(2));
    const start = performance.now();
    for (const op of ops) {
      target.applyRemote(op);
    }
    const elapsed = performance.now() - start;
    console.log(`1K remote ops: ${elapsed.toFixed(0)}ms`);
    expect(elapsed).toBeLessThan(100);
  });
});
```

**Step 2: Rewrite applyRemoteInsertDirect**

```typescript
private applyRemoteInsertDirect(op: InsertOperation): void {
  // Update clock
  this.clock.observe(op.id.counter);
  observeVersion(this._version, op.id.replicaId, op.id.counter);
  mergeVersionVectors(this._version, op.version);

  // Handle causal reference splits (may need to split existing fragments)
  this.handleRefSplits(op);

  // Check undo map for initial visibility
  const visible = !this.undoMap.isUndone(op.id);
  const newFrag = createFragment(op.id, 0, op.locator, op.text, visible);

  // Find insert position by Locator (O(log n))
  const insertIndex = this.findInsertIndexByLocator(op.locator);

  // Insert at that position (O(log n))
  this.fragments = this.fragments.insertAt(insertIndex, newFrag);

  // Update fragment index
  this.addToFragmentIndex(op.id);
}

/**
 * Handle causal reference splits for remote insert.
 * If the after/before refs point to the middle of a fragment, split it.
 */
private handleRefSplits(op: InsertOperation): void {
  if (!operationIdsEqual(op.after.insertionId, MIN_OPERATION_ID)) {
    this.splitAtRef(op.after);
  }
  if (!operationIdsEqual(op.before.insertionId, MAX_OPERATION_ID)) {
    this.splitAtRef(op.before);
  }
}

/**
 * Split a fragment at the given reference point if needed.
 */
private splitAtRef(ref: { insertionId: OperationId; offset: number }): void {
  // Find fragment by insertionId (could optimize with index later)
  let index = 0;
  for (const frag of this.fragments.toArray()) {
    if (operationIdsEqual(frag.insertionId, ref.insertionId)) {
      const fragStart = frag.insertionOffset;
      const fragEnd = frag.insertionOffset + frag.length;

      if (ref.offset > fragStart && ref.offset < fragEnd) {
        // Need to split
        const localOffset = ref.offset - fragStart;
        const [left, right] = splitFragment(frag, localOffset);

        this.fragments = this.fragments.removeAt(index);
        this.fragments = this.fragments.insertAt(index, right);
        this.fragments = this.fragments.insertAt(index, left);
        return;
      }
    }
    index++;
  }
}
```

**Step 3: Run correctness tests**

```bash
bun test src/text/text-buffer.test.ts --timeout 10000
```

**Step 4: Run property tests**

```bash
bun test src/text/property-tests.test.ts --timeout 30000 2>&1 | grep -E "(pass|fail)" | tail -3
```

Expected: Same 7 failures, no new failures.

**Step 5: Run performance test**

```bash
bun test src/text/perf.test.ts
```

Expected: Both tests pass.

**Step 6: Commit**

```bash
git add src/text/text-buffer.ts src/text/perf.test.ts
git commit -m "perf(text): O(log n) applyRemoteInsertDirect using findInsertIndexByLocator"
```

---

## Task 6: Remove Old O(n) Helpers

**Files:**
- Modify: `src/text/text-buffer.ts` (remove/simplify methods)

**Step 1: Simplify setFragments**

The `setFragments` method is now only needed for batch operations. Update it to not rebuild the index (since we now maintain it incrementally):

```typescript
private setFragments(frags: Fragment[]): void {
  this.fragments = SumTree.fromItems(frags, fragmentSummaryOps);
  // Rebuild index (still O(n) but only called for batch ops)
  const index = new Map<ReplicaId, Set<number>>();
  for (const frag of frags) {
    const rid = frag.insertionId.replicaId;
    let counters = index.get(rid);
    if (counters === undefined) {
      counters = new Set();
      index.set(rid, counters);
    }
    counters.add(frag.insertionId.counter);
  }
  this._fragmentIds = index;
}
```

**Step 2: Remove insertFragmentByLocator (no longer needed)**

Delete the `insertFragmentByLocator` method since we now use `findInsertIndexByLocator` + `insertAt`.

**Step 3: Remove findInsertPosition (no longer needed)**

Delete the `findInsertPosition` method since we now use `computeInsertLocator`.

**Step 4: Run all tests**

```bash
bun test --timeout 30000
```

Expected: Same 7 failures as before.

**Step 5: Commit**

```bash
git add src/text/text-buffer.ts
git commit -m "refactor(text): remove deprecated O(n) helper methods"
```

---

## Task 7: Final Performance Validation

**Step 1: Update perf test with final targets**

Update `src/text/perf.test.ts`:

```typescript
describe("insert performance - final targets", () => {
  test("10K sequential inserts under 100ms (issue #33 target)", () => {
    const start = performance.now();
    const buf = TextBuffer.create();
    for (let i = 0; i < 10000; i++) {
      buf.insert(buf.length, "x");
    }
    const elapsed = performance.now() - start;
    console.log(`10K inserts: ${elapsed.toFixed(0)}ms (target: <100ms)`);
    expect(elapsed).toBeLessThan(100);
  });
});
```

**Step 2: Run benchmark suite**

```bash
bun run bench 2>&1 | grep -E "(text-insert|text-batch|editing-trace)" -A 3 | head -40
```

**Step 3: Run full test suite**

```bash
bun test --timeout 30000 2>&1 | grep -E "(pass|fail)" | tail -3
```

Expected: Same 7 Convergence failures, no new failures.

**Step 4: Final commit**

```bash
git add -A
git commit -m "perf(text): complete O(log n) fragment insertion - closes #33"
```

---

## Notes

### Why PR #54 Failed

PR #54 introduced 341 test failures because it maintained different orderings:
- Local inserts: ordered by visible offset
- Remote inserts: ordered by Locator

This caused Order Independence tests to fail - same ops in different order gave different results.

### Key Invariant

**Fragments must ALWAYS be in Locator order.** Both local and remote inserts must:
1. Compute the Locator first
2. Find the Locator's position in the tree
3. Insert at that position

### Future Optimization

Delete operations still use O(n) `setFragments`. This could be optimized later with similar techniques:
1. Find affected fragments by visible offset
2. Use `removeAt` and `insertAt` for splits
3. Update visibility in place using `replaceAt`
