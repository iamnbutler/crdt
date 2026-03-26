# CRDT Project Status

> Where we are, what's working, what's broken, and what comes next.
>
> 2026-03-23, end of day 1

---

## What This Is

`iamnbutler/crdt` — a pure-TypeScript CRDT text engine for collaborative
editing. Designed to be the text storage layer for the `multibuffer` editor
project. Built from scratch in one session, bottom-up.

**Runtime:** Bun-only for now (near-zero cost to add Node/browser later).
**No dependencies.** ~4,400 lines of source across 10 files.

---

## Architecture

```
Layer 0: TypedArray Arena       — GC-free node allocation for the B-tree
Layer 1: SumTree<T>             — Generic augmented B-tree with multi-dim seek
Layer 2: Rope                   — SumTree<TextChunk> with TextSummary
Layer 3: CRDT Text Buffer       — Fragments, Lamport clocks, version vectors
         + Anchors              — Stable positions via insertion reference
         + Transactions         — Time-based undo grouping (300ms window)
```

---

## What's Done

| Component | Status | Tests | PR |
|-----------|--------|-------|----|
| Repo scaffolding (Bun, TS, Biome) | Merged | — | #14 |
| Layer 0: TypedArray Arena | Merged | included in SumTree | #14 |
| Layer 1: SumTree | Merged | 60 | #15 |
| Layer 2: Rope | Merged | 94 | #18 |
| Layer 3: CRDT Text Buffer | Merged | 89 | #19 |
| Anchors | Merged | 48 | #16 |
| Transactions (undo grouping) | Merged | 27 | #20 |
| Property-based tests | Merged | 600 pass, 100 skipped | #21 |

**7 PRs merged. 922 tests passing. 0 failures (54 known-broken tests unskipped on a fix branch).**

---

## What Works

- **Single-replica editing** — insert, delete, undo, redo, all correct
- **Snapshots** — immutable views, anchor resolution, getText/getLine
- **O(log n) position lookups** — lineToOffset, offsetToLineCol via SumTree cursor
- **Time-based undo grouping** — consecutive edits within 300ms merge
- **Two-replica convergence** — same ops, same order → same text
- **Commutativity** — two concurrent ops from different replicas commute
- **Idempotency** — duplicate operations correctly ignored
- **Causal ordering** — ops with unmet dependencies are deferred and retried
- **Anchor stability** — anchors survive unrelated edits

---

## What's Broken: Order Independence (Issue #22)

**The only failing tests.** 54/100 randomized seeds fail when the same
operations are applied in shuffled order on different replicas.

### The symptom

Replica A and Replica B each start from the same state. They receive the
same set of 20-50 operations but in different shuffled orders. After
applying all operations, their document text differs.

### The root cause

Two interrelated problems:

**1. The fragment array is in insertion order, not Locator order.**

When a remote operation arrives, `applyRemoteInsertDirect` finds the
`after`/`before` reference fragments by linear scan, then splices the new
fragment between them. But when operations arrive in different orders, the
reference fragments may be at different array positions (because earlier
operations placed other fragments differently). So the splice lands in a
different spot on each replica.

The Locator is supposed to define a canonical total order, but the array
isn't sorted by Locator — it's sorted by the order operations happened to
be applied.

**2. Split fragments share the same Locator.**

When a fragment is split (by a concurrent insert mid-fragment), both halves
inherit the same Locator. Any fragment that needs to be placed between the
halves faces an ambiguous ordering decision.

### The fix (designed, not yet implemented)

Two changes, both required:

**A. Locator-sorted insertion.** On the receiver side, the operation already
carries the Locator (computed by the sender). Insert the new fragment at
its Locator-correct position via binary search — don't scan for
after/before references to find the position. The after/before refs are
still used for causal ordering ("don't apply until dependencies exist")
but NOT for positioning.

**B. Distinct Locators on split.** When splitting fragment F into F_left
and F_right: F_right keeps F's original Locator. F_left gets a new Locator
via `locatorBetween(prevFragment.locator, F.locator)`. This is what Zed
does (`crates/text/src/text.rs` line 953). Every fragment gets a unique
Locator, so the sort order is unambiguous.

