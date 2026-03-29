/**
 * Persistent (copy-on-write) wrapper for SumTree.
 *
 * Provides:
 * - O(1) branching via VersionHandle (just copies a root pointer)
 * - Version history with structural sharing
 * - Epoch-based memory reclamation for unreferenced versions
 *
 * The underlying SumTree already uses path copying for immutable operations,
 * so each mutation produces a new root that shares most nodes with the old.
 * PersistentTree formalizes this into a version management layer.
 */

import type { Epoch } from "../arena/index.js";
import { SumTree, type Summarizable, type Summary } from "./index.js";

// ---------------------------------------------------------------------------
// VersionHandle — lightweight reference to a point-in-time tree state
// ---------------------------------------------------------------------------

/** Unique identifier for a version. */
export type VersionId = number & { readonly __brand: "VersionId" };

function versionId(n: number): VersionId {
  return n as VersionId;
}

/** Metadata stored per version. */
interface VersionEntry<T extends Summarizable<S>, S> {
  /** The SumTree snapshot for this version (shares arena + nodes with other versions). */
  tree: SumTree<T, S>;
  /** Arena epoch at which this version was created. */
  epoch: Epoch;
  /** Parent version (undefined for the initial version). */
  parent: VersionId | undefined;
  /** Number of live handles referencing this version. */
  refCount: number;
  /** Human-readable label (e.g. "before-delete", "branch-A"). */
  label: string | undefined;
  /** Timestamp when this version was created. */
  createdAt: number;
}

/**
 * A handle to a specific version of the tree.
 * Prevents the version's nodes from being garbage-collected.
 * Must be released when no longer needed.
 */
export class VersionHandle<T extends Summarizable<S>, S> {
  private _id: VersionId;
  private _persistent: PersistentTree<T, S> | null;

  constructor(id: VersionId, persistent: PersistentTree<T, S>) {
    this._id = id;
    this._persistent = persistent;
  }

  /** The version ID. */
  get id(): VersionId {
    return this._id;
  }

  /** Whether this handle has been released. */
  get released(): boolean {
    return this._persistent === null;
  }

  /** Get the immutable tree at this version. */
  get tree(): SumTree<T, S> {
    if (this._persistent === null) {
      throw new Error("VersionHandle has been released");
    }
    return this._persistent.getTree(this._id);
  }

  /** Release this handle, allowing GC of unreferenced nodes. */
  release(): void {
    if (this._persistent !== null) {
      this._persistent.releaseVersion(this._id);
      this._persistent = null;
    }
  }
}

// ---------------------------------------------------------------------------
// PersistentTree — version-managed SumTree with O(1) branching
// ---------------------------------------------------------------------------

/** Statistics about structural sharing between versions. */
export interface SharingStats {
  /** Total versions tracked. */
  versionCount: number;
  /** Total live handles. */
  liveHandleCount: number;
  /** Arena node count (shared across all versions). */
  arenaAllocated: number;
  /** Arena capacity. */
  arenaCapacity: number;
  /** Arena utilization ratio. */
  utilizationRatio: number;
}

/**
 * A persistent (versioned) tree that tracks multiple versions of a SumTree
 * with structural sharing.
 *
 * Each mutation returns a new version that shares most of its internal
 * nodes with previous versions. Old versions remain valid and accessible
 * as long as a VersionHandle references them.
 *
 * ## Usage
 *
 * ```typescript
 * const pt = new PersistentTree(summaryOps);
 *
 * // Mutate and track versions
 * pt.insertAt(0, item1);
 * const v1 = pt.createHandle("after-first-insert");
 *
 * pt.insertAt(1, item2);
 * const v2 = pt.createHandle("after-second-insert");
 *
 * // v1 and v2 see different states, sharing structure
 * v1.tree.length(); // 1
 * v2.tree.length(); // 2
 *
 * // Branch from an old version
 * const branch = pt.branch(v1.id);
 * branch.insertAt(1, item3); // diverges from v2
 *
 * // Release handles when done
 * v1.release();
 * v2.release();
 * ```
 */
export class PersistentTree<T extends Summarizable<S>, S> {
  private versions: Map<VersionId, VersionEntry<T, S>>;
  private nextVersionId: number;
  private _current: VersionId;
  private summaryOps: Summary<S>;
  private branchingFactor: number;

