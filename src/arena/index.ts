// Arena allocator for CRDT nodes
// Uses TypedArrays for cache-efficient node storage

export const ARENA_VERSION = "0.1.0";

// Node ID type for type safety
export type NodeId = number & { readonly __brand: unique symbol };

// Invalid node ID constant
export const INVALID_NODE_ID = 0 as NodeId;

// Create a valid node ID from a number
export function nodeId(n: number): NodeId {
  return n as NodeId;
}

// Default initial capacity (will grow as needed)
const DEFAULT_CAPACITY = 1024;

// Growth factor when resizing
const GROWTH_FACTOR = 2;

/**
 * Arena allocator for tree nodes.
 * Stores node metadata in TypedArrays and references to JS objects in a parallel array.
 *
 * Layout per node in the Uint32Array:
 * - [0]: flags (1 = allocated, 2 = internal node, 4 = leaf node)
 * - [1]: child count (for internal) or item count (for leaf)
 * - [2]: parent node ID
 * - [3]: height (0 for leaves)
 */
export class Arena<T> {
  private metadata: Uint32Array;
  private items: Array<T | undefined>;
  private children: Array<NodeId[] | undefined>;
  private nextId: number;
  private freeList: NodeId[];
  private _capacity: number;

  // Metadata layout constants
  static readonly META_FIELDS = 4;
  static readonly FLAG_ALLOCATED = 1;
  static readonly FLAG_INTERNAL = 2;
  static readonly FLAG_LEAF = 4;

  constructor(initialCapacity = DEFAULT_CAPACITY) {
    this._capacity = initialCapacity;
    this.metadata = new Uint32Array(initialCapacity * Arena.META_FIELDS);
    this.items = new Array(initialCapacity);
    this.children = new Array(initialCapacity);
    this.nextId = 1; // Start at 1 so 0 can be INVALID_NODE_ID
    this.freeList = [];
  }

  get capacity(): number {
    return this._capacity;
  }

  get allocated(): number {
    return this.nextId - 1 - this.freeList.length;
  }

  /**
   * Allocate a new node, returning its ID.
   */
  allocate(): NodeId {
    let id: NodeId;

    if (this.freeList.length > 0) {
      id = this.freeList.pop() as NodeId;
    } else {
      if (this.nextId >= this._capacity) {
        this.grow();
      }
      id = nodeId(this.nextId++);
    }

    const offset = id * Arena.META_FIELDS;
    this.metadata[offset] = Arena.FLAG_ALLOCATED;
    this.metadata[offset + 1] = 0;
    this.metadata[offset + 2] = 0;
    this.metadata[offset + 3] = 0;
    this.items[id] = undefined;
    this.children[id] = undefined;

    return id;
  }

  /**
   * Free a node, returning it to the free list.
   */
  free(id: NodeId): void {
    if (!this.isAllocated(id)) {
      throw new Error(`Cannot free unallocated node ${id}`);
    }

    const offset = id * Arena.META_FIELDS;
    this.metadata[offset] = 0; // Clear flags
    this.items[id] = undefined;
    this.children[id] = undefined;
    this.freeList.push(id);
  }

  /**
   * Check if a node is allocated.
   */
  isAllocated(id: NodeId): boolean {
    if (id <= 0 || id >= this.nextId) {
      return false;
    }
    const offset = id * Arena.META_FIELDS;
    return ((this.metadata[offset] ?? 0) & Arena.FLAG_ALLOCATED) !== 0;
  }

  /**
   * Set node as internal node.
   */
  setInternal(id: NodeId, childCount: number, childIds: NodeId[]): void {
    const offset = id * Arena.META_FIELDS;
    this.metadata[offset] = Arena.FLAG_ALLOCATED | Arena.FLAG_INTERNAL;
    this.metadata[offset + 1] = childCount;
    this.children[id] = [...childIds];
    this.items[id] = undefined;
  }

  /**
   * Set node as leaf node with items.
   */
  setLeaf(id: NodeId, itemCount: number): void {
    const offset = id * Arena.META_FIELDS;
    this.metadata[offset] = Arena.FLAG_ALLOCATED | Arena.FLAG_LEAF;
    this.metadata[offset + 1] = itemCount;
    this.children[id] = undefined;
  }

