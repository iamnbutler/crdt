/**
 * Binary serialization for CRDT operations and state.
 *
 * Uses a compact binary format optimized for performance:
 * - Variable-length integers (VarInt) for most numbers
 * - UTF-8 encoding for text with length prefix
 * - Fixed-size headers for message framing
 */

import { replicaId, transactionId } from "../text/types.js";
import type {
  DeleteOperation,
  DeleteRange,
  InsertOperation,
  InsertionRef,
  Locator,
  Operation,
  OperationId,
  UndoOperation,
  VersionVector,
} from "../text/types.js";
import {
  BINARY_VERSION,
  OperationType,
  PROTOCOL_MAGIC,
  type SerializedFragment,
  type StateSnapshot,
} from "./types.js";

// ---------------------------------------------------------------------------
// Binary Writer
// ---------------------------------------------------------------------------

/**
 * Efficient binary writer with automatic buffer growth.
 */
export class BinaryWriter {
  private buffer: Uint8Array;
  private view: DataView;
  private offset: number;

  constructor(initialSize = 1024) {
    this.buffer = new Uint8Array(initialSize);
    this.view = new DataView(this.buffer.buffer);
    this.offset = 0;
  }

  private ensureCapacity(needed: number): void {
    const required = this.offset + needed;
    if (required <= this.buffer.length) return;

    // Double capacity until we have enough
    let newSize = this.buffer.length * 2;
    while (newSize < required) {
      newSize *= 2;
    }

    const newBuffer = new Uint8Array(newSize);
    newBuffer.set(this.buffer);
    this.buffer = newBuffer;
    this.view = new DataView(this.buffer.buffer);
  }

  /** Write a single byte (0-255). */
  writeU8(value: number): void {
    this.ensureCapacity(1);
    this.buffer[this.offset++] = value & 0xff;
  }

  /** Write a 32-bit unsigned integer (little-endian). */
  writeU32(value: number): void {
    this.ensureCapacity(4);
    this.view.setUint32(this.offset, value, true);
    this.offset += 4;
  }

  /** Write a 64-bit float (for safe integer range). */
  writeF64(value: number): void {
    this.ensureCapacity(8);
    this.view.setFloat64(this.offset, value, true);
    this.offset += 8;
  }

  /**
   * Write a variable-length unsigned integer.
   * Uses 7 bits per byte, MSB indicates continuation.
   */
  writeVarUint(value: number): void {
    let v = value;
    while (v >= 0x80) {
      this.writeU8((v & 0x7f) | 0x80);
      v >>>= 7;
    }
    this.writeU8(v);
  }

  /**
   * Write a variable-length signed integer (ZigZag encoding).
   */
  writeVarInt(value: number): void {
    // ZigZag encoding: positive -> even, negative -> odd
    const zigzag = value >= 0 ? value * 2 : -value * 2 - 1;
    this.writeVarUint(zigzag);
  }

  /** Write a length-prefixed UTF-8 string. */
  writeString(str: string): void {
    const encoded = new TextEncoder().encode(str);
    this.writeVarUint(encoded.length);
    this.ensureCapacity(encoded.length);
    this.buffer.set(encoded, this.offset);
    this.offset += encoded.length;
  }

  /** Write raw bytes with length prefix. */
  writeBytes(data: Uint8Array): void {
    this.writeVarUint(data.length);
    this.ensureCapacity(data.length);
    this.buffer.set(data, this.offset);
    this.offset += data.length;
  }

  /** Write a boolean as a single byte. */
  writeBool(value: boolean): void {
    this.writeU8(value ? 1 : 0);
  }

  /** Get the final buffer (trimmed to actual size). */
  finish(): Uint8Array {
    return this.buffer.slice(0, this.offset);
  }

  /** Current write position. */
  get position(): number {
    return this.offset;
  }
}

// ---------------------------------------------------------------------------
// Binary Reader
// ---------------------------------------------------------------------------

