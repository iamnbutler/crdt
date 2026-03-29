/**
 * Skip list data structure with typed-array backing and monoidal summaries.
 *
 * Designed as a potential replacement for SumTree with better cache locality
 * and O(1) amortized sequential insertion via finger search.
 *
 * Memory layout: Struct-of-Arrays (SoA) using typed arrays for cache efficiency.
 * Each level's forward pointers are stored in separate Uint32Arrays.
 *
 * Supports the same Summary/Dimension/Summarizable traits as SumTree.
 */

import type { Dimension, SeekBias, Summarizable, Summary } from "../sum-tree/index.js";

// Re-export types for convenience
export type { Dimension, SeekBias, Summarizable, Summary };

export const SKIP_LIST_VERSION = "0.1.0";

/** Maximum number of levels in the skip list. 2^MAX_LEVEL supports ~1M elements. */
const MAX_LEVEL = 20;

/** Probability for level promotion (1/4 = sparser levels = better cache behavior). */
const PROMOTION_PROBABILITY = 0.25;

/** Initial capacity for typed arrays. */
const DEFAULT_CAPACITY = 1024;

/** Growth factor when resizing. */
const GROWTH_FACTOR = 2;

/** Sentinel index for "no next node". */
const NIL = 0;

/**
 * Seeded PRNG (xorshift32) for reproducible level generation.
 * Using a fast PRNG avoids the cost of crypto.getRandomValues
 * while still providing good distribution.
 */
class Xorshift32 {
  private state: number;

  constructor(seed: number) {
    this.state = seed | 1; // Ensure non-zero
  }

  next(): number {
    let x = this.state;
    x ^= x << 13;
    x ^= x >> 17;
    x ^= x << 5;
    this.state = x;
    return (x >>> 0) / 0x100000000; // [0, 1)
  }
}

/**
 * SkipList: a probabilistic ordered data structure with monoidal summary caching.
 *
 * Generic parameters:
 * - T: item type (must implement Summarizable<S>)
 * - S: summary type
 *
 * Features:
 * - SoA typed-array layout for cache-friendly traversal
 * - Monoidal summary aggregation at each level (like SumTree)
 * - Finger search for O(log d) insertion near a known position
 * - Cursor-based navigation with dimension seeking
 */
export class SkipList<T extends Summarizable<S>, S> {
  // --- SoA storage ---
  /** Forward pointers per level. forward[level][nodeIndex] = next node at that level. */
  private forward: Uint32Array[];
  /** Items stored at each node index. Index 0 is the head sentinel. */
  private items: Array<T | undefined>;
  /** Cached summary per node (just the node's own item summary). */
  private nodeSummaries: Array<S | undefined>;
  /**
   * Aggregated summaries per level: the sum of all items reachable by walking
   * forward pointers at a given level from this node to the next node at this level.
   * spanSummaries[level][nodeIndex] = summary of items spanned at that level.
   */
  private spanSummaries: Array<Array<S | undefined>>;
  /**
   * Span counts per level: number of level-0 nodes between this node and the
   * next node at this level (used for O(log n) index calculation).
   */
  private spanCounts: Uint32Array[];
  /** Height of each node (max level index it participates in). */
  private heights: Uint8Array;

  // --- Metadata ---
  private _length: number;
  private _capacity: number;
  private _level: number; // Current max level in use
  private nextFreeIndex: number;
  private freeList: number[];
  private summaryOps: Summary<S>;
  private rng: Xorshift32;

  // --- Cached total summary ---
  private _totalSummary: S | undefined;

  // --- Finger cache ---
  /** Last insertion/access position for finger search. */
  private _finger: number;

  /** Tail pointer at each level for O(1) pushBack. */
  private tail: number[];

  constructor(summaryOps: Summary<S>, seed = 42) {
    this.summaryOps = summaryOps;
    this.rng = new Xorshift32(seed);
    this._capacity = DEFAULT_CAPACITY;
    this._length = 0;
    this._level = 0;
    this.nextFreeIndex = 1; // 0 is head sentinel
    this.freeList = [];
    this._finger = NIL;
    this.tail = new Array(MAX_LEVEL + 1).fill(NIL);
    this._totalSummary = undefined;

    // Initialize SoA arrays
    this.forward = [];
    this.spanCounts = [];
    this.spanSummaries = [];
    for (let i = 0; i <= MAX_LEVEL; i++) {
      this.forward.push(new Uint32Array(this._capacity));
      this.spanCounts.push(new Uint32Array(this._capacity));
      this.spanSummaries.push(new Array(this._capacity));
    }

    this.items = new Array(this._capacity);
    this.nodeSummaries = new Array(this._capacity);
    this.heights = new Uint8Array(this._capacity);

    // Head sentinel (index 0) has no item, height = MAX_LEVEL
    this.heights[0] = MAX_LEVEL;
  }

