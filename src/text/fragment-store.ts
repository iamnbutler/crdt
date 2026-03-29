/**
 * FragmentStore: Struct-of-Arrays (SoA) memory layout for CRDT fragments.
 *
 * Instead of storing fragments as individual JavaScript objects with properties,
 * this store uses parallel typed arrays for numeric fields and regular arrays
 * for variable-length data. This provides:
 *
 * 1. **~70% memory reduction** — typed arrays have no per-element object overhead
 * 2. **Cache locality** — scanning a single field (e.g., visibility) reads contiguous memory
 * 3. **Reduced GC pressure** — typed arrays are not traced by the garbage collector
 * 4. **V8-optimized access** — typed array reads compile to single machine instructions
 *
 * Fragments are referenced by a stable {@link FragmentHandle} (integer index).
 * Allocation is append-only with a free list, so handles are never invalidated
 * by insertions or deletions elsewhere in the store.
 */

import type { Summarizable } from "../sum-tree/index.js";
import type { Fragment, FragmentSummary, Locator, OperationId, ReplicaId } from "./types.js";

// ---------------------------------------------------------------------------
// FragmentHandle — stable reference into the store
// ---------------------------------------------------------------------------

/**
 * A branded integer index into a FragmentStore. Handles are stable: they are
 * never invalidated by operations on other fragments. A handle remains valid
 * until explicitly freed via {@link FragmentStore.free}.
 */
export type FragmentHandle = number & { readonly __brand: "FragmentHandle" };

/** Sentinel value for "no handle". */
export const NULL_HANDLE = -1 as unknown as FragmentHandle;

// ---------------------------------------------------------------------------
// Initial / growth constants
// ---------------------------------------------------------------------------

const INITIAL_CAPACITY = 256;

// ---------------------------------------------------------------------------
// FragmentStore
// ---------------------------------------------------------------------------

export class FragmentStore {
  // -- Typed arrays for numeric fields (SoA columns) -----------------------

  /** ReplicaId of the insertion operation. */
  private _replicaIds: Uint32Array;
  /** Counter of the insertion operation. */
  private _counters: Uint32Array;
  /** Insertion offset within the original operation's text. */
  private _insertionOffsets: Uint32Array;
  /** UTF-16 length of the fragment text. */
  private _lengths: Uint32Array;
  /** 1 = visible, 0 = deleted/hidden. */
  private _visible: Uint8Array;

  // -- Regular arrays for variable-length / complex fields ------------------

  /** Locator for fragment ordering (variable-length number[]). */
  private _locators: Array<Locator | undefined>;
  /** Base locator from original insertion (for deterministic splits). */
  private _baseLocators: Array<Locator | undefined>;
  /** Deletion operation IDs (variable-length). */
  private _deletions: Array<ReadonlyArray<OperationId> | undefined>;
  /** Text content per fragment. */
  private _texts: Array<string | undefined>;
  /** Precomputed summaries per fragment. */
  private _summaries: Array<FragmentSummary | undefined>;

  // -- Allocation bookkeeping -----------------------------------------------

  /** Number of live (allocated) fragments. */
  private _count: number;
  /** Total capacity (allocated slots, including free). */
  private _capacity: number;
  /** Free list: indices available for reuse. */
  private _freeList: FragmentHandle[];
  /** Next index to allocate from when free list is empty. */
  private _nextIndex: number;

  constructor(initialCapacity: number = INITIAL_CAPACITY) {
    this._capacity = initialCapacity;
    this._count = 0;
    this._nextIndex = 0;
    this._freeList = [];

    // Typed arrays
    this._replicaIds = new Uint32Array(initialCapacity);
    this._counters = new Uint32Array(initialCapacity);
    this._insertionOffsets = new Uint32Array(initialCapacity);
    this._lengths = new Uint32Array(initialCapacity);
    this._visible = new Uint8Array(initialCapacity);

    // Regular arrays (pre-allocated with undefined)
    this._locators = new Array(initialCapacity);
    this._baseLocators = new Array(initialCapacity);
    this._deletions = new Array(initialCapacity);
    this._texts = new Array(initialCapacity);
    this._summaries = new Array(initialCapacity);
  }