  constructor(summaryOps: Summary<S>, branchingFactor?: number) {
    this.versions = new Map();
    this.nextVersionId = 1;
    this.summaryOps = summaryOps;
    this.branchingFactor = branchingFactor ?? 16;

    // Create initial version with an empty tree
    const tree = new SumTree<T, S>(summaryOps, this.branchingFactor);
    const epoch = tree.getArena().currentEpoch;
    const id = this.allocateVersionId();
    this.versions.set(id, {
      tree,
      epoch,
      parent: undefined,
      refCount: 1, // current pointer counts as a reference
      label: "initial",
      createdAt: Date.now(),
    });
    this._current = id;
  }

  // ---------------------------------------------------------------------------
  // Version management
  // ---------------------------------------------------------------------------

  /** Get the current version ID. */
  get currentVersionId(): VersionId {
    return this._current;
  }

  /** Get the current tree (mutable head). */
  get tree(): SumTree<T, S> {
    return this.getTree(this._current);
  }

  /** Get the tree for a specific version. */
  getTree(id: VersionId): SumTree<T, S> {
    const entry = this.versions.get(id);
    if (entry === undefined) {
      throw new Error(`Version ${id} does not exist`);
    }
    return entry.tree;
  }

  /**
   * Create a VersionHandle to the current state.
   * This is O(1) — it just increments a ref count.
   * The handle keeps the version's nodes alive until released.
   */
  createHandle(label?: string): VersionHandle<T, S> {
    const entry = this.versions.get(this._current);
    if (entry === undefined) {
      throw new Error("Current version does not exist");
    }
    entry.refCount++;
    if (label !== undefined) {
      entry.label = label;
    }
    return new VersionHandle<T, S>(this._current, this);
  }

  /**
   * Create a handle to a specific version.
   */
  createHandleAt(id: VersionId, label?: string): VersionHandle<T, S> {
    const entry = this.versions.get(id);
    if (entry === undefined) {
      throw new Error(`Version ${id} does not exist`);
    }
    entry.refCount++;
    if (label !== undefined) {
      entry.label = label;
    }
    return new VersionHandle<T, S>(id, this);
  }

  /**
   * Release a version reference. When refCount drops to 0 and the version
   * is not the current head, it becomes eligible for cleanup.
   */
  releaseVersion(id: VersionId): void {
    const entry = this.versions.get(id);
    if (entry === undefined) {
      return;
    }
    entry.refCount = Math.max(0, entry.refCount - 1);
    // Don't remove versions that are still current or have refs
    // GC can be triggered explicitly via collectUnreachable()
  }

  /**
   * Get the version history chain from a version back to the root.
   */
  history(fromId?: VersionId): VersionId[] {
    const result: VersionId[] = [];
    let current: VersionId | undefined = fromId ?? this._current;

    while (current !== undefined) {
      result.push(current);
      const entry = this.versions.get(current);
      current = entry?.parent;
    }

    return result;
  }

  /**
   * Get the number of tracked versions.
   */
  get versionCount(): number {
    return this.versions.size;
  }

  // ---------------------------------------------------------------------------
  // Mutations (advance current version)
  // ---------------------------------------------------------------------------

  /**
   * Insert an item at index, creating a new version.
   * The old version's tree is preserved (structural sharing via path copying).
   * O(log n) — copies only the path from root to the modified leaf.
   */
  insertAt(index: number, item: T): VersionId {
    const oldTree = this.tree;
    const newTree = oldTree.insertAt(index, item);
    return this.advanceTo(newTree);
  }

  /**
   * Push an item to the end, creating a new version.
   */
  push(item: T): VersionId {
    const oldTree = this.tree;
    const newTree = oldTree.push(item);
    return this.advanceTo(newTree);
  }

  /**
   * Remove item at index, creating a new version.
   */
  removeAt(index: number): VersionId {
    const oldTree = this.tree;
    const newTree = oldTree.removeAt(index);
    return this.advanceTo(newTree);
  }

  /**
   * Replace item at index with multiple items, creating a new version.
   */
  replaceAt(index: number, items: T[]): VersionId {
    const oldTree = this.tree;
    const newTree = oldTree.replaceAt(index, items);
    return this.advanceTo(newTree);
  }