/**
 * Binary reader for deserializing data.
 */
export class BinaryReader {
  private buffer: Uint8Array;
  private view: DataView;
  private offset: number;

  constructor(buffer: Uint8Array) {
    this.buffer = buffer;
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    this.offset = 0;
  }

  /** Read a single byte. */
  readU8(): number {
    if (this.offset >= this.buffer.length) {
      throw new Error("Buffer underflow");
    }
    const value = this.buffer[this.offset] ?? 0;
    this.offset++;
    return value;
  }

  /** Read a 32-bit unsigned integer (little-endian). */
  readU32(): number {
    if (this.offset + 4 > this.buffer.length) {
      throw new Error("Buffer underflow");
    }
    const value = this.view.getUint32(this.offset, true);
    this.offset += 4;
    return value;
  }

  /** Read a 64-bit float. */
  readF64(): number {
    if (this.offset + 8 > this.buffer.length) {
      throw new Error("Buffer underflow");
    }
    const value = this.view.getFloat64(this.offset, true);
    this.offset += 8;
    return value;
  }

  /** Read a variable-length unsigned integer. */
  readVarUint(): number {
    let result = 0;
    let shift = 0;
    let byte: number;
    do {
      byte = this.readU8();
      result |= (byte & 0x7f) << shift;
      shift += 7;
    } while (byte >= 0x80);
    return result >>> 0; // Ensure unsigned
  }

  /** Read a variable-length signed integer (ZigZag decoding). */
  readVarInt(): number {
    const zigzag = this.readVarUint();
    // ZigZag decoding
    return (zigzag >>> 1) ^ -(zigzag & 1);
  }

  /** Read a length-prefixed UTF-8 string. */
  readString(): string {
    const length = this.readVarUint();
    if (this.offset + length > this.buffer.length) {
      throw new Error("Buffer underflow");
    }
    const bytes = this.buffer.slice(this.offset, this.offset + length);
    this.offset += length;
    return new TextDecoder().decode(bytes);
  }

  /** Read raw bytes with length prefix. */
  readBytes(): Uint8Array {
    const length = this.readVarUint();
    if (this.offset + length > this.buffer.length) {
      throw new Error("Buffer underflow");
    }
    const bytes = this.buffer.slice(this.offset, this.offset + length);
    this.offset += length;
    return bytes;
  }

  /** Read a boolean. */
  readBool(): boolean {
    return this.readU8() !== 0;
  }

  /** Check if there's more data to read. */
  get hasMore(): boolean {
    return this.offset < this.buffer.length;
  }

  /** Current read position. */
  get position(): number {
    return this.offset;
  }

  /** Remaining bytes. */
  get remaining(): number {
    return this.buffer.length - this.offset;
  }
}

// ---------------------------------------------------------------------------
// OperationId Serialization
// ---------------------------------------------------------------------------

function writeOperationId(writer: BinaryWriter, id: OperationId): void {
  writer.writeVarUint(id.replicaId);
  writer.writeVarUint(id.counter);
}

function readOperationId(reader: BinaryReader): OperationId {
  const rid = replicaId(reader.readVarUint());
  const counter = reader.readVarUint();
  return { replicaId: rid, counter };
}

// ---------------------------------------------------------------------------
// VersionVector Serialization
// ---------------------------------------------------------------------------

function writeVersionVector(writer: BinaryWriter, vv: VersionVector): void {
  writer.writeVarUint(vv.size);
  for (const [rid, counter] of vv) {
    writer.writeVarUint(rid);
    writer.writeVarUint(counter);
  }
}

function readVersionVector(reader: BinaryReader): VersionVector {
  const size = reader.readVarUint();
  const vv: VersionVector = new Map();
  for (let i = 0; i < size; i++) {
    const rid = replicaId(reader.readVarUint());
    const counter = reader.readVarUint();
    vv.set(rid, counter);
  }
  return vv;
}