  // ---------------------------------------------------------------------------
  // Allocation
  // ---------------------------------------------------------------------------

  /** Number of live fragments in the store. */
  get count(): number {
    return this._count;
  }

  /** Total allocated capacity. */
  get capacity(): number {
    return this._capacity;
  }

  /**
   * Allocate a new fragment slot and populate it. Returns a stable handle.
   *
   * The handle remains valid until {@link free} is called on it.
   */
  allocate(
    insertionId: OperationId,
    insertionOffset: number,
    locator: Locator,
    text: string,
    visible: boolean,
    deletions: ReadonlyArray<OperationId>,
    baseLocator: Locator,
    summary: FragmentSummary,
  ): FragmentHandle {
    let index: number;

    if (this._freeList.length > 0) {
      index = this._freeList.pop() as number;
    } else {
      if (this._nextIndex >= this._capacity) {
        this.grow();
      }
      index = this._nextIndex++;
    }

    // Write to typed arrays
    this._replicaIds[index] = insertionId.replicaId as number;
    this._counters[index] = insertionId.counter;
    this._insertionOffsets[index] = insertionOffset;
    this._lengths[index] = text.length;
    this._visible[index] = visible ? 1 : 0;

    // Write to regular arrays
    this._locators[index] = locator;
    this._baseLocators[index] = baseLocator;
    this._deletions[index] = deletions;
    this._texts[index] = text;
    this._summaries[index] = summary;

    this._count++;
    return index as unknown as FragmentHandle;
  }

  /**
   * Free a fragment slot, returning it to the free list for reuse.
   * The handle becomes invalid after this call.
   */
  free(handle: FragmentHandle): void {
    const index = handle as number;
    // Clear references so they can be GC'd
    this._locators[index] = undefined;
    this._baseLocators[index] = undefined;
    this._deletions[index] = undefined;
    this._texts[index] = undefined;
    this._summaries[index] = undefined;

    this._freeList.push(handle);
    this._count--;
  }

  // ---------------------------------------------------------------------------
  // Accessors — typed array fields (hot path, cache-friendly)
  // ---------------------------------------------------------------------------

  getReplicaId(handle: FragmentHandle): ReplicaId {
    return this._replicaIds[handle as number] as unknown as ReplicaId;
  }

  getCounter(handle: FragmentHandle): number {
    return this._counters[handle as number] as number;
  }

  getInsertionId(handle: FragmentHandle): OperationId {
    return {
      replicaId: this._replicaIds[handle as number] as unknown as ReplicaId,
      counter: this._counters[handle as number] as number,
    };
  }

  getInsertionOffset(handle: FragmentHandle): number {
    return this._insertionOffsets[handle as number] as number;
  }

  getLength(handle: FragmentHandle): number {
    return this._lengths[handle as number] as number;
  }

  isVisible(handle: FragmentHandle): boolean {
    return this._visible[handle as number] === 1;
  }

  // ---------------------------------------------------------------------------
  // Accessors — regular array fields
  // ---------------------------------------------------------------------------

  getLocator(handle: FragmentHandle): Locator {
    const loc = this._locators[handle as number];
    if (loc === undefined) throw new Error(`Invalid handle: ${handle}`);
    return loc;
  }

  getBaseLocator(handle: FragmentHandle): Locator {
    const loc = this._baseLocators[handle as number];
    if (loc === undefined) throw new Error(`Invalid handle: ${handle}`);
    return loc;
  }

  getDeletions(handle: FragmentHandle): ReadonlyArray<OperationId> {
    const dels = this._deletions[handle as number];
    if (dels === undefined) throw new Error(`Invalid handle: ${handle}`);
    return dels;
  }

