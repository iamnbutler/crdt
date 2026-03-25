// Sum tree data structure for efficient range queries
// A balanced B-tree where each node caches the monoidal sum of summaries in its subtree

import { Arena, INVALID_NODE_ID, type NodeId, nodeId } from "../arena/index.js";

export const SUM_TREE_VERSION = "0.1.0";

// Re-export arena types for convenience
export { type NodeId, INVALID_NODE_ID, nodeId };

// Default branching factor (fits 1 cache line for Uint32 summaries)
export const DEFAULT_BRANCHING_FACTOR = 16;

/**
 * Summary trait: a monoid over item summaries.
 * Summaries must support an identity element and an associative combine operation.
 */
export interface Summary<S> {
  /** The identity element (empty summary) */
  identity(): S;
  /** Combine two summaries (must be associative) */
  combine(left: S, right: S): S;
  /**
   * Optional: extract item count from a summary for O(log n) itemIndex().
   * If not provided, falls back to O(n) recursive counting.
   */
  getItemCount?(summary: S): number;
}

/**
 * Dimension trait: maps a summary to a comparable measure.
 * Used for seeking to positions in the tree.
 */
export interface Dimension<S, D> {
  /** Extract the dimension value from a summary */
  measure(summary: S): D;
  /** Compare two dimension values (returns negative if a < b, 0 if equal, positive if a > b) */
  compare(a: D, b: D): number;
  /** Add two dimension values */
  add(a: D, b: D): D;
  /** The zero value for this dimension */
  zero(): D;
}

/**
 * Item trait: items stored in the tree must be summarizable.
 */
export interface Summarizable<S> {
  /** Compute the summary for this item */
  summary(): S;
}

/**
 * Bias for cursor seeking: whether to land before or after the target.
 */
export type SeekBias = "left" | "right";

/**
 * Position in a cursor stack: (nodeId, childIndex, accumulatedPosition)
 */
interface StackEntry<D> {
  nodeId: NodeId;
  childIndex: number;
  position: D;
}

/**
 * Cursor for navigating the SumTree.
 * Maintains a stack of (nodeId, childIndex) pairs with accumulated position.
 */
export class Cursor<T extends Summarizable<S>, S, D> {
  private tree: SumTree<T, S>;
  private dimension: Dimension<S, D>;
  private stack: Array<StackEntry<D>>;
  private _position: D;
  private _atEnd: boolean;

  constructor(tree: SumTree<T, S>, dimension: Dimension<S, D>) {
    this.tree = tree;
    this.dimension = dimension;
    this.stack = [];
    this._position = dimension.zero();
    this._atEnd = tree.isEmpty();
  }

  /** Current position in the dimension */
  get position(): D {
    return this._position;
  }

  /** Whether cursor is past the last item */
  get atEnd(): boolean {
    return this._atEnd;
  }

  /** Reset cursor to the beginning */
  reset(): void {
    this.stack = [];
    this._position = this.dimension.zero();
    this._atEnd = this.tree.isEmpty();

    if (!this._atEnd) {
      this.descendToLeftmost(this.tree.root);
    }
  }

  /**
   * Seek forward to the given target position.
   * Returns true if an item was found at or near the target.
   */
  seekForward(target: D, bias: SeekBias = "right"): boolean {
    if (this._atEnd) {
      return false;
    }

    if (this.stack.length === 0) {
      this.reset();
    }

    // If we're already past the target, can't seek forward
    if (this.dimension.compare(this._position, target) > 0) {
      return true; // Already past it
    }

    return this.seekFromCurrent(target, bias);
  }

  /**
   * Move to the next item.
   * Returns false if already at end.
   */
  next(): boolean {
    if (this._atEnd) {
      return false;
    }

    // Get current item summary and advance position
    const item = this.item();
    if (item !== undefined) {
      const itemSummary = item.summary();
      const itemMeasure = this.dimension.measure(itemSummary);
      this._position = this.dimension.add(this._position, itemMeasure);
    }

    // Try to move to next sibling or ascend
    return this.advanceToNext();
  }

  /**
   * Move to the previous item.
   * Returns false if already at beginning.
   */
  prev(): boolean {
    if (this.stack.length === 0) {
      return false;
    }

    // Try to move to previous sibling
    const top = this.stack[this.stack.length - 1];
    if (top === undefined) {
      return false;
    }

    if (top.childIndex > 0) {
      // Move to previous sibling
      top.childIndex--;

      // If internal node, descend to rightmost leaf
      const arena = this.tree.getArena();
      if (arena.isInternal(top.nodeId)) {
        const childId = arena.getChild(top.nodeId, top.childIndex);
        if (childId !== INVALID_NODE_ID) {
          this.descendToRightmost(childId);
        }
      }

      // Update position (subtract previous items)
      this.recalculatePosition();
      this._atEnd = false;
      return true;
    }

    // Ascend to parent
    this.stack.pop();
    if (this.stack.length === 0) {
      // At beginning
      this.reset();
      return false;
    }

    return this.prev();
  }

  /**
   * Get the current item at cursor position.
   * Returns undefined if cursor is at end or at an internal node boundary.
   */
  item(): T | undefined {
    if (this._atEnd || this.stack.length === 0) {
      return undefined;
    }

    const top = this.stack[this.stack.length - 1];
    if (top === undefined) {
      return undefined;
    }

    const arena = this.tree.getArena();
    if (!arena.isLeaf(top.nodeId)) {
      return undefined;
    }

    const leafItems = this.tree.getLeafItems(top.nodeId);
    return leafItems[top.childIndex];
  }

