/**
 * CRDT Serialization
 *
 * Provides snapshot serialization for the TextBuffer CRDT. Supports both
 * JSON (human-readable) and binary (compact) formats.
 *
 * A snapshot contains all state needed to fully reconstruct a TextBuffer:
 * - Fragment data (text, locators, visibility, deletions)
 * - Undo map entries
 * - Undo/redo stacks
 * - Version vector and clock state
 * - Applied operations set (for idempotency)
 */

import type { Fragment, Locator, OperationId, ReplicaId, TransactionId } from "./types.js";
import { replicaId, transactionId } from "./types.js";

// ---------------------------------------------------------------------------
// Serialization Format Version
// ---------------------------------------------------------------------------

/** Current serialization format version. Increment on breaking changes. */
export const SERIALIZATION_VERSION = 1;

// ---------------------------------------------------------------------------
// Serialized Types (JSON-friendly representations)
// ---------------------------------------------------------------------------

/** Serialized representation of an OperationId. */
export interface SerializedOperationId {
  readonly r: number; // replicaId
  readonly c: number; // counter
}

/** Serialized representation of a Locator. */
export interface SerializedLocator {
  readonly l: ReadonlyArray<number>; // levels
}

/** Serialized representation of a Fragment. */
export interface SerializedFragment {
  readonly id: SerializedOperationId; // insertionId
  readonly io: number; // insertionOffset
  readonly loc: SerializedLocator; // locator
  readonly base: SerializedLocator; // baseLocator
  readonly t: string; // text
  readonly v: boolean; // visible
  readonly del: ReadonlyArray<SerializedOperationId>; // deletions
}

/** Serialized undo map entry. */
export interface SerializedUndoEntry {
  readonly op: SerializedOperationId;
  readonly count: number;
}

/** Serialized undo/redo stack entry. */
export interface SerializedUndoStackEntry {
  readonly txnId: number; // transactionId
  readonly ops: ReadonlyArray<SerializedOperationId>; // operationIds
  readonly counts: ReadonlyArray<{
    readonly op: SerializedOperationId;
    readonly old: number;
    readonly new: number;
  }>;
}

/** Serialized version vector entry. */
export interface SerializedVersionEntry {
  readonly r: number; // replicaId
  readonly c: number; // counter
}

/** Complete serialized snapshot of a TextBuffer. */
export interface SerializedSnapshot {
  /** Format version for compatibility checking. */
  readonly version: number;
  /** Replica ID of the buffer. */
  readonly replicaId: number;
  /** Current clock counter. */
  readonly clockCounter: number;
  /** Version vector entries. */
  readonly versionVector: ReadonlyArray<SerializedVersionEntry>;
  /** All fragments in document order. */
  readonly fragments: ReadonlyArray<SerializedFragment>;
  /** Undo map entries. */
  readonly undoMap: ReadonlyArray<SerializedUndoEntry>;
  /** Undo stack. */
  readonly undoStack: ReadonlyArray<SerializedUndoStackEntry>;
  /** Redo stack. */
  readonly redoStack: ReadonlyArray<SerializedUndoStackEntry>;
  /** Applied operation IDs (for idempotency). */
  readonly appliedOps: ReadonlyArray<string>;
  /** Next transaction ID. */
  readonly nextTransactionId: number;
  /** Group delay setting (ms). */
  readonly groupDelay: number;
}

// ---------------------------------------------------------------------------
// Serialization Helpers
// ---------------------------------------------------------------------------

/** Serialize an OperationId. */
export function serializeOperationId(opId: OperationId): SerializedOperationId {
  return { r: opId.replicaId, c: opId.counter };
}

/** Deserialize an OperationId. */
export function deserializeOperationId(s: SerializedOperationId): OperationId {
  return { replicaId: replicaId(s.r), counter: s.c };
}

/** Serialize a Locator. */
export function serializeLocator(loc: Locator): SerializedLocator {
  return { l: [...loc.levels] };
}

/** Deserialize a Locator. */
export function deserializeLocator(s: SerializedLocator): Locator {
  return { levels: [...s.l] };
}

