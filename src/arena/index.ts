// Arena allocator for CRDT nodes
// Uses TypedArrays for cache-efficient node storage

export const ARENA_VERSION = "0.2.0";

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
 * Snapshot registration for epoch-based reclamation.
 */
export interface SnapshotRegistration {
  readonly id: number;
  readonly epoch: number;
  readonly createdAt: number;
  readonly rootIds: ReadonlyArray<NodeId>;
}

/**
 * Arena utilization statistics.
 */
export interface ArenaStats {
  readonly capacity: number;
  readonly allocated: number;
  readonly freeListSize: number;
  readonly utilizationPercent: number;
  readonly currentEpoch: number;
  readonly activeSnapshots: number;
  readonly minLiveEpoch: number;
}

/**
 * Arena allocator for tree nodes.
 * Stores node metadata in TypedArrays and references to JS objects in a parallel array.
 *
 * Layout per node in the Uint32Array:
 * - [0]: flags (1 = allocated, 2 = internal node, 4 = leaf node)
 * - [1]: child count (for internal) or item count (for leaf)
 * - [2]: parent node ID
 * - [3]: height (0 for leaves)
 * - [4]: epoch when allocated
 */
export class Arena<T> {
  private metadata: Uint32Array;
  private items: Array<T | undefined>;
  private children: Array<NodeId[] | undefined>;
  private nextId: number;
  private freeList: NodeId[];
  private _capacity: number;

  // Epoch tracking for snapshot isolation
  private _currentEpoch: number;
  private _nextSnapshotId: number;
  private _activeSnapshots: Map<number, SnapshotRegistration>;