  /**
   * Get the summary of remaining items from cursor to end.
   * Includes the current item.
   */
  suffix(): S {
    const summaryOps = this.tree.getSummaryOps();
    if (this._atEnd) {
      return summaryOps.identity();
    }

    // Sum from current position to end.
    // Walk from the deepest stack entry (leaf) upward to root.
    // For leaf entries, sum items from childIndex onward.
    // For internal entries, find the child that was descended into
    // (identified by the next deeper entry's nodeId) and sum children
    // strictly AFTER that child. This avoids double-counting the subtree
    // already accounted for by the deeper stack entry.
    let result = summaryOps.identity();
    const arena = this.tree.getArena();

    for (let i = this.stack.length - 1; i >= 0; i--) {
      const entry = this.stack[i];
      if (entry === undefined) continue;

      const count = arena.getCount(entry.nodeId);

      if (arena.isLeaf(entry.nodeId)) {
        // Leaf: sum items from childIndex (current item) onward
        const leafItems = this.tree.getLeafItems(entry.nodeId);
        for (let j = entry.childIndex; j < count; j++) {
          const item = leafItems[j];
          if (item !== undefined) {
            result = summaryOps.combine(result, item.summary());
          }
        }
      } else {
        // Internal node: find which child the deeper entry descended into,
        // then sum only the children AFTER it.
        const deeperEntry = this.stack[i + 1];
        let startJ = entry.childIndex;

        if (deeperEntry !== undefined) {
          // Find the child index that matches the deeper entry's nodeId
          for (let j = 0; j < count; j++) {
            if (arena.getChild(entry.nodeId, j) === deeperEntry.nodeId) {
              startJ = j + 1;
              break;
            }
          }
        }

        for (let j = startJ; j < count; j++) {
          const childId = arena.getChild(entry.nodeId, j);
          if (childId !== INVALID_NODE_ID) {
            const childSummary = this.tree.getSummary(childId);
            if (childSummary !== undefined) {
              result = summaryOps.combine(result, childSummary);
            }
          }
        }
      }
    }

    return result;
  }

  private seekFromCurrent(target: D, bias: SeekBias): boolean {
    const arena = this.tree.getArena();

    // Navigate through the tree to find the target
    while (this.stack.length > 0) {
      const top = this.stack[this.stack.length - 1];
      if (top === undefined) break;

      if (arena.isLeaf(top.nodeId)) {
        // At a leaf, scan items
        return this.scanLeaf(top, target, bias);
      }

      // At internal node, find the right child
      const found = this.findChildForTarget(top, target, bias);
      if (!found) {
        // Need to ascend
        if (!this.ascendAndContinue(target, bias)) {
          this._atEnd = true;
          return false;
        }
      }
    }

    return !this._atEnd;
  }

  private scanLeaf(entry: StackEntry<D>, target: D, bias: SeekBias): boolean {
    const leafItems = this.tree.getLeafItems(entry.nodeId);
    const arena = this.tree.getArena();
    const count = arena.getCount(entry.nodeId);

    let pos = entry.position;

    for (let i = entry.childIndex; i < count; i++) {
      const item = leafItems[i];
      if (item === undefined) continue;

      const itemSummary = item.summary();
      const itemMeasure = this.dimension.measure(itemSummary);
      const nextPos = this.dimension.add(pos, itemMeasure);

      const cmp = this.dimension.compare(nextPos, target);

      if (cmp > 0 || (cmp === 0 && bias === "left")) {
        // Found it
        entry.childIndex = i;
        entry.position = pos;
        this._position = pos;
        return true;
      }

      pos = nextPos;
    }

    // Target is past this leaf
    this._position = pos;
    entry.childIndex = count;
    return this.ascendAndContinue(target, bias);
  }

  private findChildForTarget(entry: StackEntry<D>, target: D, bias: SeekBias): boolean {
    const arena = this.tree.getArena();
    const count = arena.getCount(entry.nodeId);

    let pos = entry.position;

    for (let i = entry.childIndex; i < count; i++) {
      const childId = arena.getChild(entry.nodeId, i);
      if (childId === INVALID_NODE_ID) continue;

      const childSummary = this.tree.getSummary(childId);
      if (childSummary === undefined) continue;

      const childMeasure = this.dimension.measure(childSummary);
      const nextPos = this.dimension.add(pos, childMeasure);

      const cmp = this.dimension.compare(nextPos, target);

      if (cmp > 0 || (cmp === 0 && bias === "left")) {
        // Target is in this child
        entry.childIndex = i + 1; // Mark we've processed up to here
        this.stack.push({
          nodeId: childId,
          childIndex: 0,
          position: pos,
        });
        return true;
      }

      pos = nextPos;
    }

    // Target is past all children
    entry.position = pos;
    entry.childIndex = count;
    return false;
  }

  private ascendAndContinue(target: D, bias: SeekBias): boolean {
    this.stack.pop();
    if (this.stack.length === 0) {
      this._atEnd = true;
      return false;
    }
    return this.seekFromCurrent(target, bias);
  }

  private advanceToNext(): boolean {
    if (this.stack.length === 0) {
      this._atEnd = true;
      return false;
    }

    const arena = this.tree.getArena();
    const top = this.stack[this.stack.length - 1];
    if (top === undefined) {
      this._atEnd = true;
      return false;
    }

    const count = arena.getCount(top.nodeId);

    // Try to move to next sibling
    if (top.childIndex + 1 < count) {
      top.childIndex++;

      if (arena.isInternal(top.nodeId)) {
        const childId = arena.getChild(top.nodeId, top.childIndex);
        if (childId !== INVALID_NODE_ID) {
          this.descendToLeftmost(childId);
        }
      }
      return true;
    }

    // Ascend to parent and try again
    this.stack.pop();
    return this.advanceToNext();
  }

  private descendToLeftmost(nodeId: NodeId): void {
    const arena = this.tree.getArena();
    let current = nodeId;
    const pos = this._position;

    while (arena.isInternal(current)) {
      this.stack.push({
        nodeId: current,
        childIndex: 0,
        position: pos,
      });
      const firstChild = arena.getChild(current, 0);
      if (firstChild === INVALID_NODE_ID) break;
      current = firstChild;
    }

    // Push the leaf
    this.stack.push({
      nodeId: current,
      childIndex: 0,
      position: pos,
    });
  }