  /** Number of items in the skip list. */
  get length(): number {
    return this._length;
  }

  /** Whether the skip list is empty. */
  isEmpty(): boolean {
    return this._length === 0;
  }

  /** Get the total summary of all items. O(1) via cached total, O(n) on cache miss. */
  summary(): S {
    if (this._totalSummary !== undefined) {
      return this._totalSummary;
    }
    if (this._length === 0) {
      return this.summaryOps.identity();
    }
    return this.recomputeTotalSummary();
  }

  /** Recompute total summary by walking level 0. O(n). */
  private recomputeTotalSummary(): S {
    let result = this.summaryOps.identity();
    const fwd0 = this.forward[0];
    if (fwd0 === undefined) return result;

    let current = fwd0[NIL] ?? NIL;
    while (current !== NIL) {
      const ns = this.nodeSummaries[current];
      if (ns !== undefined) {
        result = this.summaryOps.combine(result, ns);
      }
      current = fwd0[current] ?? NIL;
    }
    this._totalSummary = result;
    return result;
  }

  /** Get the summary ops. */
  getSummaryOps(): Summary<S> {
    return this.summaryOps;
  }

  // ---------------------------------------------------------------------------
  // Random level generation
  // ---------------------------------------------------------------------------

  private randomLevel(): number {
    let level = 0;
    while (level < MAX_LEVEL && this.rng.next() < PROMOTION_PROBABILITY) {
      level++;
    }
    return level;
  }

  // ---------------------------------------------------------------------------
  // Capacity management
  // ---------------------------------------------------------------------------

  private allocateIndex(): number {
    if (this.freeList.length > 0) {
      return this.freeList.pop() ?? this.nextFreeIndex++;
    }
    if (this.nextFreeIndex >= this._capacity) {
      this.grow();
    }
    return this.nextFreeIndex++;
  }

  private grow(): void {
    const newCapacity = this._capacity * GROWTH_FACTOR;

    // Grow forward pointer arrays
    for (let level = 0; level <= MAX_LEVEL; level++) {
      const oldFwd = this.forward[level];
      const newFwd = new Uint32Array(newCapacity);
      if (oldFwd !== undefined) newFwd.set(oldFwd);
      this.forward[level] = newFwd;

      const oldSpanCount = this.spanCounts[level];
      const newSpanCount = new Uint32Array(newCapacity);
      if (oldSpanCount !== undefined) newSpanCount.set(oldSpanCount);
      this.spanCounts[level] = newSpanCount;

      // Grow span summaries (regular array, just extend)
      const oldSpanSums = this.spanSummaries[level];
      if (oldSpanSums !== undefined) {
        oldSpanSums.length = newCapacity;
      }
    }

    // Grow heights
    const newHeights = new Uint8Array(newCapacity);
    newHeights.set(this.heights);
    this.heights = newHeights;

    // Grow items / summaries (regular arrays auto-grow)
    this.items.length = newCapacity;
    this.nodeSummaries.length = newCapacity;

    this._capacity = newCapacity;
  }

  // ---------------------------------------------------------------------------
  // Core operations
  // ---------------------------------------------------------------------------