/** Serialize a Fragment (without the summary method). */
export function serializeFragment(frag: Fragment): SerializedFragment {
  return {
    id: serializeOperationId(frag.insertionId),
    io: frag.insertionOffset,
    loc: serializeLocator(frag.locator),
    base: serializeLocator(frag.baseLocator),
    t: frag.text,
    v: frag.visible,
    del: frag.deletions.map(serializeOperationId),
  };
}

/** Serialize a version vector. */
export function serializeVersionVector(vv: Map<ReplicaId, number>): SerializedVersionEntry[] {
  const entries: SerializedVersionEntry[] = [];
  vv.forEach((counter, rid) => {
    entries.push({ r: rid, c: counter });
  });
  return entries;
}

/** Deserialize a version vector. */
export function deserializeVersionVector(
  entries: ReadonlyArray<SerializedVersionEntry>,
): Map<ReplicaId, number> {
  const vv = new Map<ReplicaId, number>();
  for (const entry of entries) {
    vv.set(replicaId(entry.r), entry.c);
  }
  return vv;
}

/** Deserialize a TransactionId. */
export function deserializeTransactionId(n: number): TransactionId {
  return transactionId(n);
}

// ---------------------------------------------------------------------------
// Binary Serialization
// ---------------------------------------------------------------------------

/**
 * Binary format specification:
 *
 * Header (16 bytes):
 *   - Magic bytes: "CRDT" (4 bytes)
 *   - Version: uint32 (4 bytes)
 *   - ReplicaId: uint32 (4 bytes)
 *   - ClockCounter: uint32 (4 bytes)
 *
 * Version Vector Section:
 *   - Count: uint32
 *   - Entries: (replicaId: uint32, counter: uint32)[]
 *
 * Fragments Section:
 *   - Count: uint32
 *   - For each fragment:
 *     - insertionId: (replicaId: uint32, counter: uint32)
 *     - insertionOffset: uint32
 *     - locator levels count: uint16
 *     - locator levels: float64[]
 *     - baseLocator levels count: uint16
 *     - baseLocator levels: float64[]
 *     - text length: uint32
 *     - text: UTF-8 bytes
 *     - visible: uint8 (0 or 1)
 *     - deletions count: uint16
 *     - deletions: (replicaId: uint32, counter: uint32)[]
 *
 * UndoMap Section:
 *   - Count: uint32
 *   - Entries: (replicaId: uint32, counter: uint32, count: uint32)[]
 *
 * UndoStack Section:
 *   - Count: uint32
 *   - For each entry:
 *     - transactionId: uint32
 *     - operationIds count: uint16
 *     - operationIds: (replicaId: uint32, counter: uint32)[]
 *     - undoCounts count: uint16
 *     - undoCounts: (replicaId: uint32, counter: uint32, old: uint32, new: uint32)[]
 *
 * RedoStack Section: (same format as UndoStack)
 *
 * AppliedOps Section:
 *   - Count: uint32
 *   - For each string:
 *     - length: uint16
 *     - bytes: UTF-8
 *
 * Footer:
 *   - nextTransactionId: uint32
 *   - groupDelay: uint32
 */

const MAGIC = new Uint8Array([0x43, 0x52, 0x44, 0x54]); // "CRDT"

