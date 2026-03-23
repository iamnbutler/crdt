/**
 * Arena Allocator Types
 *
 * This module defines the types for the TypedArray arena allocator that backs
 * all SumTree nodes. Nodes are represented as integer indices into the arena.
 */

/** Node index type - indices are 32-bit unsigned integers */
export type NodeIndex = number;

/** Invalid/null node sentinel */
export const NULL_NODE: NodeIndex = 0xffffffff;

/**
 * Node layout for SumTree nodes (AoS layout)
 *
 * Field layout (32 bytes total):
 * - offset 0:  left child index (u32)
 * - offset 4:  right child index (u32)
 * - offset 8:  parent index (u32)
 * - offset 12: flags (u32) - allocation status, mark bit, etc.
 * - offset 16: sum value (f64)
 * - offset 24: user data / payload (f64)
 */
export const NODE_SIZE_BYTES = 32;

export const NODE_OFFSETS = {
  LEFT: 0,
  RIGHT: 4,
  PARENT: 8,
  FLAGS: 12,
  SUM: 16,
  PAYLOAD: 24,
} as const;

/** Node flags */
export const NODE_FLAGS = {
  ALLOCATED: 1 << 0,
  MARKED: 1 << 1,
  LEAF: 1 << 2,
} as const;

/**
 * Arena statistics
 */
export interface ArenaStats {
  /** Total capacity in nodes */
  capacity: number;
  /** Number of currently allocated nodes */
  liveNodes: number;
  /** Number of free nodes */
  freeNodes: number;
  /** Arena utilization ratio (liveNodes / capacity) */
  utilization: number;
  /** Total memory in bytes */
  memoryBytes: number;
  /** Current epoch for snapshot tracking */
  epoch: number;
}

/**
 * Common interface for arena allocators
 */
export interface Arena {
  /** Allocate a new node, returns its index */
  allocNode(): NodeIndex;

  /** Free a node by index */
  freeNode(index: NodeIndex): void;

  /** Get current number of allocated nodes */
  readonly nodeCount: number;

  /** Get total capacity */
  readonly capacity: number;

  /** Get arena statistics */
  getStats(): ArenaStats;

  /** Node accessors */
  getLeft(index: NodeIndex): NodeIndex;
  setLeft(index: NodeIndex, value: NodeIndex): void;
  getRight(index: NodeIndex): NodeIndex;
  setRight(index: NodeIndex, value: NodeIndex): void;
  getParent(index: NodeIndex): NodeIndex;
  setParent(index: NodeIndex, value: NodeIndex): void;
  getSum(index: NodeIndex): number;
  setSum(index: NodeIndex, value: number): void;
  getPayload(index: NodeIndex): number;
  setPayload(index: NodeIndex, value: number): void;
  getFlags(index: NodeIndex): number;
  setFlags(index: NodeIndex, value: number): void;

  /** Epoch management for snapshot-aware reclamation */
  getCurrentEpoch(): number;
  advanceEpoch(): number;

  /** Mark-sweep garbage collection */
  markNode(index: NodeIndex): void;
  sweep(): number;

  /** Release the arena and free all resources */
  release(): void;
}

/**
 * Snapshot reference for epoch-based reclamation
 */
export interface Snapshot {
  /** Epoch when snapshot was created */
  readonly epoch: number;
  /** Mark snapshot as no longer needed */
  release(): void;
}