  /**
   * Insert an item at the correct position determined by a comparator.
   * The comparator is called with each item; return < 0 to go left, >= 0 to go right.
   *
   * Returns the index of the inserted node.
   */
  insert(item: T, compare: (existing: T) => number): number {
    const nodeLevel = this.randomLevel();
    const newIndex = this.allocateIndex();

    // Update max level if needed
    if (nodeLevel > this._level) {
      // New levels need span counts from head = total length
      for (let i = this._level + 1; i <= nodeLevel; i++) {
        const sc = this.spanCounts[i];
        if (sc !== undefined) sc[NIL] = this._length;
        // Head's span summary at new levels = total summary
        const ss = this.spanSummaries[i];
        if (ss !== undefined) ss[NIL] = this.summary();
      }
      this._level = nodeLevel;
    }

    // Find insertion position at each level (update[] and position tracking)
    const update: number[] = new Array(this._level + 1);
    const posAtLevel: number[] = new Array(this._level + 1);
    let current = NIL;
    let currentPos = 0;

    for (let level = this._level; level >= 0; level--) {
      const fwd = this.forward[level];
      const sc = this.spanCounts[level];
      if (fwd === undefined || sc === undefined) {
        update[level] = NIL;
        posAtLevel[level] = 0;
        continue;
      }

      while (fwd[current] !== NIL) {
        const nextItem = this.items[fwd[current] ?? NIL];
        if (nextItem !== undefined && compare(nextItem) > 0) {
          currentPos += (sc[current] ?? 0);
          current = fwd[current] ?? NIL;
        } else {
          break;
        }
      }
      update[level] = current;
      posAtLevel[level] = currentPos;
    }

    // Position of the new node in the list
    const fwd0 = this.forward[0];
    const sc0 = this.spanCounts[0];
    const newPos = currentPos + ((sc0 !== undefined ? sc0[current] : 0) > 0 ? 1 : 1);

    // Store the item
    this.items[newIndex] = item;
    this.nodeSummaries[newIndex] = item.summary();
    this.heights[newIndex] = nodeLevel;

    const itemSummary = item.summary();

    // Wire up forward pointers and update span counts/summaries
    for (let level = 0; level <= this._level; level++) {
      const fwd = this.forward[level];
      const sc = this.spanCounts[level];
      const ss = this.spanSummaries[level];
      if (fwd === undefined || sc === undefined || ss === undefined) continue;

      if (level <= nodeLevel) {
        // Insert at this level
        const prev = update[level] ?? NIL;
        fwd[newIndex] = fwd[prev] ?? NIL;
        fwd[prev] = newIndex;

        // Compute new span counts
        const oldSpan = sc[prev] ?? 0;
        const prevPos = posAtLevel[level] ?? 0;
        const insertPos = currentPos + 1;
        const spanBefore = insertPos - prevPos;
        const spanAfter = oldSpan - spanBefore + 1;

        sc[newIndex] = Math.max(0, spanAfter);
        sc[prev] = spanBefore;

        // Update span summaries
        this.recomputeSpanSummary(newIndex, level);
        this.recomputeSpanSummary(prev, level);
      } else {
        // Level above new node - just increment span count
        const prev = update[level] ?? NIL;
        sc[prev] = (sc[prev] ?? 0) + 1;
        // Recompute span summary to include new item
        this.recomputeSpanSummary(prev, level);
      }
    }

    this._length++;
    // Update cached total summary
    if (this._totalSummary !== undefined) {
      this._totalSummary = this.summaryOps.combine(this._totalSummary, itemSummary);
    } else {
      this._totalSummary = itemSummary;
    }
    this._finger = newIndex;
    return newIndex;
  }

  /**
   * Insert an item using the Summarizable ordering (by dimension comparison).
   * Common case: insert by a dimension that represents position.
   */
  insertByDimension<D>(
    dimension: Dimension<S, D>,
    target: D,
    item: T,
    bias: SeekBias = "right",
  ): number {
    return this.insert(item, (existing) => {
      const existingMeasure = dimension.measure(existing.summary());
      const cmp = dimension.compare(target, existingMeasure);
      if (cmp === 0) return bias === "left" ? -1 : 1;
      return cmp;
    });
  }

  /**
   * Insert an item ordered by a custom key comparator applied to items.
   * This is the most common pattern for CRDT usage: items sorted by Locator.
   */
  insertOrdered(item: T, itemCompare: (a: T, b: T) => number): number {
    return this.insert(item, (existing) => itemCompare(item, existing));
  }

  /**
   * Finger-aware insert: if the new item is near the finger position,
   * start the search from the finger rather than the head.
   *
   * Expected O(log d) where d = distance from finger.
   * For sequential typing (d ≈ 1), this is O(1).
   */
  insertNearFinger(item: T, itemCompare: (a: T, b: T) => number): number {
    if (this._finger === NIL || this._length < 2) {
      return this.insertOrdered(item, itemCompare);
    }

    const fingerItem = this.items[this._finger];
    if (fingerItem === undefined) {
      return this.insertOrdered(item, itemCompare);
    }

    const cmp = itemCompare(item, fingerItem);

    if (cmp >= 0) {
      // New item goes after finger - search forward from finger
      return this.insertAfterFinger(item, itemCompare);
    }

    // New item goes before finger - fall back to full search
    return this.insertOrdered(item, itemCompare);
  }