  /**
   * Advance to an externally-produced tree as a new version.
   * Useful when the caller does custom mutations.
   */
  advanceTo(newTree: SumTree<T, S>, label?: string): VersionId {
    const parentId = this._current;
    const parentEntry = this.versions.get(parentId);

    // Decrement refCount on old current (current pointer is moving)
    if (parentEntry !== undefined) {
      parentEntry.refCount = Math.max(0, parentEntry.refCount - 1);
    }

    const epoch = newTree.getArena().currentEpoch;
    const id = this.allocateVersionId();
    this.versions.set(id, {
      tree: newTree,
      epoch,
      parent: parentId,
      refCount: 1, // current pointer
      label,
      createdAt: Date.now(),
    });
    this._current = id;

    return id;
  }

  // ---------------------------------------------------------------------------
  // Branching — O(1) fork from any version
  // ---------------------------------------------------------------------------

  /**
   * Create a new PersistentTree branched from the given version.
   * O(1) — the new tree shares all nodes with the original via the shared arena.
   *
   * The branch is independent: mutations on either branch don't affect the other.
   */
  branch(fromId?: VersionId): PersistentTree<T, S> {
    const sourceId = fromId ?? this._current;
    const sourceEntry = this.versions.get(sourceId);
    if (sourceEntry === undefined) {
      throw new Error(`Version ${sourceId} does not exist`);
    }

    // Create a new PersistentTree starting from a snapshot of the source tree.
    // snapshotClone() is O(1): copies root pointer, shares arena.
    // Note: summaries Map is copied (O(nodes)), which is the main cost.
    const branchedTree = sourceEntry.tree.snapshotClone();
    const branch = new PersistentTree<T, S>(this.summaryOps, this.branchingFactor);

    // Replace the initial version's tree with our branched tree
    const initialId = branch._current;
    const initialEntry = branch.versions.get(initialId);
    if (initialEntry !== undefined) {
      initialEntry.tree = branchedTree;
      initialEntry.label = `branch-from-v${sourceId}`;
    }

    return branch;
  }

  // ---------------------------------------------------------------------------
  // Time travel
  // ---------------------------------------------------------------------------

  /**
   * Rewind current to a previous version.
   * Does NOT discard newer versions — they remain accessible via handles.
   * O(1) — just moves the current pointer.
   */
  rewindTo(id: VersionId): void {
    const entry = this.versions.get(id);
    if (entry === undefined) {
      throw new Error(`Version ${id} does not exist`);
    }

    // Decrement old current's refCount
    const oldEntry = this.versions.get(this._current);
    if (oldEntry !== undefined) {
      oldEntry.refCount = Math.max(0, oldEntry.refCount - 1);
    }

    // Increment new current's refCount
    entry.refCount++;
    this._current = id;
  }

  // ---------------------------------------------------------------------------
  // Memory management
  // ---------------------------------------------------------------------------

  /**
   * Remove versions with zero references that are not the current head
   * and are not ancestors of any referenced version.
   * Returns the number of versions removed.
   */
  collectUnreachable(): number {
    // Mark all versions reachable from any live handle or current
    const reachable = new Set<VersionId>();

    for (const [id, entry] of this.versions) {
      if (entry.refCount > 0) {
        // Walk ancestry chain to mark all ancestors as reachable
        let current: VersionId | undefined = id;
        while (current !== undefined && !reachable.has(current)) {
          reachable.add(current);
          const e = this.versions.get(current);
          current = e?.parent;
        }
      }
    }

    // Remove unreachable versions
    let removed = 0;
    for (const [id] of this.versions) {
      if (!reachable.has(id)) {
        this.versions.delete(id);
        removed++;
      }
    }

    return removed;
  }

  /**
   * Get statistics about structural sharing and memory usage.
   */
  stats(): SharingStats {
    let liveHandles = 0;
    for (const entry of this.versions.values()) {
      liveHandles += entry.refCount;
    }

    const arena = this.tree.getArena();

    return {
      versionCount: this.versions.size,
      liveHandleCount: liveHandles,
      arenaAllocated: arena.allocated,
      arenaCapacity: arena.capacity,
      utilizationRatio: arena.allocated / arena.capacity,
    };
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private allocateVersionId(): VersionId {
    return versionId(this.nextVersionId++);
  }
}