  getText(handle: FragmentHandle): string {
    const text = this._texts[handle as number];
    if (text === undefined) throw new Error(`Invalid handle: ${handle}`);
    return text;
  }

  getSummary(handle: FragmentHandle): FragmentSummary {
    const summary = this._summaries[handle as number];
    if (summary === undefined) throw new Error(`Invalid handle: ${handle}`);
    return summary;
  }

  // ---------------------------------------------------------------------------
  // Batch accessors — direct typed array access for scanning operations
  // ---------------------------------------------------------------------------

  /**
   * Get the raw visibility array for batch scanning.
   * This enables cache-friendly sequential scans over fragment visibility.
   */
  get visibilityArray(): Uint8Array {
    return this._visible;
  }

  /**
   * Get the raw replicaId array for batch operations.
   */
  get replicaIdArray(): Uint32Array {
    return this._replicaIds;
  }

  /**
   * Get the raw counter array for batch operations.
   */
  get counterArray(): Uint32Array {
    return this._counters;
  }

  // ---------------------------------------------------------------------------
  // Mutations — update fragment data in place
  // ---------------------------------------------------------------------------

  /**
   * Toggle visibility for a fragment. This is an O(1) operation on a typed
   * array — the hot path for delete/undo operations.
   */
  setVisible(handle: FragmentHandle, visible: boolean): void {
    this._visible[handle as number] = visible ? 1 : 0;
  }

  /**
   * Update the full summary for a fragment (e.g., after visibility change).
   */
  setSummary(handle: FragmentHandle, summary: FragmentSummary): void {
    this._summaries[handle as number] = summary;
  }

  /**
   * Update deletions array for a fragment.
   */
  setDeletions(handle: FragmentHandle, deletions: ReadonlyArray<OperationId>): void {
    this._deletions[handle as number] = deletions;
  }

  // ---------------------------------------------------------------------------
  // Growth
  // ---------------------------------------------------------------------------

  /**
   * Double the capacity of all backing arrays. Typed arrays are copied to new
   * buffers; regular arrays grow naturally. This is amortized O(1) per allocation.
   */
  private grow(): void {
    const newCapacity = this._capacity * 2;

    // Grow typed arrays (must copy to new buffer)
    const newReplicaIds = new Uint32Array(newCapacity);
    newReplicaIds.set(this._replicaIds);
    this._replicaIds = newReplicaIds;

    const newCounters = new Uint32Array(newCapacity);
    newCounters.set(this._counters);
    this._counters = newCounters;

    const newInsertionOffsets = new Uint32Array(newCapacity);
    newInsertionOffsets.set(this._insertionOffsets);
    this._insertionOffsets = newInsertionOffsets;

    const newLengths = new Uint32Array(newCapacity);
    newLengths.set(this._lengths);
    this._lengths = newLengths;

    const newVisible = new Uint8Array(newCapacity);
    newVisible.set(this._visible);
    this._visible = newVisible;

    // Regular arrays grow automatically, just extend length
    this._locators.length = newCapacity;
    this._baseLocators.length = newCapacity;
    this._deletions.length = newCapacity;
    this._texts.length = newCapacity;
    this._summaries.length = newCapacity;

    this._capacity = newCapacity;
  }
}

// ---------------------------------------------------------------------------
// FragmentRef — lightweight proxy implementing Fragment interface
// ---------------------------------------------------------------------------

/**
 * A lightweight reference to a fragment stored in a {@link FragmentStore}.
 *
 * Implements the {@link Fragment} interface so it's transparent to the
 * SumTree and all existing code that works with Fragment objects. The actual
 * data lives in the store's typed/regular arrays; this object is just a
 * thin accessor (~3 fields: store + handle + summary).
 *
 * This is the key integration point: the SumTree stores FragmentRef objects
 * but reads data from the columnar store, getting SoA cache benefits while
 * maintaining full API compatibility.
 */
export class FragmentRef implements Fragment, Summarizable<FragmentSummary> {
  readonly handle: FragmentHandle;
  private readonly store: FragmentStore;
  private readonly _summary: FragmentSummary;