  /**
   * Insert after the finger position by walking forward from the finger node.
   */
  private insertAfterFinger(item: T, itemCompare: (a: T, b: T) => number): number {
    const nodeLevel = this.randomLevel();
    const newIndex = this.allocateIndex();

    if (nodeLevel > this._level) {
      for (let i = this._level + 1; i <= nodeLevel; i++) {
        const sc = this.spanCounts[i];
        if (sc !== undefined) sc[NIL] = this._length;
        const ss = this.spanSummaries[i];
        if (ss !== undefined) ss[NIL] = this.summary();
      }
      this._level = nodeLevel;
    }

    // Walk from finger at level 0 to find exact insertion point
    let insertAfter = this._finger;
    const fwd0 = this.forward[0];
    if (fwd0 !== undefined) {
      while (fwd0[insertAfter] !== NIL) {
        const nextItem = this.items[fwd0[insertAfter] ?? NIL];
        if (nextItem !== undefined && itemCompare(item, nextItem) >= 0) {
          insertAfter = fwd0[insertAfter] ?? NIL;
        } else {
          break;
        }
      }
    }

    // For levels > 0, we need to find the predecessor at each level.
    // Walk backwards from insertAfter (or use head search for upper levels).
    // For simplicity and correctness, use head search for upper levels.
    const update: number[] = new Array(this._level + 1);
    const posAtLevel: number[] = new Array(this._level + 1);
    update[0] = insertAfter;
    posAtLevel[0] = this.positionOf(insertAfter);

    // For levels > 0, search from head
    let current = NIL;
    let currentPos = 0;
    for (let level = this._level; level >= 1; level--) {
      const fwd = this.forward[level];
      const sc = this.spanCounts[level];
      if (fwd === undefined || sc === undefined) {
        update[level] = NIL;
        posAtLevel[level] = 0;
        continue;
      }

      while (fwd[current] !== NIL) {
        const nextItem = this.items[fwd[current] ?? NIL];
        if (nextItem !== undefined && itemCompare(item, nextItem) >= 0) {
          currentPos += (sc[current] ?? 0);
          current = fwd[current] ?? NIL;
        } else {
          break;
        }
      }
      update[level] = current;
      posAtLevel[level] = currentPos;
    }

    const insertPos = (posAtLevel[0] ?? 0) + 1;

    // Store item
    this.items[newIndex] = item;
    this.nodeSummaries[newIndex] = item.summary();
    this.heights[newIndex] = nodeLevel;

    // Wire up
    for (let level = 0; level <= this._level; level++) {
      const fwd = this.forward[level];
      const sc = this.spanCounts[level];
      const ss = this.spanSummaries[level];
      if (fwd === undefined || sc === undefined || ss === undefined) continue;

      if (level <= nodeLevel) {
        const prev = update[level] ?? NIL;
        fwd[newIndex] = fwd[prev] ?? NIL;
        fwd[prev] = newIndex;

        const oldSpan = sc[prev] ?? 0;
        const prevPos = posAtLevel[level] ?? 0;
        const spanBefore = insertPos - prevPos;
        const spanAfter = oldSpan - spanBefore + 1;

        sc[newIndex] = Math.max(0, spanAfter);
        sc[prev] = spanBefore;

        this.recomputeSpanSummary(newIndex, level);
        this.recomputeSpanSummary(prev, level);
      } else {
        const prev = update[level] ?? NIL;
        sc[prev] = (sc[prev] ?? 0) + 1;
        this.recomputeSpanSummary(prev, level);
      }
    }

    this._length++;
    const insertedSummary = item.summary();
    if (this._totalSummary !== undefined) {
      this._totalSummary = this.summaryOps.combine(this._totalSummary, insertedSummary);
    } else {
      this._totalSummary = insertedSummary;
    }
    this._finger = newIndex;
    return newIndex;
  }

  /**
   * Compute the 0-based position of a node by walking from head.
   * O(log n) using span counts at higher levels.
   */
  private positionOf(nodeIndex: number): number {
    if (nodeIndex === NIL) return 0;

    // Walk from head at the highest level, descending when we overshoot
    let pos = 0;
    let current = NIL;

    for (let level = this._level; level >= 0; level--) {
      const fwd = this.forward[level];
      const sc = this.spanCounts[level];
      if (fwd === undefined || sc === undefined) continue;

      while (fwd[current] !== NIL && fwd[current] !== nodeIndex) {
        // Check if target is reachable from next
        const next = fwd[current] ?? NIL;
        // Only advance if next <= target in list order
        if (this.isBeforeOrEqual(next, nodeIndex, level)) {
          pos += (sc[current] ?? 0);
          current = next;
        } else {
          break;
        }
      }
      if (fwd[current] === nodeIndex) {
        pos += (sc[current] ?? 0);
        return pos;
      }
    }

    return pos;
  }

  /**
   * Check if nodeA appears before or at nodeB in list order at level 0.
   */
  private isBeforeOrEqual(nodeA: number, nodeB: number, _level: number): boolean {
    // Walk level 0 from nodeA to see if we reach nodeB
    const fwd0 = this.forward[0];
    if (fwd0 === undefined) return false;
    let current = nodeA;
    // Limit walk to avoid O(n) worst case
    for (let i = 0; i < 1000 && current !== NIL; i++) {
      if (current === nodeB) return true;
      current = fwd0[current] ?? NIL;
    }
    return false;
  }