**Secondary sort key** for any remaining ties:
`(Locator, replicaId, counter, insertionOffset)`.

### Why this hasn't been fixed yet

The previous attempt added a secondary sort key and tried to give split
prefixes new Locators, but the changes broke local insert Locator
computation. The issue is that `text-buffer.ts` uses a
`fragmentsArray()` → splice → `SumTree.fromItems()` pattern that
rebuilds the entire tree on every operation. A proper fix requires
either:

- Making `applyRemoteInsertDirect` insert at the Locator-sorted position
  (keep the rebuild pattern but sort by Locator instead of splice order), or
- Making the SumTree natively Locator-ordered with a Locator dimension on
  FragmentSummary, enabling O(log n) keyed insertion

The first is simpler and sufficient. The second is better architecture.

### Current branch state

`fix/order-independence` branch has the partial fix (secondary sort key,
idempotency check, causal deferral). 968 pass, 54 fail. The 54 failures
are all in the Order Independence property test suite.

---

## Open Issues

| # | Title | Priority |
|---|-------|----------|
| **22** | **Order independence (this bug)** | **Blocking** |
| 8 | Snapshot isolation (epoch-based reclamation) | Medium |
| 9 | Collaboration protocol (serialization, sync) | Medium |
| 11 | Public API surface (clean exports, branded types) | Medium |
| 12 | Benchmark suite (perf regression detection) | Medium |
| 13 | Research doc upload | Low |
| 17 | CI setup | Low |

---

## Codebase Map

```
~/code/crdt/
├── src/
│   ├── arena/index.ts          (298 lines)  — TypedArray arena allocator
│   ├── sum-tree/index.ts       (1585 lines) — Generic augmented B-tree
│   ├── rope/
│   │   ├── rope.ts             (366 lines)  — SumTree<TextChunk>
│   │   ├── summary.ts                       — TextSummary computation
│   │   └── types.ts                         — TextChunk, chunk constants
│   ├── text/
│   │   ├── text-buffer.ts      (1071 lines) — CRDT buffer (THE FILE TO FIX)
│   │   ├── types.ts            (167 lines)  — Fragment, Operation, OperationId
│   │   ├── fragment.ts         (202 lines)  — Fragment creation, splitting
│   │   ├── locator.ts          (117 lines)  — Locator.between, compare
│   │   ├── clock.ts            (135 lines)  — Lamport clocks, version vectors
│   │   ├── undo-map.ts         (131 lines)  — Max-wins undo counts
│   │   ├── snapshot.ts         (296 lines)  — TextBufferSnapshot
│   │   ├── text-buffer.test.ts              — 89 unit tests
│   │   ├── transactions.test.ts             — 27 transaction tests
│   │   └── property-tests.test.ts           — 700 property tests (100 skipped)
│   └── anchor/
│       ├── anchor.ts           (222 lines)  — Anchor creation/resolution
│       ├── anchor-set.ts       (362 lines)  — Batch anchor operations
│       └── types.ts            (164 lines)  — Anchor, Bias types
├── docs/
│   └── STATUS.md               (this file)
└── package.json
```

---

## Key Design Decisions Made

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Language | Pure TypeScript | WASM boundary tax too high for <1ms keypress |
| Runtime | Bun-first | Near-zero migration cost to add Node/browser later |
| CRDT algorithm | Locator-based (Zed-style) | Simpler than Fugue, cache-friendly, sufficient for code editors |
| Interleaving | Accept (rare in code editors) | Fugue fixes it but adds complexity; can migrate later via Eg-walker |
| Arena | TypedArray-backed | Zero GC pressure on tree traversal hot path |
| B-tree branching | B=16 | Fits 1 cache line for Uint32 summaries |
| Undo | Max-wins CRDT undo | Commutative, works across concurrent edits |
| Locator shift | >> 37 (two JS numbers) | ~137B sequential inserts before depth growth |
| Chunk size | 2048 UTF-16 units | Balances tree depth vs copy cost |
| CRLF | Normalize to \n at I/O boundary | Simplifies newline counting and CRDT splitting |