  private descendToRightmost(nodeId: NodeId): void {
    const arena = this.tree.getArena();
    let current = nodeId;

    while (arena.isInternal(current)) {
      const count = arena.getCount(current);
      const lastIndex = Math.max(0, count - 1);
      this.stack.push({
        nodeId: current,
        childIndex: lastIndex,
        position: this._position, // Will be recalculated
      });
      const lastChild = arena.getChild(current, lastIndex);
      if (lastChild === INVALID_NODE_ID) break;
      current = lastChild;
    }

    // Push the leaf
    const leafCount = arena.getCount(current);
    this.stack.push({
      nodeId: current,
      childIndex: Math.max(0, leafCount - 1),
      position: this._position,
    });
  }

  private recalculatePosition(): void {
    // Recalculate position by summing from root
    this._position = this.dimension.zero();
    const arena = this.tree.getArena();

    for (let i = 0; i < this.stack.length; i++) {
      const entry = this.stack[i];
      if (entry === undefined) continue;

      entry.position = this._position;

      // Sum all siblings before current index
      for (let j = 0; j < entry.childIndex; j++) {
        if (arena.isLeaf(entry.nodeId)) {
          const leafItems = this.tree.getLeafItems(entry.nodeId);
          const item = leafItems[j];
          if (item !== undefined) {
            const itemMeasure = this.dimension.measure(item.summary());
            this._position = this.dimension.add(this._position, itemMeasure);
          }
        } else {
          const childId = arena.getChild(entry.nodeId, j);
          if (childId !== INVALID_NODE_ID) {
            const childSummary = this.tree.getSummary(childId);
            if (childSummary !== undefined) {
              const childMeasure = this.dimension.measure(childSummary);
              this._position = this.dimension.add(this._position, childMeasure);
            }
          }
        }
      }
    }
  }

  /**
   * Get the 0-based item index of the current cursor position.
   * Returns the number of items before the current position.
   * O(log n) if the summary supports getItemCount, O(n) otherwise.
   */
  itemIndex(): number {
    if (this._atEnd) {
      return this.tree.length();
    }

    let index = 0;
    const arena = this.tree.getArena();
    const summaryOps = this.tree.getSummaryOps();

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
            // Use O(1) summary lookup if available, otherwise O(subtree) traversal
            const getItemCount = summaryOps.getItemCount;
            if (getItemCount !== undefined) {
              const summary = this.tree.getSummary(childId);
              if (summary !== undefined) {
                index += getItemCount(summary);
              }
            } else {
              index += this.tree.countItems(childId);
            }
          }
        }
      }
    }

    return index;
  }
}

/**
 * Internal node data stored separately (for items array in leaves).
 */
interface LeafData<T> {
  items: T[];
}

/**
 * SumTree: a balanced B-tree with monoidal summary caching.
 *
 * Generic parameters:
 * - T: item type (must implement Summarizable<S>)
 * - S: summary type
 */
export class SumTree<T extends Summarizable<S>, S> {
  private arena: Arena<LeafData<T>>;
  private summaries: Map<NodeId, S>;
  private _root: NodeId;
  private summaryOps: Summary<S>;
  private branchingFactor: number;

  constructor(summaryOps: Summary<S>, branchingFactor = DEFAULT_BRANCHING_FACTOR) {
    this.arena = new Arena<LeafData<T>>();
    this.summaries = new Map();
    this.summaryOps = summaryOps;
    this.branchingFactor = branchingFactor;

    // Create empty root leaf
    this._root = this.createLeaf([]);
  }

  /** Get the root node ID */
  get root(): NodeId {
    return this._root;
  }

  /** Check if tree is empty */
  isEmpty(): boolean {
    return this.arena.getCount(this._root) === 0;
  }

  /** Get the total summary of the tree */
  summary(): S {
    const s = this.summaries.get(this._root);
    return s ?? this.summaryOps.identity();
  }

  /** Get summary ops for external use */
  getSummaryOps(): Summary<S> {
    return this.summaryOps;
  }

  /** Get arena for cursor use */
  getArena(): Arena<LeafData<T>> {
    return this.arena;
  }

  /** Get summary of a specific node */
  getSummary(nodeId: NodeId): S | undefined {
    return this.summaries.get(nodeId);
  }

  /** Get leaf items for cursor use */
  getLeafItems(nodeId: NodeId): T[] {
    const data = this.arena.getItem(nodeId);
    return data?.items ?? [];
  }

  /**
   * Create a cursor for navigating the tree in the given dimension.
   */
  cursor<D>(dimension: Dimension<S, D>): Cursor<T, S, D> {
    const c = new Cursor<T, S, D>(this, dimension);
    c.reset();
    return c;
  }

  /**
   * Push an item to the end of the tree.
   * Returns a new tree (path copying), leaving the original unchanged.
   */
  push(item: T): SumTree<T, S> {
    return this.insertAt(this.length(), item);
  }

  /**
   * Insert an item at the given index.
   * Returns a new tree (path copying), leaving the original unchanged.
   */
  insertAt(index: number, item: T): SumTree<T, S> {
    const newTree = this.shallowClone();

    // Find the leaf and position for insertion
    const path = newTree.findLeafForIndex(index);
    if (path.length === 0) {
      // Empty tree, insert into root
      const items = [item];
      newTree._root = newTree.createLeaf(items);
      return newTree;
    }

    // Clone the path (path copying)
    const clonedPath = newTree.clonePath(path);

    // Insert into the leaf
    const leafEntry = clonedPath[clonedPath.length - 1];
    if (leafEntry === undefined) {
      return newTree;
    }

    const leafData = newTree.arena.getItem(leafEntry.nodeId);
    const items = leafData?.items ?? [];
    items.splice(leafEntry.indexInNode, 0, item);

    // Update leaf
    newTree.arena.setItem(leafEntry.nodeId, { items });
    newTree.arena.setCount(leafEntry.nodeId, items.length);

    // Check for overflow and split if needed
    if (items.length > newTree.branchingFactor) {
      newTree.splitAndPropagate(clonedPath);
    } else {
      // Just update summaries up the path
      newTree.updateSummariesUp(clonedPath);
    }

    return newTree;
  }