  /**
   * Check if node is internal.
   */
  isInternal(id: NodeId): boolean {
    const offset = id * Arena.META_FIELDS;
    return ((this.metadata[offset] ?? 0) & Arena.FLAG_INTERNAL) !== 0;
  }

  /**
   * Check if node is a leaf.
   */
  isLeaf(id: NodeId): boolean {
    const offset = id * Arena.META_FIELDS;
    return ((this.metadata[offset] ?? 0) & Arena.FLAG_LEAF) !== 0;
  }

  /**
   * Get the count (children for internal, items for leaf).
   */
  getCount(id: NodeId): number {
    const offset = id * Arena.META_FIELDS;
    const count = this.metadata[offset + 1];
    return count === undefined ? 0 : count;
  }

  /**
   * Set the count.
   */
  setCount(id: NodeId, count: number): void {
    const offset = id * Arena.META_FIELDS;
    this.metadata[offset + 1] = count;
  }

  /**
   * Get parent node ID.
   */
  getParent(id: NodeId): NodeId {
    const offset = id * Arena.META_FIELDS;
    return nodeId(this.metadata[offset + 2] ?? 0);
  }

  /**
   * Set parent node ID.
   */
  setParent(id: NodeId, parentId: NodeId): void {
    const offset = id * Arena.META_FIELDS;
    this.metadata[offset + 2] = parentId;
  }

  /**
   * Get node height (0 for leaves).
   */
  getHeight(id: NodeId): number {
    const offset = id * Arena.META_FIELDS;
    const height = this.metadata[offset + 3];
    return height === undefined ? 0 : height;
  }

  /**
   * Set node height.
   */
  setHeight(id: NodeId, height: number): void {
    const offset = id * Arena.META_FIELDS;
    this.metadata[offset + 3] = height;
  }

  /**
   * Get children array for internal node.
   */
  getChildren(id: NodeId): NodeId[] {
    const arr = this.children[id];
    return arr ?? [];
  }

  /**
   * Set children for internal node.
   */
  setChildren(id: NodeId, childIds: NodeId[]): void {
    this.children[id] = [...childIds];
    this.setCount(id, childIds.length);
  }

  /**
   * Get child at index.
   */
  getChild(id: NodeId, index: number): NodeId {
    const arr = this.children[id];
    if (!arr || index < 0 || index >= arr.length) {
      return INVALID_NODE_ID;
    }
    return arr[index] ?? INVALID_NODE_ID;
  }

  /**
   * Store item data for a leaf node.
   */
  setItem(id: NodeId, item: T): void {
    this.items[id] = item;
  }

  /**
   * Get item data for a leaf node.
   */
  getItem(id: NodeId): T | undefined {
    return this.items[id];
  }

  /**
   * Clone a node (for path copying), returning new node ID.
   */
  clone(id: NodeId): NodeId {
    const newId = this.allocate();
    const oldOffset = id * Arena.META_FIELDS;
    const newOffset = newId * Arena.META_FIELDS;

    // Copy metadata
    this.metadata[newOffset] = this.metadata[oldOffset] ?? 0;
    this.metadata[newOffset + 1] = this.metadata[oldOffset + 1] ?? 0;
    this.metadata[newOffset + 2] = this.metadata[oldOffset + 2] ?? 0;
    this.metadata[newOffset + 3] = this.metadata[oldOffset + 3] ?? 0;

    // Copy children/items
    if (this.isInternal(id)) {
      const childArr = this.children[id];
      this.children[newId] = childArr ? [...childArr] : [];
    }
    this.items[newId] = this.items[id];

    return newId;
  }

  /**
   * Grow the arena when capacity is exhausted.
   */
  private grow(): void {
    const newCapacity = this._capacity * GROWTH_FACTOR;

    // Grow metadata array
    const newMetadata = new Uint32Array(newCapacity * Arena.META_FIELDS);
    newMetadata.set(this.metadata);
    this.metadata = newMetadata;

    // Grow items array
    this.items.length = newCapacity;

    // Grow children array
    this.children.length = newCapacity;

    this._capacity = newCapacity;
  }

  /**
   * Reset the arena, freeing all nodes.
   */
  reset(): void {
    this.metadata.fill(0);
    this.items.fill(undefined);
    this.children.fill(undefined);
    this.nextId = 1;
    this.freeList = [];
  }
}