  // Metadata layout constants
  static readonly META_FIELDS = 5;
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
    this._currentEpoch = 0;
    this._nextSnapshotId = 1;
    this._activeSnapshots = new Map();
  }

  get capacity(): number {
    return this._capacity;
  }

  get allocated(): number {
    return this.nextId - 1 - this.freeList.length;
  }

  get currentEpoch(): number {
    return this._currentEpoch;
  }

  /**
   * Advance the epoch counter. Called when taking a snapshot.
   */
  advanceEpoch(): number {
    return ++this._currentEpoch;
  }

  /**
   * Get the minimum epoch still referenced by active snapshots.
   * Returns currentEpoch + 1 if no snapshots are active.
   */
  get minLiveEpoch(): number {
    if (this._activeSnapshots.size === 0) {
      return this._currentEpoch + 1;
    }
    let min = this._currentEpoch + 1;
    for (const snap of this._activeSnapshots.values()) {
      if (snap.epoch < min) {
        min = snap.epoch;
      }
    }
    return min;
  }

  /**
   * Get arena utilization statistics.
   */
  stats(): ArenaStats {
    const allocated = this.allocated;
    return {
      capacity: this._capacity,
      allocated,
      freeListSize: this.freeList.length,
      utilizationPercent: this._capacity > 0 ? (allocated / this._capacity) * 100 : 0,
      currentEpoch: this._currentEpoch,
      activeSnapshots: this._activeSnapshots.size,
      minLiveEpoch: this.minLiveEpoch,
    };
  }

  /**
   * Register a snapshot for epoch tracking.
   * Returns a snapshot registration that must be released when the snapshot is no longer needed.
   */
  registerSnapshot(rootIds: ReadonlyArray<NodeId>): SnapshotRegistration {
    const id = this._nextSnapshotId++;
    const epoch = this._currentEpoch;
    const registration: SnapshotRegistration = {
      id,
      epoch,
      createdAt: Date.now(),
      rootIds,
    };
    this._activeSnapshots.set(id, registration);
    return registration;
  }

  /**
   * Release a snapshot registration.
   * Returns the number of nodes that were reclaimed (freed).
   */
  releaseSnapshot(registration: SnapshotRegistration): number {
    if (!this._activeSnapshots.has(registration.id)) {
      return 0; // Already released
    }
    this._activeSnapshots.delete(registration.id);
    return this.tryReclaim();
  }

  /**
   * Get a snapshot registration by ID.
   */
  getSnapshot(id: number): SnapshotRegistration | undefined {
    return this._activeSnapshots.get(id);
  }

  /**
   * Get all active snapshot registrations.
   */
  getActiveSnapshots(): ReadonlyArray<SnapshotRegistration> {
    return Array.from(this._activeSnapshots.values());
  }

  /**
   * Check if any snapshots are older than the given age in milliseconds.
   * Returns the IDs of expired snapshots.
   */
  getExpiredSnapshots(maxAgeMs: number): ReadonlyArray<number> {
    const now = Date.now();
    const expired: number[] = [];
    for (const snap of this._activeSnapshots.values()) {
      if (now - snap.createdAt > maxAgeMs) {
        expired.push(snap.id);
      }
    }
    return expired;
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
    this.metadata[offset + 4] = this._currentEpoch;
    this.items[id] = undefined;
    this.children[id] = undefined;

    return id;
  }

  /**
   * Get the epoch when a node was allocated.
   */
  getEpoch(id: NodeId): number {
    const offset = id * Arena.META_FIELDS;
    const epoch = this.metadata[offset + 4];
    return epoch === undefined ? 0 : epoch;
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
   * The cloned node gets the current epoch, not the source node's epoch.
   */
  clone(id: NodeId): NodeId {
    const newId = this.allocate();
    const oldOffset = id * Arena.META_FIELDS;
    const newOffset = newId * Arena.META_FIELDS;

    // Copy metadata (except epoch which was set by allocate)
    this.metadata[newOffset] = this.metadata[oldOffset] ?? 0;
    this.metadata[newOffset + 1] = this.metadata[oldOffset + 1] ?? 0;
    this.metadata[newOffset + 2] = this.metadata[oldOffset + 2] ?? 0;
    this.metadata[newOffset + 3] = this.metadata[oldOffset + 3] ?? 0;
    // epoch (offset + 4) is already set by allocate()

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
    this._currentEpoch = 0;
    this._nextSnapshotId = 1;
    this._activeSnapshots.clear();
  }

  /**
   * Try to reclaim unreachable nodes from epochs older than minLiveEpoch.
   * Uses mark-sweep: marks all nodes reachable from live roots, then frees unmarked nodes.
   * Returns the number of nodes freed.
   */
  tryReclaim(): number {
    const minEpoch = this.minLiveEpoch;
    if (minEpoch === 0) {
      return 0; // Nothing can be reclaimed
    }

    // Collect all live root nodes
    const liveRoots: NodeId[] = [];
    for (const snap of this._activeSnapshots.values()) {
      for (const rootId of snap.rootIds) {
        liveRoots.push(rootId);
      }
    }

    // If there are no snapshots, we need an external current root to be passed in
    // For now, we only reclaim when there are snapshots that define live roots
    if (liveRoots.length === 0) {
      return 0;
    }

    // Mark phase: find all reachable nodes from live roots
    const reachable = new Set<NodeId>();
    const stack: NodeId[] = [...liveRoots];

    while (stack.length > 0) {
      const id = stack.pop();
      if (id === undefined || id === INVALID_NODE_ID || reachable.has(id)) {
        continue;
      }
      if (!this.isAllocated(id)) {
        continue;
      }
      reachable.add(id);

      // Add children to stack
      if (this.isInternal(id)) {
        const children = this.getChildren(id);
        for (const childId of children) {
          stack.push(childId);
        }
      }
    }

    // Sweep phase: free unreachable nodes from old epochs
    let freedCount = 0;
    for (let id = 1; id < this.nextId; id++) {
      const nodeId_ = nodeId(id);
      if (!this.isAllocated(nodeId_)) {
        continue;
      }
      const nodeEpoch = this.getEpoch(nodeId_);
      if (nodeEpoch < minEpoch && !reachable.has(nodeId_)) {
        this.free(nodeId_);
        freedCount++;
      }
    }

    return freedCount;
  }

  /**
   * Force reclamation with explicit current roots.
   * This is useful when you want to reclaim but also preserve nodes reachable from
   * the current (non-snapshot) state.
   */
  reclaimWithRoots(currentRoots: ReadonlyArray<NodeId>): number {
    const minEpoch = this.minLiveEpoch;

    // Collect all live root nodes: snapshots + current
    const liveRoots: NodeId[] = [...currentRoots];
    for (const snap of this._activeSnapshots.values()) {
      for (const rootId of snap.rootIds) {
        liveRoots.push(rootId);
      }
    }

    if (liveRoots.length === 0) {
      return 0;
    }

    // Mark phase
    const reachable = new Set<NodeId>();
    const stack: NodeId[] = [...liveRoots];

    while (stack.length > 0) {
      const id = stack.pop();
      if (id === undefined || id === INVALID_NODE_ID || reachable.has(id)) {
        continue;
      }
      if (!this.isAllocated(id)) {
        continue;
      }
      reachable.add(id);

      if (this.isInternal(id)) {
        const children = this.getChildren(id);
        for (const childId of children) {
          stack.push(childId);
        }
      }
    }

    // Sweep phase: free unreachable nodes
    // When current roots are provided, we can be more aggressive: free anything unreachable
    let freedCount = 0;
    for (let id = 1; id < this.nextId; id++) {
      const nodeId_ = nodeId(id);
      if (!this.isAllocated(nodeId_)) {
        continue;
      }
      if (!reachable.has(nodeId_)) {
        // Only free if epoch is old enough (respecting active snapshots)
        const nodeEpoch = this.getEpoch(nodeId_);
        if (this._activeSnapshots.size === 0 || nodeEpoch < minEpoch) {
          this.free(nodeId_);
          freedCount++;
        }
      }
    }

    return freedCount;
  }
}