  /**
   * Remove item at the given index.
   * Returns a new tree (path copying), leaving the original unchanged.
   */
  removeAt(index: number): SumTree<T, S> {
    if (index < 0 || index >= this.length()) {
      throw new Error(`Index ${index} out of bounds`);
    }

    const newTree = this.shallowClone();
    const path = newTree.findLeafForIndex(index);
    if (path.length === 0) {
      return newTree;
    }

    // Clone the path
    const clonedPath = newTree.clonePath(path);

    // Remove from the leaf
    const leafEntry = clonedPath[clonedPath.length - 1];
    if (leafEntry === undefined) {
      return newTree;
    }

    const leafData = newTree.arena.getItem(leafEntry.nodeId);
    const items = leafData?.items ?? [];
    items.splice(leafEntry.indexInNode, 1);

    // Update leaf
    newTree.arena.setItem(leafEntry.nodeId, { items });
    newTree.arena.setCount(leafEntry.nodeId, items.length);

    // Check for underflow and merge if needed
    const minItems = Math.floor(newTree.branchingFactor / 2);
    if (items.length < minItems && clonedPath.length > 1) {
      newTree.mergeOrRedistribute(clonedPath);
    } else {
      newTree.updateSummariesUp(clonedPath);
    }

    return newTree;
  }

  /**
   * Get item at index.
   */
  get(index: number): T | undefined {
    if (index < 0 || index >= this.length()) {
      return undefined;
    }

    const path = this.findLeafForIndex(index);
    const leafEntry = path[path.length - 1];
    if (leafEntry === undefined) {
      return undefined;
    }

    const leafData = this.arena.getItem(leafEntry.nodeId);
    return leafData?.items[leafEntry.indexInNode];
  }

  /**
   * Get the number of items in the tree.
   * O(1) if the summary supports getItemCount, O(n) otherwise.
   */
  length(): number {
    if (this.summaryOps.getItemCount !== undefined) {
      const summary = this.summaries.get(this._root);
      if (summary !== undefined) {
        return this.summaryOps.getItemCount(summary);
      }
    }
    return this.countItems(this._root);
  }

  /**
   * Split the tree at position, returning [left, right] trees.
   * Both trees are new (original unchanged via path copying).
   */
  slice(position: number): [SumTree<T, S>, SumTree<T, S>] {
    const len = this.length();
    if (position <= 0) {
      return [new SumTree<T, S>(this.summaryOps, this.branchingFactor), this.shallowClone()];
    }
    if (position >= len) {
      return [this.shallowClone(), new SumTree<T, S>(this.summaryOps, this.branchingFactor)];
    }

    // Build left and right trees by collecting items
    const leftItems: T[] = [];
    const rightItems: T[] = [];

    this.forEach((item, idx) => {
      if (idx < position) {
        leftItems.push(item);
      } else {
        rightItems.push(item);
      }
    });

    return [
      SumTree.fromItems(leftItems, this.summaryOps, this.branchingFactor),
      SumTree.fromItems(rightItems, this.summaryOps, this.branchingFactor),
    ];
  }

  /**
   * Concatenate two trees, returning a new tree.
   * Both input trees are unchanged (path copying).
   */
  static concat<T extends Summarizable<S>, S>(
    left: SumTree<T, S>,
    right: SumTree<T, S>,
  ): SumTree<T, S> {
    // Collect all items from both trees
    const items: T[] = [...left.toArray(), ...right.toArray()];
    return SumTree.fromItems(items, left.summaryOps, left.branchingFactor);
  }

  /**
   * Create a tree from an array of items.
   */
  static fromItems<T extends Summarizable<S>, S>(
    items: T[],
    summaryOps: Summary<S>,
    branchingFactor = DEFAULT_BRANCHING_FACTOR,
  ): SumTree<T, S> {
    const tree = new SumTree<T, S>(summaryOps, branchingFactor);

    if (items.length === 0) {
      return tree;
    }

    // Build bottom-up for efficiency
    const leaves: NodeId[] = [];
    const minItems = Math.floor(branchingFactor / 2);

    // Calculate how to split items into leaves
    const numFullLeaves = Math.floor(items.length / branchingFactor);
    const remainder = items.length % branchingFactor;

    // If remainder would create an underflow leaf, redistribute
    if (remainder > 0 && remainder < minItems && numFullLeaves > 0) {
      // Take items from the last full leaf to balance
      // Split the last (branchingFactor + remainder) items into 2 leaves
      const lastTwoItemCount = branchingFactor + remainder;
      const firstHalf = Math.ceil(lastTwoItemCount / 2);

      // Create all but last leaf normally
      for (let i = 0; i < (numFullLeaves - 1) * branchingFactor; i += branchingFactor) {
        const chunk = items.slice(i, i + branchingFactor);
        const leafId = tree.createLeaf(chunk);
        leaves.push(leafId);
      }

      // Split the last batch into two leaves
      const startIdx = (numFullLeaves - 1) * branchingFactor;
      const chunk1 = items.slice(startIdx, startIdx + firstHalf);
      const chunk2 = items.slice(startIdx + firstHalf);
      leaves.push(tree.createLeaf(chunk1));
      leaves.push(tree.createLeaf(chunk2));
    } else {
      // Normal case: create leaves in chunks
      for (let i = 0; i < items.length; i += branchingFactor) {
        const chunk = items.slice(i, i + branchingFactor);
        const leafId = tree.createLeaf(chunk);
        leaves.push(leafId);
      }
    }

    tree._root = tree.buildFromLeaves(leaves);
    return tree;
  }