/** Encode a SerializedSnapshot to binary format. */
export function encodeBinary(snapshot: SerializedSnapshot): Uint8Array {
  // Calculate total size
  let size = 16; // Header

  // Version vector
  size += 4 + snapshot.versionVector.length * 8;

  // Fragments
  size += 4;
  for (const frag of snapshot.fragments) {
    size += 8; // insertionId
    size += 4; // insertionOffset
    size += 2 + frag.loc.l.length * 8; // locator
    size += 2 + frag.base.l.length * 8; // baseLocator
    const textBytes = new TextEncoder().encode(frag.t);
    size += 4 + textBytes.length; // text
    size += 1; // visible
    size += 2 + frag.del.length * 8; // deletions
  }

  // UndoMap
  size += 4 + snapshot.undoMap.length * 12;

  // UndoStack
  size += 4;
  for (const entry of snapshot.undoStack) {
    size += 4; // transactionId
    size += 2 + entry.ops.length * 8; // operationIds
    size += 2 + entry.counts.length * 16; // undoCounts
  }

  // RedoStack
  size += 4;
  for (const entry of snapshot.redoStack) {
    size += 4;
    size += 2 + entry.ops.length * 8;
    size += 2 + entry.counts.length * 16;
  }

  // AppliedOps
  size += 4;
  for (const op of snapshot.appliedOps) {
    const bytes = new TextEncoder().encode(op);
    size += 2 + bytes.length;
  }

  // Footer
  size += 8;

  // Allocate buffer
  const buffer = new ArrayBuffer(size);
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  let offset = 0;

  // Write header
  bytes.set(MAGIC, offset);
  offset += 4;
  view.setUint32(offset, snapshot.version, true);
  offset += 4;
  view.setUint32(offset, snapshot.replicaId, true);
  offset += 4;
  view.setUint32(offset, snapshot.clockCounter, true);
  offset += 4;

  // Write version vector
  view.setUint32(offset, snapshot.versionVector.length, true);
  offset += 4;
  for (const entry of snapshot.versionVector) {
    view.setUint32(offset, entry.r, true);
    offset += 4;
    view.setUint32(offset, entry.c, true);
    offset += 4;
  }

  // Write fragments
  view.setUint32(offset, snapshot.fragments.length, true);
  offset += 4;
  const encoder = new TextEncoder();
  for (const frag of snapshot.fragments) {
    // insertionId
    view.setUint32(offset, frag.id.r, true);
    offset += 4;
    view.setUint32(offset, frag.id.c, true);
    offset += 4;
    // insertionOffset
    view.setUint32(offset, frag.io, true);
    offset += 4;
    // locator
    view.setUint16(offset, frag.loc.l.length, true);
    offset += 2;
    for (const level of frag.loc.l) {
      view.setFloat64(offset, level, true);
      offset += 8;
    }
    // baseLocator
    view.setUint16(offset, frag.base.l.length, true);
    offset += 2;
    for (const level of frag.base.l) {
      view.setFloat64(offset, level, true);
      offset += 8;
    }
    // text
    const textBytes = encoder.encode(frag.t);
    view.setUint32(offset, textBytes.length, true);
    offset += 4;
    bytes.set(textBytes, offset);
    offset += textBytes.length;
    // visible
    view.setUint8(offset, frag.v ? 1 : 0);
    offset += 1;
    // deletions
    view.setUint16(offset, frag.del.length, true);
    offset += 2;
    for (const del of frag.del) {
      view.setUint32(offset, del.r, true);
      offset += 4;
      view.setUint32(offset, del.c, true);
      offset += 4;
    }
  }

  // Write undoMap
  view.setUint32(offset, snapshot.undoMap.length, true);
  offset += 4;
  for (const entry of snapshot.undoMap) {
    view.setUint32(offset, entry.op.r, true);
    offset += 4;
    view.setUint32(offset, entry.op.c, true);
    offset += 4;
    view.setUint32(offset, entry.count, true);
    offset += 4;
  }

  // Write undoStack
  view.setUint32(offset, snapshot.undoStack.length, true);
  offset += 4;
  for (const entry of snapshot.undoStack) {
    view.setUint32(offset, entry.txnId, true);
    offset += 4;
    view.setUint16(offset, entry.ops.length, true);
    offset += 2;
    for (const op of entry.ops) {
      view.setUint32(offset, op.r, true);
      offset += 4;
      view.setUint32(offset, op.c, true);
      offset += 4;
    }
    view.setUint16(offset, entry.counts.length, true);
    offset += 2;
    for (const c of entry.counts) {
      view.setUint32(offset, c.op.r, true);
      offset += 4;
      view.setUint32(offset, c.op.c, true);
      offset += 4;
      view.setUint32(offset, c.old, true);
      offset += 4;
      view.setUint32(offset, c.new, true);
      offset += 4;
    }
  }

  // Write redoStack
  view.setUint32(offset, snapshot.redoStack.length, true);
  offset += 4;
  for (const entry of snapshot.redoStack) {
    view.setUint32(offset, entry.txnId, true);
    offset += 4;
    view.setUint16(offset, entry.ops.length, true);
    offset += 2;
    for (const op of entry.ops) {
      view.setUint32(offset, op.r, true);
      offset += 4;
      view.setUint32(offset, op.c, true);
      offset += 4;
    }
    view.setUint16(offset, entry.counts.length, true);
    offset += 2;
    for (const c of entry.counts) {
      view.setUint32(offset, c.op.r, true);
      offset += 4;
      view.setUint32(offset, c.op.c, true);
      offset += 4;
      view.setUint32(offset, c.old, true);
      offset += 4;
      view.setUint32(offset, c.new, true);
      offset += 4;
    }
  }

  // Write appliedOps
  view.setUint32(offset, snapshot.appliedOps.length, true);
  offset += 4;
  for (const op of snapshot.appliedOps) {
    const opBytes = encoder.encode(op);
    view.setUint16(offset, opBytes.length, true);
    offset += 2;
    bytes.set(opBytes, offset);
    offset += opBytes.length;
  }

  // Write footer
  view.setUint32(offset, snapshot.nextTransactionId, true);
  offset += 4;
  view.setUint32(offset, snapshot.groupDelay, true);
  offset += 4;

  return bytes;
}

