/**
 * State synchronization for CRDT collaboration.
 *
 * Provides full state snapshot creation and application for:
 * - Initial sync when a new replica joins
 * - Recovery after operation queue overflow
 * - Periodic state verification
 */

import { cloneVersionVector } from "../text/clock.js";
import { createFragment } from "../text/fragment.js";
import type { Fragment, OperationId, ReplicaId, VersionVector } from "../text/types.js";
import { BINARY_VERSION, type SerializedFragment, type StateSnapshot } from "./types.js";

// ---------------------------------------------------------------------------
// Snapshot Creation
// ---------------------------------------------------------------------------

/**
 * Context for creating a state snapshot from a TextBuffer.
 */
export interface SnapshotSourceContext {
  /** The replica creating the snapshot. */
  readonly replicaId: ReplicaId;
  /** Current version vector. */
  readonly versionVector: VersionVector;
  /** All fragments in document order. */
  readonly fragments: ReadonlyArray<Fragment>;
  /** All undo counts. */
  readonly undoCounts: ReadonlyArray<{ operationId: OperationId; count: number }>;
}

/**
 * Create a state snapshot from buffer context.
 */
export function createSnapshot(context: SnapshotSourceContext): StateSnapshot {
  const serializedFragments: SerializedFragment[] = [];

  for (const frag of context.fragments) {
    serializedFragments.push({
      insertionId: frag.insertionId,
      insertionOffset: frag.insertionOffset,
      locatorLevels: [...frag.locator.levels],
      baseLocatorLevels: [...frag.baseLocator.levels],
      length: frag.length,
      visible: frag.visible,
      deletions: [...frag.deletions],
      text: frag.text,
    });
  }

  return {
    version: BINARY_VERSION,
    replicaId: context.replicaId,
    versionVector: cloneVersionVector(context.versionVector),
    fragments: serializedFragments,
    undoCounts: [...context.undoCounts],
  };
}

// ---------------------------------------------------------------------------
// Snapshot Application
// ---------------------------------------------------------------------------

/**
 * Result of applying a state snapshot.
 */
export interface ApplySnapshotResult {
  /** Reconstructed fragments. */
  readonly fragments: Fragment[];
  /** Reconstructed version vector. */
  readonly versionVector: VersionVector;
  /** Reconstructed undo counts. */
  readonly undoCounts: Map<string, number>;
}

/**
 * Apply a state snapshot to reconstruct document state.
 */
export function applySnapshot(snapshot: StateSnapshot): ApplySnapshotResult {
  const fragments: Fragment[] = [];

  for (const serialized of snapshot.fragments) {
    const fragment = createFragment(
      serialized.insertionId,
      serialized.insertionOffset,
      { levels: [...serialized.locatorLevels] },
      serialized.text,
      serialized.visible,
      [...serialized.deletions],
      { levels: [...serialized.baseLocatorLevels] },
    );
    fragments.push(fragment);
  }

  const undoCounts = new Map<string, number>();
  for (const entry of snapshot.undoCounts) {
    const key = `${entry.operationId.replicaId}:${entry.operationId.counter}`;
    undoCounts.set(key, entry.count);
  }

  return {
    fragments,
    versionVector: cloneVersionVector(snapshot.versionVector),
    undoCounts,
  };
}

// ---------------------------------------------------------------------------
// Differential Sync (Future Enhancement)
// ---------------------------------------------------------------------------

/**
 * Compute operations needed to bring a replica from one version to another.
 * This is a placeholder for future delta-sync optimization.
 */
export interface DeltaSyncRequest {
  /** Replica requesting sync. */
  readonly replicaId: ReplicaId;
  /** Replica's current version vector. */
  readonly fromVersion: VersionVector;
}

/**
 * Check if a full sync is required based on version vectors.
 */
export function requiresFullSync(
  localVersion: VersionVector,
  remoteVersion: VersionVector,
): boolean {
  // Full sync required if remote is ahead on any replica we don't know about,
  // or if there's a significant version gap

  for (const [rid, remoteCounter] of remoteVersion) {
    const localCounter = localVersion.get(rid);
    if (localCounter === undefined) {
      // We don't know about this replica at all
      return true;
    }
    // If gap is too large, prefer full sync
    if (remoteCounter - localCounter > 1000) {
      return true;
    }
  }

  return false;
}

// ---------------------------------------------------------------------------
// Snapshot Verification
// ---------------------------------------------------------------------------

/**
 * Verify that two snapshots represent the same document state.
 * Useful for testing convergence.
 */
export function snapshotsEqual(a: StateSnapshot, b: StateSnapshot): boolean {
  // Compare version vectors
  if (a.versionVector.size !== b.versionVector.size) {
    return false;
  }
  for (const [rid, counter] of a.versionVector) {
    if (b.versionVector.get(rid) !== counter) {
      return false;
    }
  }

  // Compare fragments
  if (a.fragments.length !== b.fragments.length) {
    return false;
  }
  for (let i = 0; i < a.fragments.length; i++) {
    const fa = a.fragments[i] as SerializedFragment;
    const fb = b.fragments[i] as SerializedFragment;

    if (
      fa.insertionId.replicaId !== fb.insertionId.replicaId ||
      fa.insertionId.counter !== fb.insertionId.counter ||
      fa.insertionOffset !== fb.insertionOffset ||
      fa.length !== fb.length ||
      fa.visible !== fb.visible ||
      fa.text !== fb.text
    ) {
      return false;
    }

    // Compare locators
    if (fa.locatorLevels.length !== fb.locatorLevels.length) {
      return false;
    }
    for (let j = 0; j < fa.locatorLevels.length; j++) {
      const levelA = fa.locatorLevels[j] as number;
      const levelB = fb.locatorLevels[j] as number;
      if (levelA !== levelB) {
        return false;
      }
    }

    // Compare deletions
    if (fa.deletions.length !== fb.deletions.length) {
      return false;
    }
    for (let j = 0; j < fa.deletions.length; j++) {
      const da = fa.deletions[j] as OperationId;
      const db = fb.deletions[j] as OperationId;
      if (da.replicaId !== db.replicaId || da.counter !== db.counter) {
        return false;
      }
    }
  }

  // Compare undo counts
  if (a.undoCounts.length !== b.undoCounts.length) {
    return false;
  }
  const aUndoMap = new Map<string, number>();
  const bUndoMap = new Map<string, number>();
  for (const entry of a.undoCounts) {
    aUndoMap.set(`${entry.operationId.replicaId}:${entry.operationId.counter}`, entry.count);
  }
  for (const entry of b.undoCounts) {
    bUndoMap.set(`${entry.operationId.replicaId}:${entry.operationId.counter}`, entry.count);
  }
  if (aUndoMap.size !== bUndoMap.size) {
    return false;
  }
  for (const [key, count] of aUndoMap) {
    if (bUndoMap.get(key) !== count) {
      return false;
    }
  }

  return true;
}

/**
 * Get the visible text from a snapshot.
 * Useful for comparing document content after convergence.
 */
export function getSnapshotText(snapshot: StateSnapshot): string {
  const parts: string[] = [];
  for (const frag of snapshot.fragments) {
    if (frag.visible) {
      parts.push(frag.text);
    }
  }
  return parts.join("");
}