  /**
   * Iterate over all items in order.
   */
  forEach(callback: (item: T, index: number) => void): void {
    let index = 0;
    this.forEachNode(this._root, (item) => {
      callback(item, index++);
    });
  }

  /**
   * Convert tree to array.
   */
  toArray(): T[] {
    const result: T[] = [];
    this.collectItems(this._root, result);
    return result;
  }

  private collectItems(nodeId: NodeId, result: T[]): void {
    if (this.arena.isLeaf(nodeId)) {
      const data = this.arena.getItem(nodeId);
      if (data) {
        for (const item of data.items) {
          result.push(item);
        }
      }
      return;
    }

    const children = this.arena.getChildren(nodeId);
    for (const childId of children) {
      this.collectItems(childId, result);
    }
  }

  /**
   * Check tree invariants (for testing).
   */
  checkInvariants(): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Check 1: All leaves at same depth
    const depths = new Set<number>();
    this.collectLeafDepths(this._root, 0, depths);
    if (depths.size > 1) {
      errors.push(`Leaves at different depths: ${[...depths].join(", ")}`);
    }

    // Check 2: Parent summary = monoidal sum of children
    this.checkSummaryInvariants(this._root, errors);

    // Check 3: Node counts within bounds (except root)
    this.checkCountInvariants(this._root, true, errors);