/** Decode a SerializedSnapshot from binary format. */
export function decodeBinary(data: Uint8Array): SerializedSnapshot {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let offset = 0;

  // Read and validate header
  const magic = data.slice(offset, offset + 4);
  offset += 4;
  if (
    magic[0] !== MAGIC[0] ||
    magic[1] !== MAGIC[1] ||
    magic[2] !== MAGIC[2] ||
    magic[3] !== MAGIC[3]
  ) {
    throw new Error("Invalid CRDT binary format: bad magic bytes");
  }

  const version = view.getUint32(offset, true);
  offset += 4;
  if (version !== SERIALIZATION_VERSION) {
    throw new Error(
      `Unsupported serialization version: ${version} (expected ${SERIALIZATION_VERSION})`,
    );
  }

  const snapshotReplicaId = view.getUint32(offset, true);
  offset += 4;
  const clockCounter = view.getUint32(offset, true);
  offset += 4;

  // Read version vector
  const vvCount = view.getUint32(offset, true);
  offset += 4;
  const versionVector: SerializedVersionEntry[] = [];
  for (let i = 0; i < vvCount; i++) {
    const r = view.getUint32(offset, true);
    offset += 4;
    const c = view.getUint32(offset, true);
    offset += 4;
    versionVector.push({ r, c });
  }

  // Read fragments
  const fragCount = view.getUint32(offset, true);
  offset += 4;
  const decoder = new TextDecoder();
  const fragments: SerializedFragment[] = [];
  for (let i = 0; i < fragCount; i++) {
    // insertionId
    const idR = view.getUint32(offset, true);
    offset += 4;
    const idC = view.getUint32(offset, true);
    offset += 4;
    // insertionOffset
    const io = view.getUint32(offset, true);
    offset += 4;
    // locator
    const locLen = view.getUint16(offset, true);
    offset += 2;
    const locLevels: number[] = [];
    for (let j = 0; j < locLen; j++) {
      locLevels.push(view.getFloat64(offset, true));
      offset += 8;
    }
    // baseLocator
    const baseLen = view.getUint16(offset, true);
    offset += 2;
    const baseLevels: number[] = [];
    for (let j = 0; j < baseLen; j++) {
      baseLevels.push(view.getFloat64(offset, true));
      offset += 8;
    }
    // text
    const textLen = view.getUint32(offset, true);
    offset += 4;
    const textBytes = data.slice(offset, offset + textLen);
    offset += textLen;
    const t = decoder.decode(textBytes);
    // visible
    const v = view.getUint8(offset) === 1;
    offset += 1;
    // deletions
    const delCount = view.getUint16(offset, true);
    offset += 2;
    const del: SerializedOperationId[] = [];
    for (let j = 0; j < delCount; j++) {
      const dr = view.getUint32(offset, true);
      offset += 4;
      const dc = view.getUint32(offset, true);
      offset += 4;
      del.push({ r: dr, c: dc });
    }

    fragments.push({
      id: { r: idR, c: idC },
      io,
      loc: { l: locLevels },
      base: { l: baseLevels },
      t,
      v,
      del,
    });
  }

  // Read undoMap
  const undoMapCount = view.getUint32(offset, true);
  offset += 4;
  const undoMap: SerializedUndoEntry[] = [];
  for (let i = 0; i < undoMapCount; i++) {
    const r = view.getUint32(offset, true);
    offset += 4;
    const c = view.getUint32(offset, true);
    offset += 4;
    const count = view.getUint32(offset, true);
    offset += 4;
    undoMap.push({ op: { r, c }, count });
  }

  // Read undoStack
  const undoStackCount = view.getUint32(offset, true);
  offset += 4;
  const undoStack: SerializedUndoStackEntry[] = [];
  for (let i = 0; i < undoStackCount; i++) {
    const txnId = view.getUint32(offset, true);
    offset += 4;
    const opsCount = view.getUint16(offset, true);
    offset += 2;
    const ops: SerializedOperationId[] = [];
    for (let j = 0; j < opsCount; j++) {
      const r = view.getUint32(offset, true);
      offset += 4;
      const c = view.getUint32(offset, true);
      offset += 4;
      ops.push({ r, c });
    }
    const countsCount = view.getUint16(offset, true);
    offset += 2;
    const counts: { op: SerializedOperationId; old: number; new: number }[] = [];
    for (let j = 0; j < countsCount; j++) {
      const r = view.getUint32(offset, true);
      offset += 4;
      const c = view.getUint32(offset, true);
      offset += 4;
      const oldVal = view.getUint32(offset, true);
      offset += 4;
      const newVal = view.getUint32(offset, true);
      offset += 4;
      counts.push({ op: { r, c }, old: oldVal, new: newVal });
    }
    undoStack.push({ txnId, ops, counts });
  }

  // Read redoStack
  const redoStackCount = view.getUint32(offset, true);
  offset += 4;
  const redoStack: SerializedUndoStackEntry[] = [];
  for (let i = 0; i < redoStackCount; i++) {
    const txnId = view.getUint32(offset, true);
    offset += 4;
    const opsCount = view.getUint16(offset, true);
    offset += 2;
    const ops: SerializedOperationId[] = [];
    for (let j = 0; j < opsCount; j++) {
      const r = view.getUint32(offset, true);
      offset += 4;
      const c = view.getUint32(offset, true);
      offset += 4;
      ops.push({ r, c });
    }
    const countsCount = view.getUint16(offset, true);
    offset += 2;
    const counts: { op: SerializedOperationId; old: number; new: number }[] = [];
    for (let j = 0; j < countsCount; j++) {
      const r = view.getUint32(offset, true);
      offset += 4;
      const c = view.getUint32(offset, true);
      offset += 4;
      const oldVal = view.getUint32(offset, true);
      offset += 4;
      const newVal = view.getUint32(offset, true);
      offset += 4;
      counts.push({ op: { r, c }, old: oldVal, new: newVal });
    }
    redoStack.push({ txnId, ops, counts });
  }

  // Read appliedOps
  const appliedOpsCount = view.getUint32(offset, true);
  offset += 4;
  const appliedOps: string[] = [];
  for (let i = 0; i < appliedOpsCount; i++) {
    const len = view.getUint16(offset, true);
    offset += 2;
    const opBytes = data.slice(offset, offset + len);
    offset += len;
    appliedOps.push(decoder.decode(opBytes));
  }

  // Read footer
  const nextTransactionId = view.getUint32(offset, true);
  offset += 4;
  const groupDelay = view.getUint32(offset, true);
  offset += 4;

  return {
    version,
    replicaId: snapshotReplicaId,
    clockCounter,
    versionVector,
    fragments,
    undoMap,
    undoStack,
    redoStack,
    appliedOps,
    nextTransactionId,
    groupDelay,
  };
}

// ---------------------------------------------------------------------------
// JSON Serialization
// ---------------------------------------------------------------------------

/** Encode a SerializedSnapshot to JSON string. */
export function encodeJSON(snapshot: SerializedSnapshot): string {
  return JSON.stringify(snapshot);
}

/** Decode a SerializedSnapshot from JSON string. */
export function decodeJSON(json: string): SerializedSnapshot {
  const parsed = JSON.parse(json) as SerializedSnapshot;
  if (parsed.version !== SERIALIZATION_VERSION) {
    throw new Error(
      `Unsupported serialization version: ${parsed.version} (expected ${SERIALIZATION_VERSION})`,
    );
  }
  return parsed;
}