// ---------------------------------------------------------------------------
// Locator Serialization
// ---------------------------------------------------------------------------

function writeLocator(writer: BinaryWriter, locator: Locator): void {
  writer.writeVarUint(locator.levels.length);
  for (const level of locator.levels) {
    writer.writeF64(level);
  }
}

function readLocator(reader: BinaryReader): Locator {
  const length = reader.readVarUint();
  const levels: number[] = [];
  for (let i = 0; i < length; i++) {
    levels.push(reader.readF64());
  }
  return { levels };
}

// ---------------------------------------------------------------------------
// InsertionRef Serialization
// ---------------------------------------------------------------------------

function writeInsertionRef(writer: BinaryWriter, ref: InsertionRef): void {
  writeOperationId(writer, ref.insertionId);
  writer.writeVarUint(ref.offset);
}

function readInsertionRef(reader: BinaryReader): InsertionRef {
  const insertionId = readOperationId(reader);
  const offset = reader.readVarUint();
  return { insertionId, offset };
}

// ---------------------------------------------------------------------------
// Operation Serialization
// ---------------------------------------------------------------------------

function writeInsertOperation(writer: BinaryWriter, op: InsertOperation): void {
  writer.writeU8(OperationType.Insert);
  writeOperationId(writer, op.id);
  writer.writeString(op.text);
  writeInsertionRef(writer, op.after);
  writeInsertionRef(writer, op.before);
  writeVersionVector(writer, op.version);
  writeLocator(writer, op.locator);
}

function readInsertOperation(reader: BinaryReader): InsertOperation {
  const id = readOperationId(reader);
  const text = reader.readString();
  const after = readInsertionRef(reader);
  const before = readInsertionRef(reader);
  const version = readVersionVector(reader);
  const locator = readLocator(reader);
  return { type: "insert", id, text, after, before, version, locator };
}

function writeDeleteOperation(writer: BinaryWriter, op: DeleteOperation): void {
  writer.writeU8(OperationType.Delete);
  writeOperationId(writer, op.id);
  writer.writeVarUint(op.ranges.length);
  for (const range of op.ranges) {
    writeOperationId(writer, range.insertionId);
    writer.writeVarUint(range.offset);
    writer.writeVarUint(range.length);
  }
  writeVersionVector(writer, op.version);
}

function readDeleteOperation(reader: BinaryReader): DeleteOperation {
  const id = readOperationId(reader);
  const rangeCount = reader.readVarUint();
  const ranges: DeleteRange[] = [];
  for (let i = 0; i < rangeCount; i++) {
    const insertionId = readOperationId(reader);
    const offset = reader.readVarUint();
    const length = reader.readVarUint();
    ranges.push({ insertionId, offset, length });
  }
  const version = readVersionVector(reader);
  return { type: "delete", id, ranges, version };
}

function writeUndoOperation(writer: BinaryWriter, op: UndoOperation): void {
  writer.writeU8(OperationType.Undo);
  writeOperationId(writer, op.id);
  writer.writeVarUint(op.transactionId);
  writer.writeVarUint(op.counts.length);
  for (const entry of op.counts) {
    writeOperationId(writer, entry.operationId);
    writer.writeVarUint(entry.count);
  }
  writeVersionVector(writer, op.version);
}

function readUndoOperation(reader: BinaryReader): UndoOperation {
  const id = readOperationId(reader);
  const txnId = transactionId(reader.readVarUint());
  const countLen = reader.readVarUint();
  const counts: Array<{ operationId: OperationId; count: number }> = [];
  for (let i = 0; i < countLen; i++) {
    const operationId = readOperationId(reader);
    const count = reader.readVarUint();
    counts.push({ operationId, count });
  }
  const version = readVersionVector(reader);
  return { type: "undo", id, transactionId: txnId, counts, version };
}

// ---------------------------------------------------------------------------
// Public API: Operation Serialization
// ---------------------------------------------------------------------------