    return { valid: errors.length === 0, errors };
  }

  // === Private methods ===

  private createLeaf(items: T[]): NodeId {
    const id = this.arena.allocate();
    this.arena.setLeaf(id, items.length);
    this.arena.setItem(id, { items });
    this.arena.setHeight(id, 0);

    // Compute summary
    let summary = this.summaryOps.identity();
    for (const item of items) {
      summary = this.summaryOps.combine(summary, item.summary());
    }
    this.summaries.set(id, summary);

    return id;
  }

  private createInternal(children: NodeId[]): NodeId {
    const id = this.arena.allocate();
    this.arena.setInternal(id, children.length, children);

    // Height is max child height + 1
    let maxHeight = 0;
    for (const childId of children) {
      maxHeight = Math.max(maxHeight, this.arena.getHeight(childId));
    }
    this.arena.setHeight(id, maxHeight + 1);

    // Compute summary
    let summary = this.summaryOps.identity();
    for (const childId of children) {
      const childSummary = this.summaries.get(childId);
      if (childSummary !== undefined) {
        summary = this.summaryOps.combine(summary, childSummary);
      }
    }
    this.summaries.set(id, summary);

    return id;
  }

  /**
   * Count items in a subtree.
   * Public to allow Cursor.itemIndex() to use it.
   */
  countItems(nodeId: NodeId): number {
    if (this.arena.isLeaf(nodeId)) {
      return this.arena.getCount(nodeId);
    }

    let count = 0;
    const children = this.arena.getChildren(nodeId);
    for (const childId of children) {
      count += this.countItems(childId);
    }
    return count;
  }

  private forEachNode(nodeId: NodeId, callback: (item: T) => void): void {
    if (this.arena.isLeaf(nodeId)) {
      const data = this.arena.getItem(nodeId);
      if (data) {
        for (const item of data.items) {
          callback(item);
        }
      }
      return;
    }

    const children = this.arena.getChildren(nodeId);
    for (const childId of children) {
      this.forEachNode(childId, callback);
    }
  }

  /**
   * Create a shallow clone of this tree for O(1) snapshot creation.
   * The clone shares the arena with the original (immutable view via path copying).
   * This is O(1) as it only copies the root NodeId and creates a new summaries Map.
   */
  snapshotClone(): SumTree<T, S> {
    return this.shallowClone();
  }

  private shallowClone(): SumTree<T, S> {
    const newTree = new SumTree<T, S>(this.summaryOps, this.branchingFactor);
    newTree.arena = this.arena; // Share arena (immutable view via path copying)
    newTree.summaries = new Map(this.summaries);
    newTree._root = this._root;
    return newTree;
  }

  private findLeafForIndex(index: number): Array<{ nodeId: NodeId; indexInNode: number }> {
    const path: Array<{ nodeId: NodeId; indexInNode: number }> = [];
    let remaining = index;
    let current = this._root;

    while (true) {
      if (this.arena.isLeaf(current)) {
        const count = this.arena.getCount(current);
        path.push({
          nodeId: current,
          indexInNode: Math.min(remaining, count),
        });
        break;
      }

      const children = this.arena.getChildren(current);
      let found = false;

      for (let i = 0; i < children.length; i++) {
        const childId = children[i];
        if (childId === undefined) continue;

        // Use O(1) summary lookup if available, otherwise O(subtree) traversal
        let childCount: number;
        const getItemCount = this.summaryOps.getItemCount;
        if (getItemCount !== undefined) {
          const summary = this.summaries.get(childId);
          childCount = summary !== undefined ? getItemCount(summary) : this.countItems(childId);
        } else {
          childCount = this.countItems(childId);
        }

        if (remaining < childCount || i === children.length - 1) {
          path.push({ nodeId: current, indexInNode: i });
          current = childId;
          found = true;
          break;
        }

        remaining -= childCount;
      }

      if (!found) break;
    }

    return path;
  }

  private clonePath(
    path: Array<{ nodeId: NodeId; indexInNode: number }>,
  ): Array<{ nodeId: NodeId; indexInNode: number }> {
    const clonedPath: Array<{ nodeId: NodeId; indexInNode: number }> = [];
    let prevClonedId: NodeId = INVALID_NODE_ID;

    for (let i = path.length - 1; i >= 0; i--) {
      const entry = path[i];
      if (entry === undefined) continue;

      const clonedId = this.cloneNode(entry.nodeId);

      // Update child pointer if we cloned a child
      if (prevClonedId !== INVALID_NODE_ID && this.arena.isInternal(clonedId)) {
        const children = this.arena.getChildren(clonedId);
        children[entry.indexInNode] = prevClonedId;
        this.arena.setChildren(clonedId, children);
      }

      clonedPath.unshift({ nodeId: clonedId, indexInNode: entry.indexInNode });
      prevClonedId = clonedId;
    }

    // Update root if needed
    if (clonedPath.length > 0) {
      const firstEntry = clonedPath[0];
      if (firstEntry !== undefined) {
        this._root = firstEntry.nodeId;
      }
    }

    return clonedPath;
  }

  private cloneNode(nodeId: NodeId): NodeId {
    const clonedId = this.arena.clone(nodeId);

    // Copy summary
    const summary = this.summaries.get(nodeId);
    if (summary !== undefined) {
      this.summaries.set(clonedId, summary);
    }

    // Deep copy leaf items if leaf
    if (this.arena.isLeaf(nodeId)) {
      const data = this.arena.getItem(nodeId);
      if (data) {
        this.arena.setItem(clonedId, { items: [...data.items] });
      }
    }

    return clonedId;
  }

  private splitAndPropagate(path: Array<{ nodeId: NodeId; indexInNode: number }>): void {
    let i = path.length - 1;

    while (i >= 0) {
      const entry = path[i];
      if (entry === undefined) {
        i--;
        continue;
      }

      const nodeId = entry.nodeId;
      const count = this.arena.isLeaf(nodeId)
        ? this.arena.getCount(nodeId)
        : this.arena.getChildren(nodeId).length;

      if (count <= this.branchingFactor) {
        // No more splits needed, just update summaries
        this.updateSummary(nodeId);
        i--;
        continue;
      }

      // Need to split
      const [leftId, rightId] = this.splitNode(nodeId);

      if (i === 0) {
        // Splitting root - create new root
        this._root = this.createInternal([leftId, rightId]);
        return;
      }

      // Insert right node into parent
      const parentEntry = path[i - 1];
      if (parentEntry === undefined) {
        i--;
        continue;
      }

      const parentChildren = this.arena.getChildren(parentEntry.nodeId);
      parentChildren[parentEntry.indexInNode] = leftId;
      parentChildren.splice(parentEntry.indexInNode + 1, 0, rightId);
      this.arena.setChildren(parentEntry.nodeId, parentChildren);

      i--;
    }

    this.updateSummariesUp(path);
  }

  private splitNode(nodeId: NodeId): [NodeId, NodeId] {
    const mid = Math.floor(this.branchingFactor / 2);

    if (this.arena.isLeaf(nodeId)) {
      const data = this.arena.getItem(nodeId);
      const items = data?.items ?? [];

      const leftItems = items.slice(0, mid);
      const rightItems = items.slice(mid);

      const leftId = this.createLeaf(leftItems);
      const rightId = this.createLeaf(rightItems);

      return [leftId, rightId];
    }

    const children = this.arena.getChildren(nodeId);
    const leftChildren = children.slice(0, mid);
    const rightChildren = children.slice(mid);

    const leftId = this.createInternal(leftChildren);
    const rightId = this.createInternal(rightChildren);

    return [leftId, rightId];
  }

  private mergeOrRedistribute(path: Array<{ nodeId: NodeId; indexInNode: number }>): void {
    const minItems = Math.floor(this.branchingFactor / 2);

    for (let i = path.length - 1; i >= 0; i--) {
      const entry = path[i];
      if (entry === undefined) continue;

      const nodeId = entry.nodeId;
      const count = this.arena.isLeaf(nodeId)
        ? this.arena.getCount(nodeId)
        : this.arena.getChildren(nodeId).length;

      // Root can have any number of children (down to 0)
      if (i === 0) {
        // If root is internal with single child, make child the new root
        if (this.arena.isInternal(nodeId) && count === 1) {
          const children = this.arena.getChildren(nodeId);
          const onlyChild = children[0];
          if (onlyChild !== undefined) {
            this._root = onlyChild;
          }
        }
        this.updateSummary(nodeId);
        continue;
      }

      if (count >= minItems) {
        this.updateSummary(nodeId);
        continue;
      }

      // Need to merge or redistribute
      const parentEntry = path[i - 1];
      if (parentEntry === undefined) continue;

      const parentChildren = this.arena.getChildren(parentEntry.nodeId);
      const siblingIndex =
        parentEntry.indexInNode > 0 ? parentEntry.indexInNode - 1 : parentEntry.indexInNode + 1;

      const siblingId = parentChildren[siblingIndex];
      if (siblingId === undefined) {
        this.updateSummary(nodeId);
        continue;
      }

      const siblingCount = this.arena.isLeaf(siblingId)
        ? this.arena.getCount(siblingId)
        : this.arena.getChildren(siblingId).length;

      if (count + siblingCount <= this.branchingFactor) {
        // Merge
        this.mergeNodes(path, i, siblingIndex);
      } else {
        // Redistribute
        this.redistributeNodes(nodeId, siblingId, siblingIndex < parentEntry.indexInNode);
        this.updateSummary(nodeId);
        this.updateSummary(siblingId);
      }
    }
  }

  private mergeNodes(
    path: Array<{ nodeId: NodeId; indexInNode: number }>,
    nodeIndex: number,
    siblingIndex: number,
  ): void {
    const entry = path[nodeIndex];
    const parentEntry = path[nodeIndex - 1];
    if (entry === undefined || parentEntry === undefined) return;

    const nodeId = entry.nodeId;
    const parentChildren = this.arena.getChildren(parentEntry.nodeId);
    const siblingId = parentChildren[siblingIndex];
    if (siblingId === undefined) return;

    // Determine left and right
    const [leftId, rightId] =
      siblingIndex < parentEntry.indexInNode ? [siblingId, nodeId] : [nodeId, siblingId];

    if (this.arena.isLeaf(leftId)) {
      // Merge leaf items
      const leftData = this.arena.getItem(leftId);
      const rightData = this.arena.getItem(rightId);
      const mergedItems = [...(leftData?.items ?? []), ...(rightData?.items ?? [])];
      this.arena.setItem(leftId, { items: mergedItems });
      this.arena.setCount(leftId, mergedItems.length);
    } else {
      // Merge internal children
      const leftChildren = this.arena.getChildren(leftId);
      const rightChildren = this.arena.getChildren(rightId);
      this.arena.setChildren(leftId, [...leftChildren, ...rightChildren]);
    }

    this.updateSummary(leftId);

    // Remove the right node from parent
    const removeIndex =
      siblingIndex < parentEntry.indexInNode ? parentEntry.indexInNode : siblingIndex;
    parentChildren.splice(removeIndex, 1);
    this.arena.setChildren(parentEntry.nodeId, parentChildren);

    // Update path entry if we merged into sibling
    if (siblingIndex < parentEntry.indexInNode) {
      entry.nodeId = leftId;
      entry.indexInNode = siblingIndex;
    }
  }

  private redistributeNodes(nodeId: NodeId, siblingId: NodeId, siblingIsLeft: boolean): void {
    if (this.arena.isLeaf(nodeId)) {
      const nodeData = this.arena.getItem(nodeId);
      const siblingData = this.arena.getItem(siblingId);
      const nodeItems = nodeData?.items ?? [];
      const siblingItems = siblingData?.items ?? [];

      const total = [...siblingItems, ...nodeItems];
      if (!siblingIsLeft) {
        total.reverse();
      }

      const mid = Math.floor(total.length / 2);
      const leftItems = total.slice(0, mid);
      const rightItems = total.slice(mid);

      if (siblingIsLeft) {
        this.arena.setItem(siblingId, { items: leftItems });
        this.arena.setCount(siblingId, leftItems.length);
        this.arena.setItem(nodeId, { items: rightItems });
        this.arena.setCount(nodeId, rightItems.length);
      } else {
        this.arena.setItem(nodeId, { items: leftItems });
        this.arena.setCount(nodeId, leftItems.length);
        this.arena.setItem(siblingId, { items: rightItems });
        this.arena.setCount(siblingId, rightItems.length);
      }
    } else {
      const nodeChildren = this.arena.getChildren(nodeId);
      const siblingChildren = this.arena.getChildren(siblingId);

      const total = siblingIsLeft
        ? [...siblingChildren, ...nodeChildren]
        : [...nodeChildren, ...siblingChildren];

      const mid = Math.floor(total.length / 2);

      if (siblingIsLeft) {
        this.arena.setChildren(siblingId, total.slice(0, mid));
        this.arena.setChildren(nodeId, total.slice(mid));
      } else {
        this.arena.setChildren(nodeId, total.slice(0, mid));
        this.arena.setChildren(siblingId, total.slice(mid));
      }
    }
  }

  private updateSummariesUp(path: Array<{ nodeId: NodeId; indexInNode: number }>): void {
    for (let i = path.length - 1; i >= 0; i--) {
      const entry = path[i];
      if (entry === undefined) continue;
      this.updateSummary(entry.nodeId);
    }
  }

  private updateSummary(nodeId: NodeId): void {
    let summary = this.summaryOps.identity();

    if (this.arena.isLeaf(nodeId)) {
      const data = this.arena.getItem(nodeId);
      if (data) {
        for (const item of data.items) {
          summary = this.summaryOps.combine(summary, item.summary());
        }
      }
    } else {
      const children = this.arena.getChildren(nodeId);
      for (const childId of children) {
        const childSummary = this.summaries.get(childId);
        if (childSummary !== undefined) {
          summary = this.summaryOps.combine(summary, childSummary);
        }
      }
    }

    this.summaries.set(nodeId, summary);
  }

  private buildFromLeaves(leaves: NodeId[]): NodeId {
    if (leaves.length === 0) {
      return this.createLeaf([]);
    }

    if (leaves.length === 1) {
      const leaf = leaves[0];
      return leaf !== undefined ? leaf : this.createLeaf([]);
    }

    // Build internal nodes level by level
    let currentLevel = leaves;
    const minChildren = Math.floor(this.branchingFactor / 2);

    while (currentLevel.length > 1) {
      const nextLevel: NodeId[] = [];
      let i = 0;

      while (i < currentLevel.length) {
        const remaining = currentLevel.length - i;

        // If remaining nodes would result in an underflow node at the end,
        // split more evenly
        if (remaining <= this.branchingFactor) {
          // Take all remaining
          const chunk = currentLevel.slice(i);
          const internalId = this.createInternal(chunk);
          nextLevel.push(internalId);
          break;
        }

        if (remaining < this.branchingFactor + minChildren && remaining > this.branchingFactor) {
          // Would leave fewer than minChildren for last node
          // Split remaining evenly between two nodes
          const mid = Math.ceil(remaining / 2);
          const chunk1 = currentLevel.slice(i, i + mid);
          const chunk2 = currentLevel.slice(i + mid);
          nextLevel.push(this.createInternal(chunk1));
          nextLevel.push(this.createInternal(chunk2));
          break;
        }

        // Normal case: take a full chunk
        const chunk = currentLevel.slice(i, i + this.branchingFactor);
        const internalId = this.createInternal(chunk);
        nextLevel.push(internalId);
        i += this.branchingFactor;
      }

      currentLevel = nextLevel;
    }

    const root = currentLevel[0];
    return root !== undefined ? root : this.createLeaf([]);
  }

  private collectLeafDepths(nodeId: NodeId, depth: number, depths: Set<number>): void {
    if (this.arena.isLeaf(nodeId)) {
      depths.add(depth);
      return;
    }

    const children = this.arena.getChildren(nodeId);
    for (const childId of children) {
      this.collectLeafDepths(childId, depth + 1, depths);
    }
  }

  private checkSummaryInvariants(nodeId: NodeId, errors: string[]): void {
    const storedSummary = this.summaries.get(nodeId);

    let computedSummary = this.summaryOps.identity();
    if (this.arena.isLeaf(nodeId)) {
      const data = this.arena.getItem(nodeId);
      if (data) {
        for (const item of data.items) {
          computedSummary = this.summaryOps.combine(computedSummary, item.summary());
        }
      }
    } else {
      const children = this.arena.getChildren(nodeId);
      for (const childId of children) {
        this.checkSummaryInvariants(childId, errors);
        const childSummary = this.summaries.get(childId);
        if (childSummary !== undefined) {
          computedSummary = this.summaryOps.combine(computedSummary, childSummary);
        }
      }
    }

    if (JSON.stringify(storedSummary) !== JSON.stringify(computedSummary)) {
      errors.push(
        `Summary mismatch at node ${nodeId}: stored=${JSON.stringify(storedSummary)}, computed=${JSON.stringify(computedSummary)}`,
      );
    }
  }

  private checkCountInvariants(nodeId: NodeId, isRoot: boolean, errors: string[]): void {
    const minItems = isRoot ? 0 : Math.floor(this.branchingFactor / 2);
    const maxItems = this.branchingFactor;

    if (this.arena.isLeaf(nodeId)) {
      const count = this.arena.getCount(nodeId);
      if (!isRoot && count < minItems) {
        errors.push(`Leaf ${nodeId} has ${count} items, minimum is ${minItems}`);
      }
      if (count > maxItems) {
        errors.push(`Leaf ${nodeId} has ${count} items, maximum is ${maxItems}`);
      }
    } else {
      const children = this.arena.getChildren(nodeId);
      if (!isRoot && children.length < minItems) {
        errors.push(
          `Internal node ${nodeId} has ${children.length} children, minimum is ${minItems}`,
        );
      }
      if (children.length > maxItems) {
        errors.push(
          `Internal node ${nodeId} has ${children.length} children, maximum is ${maxItems}`,
        );
      }

      for (const childId of children) {
        this.checkCountInvariants(childId, false, errors);
      }
    }
  }
}

