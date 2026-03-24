// Arena allocator for CRDT nodes
// Uses TypedArrays for cache-efficient node storage

export const ARENA_VERSION = "0.2.0";

/** Epoch number for tracking node allocation time. */
export type Epoch = number & { readonly __brand: "Epoch" };

/** Create an Epoch from a number. */
export function epoch(n: number): Epoch {
  return n as Epoch;
}

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

  // Epoch tracking for snapshot isolation
  private epochs: Uint32Array;
  private _currentEpoch: Epoch;
  private _minLiveEpoch: Epoch;
  private liveEpochRefCounts: Map<Epoch, number>;

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

    // Initialize epoch tracking
    this.epochs = new Uint32Array(initialCapacity);
    this._currentEpoch = epoch(1);
    this._minLiveEpoch = epoch(1);
    this.liveEpochRefCounts = new Map();
  }

  get capacity(): number {
    return this._capacity;
  }

  get allocated(): number {
    return this.nextId - 1 - this.freeList.length;
  }

  /** Current epoch for allocation tracking. */
  get currentEpoch(): Epoch {
    return this._currentEpoch;
  }

  /** Minimum epoch with live snapshots. */
  get minLiveEpoch(): Epoch {
    return this._minLiveEpoch;
  }

  /**
   * Advance to a new epoch. Returns the new epoch number.
   * Should be called before creating a new snapshot.
   */
  advanceEpoch(): Epoch {
    this._currentEpoch = epoch(this._currentEpoch + 1);
    return this._currentEpoch;
  }

  /**
   * Register a snapshot at the given epoch, incrementing its ref count.
   */
  retainEpoch(e: Epoch): void {
    const count = this.liveEpochRefCounts.get(e) ?? 0;
    this.liveEpochRefCounts.set(e, count + 1);
    this.updateMinLiveEpoch();
  }

  /**
   * Release a snapshot at the given epoch, decrementing its ref count.
   * Returns true if the epoch's ref count reached zero.
   */
  releaseEpoch(e: Epoch): boolean {
    const count = this.liveEpochRefCounts.get(e) ?? 0;
    if (count <= 1) {
      this.liveEpochRefCounts.delete(e);
      this.updateMinLiveEpoch();
      return true;
    }
    this.liveEpochRefCounts.set(e, count - 1);
    return false;
  }

  /**
   * Update the minimum live epoch based on current ref counts.
   */
  private updateMinLiveEpoch(): void {
    if (this.liveEpochRefCounts.size === 0) {
      // No live snapshots, min epoch is current
      this._minLiveEpoch = this._currentEpoch;
    } else {
      let min = this._currentEpoch;
      for (const e of this.liveEpochRefCounts.keys()) {
        if (e < min) {
          min = e;
        }
      }
      this._minLiveEpoch = min;
    }
  }

  /**
   * Get the epoch when a node was allocated.
   */
  getEpoch(id: NodeId): Epoch {
    return epoch(this.epochs[id] ?? 0);
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

    // Track allocation epoch
    this.epochs[id] = this._currentEpoch;

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

    // Grow epochs array
    const newEpochs = new Uint32Array(newCapacity);
    newEpochs.set(this.epochs);
    this.epochs = newEpochs;

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
    this.epochs.fill(0);
    this.items.fill(undefined);
    this.children.fill(undefined);
    this.nextId = 1;
    this.freeList = [];
    this._currentEpoch = epoch(1);
    this._minLiveEpoch = epoch(1);
    this.liveEpochRefCounts.clear();
  }

  // ---------------------------------------------------------------------------
  // Arena utilization monitoring
  // ---------------------------------------------------------------------------

  /**
   * Get utilization statistics for the arena.
   */
  utilization(): ArenaUtilization {
    const totalSlots = this.nextId - 1;
    const freeSlots = this.freeList.length;
    const allocatedSlots = totalSlots - freeSlots;
    const capacitySlots = this._capacity - 1; // Exclude slot 0

    return {
      allocated: allocatedSlots,
      free: freeSlots,
      total: totalSlots,
      capacity: capacitySlots,
      utilizationRatio: capacitySlots > 0 ? allocatedSlots / capacitySlots : 0,
      fragmentationRatio: totalSlots > 0 ? freeSlots / totalSlots : 0,
      liveEpochs: this.liveEpochRefCounts.size,
      currentEpoch: this._currentEpoch,
      minLiveEpoch: this._minLiveEpoch,
    };
  }

  // ---------------------------------------------------------------------------
  // Mark-sweep reclamation
  // ---------------------------------------------------------------------------

  /**
   * Mark all nodes reachable from the given root(s) as live.
   * Returns a Set of all live NodeIds.
   */
  markReachable(roots: NodeId[]): Set<NodeId> {
    const live = new Set<NodeId>();
    const stack = [...roots];

    while (stack.length > 0) {
      const id = stack.pop();
      if (id === undefined || id === INVALID_NODE_ID || live.has(id)) {
        continue;
      }
      if (!this.isAllocated(id)) {
        continue;
      }

      live.add(id);

      // If internal node, mark children as live
      if (this.isInternal(id)) {
        const children = this.getChildren(id);
        for (const childId of children) {
          if (!live.has(childId)) {
            stack.push(childId);
          }
        }
      }
    }

    return live;
  }

  /**
   * Sweep all unreachable nodes that were allocated before the given epoch.
   * Only frees nodes that are allocated and not in the live set.
   * Returns the number of nodes freed.
   */
  sweepBefore(beforeEpoch: Epoch, liveSet: Set<NodeId>): number {
    let freed = 0;

    for (let id = 1; id < this.nextId; id++) {
      const nodeId_ = nodeId(id);
      if (!this.isAllocated(nodeId_)) {
        continue;
      }
      if (liveSet.has(nodeId_)) {
        continue;
      }

      const nodeEpoch = this.getEpoch(nodeId_);
      if (nodeEpoch < beforeEpoch) {
        this.free(nodeId_);
        freed++;
      }
    }

    return freed;
  }

  /**
   * Perform a full mark-sweep garbage collection.
   * Marks all nodes reachable from the given roots, then sweeps
   * all unreachable nodes allocated before minLiveEpoch.
   * Returns the number of nodes freed.
   */
  collectGarbage(roots: NodeId[]): number {
    const liveSet = this.markReachable(roots);
    return this.sweepBefore(this._minLiveEpoch, liveSet);
  }
}

/**
 * Arena utilization statistics.
 */
export interface ArenaUtilization {
  /** Number of currently allocated nodes. */
  allocated: number;
  /** Number of free (recycled) slots. */
  free: number;
  /** Total number of slots ever allocated. */
  total: number;
  /** Maximum capacity before growth. */
  capacity: number;
  /** Ratio of allocated slots to capacity. */
  utilizationRatio: number;
  /** Ratio of free slots to total (fragmentation). */
  fragmentationRatio: number;
  /** Number of epochs with live snapshots. */
  liveEpochs: number;
  /** Current allocation epoch. */
  currentEpoch: Epoch;
  /** Minimum epoch with live snapshots. */
  minLiveEpoch: Epoch;
}