  /**
   * Remove an item by comparator. Returns the removed item or undefined.
   */
  remove(compare: (existing: T) => number): T | undefined {
    const update: number[] = new Array(this._level + 1);
    let current = NIL;

    for (let level = this._level; level >= 0; level--) {
      const fwd = this.forward[level];
      if (fwd === undefined) {
        update[level] = NIL;
        continue;
      }

      while (fwd[current] !== NIL) {
        const nextItem = this.items[fwd[current] ?? NIL];
        if (nextItem !== undefined && compare(nextItem) > 0) {
          current = fwd[current] ?? NIL;
        } else {
          break;
        }
      }
      update[level] = current;
    }

    // Check if we found the item
    const fwd0 = this.forward[0];
    if (fwd0 === undefined) return undefined;

    const targetIndex = fwd0[current] ?? NIL;
    if (targetIndex === NIL) return undefined;

    const targetItem = this.items[targetIndex];
    if (targetItem === undefined || compare(targetItem) !== 0) return undefined;

    const targetHeight = this.heights[targetIndex] ?? 0;

    // Remove from all levels
    for (let level = 0; level <= this._level; level++) {
      const fwd = this.forward[level];
      const sc = this.spanCounts[level];
      const ss = this.spanSummaries[level];
      if (fwd === undefined || sc === undefined || ss === undefined) continue;

      const prev = update[level] ?? NIL;

      if (level <= targetHeight && fwd[prev] === targetIndex) {
        // Remove at this level
        fwd[prev] = fwd[targetIndex] ?? NIL;
        sc[prev] = (sc[prev] ?? 0) + (sc[targetIndex] ?? 0) - 1;
        this.recomputeSpanSummary(prev, level);
      } else {
        // Just decrement span count
        sc[prev] = Math.max(0, (sc[prev] ?? 0) - 1);
        this.recomputeSpanSummary(prev, level);
      }
    }

    // Clean up removed node
    const removedItem = this.items[targetIndex];
    this.items[targetIndex] = undefined;
    this.nodeSummaries[targetIndex] = undefined;
    this.freeList.push(targetIndex);
    this._length--;
    // Invalidate cached summary (recompute lazily)
    this._totalSummary = undefined;

    // Lower max level if needed
    while (this._level > 0) {
      const fwdTop = this.forward[this._level];
      if (fwdTop !== undefined && (fwdTop[NIL] ?? NIL) === NIL) {
        this._level--;
      } else {
        break;
      }
    }

    if (this._finger === targetIndex) {
      this._finger = NIL;
    }

    return removedItem;
  }

  /**
   * Recompute the span summary for a node at a given level.
   * The span summary is the combined summary of all items from this node
   * (exclusive) to the next node at this level (inclusive of items between).
   */
  private recomputeSpanSummary(nodeIndex: number, level: number): void {
    const fwd = this.forward[level];
    const ss = this.spanSummaries[level];
    if (fwd === undefined || ss === undefined) return;

    if (level === 0) {
      // At level 0, span summary = just the next node's item summary
      const next = fwd[nodeIndex] ?? NIL;
      if (next === NIL) {
        ss[nodeIndex] = undefined;
      } else {
        ss[nodeIndex] = this.nodeSummaries[next];
      }
      return;
    }

    // At higher levels, combine span summaries from the level below
    const lowerFwd = this.forward[level - 1];
    const lowerSS = this.spanSummaries[level - 1];
    if (lowerFwd === undefined || lowerSS === undefined) return;

    const endNode = fwd[nodeIndex] ?? NIL;
    let combined = this.summaryOps.identity();
    let current = nodeIndex;

    while (current !== endNode) {
      const spanSum = lowerSS[current];
      if (spanSum !== undefined) {
        combined = this.summaryOps.combine(combined, spanSum);
      }
      current = lowerFwd[current] ?? NIL;
      if (current === NIL) break;
    }

    ss[nodeIndex] = combined;
  }

  // ---------------------------------------------------------------------------
  // Query operations
  // ---------------------------------------------------------------------------

  /**
   * Get item at a 0-based index. O(log n) via span counts.
   */
  get(index: number): T | undefined {
    if (index < 0 || index >= this._length) return undefined;

    let current = NIL;
    let pos = 0;

    for (let level = this._level; level >= 0; level--) {
      const fwd = this.forward[level];
      const sc = this.spanCounts[level];
      if (fwd === undefined || sc === undefined) continue;

      while (fwd[current] !== NIL) {
        const span = sc[current] ?? 0;
        if (pos + span <= index) {
          pos += span;
          current = fwd[current] ?? NIL;
        } else {
          break;
        }
      }
    }

    // current should now be the target node (pos == index means next is the item)
    const fwd0 = this.forward[0];
    if (fwd0 !== undefined && pos <= index) {
      const target = fwd0[current] ?? NIL;
      if (target !== NIL) {
        return this.items[target];
      }
    }

    return this.items[current] !== undefined && current !== NIL
      ? this.items[current]
      : undefined;
  }

