/**
 * SoA (Struct of Arrays) Arena Allocator
 *
 * Separate TypedArrays for each field. Better for bulk iteration over
 * single fields (e.g., summing all values), but potentially worse cache
 * locality for tree descent where we access multiple fields per node.
 *
 * Based on patterns from bitECS and similar ECS implementations.
 */

import {
  type Arena,
  type ArenaStats,
  NODE_FLAGS,
  NULL_NODE,
  type NodeIndex,
  type Snapshot,
} from "./types.ts";

/** Default initial capacity */
const DEFAULT_INITIAL_CAPACITY = 1024;

/** Growth factor when expanding */
const GROWTH_FACTOR = 2;

/** Bits per word in the bitfield */
const BITS_PER_WORD = 32;

/**
 * SoA Arena Allocator
 *
 * Memory layout: separate arrays for each field
 * - leftChildren: Uint32Array
 * - rightChildren: Uint32Array
 * - parents: Uint32Array
 * - flags: Uint32Array
 * - sums: Float64Array
 * - payloads: Float64Array
 */
export class SoaArena implements Arena {
  private leftChildren: Uint32Array;
  private rightChildren: Uint32Array;
  private parents: Uint32Array;
  private nodeFlags: Uint32Array;
  private sums: Float64Array;
  private payloads: Float64Array;

  /** Bitfield tracking free slots (1 = free, 0 = allocated) */
  private freeBitfield: Uint32Array;

  /** Number of currently allocated nodes */
  private _nodeCount = 0;

  /** Total capacity in nodes */
  private _capacity: number;

  /** Current epoch for snapshot tracking */
  private _epoch = 0;

  /** Map of epoch -> reference count */
  private epochRefCounts: Map<number, number> = new Map();

  /** Minimum epoch that still has live snapshots */
  private minLiveEpoch = 0;

  /** FinalizationRegistry for leak detection */
  private finalizationRegistry: FinalizationRegistry<number>;

  /** Track leaked snapshots for debugging */
  private leakedSnapshots: Set<number> = new Set();

  constructor(initialCapacity: number = DEFAULT_INITIAL_CAPACITY) {
    this._capacity = initialCapacity;

    // Allocate separate arrays for each field
    this.leftChildren = new Uint32Array(initialCapacity);
    this.rightChildren = new Uint32Array(initialCapacity);
    this.parents = new Uint32Array(initialCapacity);
    this.nodeFlags = new Uint32Array(initialCapacity);
    this.sums = new Float64Array(initialCapacity);
    this.payloads = new Float64Array(initialCapacity);

    // Initialize parent/child pointers to NULL_NODE
    this.leftChildren.fill(NULL_NODE);
    this.rightChildren.fill(NULL_NODE);
    this.parents.fill(NULL_NODE);

    // Initialize the free bitfield
    const bitfieldSize = Math.ceil(initialCapacity / BITS_PER_WORD);
    this.freeBitfield = new Uint32Array(bitfieldSize);
    // Mark all slots as free (1 = free)
    this.freeBitfield.fill(0xffffffff);
    // Clear excess bits in the last word
    const excessBits = bitfieldSize * BITS_PER_WORD - initialCapacity;
    if (excessBits > 0) {
      this.freeBitfield[bitfieldSize - 1] &= (1 << (BITS_PER_WORD - excessBits)) - 1;
    }

    // Set up FinalizationRegistry for leak detection
    this.finalizationRegistry = new FinalizationRegistry((epoch: number) => {
      this.leakedSnapshots.add(epoch);
      console.warn(`[SoaArena] Leaked snapshot detected at epoch ${epoch}`);
    });
  }

  /**
   * Allocate a new node using O(1) bitfield allocation
   */
  allocNode(): NodeIndex {
    // Find first word with a free bit
    let wordIndex = -1;
    for (let i = 0; i < this.freeBitfield.length; i++) {
      if (this.freeBitfield[i] !== 0) {
        wordIndex = i;
        break;
      }
    }

    // No free slots - need to grow
    if (wordIndex === -1) {
      this.grow();
      return this.allocNode();
    }

    // Find first free bit using x & -x (isolates lowest set bit)
    const word = this.freeBitfield[wordIndex];
    const lowestBit = word & -word;
    const bitIndex = Math.clz32(lowestBit) ^ 31; // Convert to bit position

    // Calculate node index
    const nodeIndex = wordIndex * BITS_PER_WORD + bitIndex;

    // Mark as allocated (clear the bit)
    this.freeBitfield[wordIndex] &= ~lowestBit;
    this._nodeCount++;

    // Initialize node
    this.initNode(nodeIndex);

    return nodeIndex;
  }