// === Common Summary Types ===

/**
 * Simple count summary (counts number of items).
 */
export interface CountSummary {
  count: number;
}

export const countSummaryOps: Summary<CountSummary> = {
  identity(): CountSummary {
    return { count: 0 };
  },
  combine(left: CountSummary, right: CountSummary): CountSummary {
    return { count: left.count + right.count };
  },
};

/**
 * Dimension for seeking by item count.
 */
export const countDimension: Dimension<CountSummary, number> = {
  measure(summary: CountSummary): number {
    return summary.count;
  },
  compare(a: number, b: number): number {
    return a - b;
  },
  add(a: number, b: number): number {
    return a + b;
  },
  zero(): number {
    return 0;
  },
};

/**
 * Text summary with multi-dimensional metrics.
 */
export interface TextSummary {
  lines: number;
  utf16Len: number;
  bytes: number;
  lastLineLen: number;
  lastLineBytes: number;
}

export const textSummaryOps: Summary<TextSummary> = {
  identity(): TextSummary {
    return {
      lines: 0,
      utf16Len: 0,
      bytes: 0,
      lastLineLen: 0,
      lastLineBytes: 0,
    };
  },
  combine(left: TextSummary, right: TextSummary): TextSummary {
    return {
      lines: left.lines + right.lines,
      utf16Len: left.utf16Len + right.utf16Len,
      bytes: left.bytes + right.bytes,
      // Conditional monoid for last line
      lastLineLen: right.lines > 0 ? right.lastLineLen : left.lastLineLen + right.lastLineLen,
      lastLineBytes:
        right.lines > 0 ? right.lastLineBytes : left.lastLineBytes + right.lastLineBytes,
    };
  },
};