  /**
   * Find an item using a dimension target. O(log n).
   * Returns the item and its position, or undefined.
   */
  findByDimension<D>(
    dimension: Dimension<S, D>,
    target: D,
    bias: SeekBias = "right",
  ): { item: T; index: number; localOffset: D } | undefined {
    if (this._length === 0) return undefined;

    let current = NIL;
    let accumulatedPos = dimension.zero();
    let itemIndex = 0;

    for (let level = this._level; level >= 0; level--) {
      const fwd = this.forward[level];
      const ss = this.spanSummaries[level];
      const sc = this.spanCounts[level];
      if (fwd === undefined || ss === undefined || sc === undefined) continue;

      while (fwd[current] !== NIL) {
        const spanSum = ss[current];
        if (spanSum === undefined) break;

        const spanMeasure = dimension.measure(spanSum);
        const nextPos = dimension.add(accumulatedPos, spanMeasure);
        const cmp = dimension.compare(nextPos, target);

        if (cmp < 0 || (cmp === 0 && bias === "right")) {
          accumulatedPos = nextPos;
          itemIndex += (sc[current] ?? 0);
          current = fwd[current] ?? NIL;
        } else {
          break;
        }
      }
    }

    // current is the last node before target at level 0
    const fwd0 = this.forward[0];
    if (fwd0 === undefined) return undefined;

    const targetNode = fwd0[current] ?? NIL;
    if (targetNode === NIL) return undefined;

    const item = this.items[targetNode];
    if (item === undefined) return undefined;

    // Compute local offset
    const itemMeasure = dimension.measure(item.summary());
    const itemStart = accumulatedPos;
    const itemEnd = dimension.add(itemStart, itemMeasure);

    // Check if target is within this item
    if (dimension.compare(itemEnd, target) >= 0) {
      return {
        item,
        index: itemIndex,
        localOffset: this.subtractDimension(dimension, target, itemStart),
      };
    }

    return undefined;
  }

  private subtractDimension<D>(_dimension: Dimension<S, D>, a: D, b: D): D {
    if (typeof a === "number" && typeof b === "number") {
      return (a - b) as D;
    }
    return a;
  }

  /**
   * Iterate all items in order. O(n).
   */
  forEach(callback: (item: T, index: number) => void): void {
    const fwd0 = this.forward[0];
    if (fwd0 === undefined) return;

    let current = fwd0[NIL] ?? NIL;
    let index = 0;

    while (current !== NIL) {
      const item = this.items[current];
      if (item !== undefined) {
        callback(item, index);
        index++;
      }
      current = fwd0[current] ?? NIL;
    }
  }

  /**
   * Convert to array. O(n).
   */
  toArray(): T[] {
    const result: T[] = [];
    this.forEach((item) => result.push(item));
    return result;
  }

  /**
   * Create a cursor for navigating the skip list in a given dimension.
   */
  cursor<D>(dimension: Dimension<S, D>): SkipListCursor<T, S, D> {
    return new SkipListCursor(this, dimension);
  }

  /**
   * Build a skip list from a sorted array of items.
   * O(n) construction with deterministic level assignment.
   */
  static fromSortedItems<T extends Summarizable<S>, S>(
    items: ReadonlyArray<T>,
    summaryOps: Summary<S>,
    seed = 42,
  ): SkipList<T, S> {
    const list = new SkipList<T, S>(summaryOps, seed);

    // Insert items in order - since they're already sorted,
    // each insert is at the end (finger search makes this fast after first)
    for (const item of items) {
      list.pushBack(item);
    }

    return list;
  }