  constructor(store: FragmentStore, handle: FragmentHandle, summary: FragmentSummary) {
    this.store = store;
    this.handle = handle;
    this._summary = summary;
  }

  get insertionId(): OperationId {
    return this.store.getInsertionId(this.handle);
  }

  get insertionOffset(): number {
    return this.store.getInsertionOffset(this.handle);
  }

  get locator(): Locator {
    return this.store.getLocator(this.handle);
  }

  get baseLocator(): Locator {
    return this.store.getBaseLocator(this.handle);
  }

  get length(): number {
    return this.store.getLength(this.handle);
  }

  get visible(): boolean {
    return this.store.isVisible(this.handle);
  }

  get deletions(): ReadonlyArray<OperationId> {
    return this.store.getDeletions(this.handle);
  }

  get text(): string {
    return this.store.getText(this.handle);
  }

  summary(): FragmentSummary {
    return this._summary;
  }
}

// ---------------------------------------------------------------------------
// Store-backed fragment creation helpers
// ---------------------------------------------------------------------------

/** Count newlines in a string. */
function countNewlines(text: string): number {
  const matches = text.match(/\n/g);
  return matches ? matches.length : 0;
}

/**
 * Compute the FragmentSummary for a fragment with the given parameters.
 */
function computeSummary(
  insertionId: OperationId,
  locator: Locator,
  text: string,
  visible: boolean,
): FragmentSummary {
  const lines = countNewlines(text);
  const len = text.length;

  return visible
    ? {
        visibleLen: len,
        visibleLines: lines,
        deletedLen: 0,
        deletedLines: 0,
        maxInsertionId: insertionId,
        maxLocator: locator,
        itemCount: 1,
      }
    : {
        visibleLen: 0,
        visibleLines: 0,
        deletedLen: len,
        deletedLines: lines,
        maxInsertionId: insertionId,
        maxLocator: locator,
        itemCount: 1,
      };
}

/**
 * Create a store-backed fragment. Returns a {@link FragmentRef} that
 * implements the {@link Fragment} interface.
 *
 * This is the SoA equivalent of the standalone `createFragment()` function.
 * The actual data is stored in the store's typed arrays; the returned
 * FragmentRef is a lightweight proxy.
 */
export function createStoredFragment(
  store: FragmentStore,
  insertionId: OperationId,
  insertionOffset: number,
  locator: Locator,
  text: string,
  visible: boolean,
  deletions: ReadonlyArray<OperationId> = [],
  baseLocator?: Locator,
): FragmentRef {
  const base = baseLocator ?? locator;
  const summary = computeSummary(insertionId, locator, text, visible);
  const handle = store.allocate(
    insertionId,
    insertionOffset,
    locator,
    text,
    visible,
    deletions,
    base,
    summary,
  );
  return new FragmentRef(store, handle, summary);
}

/** Type guard: returns true if the fragment is store-backed. */
export function isFragmentRef(fragment: Fragment): fragment is FragmentRef {
  return fragment instanceof FragmentRef;
}

/**
 * Free a fragment's store handle if it is store-backed and freeing is safe.
 *
 * When `safeToFree` is false (e.g., live snapshots exist), the handle is NOT
 * freed — old FragmentRef objects held by snapshots still read from the store,
 * so their slots must remain valid. The slot becomes unreachable garbage that
 * can be reclaimed later via {@link FragmentStore.compact}.
 */
function freeIfStored(store: FragmentStore, fragment: Fragment, safeToFree: boolean): void {
  if (safeToFree && isFragmentRef(fragment)) {
    store.free(fragment.handle);
  }
}

/**
 * Split a fragment at the given local offset, allocating the two halves in
 * the store. The original fragment's handle is freed if it was store-backed
 * and `safeToFree` is true.
 *
 * All data is read from the original BEFORE freeing, so this is safe even
 * if the freed slot is immediately reused.
 *
 * @param safeToFree Pass false when live snapshots exist to prevent invalidating
 *   handles still referenced by snapshot trees.
 */