/**
 * Dimension for seeking by line number.
 */
export const lineDimension: Dimension<TextSummary, number> = {
  measure(summary: TextSummary): number {
    return summary.lines;
  },
  compare(a: number, b: number): number {
    return a - b;
  },
  add(a: number, b: number): number {
    return a + b;
  },
  zero(): number {
    return 0;
  },
};

/**
 * Dimension for seeking by UTF-16 offset.
 */
export const utf16Dimension: Dimension<TextSummary, number> = {
  measure(summary: TextSummary): number {
    return summary.utf16Len;
  },
  compare(a: number, b: number): number {
    return a - b;
  },
  add(a: number, b: number): number {
    return a + b;
  },
  zero(): number {
    return 0;
  },
};

/**
 * Dimension for seeking by byte offset.
 */
export const byteDimension: Dimension<TextSummary, number> = {
  measure(summary: TextSummary): number {
    return summary.bytes;
  },
  compare(a: number, b: number): number {
    return a - b;
  },
  add(a: number, b: number): number {
    return a + b;
  },
  zero(): number {
    return 0;
  },
};

/**
 * Point (line, column) for 2D seeking.
 */
export interface Point {
  line: number;
  column: number;
}

/**
 * Dimension for seeking by Point (line + column).
 */
export const pointDimension: Dimension<TextSummary, Point> = {
  measure(summary: TextSummary): Point {
    return {
      line: summary.lines,
      column: summary.lastLineLen,
    };
  },
  compare(a: Point, b: Point): number {
    if (a.line !== b.line) {
      return a.line - b.line;
    }
    return a.column - b.column;
  },
  add(a: Point, b: Point): Point {
    if (b.line > 0) {
      return {
        line: a.line + b.line,
        column: b.column,
      };
    }
    return {
      line: a.line,
      column: a.column + b.column,
    };
  },
  zero(): Point {
    return { line: 0, column: 0 };
  },
};