/**
 * Serialize an operation to binary format.
 */
export function serializeOperation(operation: Operation): Uint8Array {
  const writer = new BinaryWriter();
  writer.writeU32(PROTOCOL_MAGIC);
  writer.writeU8(BINARY_VERSION);

  switch (operation.type) {
    case "insert":
      writeInsertOperation(writer, operation);
      break;
    case "delete":
      writeDeleteOperation(writer, operation);
      break;
    case "undo":
      writeUndoOperation(writer, operation);
      break;
  }

  return writer.finish();
}

/**
 * Deserialize an operation from binary format.
 */
export function deserializeOperation(data: Uint8Array): Operation {
  const reader = new BinaryReader(data);

  const magic = reader.readU32();
  if (magic !== PROTOCOL_MAGIC) {
    throw new Error(`Invalid protocol magic: expected ${PROTOCOL_MAGIC}, got ${magic}`);
  }

  const version = reader.readU8();
  if (version !== BINARY_VERSION) {
    throw new Error(`Unsupported protocol version: ${version}`);
  }

  const opType = reader.readU8();
  switch (opType) {
    case OperationType.Insert:
      return readInsertOperation(reader);
    case OperationType.Delete:
      return readDeleteOperation(reader);
    case OperationType.Undo:
      return readUndoOperation(reader);
    default:
      throw new Error(`Unknown operation type: ${opType}`);
  }
}

// ---------------------------------------------------------------------------
// State Snapshot Serialization
// ---------------------------------------------------------------------------

/**
 * Serialize a full state snapshot to binary format.
 */
export function serializeSnapshot(snapshot: StateSnapshot): Uint8Array {
  const writer = new BinaryWriter(64 * 1024); // Start with 64KB for snapshots
  writer.writeU32(PROTOCOL_MAGIC);
  writer.writeU8(BINARY_VERSION);
  writer.writeU8(2); // Message type: StateSnapshot

  writer.writeVarUint(snapshot.version);
  writer.writeVarUint(snapshot.replicaId);
  writeVersionVector(writer, snapshot.versionVector);

  // Fragments
  writer.writeVarUint(snapshot.fragments.length);
  for (const frag of snapshot.fragments) {
    writeOperationId(writer, frag.insertionId);
    writer.writeVarUint(frag.insertionOffset);

    // Locator levels
    writer.writeVarUint(frag.locatorLevels.length);
    for (const level of frag.locatorLevels) {
      writer.writeF64(level);
    }

    // Base locator levels
    writer.writeVarUint(frag.baseLocatorLevels.length);
    for (const level of frag.baseLocatorLevels) {
      writer.writeF64(level);
    }

    writer.writeVarUint(frag.length);
    writer.writeBool(frag.visible);

    // Deletions
    writer.writeVarUint(frag.deletions.length);
    for (const del of frag.deletions) {
      writeOperationId(writer, del);
    }

    writer.writeString(frag.text);
  }

  // Undo counts
  writer.writeVarUint(snapshot.undoCounts.length);
  for (const entry of snapshot.undoCounts) {
    writeOperationId(writer, entry.operationId);
    writer.writeVarUint(entry.count);
  }

  return writer.finish();
}

/**
 * Deserialize a full state snapshot from binary format.
 */
