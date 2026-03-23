/**
 * AoS (Array of Structs) Arena Allocator
 *
 * Single ArrayBuffer with all node fields packed contiguously per node.
 * Better cache locality for tree descent operations where we access
 * multiple fields of the same node in sequence.
 *
 * Uses:
 * - Bun.allocUnsafe() for initial allocation (skips zero-init)
 * - ArrayBuffer.transfer() for growth (zero-copy realloc)
 * - Bitfield free-list with x & -x for O(1) first-free-bit
 */

import {
  type Arena,
  type ArenaStats,
  NODE_FLAGS,
  NODE_OFFSETS,
  NODE_SIZE_BYTES,
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
 * AoS Arena Allocator
 *
 * Memory layout: [Node0][Node1][Node2]...
 * Each node is NODE_SIZE_BYTES (32) bytes with fields packed contiguously.
 */
export class AosArena implements Arena {
  private buffer: ArrayBuffer;
  private view: DataView;

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

    // Allocate the main buffer
    // Use Bun.allocUnsafe if available (3.5x faster, skips zero-init)
    const bufferSize = initialCapacity * NODE_SIZE_BYTES;
    if (typeof Bun !== "undefined" && Bun.allocUnsafe) {
      const unsafeBuffer = Bun.allocUnsafe(bufferSize);
      this.buffer = unsafeBuffer.buffer.slice(
        unsafeBuffer.byteOffset,
        unsafeBuffer.byteOffset + bufferSize,
      );
    } else {
      this.buffer = new ArrayBuffer(bufferSize);
    }
    this.view = new DataView(this.buffer);

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
      console.warn(`[AosArena] Leaked snapshot detected at epoch ${epoch}`);
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
    return {
      capacity: this._capacity,
      liveNodes: this._nodeCount,
      freeNodes: this._capacity - this._nodeCount,
      utilization: this._nodeCount / this._capacity,
      memoryBytes: this.buffer.byteLength + this.freeBitfield.byteLength,
      epoch: this._epoch,
    };
  }

  // --- Node field accessors (inlined for performance) ---

  getLeft(index: NodeIndex): NodeIndex {
    return this.view.getUint32(index * NODE_SIZE_BYTES + NODE_OFFSETS.LEFT, true);
  }

  setLeft(index: NodeIndex, value: NodeIndex): void {
    this.view.setUint32(index * NODE_SIZE_BYTES + NODE_OFFSETS.LEFT, value, true);
  }

  getRight(index: NodeIndex): NodeIndex {
    return this.view.getUint32(index * NODE_SIZE_BYTES + NODE_OFFSETS.RIGHT, true);
  }

  setRight(index: NodeIndex, value: NodeIndex): void {
    this.view.setUint32(index * NODE_SIZE_BYTES + NODE_OFFSETS.RIGHT, value, true);
  }

  getParent(index: NodeIndex): NodeIndex {
    return this.view.getUint32(index * NODE_SIZE_BYTES + NODE_OFFSETS.PARENT, true);
  }

  setParent(index: NodeIndex, value: NodeIndex): void {
    this.view.setUint32(index * NODE_SIZE_BYTES + NODE_OFFSETS.PARENT, value, true);
  }

  getFlags(index: NodeIndex): number {
    return this.view.getUint32(index * NODE_SIZE_BYTES + NODE_OFFSETS.FLAGS, true);
  }

  setFlags(index: NodeIndex, value: number): void {
    this.view.setUint32(index * NODE_SIZE_BYTES + NODE_OFFSETS.FLAGS, value, true);
  }

  getSum(index: NodeIndex): number {
    return this.view.getFloat64(index * NODE_SIZE_BYTES + NODE_OFFSETS.SUM, true);
  }

  setSum(index: NodeIndex, value: number): void {
    this.view.setFloat64(index * NODE_SIZE_BYTES + NODE_OFFSETS.SUM, value, true);
  }

  getPayload(index: NodeIndex): number {
    return this.view.getFloat64(index * NODE_SIZE_BYTES + NODE_OFFSETS.PAYLOAD, true);
  }

  setPayload(index: NodeIndex, value: number): void {
    this.view.setFloat64(index * NODE_SIZE_BYTES + NODE_OFFSETS.PAYLOAD, value, true);
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
    const flags = this.getFlags(index);
    this.setFlags(index, flags | NODE_FLAGS.MARKED);
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

      const flags = this.getFlags(i);

      if (flags & NODE_FLAGS.MARKED) {
        // Clear mark bit for next cycle
        this.setFlags(i, flags & ~NODE_FLAGS.MARKED);
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
      console.warn(`[AosArena] ${this.leakedSnapshots.size} leaked snapshots detected at release`);
    }

    // Clear all data structures
    this.epochRefCounts.clear();
    this.leakedSnapshots.clear();
    this._nodeCount = 0;
  }

  // --- Private methods ---

  private initNode(index: NodeIndex): void {
    const offset = index * NODE_SIZE_BYTES;
    this.view.setUint32(offset + NODE_OFFSETS.LEFT, NULL_NODE, true);
    this.view.setUint32(offset + NODE_OFFSETS.RIGHT, NULL_NODE, true);
    this.view.setUint32(offset + NODE_OFFSETS.PARENT, NULL_NODE, true);
    this.view.setUint32(offset + NODE_OFFSETS.FLAGS, NODE_FLAGS.ALLOCATED, true);
    this.view.setFloat64(offset + NODE_OFFSETS.SUM, 0, true);
    this.view.setFloat64(offset + NODE_OFFSETS.PAYLOAD, 0, true);
  }

  /**
   * Grow the arena using ArrayBuffer.transfer() for zero-copy realloc
   */
  private grow(): void {
    const newCapacity = this._capacity * GROWTH_FACTOR;
    const newBufferSize = newCapacity * NODE_SIZE_BYTES;

    // Use ArrayBuffer.transfer() for zero-copy growth if available
    if ("transfer" in ArrayBuffer.prototype) {
      // ArrayBuffer.transfer is a newer API, cast to interface with the method
      this.buffer = (
        this.buffer as ArrayBuffer & { transfer(newByteLength: number): ArrayBuffer }
      ).transfer(newBufferSize);
    } else {
      // Fallback: copy to new buffer
      const newBuffer = new ArrayBuffer(newBufferSize);
      new Uint8Array(newBuffer).set(new Uint8Array(this.buffer));
      this.buffer = newBuffer;
    }

    this.view = new DataView(this.buffer);

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
 * Create an AoS arena with pre-allocated capacity based on document size
 */
export function createAosArena(estimatedNodes?: number): AosArena {
  const capacity = estimatedNodes ?? DEFAULT_INITIAL_CAPACITY;
  // Round up to power of 2 for efficient growth
  const powerOf2 = 2 ** Math.ceil(Math.log2(Math.max(capacity, 64)));
  return new AosArena(powerOf2);
}