export function splitStoredFragment(
  store: FragmentStore,
  fragment: Fragment,
  localOffset: number,
  safeToFree = true,
): [FragmentRef, FragmentRef] {
  // Capture all data before freeing
  const insertionId = fragment.insertionId;
  const parentLocator = fragment.baseLocator;
  const fullText = fragment.text;
  const fragmentVisible = fragment.visible;
  const fragmentDeletions = fragment.deletions;
  const fragmentBaseLocator = fragment.baseLocator;
  const fragInsertionOffset = fragment.insertionOffset;

  const leftText = fullText.slice(0, localOffset);
  const rightText = fullText.slice(localOffset);

  const leftInsertionOffset = fragInsertionOffset;
  const leftLocator: Locator = {
    levels: [...parentLocator.levels, 2 * leftInsertionOffset],
  };

  const rightInsertionOffset = fragInsertionOffset + localOffset;
  const rightLocator: Locator = {
    levels: [...parentLocator.levels, 2 * rightInsertionOffset],
  };

  // Free the original fragment's handle (if store-backed and safe)
  freeIfStored(store, fragment, safeToFree);

  const left = createStoredFragment(
    store,
    insertionId,
    leftInsertionOffset,
    leftLocator,
    leftText,
    fragmentVisible,
    fragmentDeletions,
    fragmentBaseLocator,
  );

  const right = createStoredFragment(
    store,
    insertionId,
    rightInsertionOffset,
    rightLocator,
    rightText,
    fragmentVisible,
    fragmentDeletions,
    fragmentBaseLocator,
  );

  return [left, right];
}

/**
 * Create a deleted version of a fragment, allocating in the store.
 * The original fragment's handle is freed if it was store-backed
 * and `safeToFree` is true.
 *
 * @param safeToFree Pass false when live snapshots exist.
 */
export function deleteStoredFragment(
  store: FragmentStore,
  fragment: Fragment,
  deletionId: OperationId,
  safeToFree = true,
): FragmentRef {
  // Capture all data before freeing
  const insertionId = fragment.insertionId;
  const insertionOffset = fragment.insertionOffset;
  const locator = fragment.locator;
  const text = fragment.text;
  const baseLocator = fragment.baseLocator;
  const deletions = [...fragment.deletions, deletionId];

  // Free the original
  freeIfStored(store, fragment, safeToFree);

  return createStoredFragment(
    store,
    insertionId,
    insertionOffset,
    locator,
    text,
    false,
    deletions,
    baseLocator,
  );
}

/**
 * Create a fragment with updated visibility, allocating in the store.
 * The original fragment's handle is freed if it was store-backed
 * and `safeToFree` is true.
 *
 * @param safeToFree Pass false when live snapshots exist.
 */
export function withStoredVisibility(
  store: FragmentStore,
  fragment: Fragment,
  visible: boolean,
  safeToFree = true,
): FragmentRef {
  if (fragment.visible === visible) {
    // If already correct, return as-is. If not already a FragmentRef,
    // migrate it into the store.
    if (isFragmentRef(fragment)) return fragment;
    return createStoredFragment(
      store,
      fragment.insertionId,
      fragment.insertionOffset,
      fragment.locator,
      fragment.text,
      fragment.visible,
      fragment.deletions,
      fragment.baseLocator,
    );
  }

  // Capture all data before freeing
  const insertionId = fragment.insertionId;
  const insertionOffset = fragment.insertionOffset;
  const locator = fragment.locator;
  const text = fragment.text;
  const baseLocator = fragment.baseLocator;
  const deletions = fragment.deletions;

  // Free the original
  freeIfStored(store, fragment, safeToFree);

  return createStoredFragment(
    store,
    insertionId,
    insertionOffset,
    locator,
    text,
    visible,
    deletions,
    baseLocator,
  );
}