export function deserializeSnapshot(data: Uint8Array): StateSnapshot {
  const reader = new BinaryReader(data);

  const magic = reader.readU32();
  if (magic !== PROTOCOL_MAGIC) {
    throw new Error(`Invalid protocol magic: expected ${PROTOCOL_MAGIC}, got ${magic}`);
  }

  const binaryVersion = reader.readU8();
  if (binaryVersion !== BINARY_VERSION) {
    throw new Error(`Unsupported protocol version: ${binaryVersion}`);
  }

  const messageType = reader.readU8();
  if (messageType !== 2) {
    throw new Error(`Expected StateSnapshot message type (2), got ${messageType}`);
  }

  const version = reader.readVarUint();
  const rid = replicaId(reader.readVarUint());
  const versionVector = readVersionVector(reader);

  // Fragments
  const fragmentCount = reader.readVarUint();
  const fragments: SerializedFragment[] = [];
  for (let i = 0; i < fragmentCount; i++) {
    const insertionId = readOperationId(reader);
    const insertionOffset = reader.readVarUint();

    // Locator levels
    const locatorLen = reader.readVarUint();
    const locatorLevels: number[] = [];
    for (let j = 0; j < locatorLen; j++) {
      locatorLevels.push(reader.readF64());
    }

    // Base locator levels
    const baseLocatorLen = reader.readVarUint();
    const baseLocatorLevels: number[] = [];
    for (let j = 0; j < baseLocatorLen; j++) {
      baseLocatorLevels.push(reader.readF64());
    }

    const length = reader.readVarUint();
    const visible = reader.readBool();

    // Deletions
    const deletionCount = reader.readVarUint();
    const deletions: OperationId[] = [];
    for (let j = 0; j < deletionCount; j++) {
      deletions.push(readOperationId(reader));
    }

    const text = reader.readString();

    fragments.push({
      insertionId,
      insertionOffset,
      locatorLevels,
      baseLocatorLevels,
      length,
      visible,
      deletions,
      text,
    });
  }

  // Undo counts
  const undoCountLen = reader.readVarUint();
  const undoCounts: Array<{ operationId: OperationId; count: number }> = [];
  for (let i = 0; i < undoCountLen; i++) {
    const operationId = readOperationId(reader);
    const count = reader.readVarUint();
    undoCounts.push({ operationId, count });
  }

  return {
    version,
    replicaId: rid,
    versionVector,
    fragments,
    undoCounts,
  };
}

// ---------------------------------------------------------------------------
// Batch Operation Serialization (for efficiency)
// ---------------------------------------------------------------------------

/**
 * Serialize multiple operations into a single buffer.
 */
export function serializeOperations(operations: ReadonlyArray<Operation>): Uint8Array {
  const writer = new BinaryWriter();
  writer.writeU32(PROTOCOL_MAGIC);
  writer.writeU8(BINARY_VERSION);
  writer.writeU8(1); // Message type: Operation batch
  writer.writeVarUint(operations.length);

  for (const op of operations) {
    switch (op.type) {
      case "insert":
        writeInsertOperation(writer, op);
        break;
      case "delete":
        writeDeleteOperation(writer, op);
        break;
      case "undo":
        writeUndoOperation(writer, op);
        break;
    }
  }

  return writer.finish();
}

/**
 * Deserialize multiple operations from a batch buffer.
 */
export function deserializeOperations(data: Uint8Array): Operation[] {
  const reader = new BinaryReader(data);

  const magic = reader.readU32();
  if (magic !== PROTOCOL_MAGIC) {
    throw new Error(`Invalid protocol magic: expected ${PROTOCOL_MAGIC}, got ${magic}`);
  }

  const version = reader.readU8();
  if (version !== BINARY_VERSION) {
    throw new Error(`Unsupported protocol version: ${version}`);
  }

  const messageType = reader.readU8();
  if (messageType !== 1) {
    throw new Error(`Expected Operation batch message type (1), got ${messageType}`);
  }

  const count = reader.readVarUint();
  const operations: Operation[] = [];

  for (let i = 0; i < count; i++) {
    const opType = reader.readU8();
    switch (opType) {
      case OperationType.Insert:
        operations.push(readInsertOperation(reader));
        break;
      case OperationType.Delete:
        operations.push(readDeleteOperation(reader));
        break;
      case OperationType.Undo:
        operations.push(readUndoOperation(reader));
        break;
      default:
        throw new Error(`Unknown operation type: ${opType}`);
    }
  }

  return operations;
}