  /**
   * Free a node by index
   */
  freeNode(index: NodeIndex): void {
    if (index >= this._capacity || index === NULL_NODE) {
      return;
    }

    const wordIndex = Math.floor(index / BITS_PER_WORD);
    const bitIndex = index % BITS_PER_WORD;
    const bit = 1 << bitIndex;

    // Check if already free
    if (this.freeBitfield[wordIndex] & bit) {
      return;
    }

    // Mark as free
    this.freeBitfield[wordIndex] |= bit;
    this._nodeCount--;
  }

  get nodeCount(): number {
    return this._nodeCount;
  }

  get capacity(): number {
    return this._capacity;
  }

  getStats(): ArenaStats {
    const memoryBytes =
      this.leftChildren.byteLength +
      this.rightChildren.byteLength +
      this.parents.byteLength +
      this.nodeFlags.byteLength +
      this.sums.byteLength +
      this.payloads.byteLength +
      this.freeBitfield.byteLength;

    return {
      capacity: this._capacity,
      liveNodes: this._nodeCount,
      freeNodes: this._capacity - this._nodeCount,
      utilization: this._nodeCount / this._capacity,
      memoryBytes,
      epoch: this._epoch,
    };
  }

  // --- Node field accessors (direct array access for SoA) ---

  getLeft(index: NodeIndex): NodeIndex {
    return this.leftChildren[index];
  }

  setLeft(index: NodeIndex, value: NodeIndex): void {
    this.leftChildren[index] = value;
  }

  getRight(index: NodeIndex): NodeIndex {
    return this.rightChildren[index];
  }

  setRight(index: NodeIndex, value: NodeIndex): void {
    this.rightChildren[index] = value;
  }

  getParent(index: NodeIndex): NodeIndex {
    return this.parents[index];
  }

  setParent(index: NodeIndex, value: NodeIndex): void {
    this.parents[index] = value;
  }

  getFlags(index: NodeIndex): number {
    return this.nodeFlags[index];
  }

  setFlags(index: NodeIndex, value: number): void {
    this.nodeFlags[index] = value;
  }

  getSum(index: NodeIndex): number {
    return this.sums[index];
  }

  setSum(index: NodeIndex, value: number): void {
    this.sums[index] = value;
  }

  getPayload(index: NodeIndex): number {
    return this.payloads[index];
  }

  setPayload(index: NodeIndex, value: number): void {
    this.payloads[index] = value;
  }

  // --- Bulk operations (SoA advantage) ---

  /**
   * Get the raw sums array for bulk operations
   * This is where SoA shines - direct iteration over a single field
   */
  getSumsArray(): Float64Array {
    return this.sums;
  }

  /**
   * Sum all allocated node sums (bulk iteration)
   */
  sumAllNodes(): number {
    let total = 0;
    for (let i = 0; i < this._capacity; i++) {
      const wordIndex = Math.floor(i / BITS_PER_WORD);
      const bitIndex = i % BITS_PER_WORD;
      // Check if allocated (bit is 0 in freeBitfield)
      if (!(this.freeBitfield[wordIndex] & (1 << bitIndex))) {
        total += this.sums[i];
      }
    }
    return total;
  }

  // --- Epoch management ---

  getCurrentEpoch(): number {
    return this._epoch;
  }

  advanceEpoch(): number {
    return ++this._epoch;
  }

  /**
   * Create a snapshot at the current epoch
   */
  createSnapshot(): Snapshot {
    const epoch = this._epoch;

    // Increment reference count for this epoch
    const count = this.epochRefCounts.get(epoch) ?? 0;
    this.epochRefCounts.set(epoch, count + 1);

    const arena = this;
    let released = false;

    const snapshot: Snapshot = {
      epoch,
      release() {
        if (released) return;
        released = true;

        const newCount = (arena.epochRefCounts.get(epoch) ?? 1) - 1;
        if (newCount <= 0) {
          arena.epochRefCounts.delete(epoch);
          arena.updateMinLiveEpoch();
        } else {
          arena.epochRefCounts.set(epoch, newCount);
        }
      },
    };

    // Register with FinalizationRegistry for leak detection
    this.finalizationRegistry.register(snapshot, epoch, snapshot);

    return snapshot;
  }

  /**
   * Check if a node can be reclaimed (no snapshots reference it)
   */
  canReclaim(nodeEpoch: number): boolean {
    return nodeEpoch < this.minLiveEpoch;
  }

