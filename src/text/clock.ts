/**
 * Lamport clocks and version vector operations.
 *
 * A LamportClock is a per-replica monotonic counter. The VersionVector
 * tracks the highest counter seen from each replica — it serves as a
 * causal ordering: operation A "happened before" B if A's version is
 * included in B's version vector.
 */

import { type OperationId, type ReplicaId, type VersionVector, replicaId } from "./types.js";

/**
 * Per-replica monotonic counter for generating OperationIds.
 */
export class LamportClock {
  readonly replicaId: ReplicaId;
  private _counter: number;

  constructor(rid: ReplicaId, initialCounter = 0) {
    this.replicaId = rid;
    this._counter = initialCounter;
  }

  /** Current counter value. */
  get counter(): number {
    return this._counter;
  }

  /** Generate the next OperationId and increment the counter. */
  tick(): OperationId {
    const id: OperationId = {
      replicaId: this.replicaId,
      counter: this._counter,
    };
    this._counter++;
    return id;
  }

  /** Update the counter to be at least as large as `observed + 1`. */
  observe(observed: number): void {
    if (observed >= this._counter) {
      this._counter = observed + 1;
    }
  }
}

// ---------------------------------------------------------------------------
// VersionVector operations
// ---------------------------------------------------------------------------

/** Create an empty version vector. */
export function createVersionVector(): VersionVector {
  return new Map<ReplicaId, number>();
}

/** Clone a version vector. */
export function cloneVersionVector(vv: VersionVector): VersionVector {
  return new Map(vv);
}

/**
 * Record that we've seen an operation from the given replica with the given counter.
 * Sets the entry to max(existing, counter).
 */
export function observeVersion(vv: VersionVector, rid: ReplicaId, counter: number): void {
  const existing = vv.get(rid);
  if (existing === undefined || counter > existing) {
    vv.set(rid, counter);
  }
}

/**
 * Merge `other` into `vv` in place (max-wins per entry).
 */
export function mergeVersionVectors(vv: VersionVector, other: VersionVector): void {
  for (const [rid, counter] of other) {
    observeVersion(vv, rid, counter);
  }
}

/**
 * Check whether the version vector includes the given operation
 * (i.e., the vector's entry for that replica >= the operation's counter).
 */
export function versionIncludes(vv: VersionVector, opId: OperationId): boolean {
  const entry = vv.get(opId.replicaId);
  return entry !== undefined && entry >= opId.counter;
}

/**
 * Check whether `a` happened before `b` (a is causally before b).
 * True iff every entry in a is <= the corresponding entry in b,
 * and at least one entry is strictly less.
 */
export function happenedBefore(a: VersionVector, b: VersionVector): boolean {
  let strictlyLess = false;

  for (const [rid, aCounter] of a) {
    const bCounter = b.get(rid);
    if (bCounter === undefined || aCounter > bCounter) {
      return false;
    }
    if (aCounter < bCounter) {
      strictlyLess = true;
    }
  }

  // Also check entries in b that are not in a — they make b strictly greater.
  for (const [rid] of b) {
    if (!a.has(rid)) {
      strictlyLess = true;
    }
  }

  return strictlyLess;
}

/**
 * Check if two version vectors are equal.
 */
export function versionVectorsEqual(a: VersionVector, b: VersionVector): boolean {
  if (a.size !== b.size) return false;
  for (const [rid, counter] of a) {
    if (b.get(rid) !== counter) return false;
  }
  return true;
}

/**
 * Generate a unique ReplicaId. Uses a simple random 30-bit integer.
 * (30 bits to stay well within safe integer range when used as a branded number.)
 */
export function generateReplicaId(): ReplicaId {
  return replicaId(Math.floor(Math.random() * 0x3fffffff) + 1);
}