  /**
   * Append an item to the end. O(1) amortized using cached tail pointers.
   */
  pushBack(item: T): number {
    const nodeLevel = this.randomLevel();
    const newIndex = this.allocateIndex();

    if (nodeLevel > this._level) {
      for (let i = this._level + 1; i <= nodeLevel; i++) {
        const sc = this.spanCounts[i];
        if (sc !== undefined) sc[NIL] = this._length;
        const ss = this.spanSummaries[i];
        if (ss !== undefined) ss[NIL] = this.summary();
        // New levels: tail is head sentinel
        this.tail[i] = NIL;
      }
      this._level = nodeLevel;
    }

    // Store item
    this.items[newIndex] = item;
    this.nodeSummaries[newIndex] = item.summary();
    this.heights[newIndex] = nodeLevel;

    const itemSummary = item.summary();

    // Wire up using cached tail pointers (O(level) instead of O(n * level))
    for (let level = 0; level <= this._level; level++) {
      const fwd = this.forward[level];
      const sc = this.spanCounts[level];
      const ss = this.spanSummaries[level];
      if (fwd === undefined || sc === undefined || ss === undefined) continue;

      const prev = this.tail[level] ?? NIL;

      if (level <= nodeLevel) {
        fwd[newIndex] = NIL;
        fwd[prev] = newIndex;
        sc[newIndex] = 0;
        sc[prev] = 1;
        // At level 0, span summary of prev = item summary of next node
        if (level === 0) {
          ss[prev] = itemSummary;
          ss[newIndex] = undefined;
        } else {
          this.recomputeSpanSummary(prev, level);
          ss[newIndex] = undefined;
        }
        // Update tail
        this.tail[level] = newIndex;
      } else {
        sc[prev] = (sc[prev] ?? 0) + 1;
        // Append to existing span summary
        const existingSpan = ss[prev];
        if (existingSpan !== undefined) {
          ss[prev] = this.summaryOps.combine(existingSpan, itemSummary);
        } else {
          ss[prev] = itemSummary;
        }
      }
    }

    this._length++;
    if (this._totalSummary !== undefined) {
      this._totalSummary = this.summaryOps.combine(this._totalSummary, itemSummary);
    } else {
      this._totalSummary = itemSummary;
    }
    this._finger = newIndex;
    return newIndex;
  }

  // ---------------------------------------------------------------------------
  // Internals for cursor
  // ---------------------------------------------------------------------------

  /** @internal Get the head sentinel's forward pointer at level 0. */
  _getFirstNode(): number {
    const fwd0 = this.forward[0];
    return fwd0 !== undefined ? (fwd0[NIL] ?? NIL) : NIL;
  }

  /** @internal Get item at a node index. */
  _getItem(nodeIndex: number): T | undefined {
    return this.items[nodeIndex];
  }

  /** @internal Get the next node at level 0. */
  _getNext(nodeIndex: number): number {
    const fwd0 = this.forward[0];
    return fwd0 !== undefined ? (fwd0[nodeIndex] ?? NIL) : NIL;
  }

  /** @internal Get the forward arrays for dimension seeking. */
  _getForward(): Uint32Array[] {
    return this.forward;
  }

  /** @internal Get span summaries. */
  _getSpanSummaries(): Array<Array<S | undefined>> {
    return this.spanSummaries;
  }

  /** @internal Get span counts. */
  _getSpanCounts(): Uint32Array[] {
    return this.spanCounts;
  }

  /** @internal Get current max level. */
  _getLevel(): number {
    return this._level;
  }

  // ---------------------------------------------------------------------------
  // Invariant checking (for tests)
  // ---------------------------------------------------------------------------

  /**
   * Verify skip list invariants. Returns an array of violation messages.
   */
  checkInvariants(): string[] {
    const violations: string[] = [];

    // Check length by walking level 0
    let count = 0;
    const fwd0 = this.forward[0];
    if (fwd0 !== undefined) {
      let current = fwd0[NIL] ?? NIL;
      while (current !== NIL) {
        count++;
        if (this.items[current] === undefined) {
          violations.push(`Node ${current} at level 0 has no item`);
        }
        current = fwd0[current] ?? NIL;
        if (count > this._capacity) {
          violations.push("Cycle detected in level 0");
          break;
        }
      }
    }
    if (count !== this._length) {
      violations.push(`Length mismatch: stored=${this._length}, actual=${count}`);
    }

    // Check ordering at level 0
    if (fwd0 !== undefined) {
      let current = fwd0[NIL] ?? NIL;
      let prev: T | undefined = undefined;
      while (current !== NIL) {
        const item = this.items[current];
        // Can't check ordering without a comparator, just check items exist
        prev = item;
        current = fwd0[current] ?? NIL;
      }
    }

    // Check that higher level nodes are a subset of lower level nodes
    for (let level = 1; level <= this._level; level++) {
      const fwd = this.forward[level];
      const lowerFwd = this.forward[level - 1];
      if (fwd === undefined || lowerFwd === undefined) continue;

      let current = fwd[NIL] ?? NIL;
      while (current !== NIL) {
        // This node must also be reachable at the lower level
        let found = false;
        let lower = lowerFwd[NIL] ?? NIL;
        let safetyCounter = 0;
        while (lower !== NIL && safetyCounter < this._capacity) {
          if (lower === current) {
            found = true;
            break;
          }
          lower = lowerFwd[lower] ?? NIL;
          safetyCounter++;
        }
        if (!found) {
          violations.push(`Node ${current} at level ${level} not found at level ${level - 1}`);
        }
        current = fwd[current] ?? NIL;
      }
    }

    return violations;
  }
}