  private updateMinLiveEpoch(): void {
    if (this.epochRefCounts.size === 0) {
      this.minLiveEpoch = this._epoch;
    } else {
      this.minLiveEpoch = Math.min(...this.epochRefCounts.keys());
    }
  }

  // --- Mark-sweep garbage collection ---

  markNode(index: NodeIndex): void {
    if (index >= this._capacity || index === NULL_NODE) return;
    this.nodeFlags[index] |= NODE_FLAGS.MARKED;
  }

  /**
   * Sweep unmarked nodes (mark-sweep GC)
   * Returns number of nodes freed
   */
  sweep(): number {
    let freed = 0;

    for (let i = 0; i < this._capacity; i++) {
      const wordIndex = Math.floor(i / BITS_PER_WORD);
      const bitIndex = i % BITS_PER_WORD;

      // Skip if already free
      if (this.freeBitfield[wordIndex] & (1 << bitIndex)) {
        continue;
      }

      const flags = this.nodeFlags[i];

      if (flags & NODE_FLAGS.MARKED) {
        // Clear mark bit for next cycle
        this.nodeFlags[i] = flags & ~NODE_FLAGS.MARKED;
      } else {
        // Not marked - free it
        this.freeNode(i);
        freed++;
      }
    }

    return freed;
  }

  // --- Lifecycle ---

  release(): void {
    // Report any leaked snapshots
    if (this.leakedSnapshots.size > 0) {
      console.warn(`[SoaArena] ${this.leakedSnapshots.size} leaked snapshots detected at release`);
    }

    // Clear all data structures
    this.epochRefCounts.clear();
    this.leakedSnapshots.clear();
    this._nodeCount = 0;
  }

  // --- Private methods ---

  private initNode(index: NodeIndex): void {
    this.leftChildren[index] = NULL_NODE;
    this.rightChildren[index] = NULL_NODE;
    this.parents[index] = NULL_NODE;
    this.nodeFlags[index] = NODE_FLAGS.ALLOCATED;
    this.sums[index] = 0;
    this.payloads[index] = 0;
  }

  /**
   * Grow the arena by creating new larger arrays
   */
  private grow(): void {
    const newCapacity = this._capacity * GROWTH_FACTOR;

    // Create new arrays
    const newLeftChildren = new Uint32Array(newCapacity);
    const newRightChildren = new Uint32Array(newCapacity);
    const newParents = new Uint32Array(newCapacity);
    const newNodeFlags = new Uint32Array(newCapacity);
    const newSums = new Float64Array(newCapacity);
    const newPayloads = new Float64Array(newCapacity);

    // Copy old data
    newLeftChildren.set(this.leftChildren);
    newRightChildren.set(this.rightChildren);
    newParents.set(this.parents);
    newNodeFlags.set(this.nodeFlags);
    newSums.set(this.sums);
    newPayloads.set(this.payloads);

    // Initialize new slots
    newLeftChildren.fill(NULL_NODE, this._capacity);
    newRightChildren.fill(NULL_NODE, this._capacity);
    newParents.fill(NULL_NODE, this._capacity);

    this.leftChildren = newLeftChildren;
    this.rightChildren = newRightChildren;
    this.parents = newParents;
    this.nodeFlags = newNodeFlags;
    this.sums = newSums;
    this.payloads = newPayloads;

    // Grow the bitfield
    const oldBitfieldSize = this.freeBitfield.length;
    const newBitfieldSize = Math.ceil(newCapacity / BITS_PER_WORD);
    const newBitfield = new Uint32Array(newBitfieldSize);
    newBitfield.set(this.freeBitfield);

    // Mark new slots as free
    for (let i = oldBitfieldSize; i < newBitfieldSize; i++) {
      newBitfield[i] = 0xffffffff;
    }

    // Clear excess bits in the last word
    const excessBits = newBitfieldSize * BITS_PER_WORD - newCapacity;
    if (excessBits > 0) {
      newBitfield[newBitfieldSize - 1] &= (1 << (BITS_PER_WORD - excessBits)) - 1;
    }

    this.freeBitfield = newBitfield;
    this._capacity = newCapacity;
  }
}

/**
 * Create a SoA arena with pre-allocated capacity based on document size
 */
export function createSoaArena(estimatedNodes?: number): SoaArena {
  const capacity = estimatedNodes ?? DEFAULT_INITIAL_CAPACITY;
  // Round up to power of 2 for efficient growth
  const powerOf2 = 2 ** Math.ceil(Math.log2(Math.max(capacity, 64)));
  return new SoaArena(powerOf2);
}