/**
 * Cursor for navigating a SkipList in a given dimension.
 * Provides sequential access with position tracking.
 */
export class SkipListCursor<T extends Summarizable<S>, S, D> {
  private list: SkipList<T, S>;
  private dimension: Dimension<S, D>;
  private currentNode: number;
  private _position: D;
  private _atEnd: boolean;
  private _itemIndex: number;

  constructor(list: SkipList<T, S>, dimension: Dimension<S, D>) {
    this.list = list;
    this.dimension = dimension;
    this.currentNode = NIL;
    this._position = dimension.zero();
    this._atEnd = list.isEmpty();
    this._itemIndex = 0;
  }

  /** Current position in the dimension. */
  get position(): D {
    return this._position;
  }

  /** Whether cursor is past the last item. */
  get atEnd(): boolean {
    return this._atEnd;
  }

  /** Reset cursor to the beginning. */
  reset(): void {
    this._position = this.dimension.zero();
    this._itemIndex = 0;
    this.currentNode = this.list._getFirstNode();
    this._atEnd = this.list.isEmpty();
  }

  /** Get the current item. */
  item(): T | undefined {
    if (this._atEnd || this.currentNode === NIL) return undefined;
    return this.list._getItem(this.currentNode);
  }

  /** Get the current item index. */
  itemIndex(): number {
    return this._itemIndex;
  }

  /**
   * Seek forward to the given target position.
   * Returns true if an item was found at or near the target.
   */
  seekForward(target: D, bias: SeekBias = "right"): boolean {
    if (this._atEnd) return false;

    // Use skip list levels for efficient seeking
    const forward = this.list._getForward();
    const spanSummaries = this.list._getSpanSummaries();
    const spanCounts = this.list._getSpanCounts();
    const maxLevel = this.list._getLevel();

    // Start from current position or head
    let searchNode = this.currentNode === NIL ? NIL : this.currentNode;
    let searchPos = this._position;
    let searchIndex = this._itemIndex;

    // If we haven't started, search from head
    if (this.currentNode === NIL && !this._atEnd) {
      searchNode = NIL; // head sentinel
      searchPos = this.dimension.zero();
      searchIndex = 0;
    }

    // Descend through levels
    for (let level = maxLevel; level >= 0; level--) {
      const fwd = forward[level];
      const ss = spanSummaries[level];
      const sc = spanCounts[level];
      if (fwd === undefined || ss === undefined || sc === undefined) continue;

      while (fwd[searchNode] !== NIL) {
        const nextNode = fwd[searchNode] ?? NIL;
        const spanSum = ss[searchNode];
        if (spanSum === undefined) break;

        const spanMeasure = this.dimension.measure(spanSum);
        const nextPos = this.dimension.add(searchPos, spanMeasure);
        const cmp = this.dimension.compare(nextPos, target);

        if (cmp < 0 || (cmp === 0 && bias === "right")) {
          searchPos = nextPos;
          searchIndex += (sc[searchNode] ?? 0);
          searchNode = nextNode;
        } else {
          break;
        }
      }
    }

    // searchNode is now the last node before or at the target
    const fwd0 = forward[0];
    if (fwd0 === undefined) {
      this._atEnd = true;
      return false;
    }

    const targetNode = fwd0[searchNode] ?? NIL;
    if (targetNode === NIL) {
      this._atEnd = true;
      this._position = searchPos;
      this._itemIndex = searchIndex;
      return false;
    }

    this.currentNode = targetNode;
    this._position = searchPos;
    this._itemIndex = searchIndex;
    return true;
  }

  /** Move to the next item. Returns true if successful. */
  next(): boolean {
    if (this._atEnd) return false;

    const currentItem = this.list._getItem(this.currentNode);
    if (currentItem !== undefined) {
      const itemMeasure = this.dimension.measure(currentItem.summary());
      this._position = this.dimension.add(this._position, itemMeasure);
    }

    const nextNode = this.list._getNext(this.currentNode);
    if (nextNode === NIL) {
      this._atEnd = true;
      return false;
    }

    this.currentNode = nextNode;
    this._itemIndex++;
    return true;
  }

  /** Get items from current position to end. */
  suffix(): T[] {
    const result: T[] = [];
    if (this._atEnd) return result;

    let current = this.currentNode;
    while (current !== NIL) {
      const item = this.list._getItem(current);
      if (item !== undefined) {
        result.push(item);
      }
      current = this.list._getNext(current);
    }
    return result;
  }
}
