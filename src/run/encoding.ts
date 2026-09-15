import {
  type Insert,
  type Operation,
  type Span,
  integer,
  validateInsert,
  validateSpan,
} from "./types.js";

const MAGIC = [82, 84, 88, 1]; // RTX, wire version 1

class Writer {
  private bytes = new Uint8Array(1024);
  private length = 0;

  byte(value: number): void {
    if (this.length === this.bytes.length) {
      const bigger = new Uint8Array(this.bytes.length * 2);
      bigger.set(this.bytes);
      this.bytes = bigger;
    }
    this.bytes[this.length++] = value;
  }

  uint(value: number): void {
    let remaining = value;
    while (remaining >= 128) {
      this.byte((remaining % 128) + 128);
      remaining = Math.floor(remaining / 128);
    }
    this.byte(remaining);
  }

  string(value: string): void {
    this.uint(value.length);
    // Code-unit varints use one byte for ASCII and round-trip lone surrogates.
    // TextEncoder would silently replace those with U+FFFD.
    for (let i = 0; i < value.length; i++) this.uint(value.charCodeAt(i));
  }

  finish(): Uint8Array {
    return this.bytes.slice(0, this.length);
  }
}

class Reader {
  offset = 0;
  constructor(readonly bytes: Uint8Array) {}

  uint(): number {
    let value = 0;
    let multiplier = 1;
    for (let i = 0; i < 8; i++) {
      const byte = this.bytes[this.offset++];
      if (byte === undefined) throw new Error("Truncated update");
      value += (byte & 127) * multiplier;
      if (!Number.isSafeInteger(value)) throw new Error("Integer overflow in update");
      if (byte < 128) return value;
      multiplier *= 128;
    }
    throw new Error("Invalid varint in update");
  }

  count(): number {
    const count = this.uint();
    if (count > this.bytes.length - this.offset) throw new Error("Invalid count in update");
    return count;
  }

  string(): string {
    const count = this.count();
    const chunks: string[] = [];
    const units: number[] = [];
    for (let i = 0; i < count; i++) {
      const unit = this.uint();
      if (unit > 65535) throw new Error("Invalid UTF-16 unit in update");
      units.push(unit);
      if (units.length === 4096) {
        chunks.push(String.fromCharCode(...units));
        units.length = 0;
      }
    }
    chunks.push(String.fromCharCode(...units));
    return chunks.join("");
  }
}

export function encodeOperations(operations: readonly Operation[]): Uint8Array {
  const writer = new Writer();
  for (const byte of MAGIC) writer.byte(byte);
  const inserts: Insert[] = [];
  const spans: Span[] = [];
  const actors = new Set<number>();
  for (const op of operations) {
    if (op.kind === "insert") {
      validateInsert(op);
      inserts.push(op);
      actors.add(op.actor);
      if (op.after !== null) actors.add(op.after.actor);
    } else {
      for (const span of op.spans) {
        validateSpan(span);
        spans.push(span);
        actors.add(span.actor);
      }
    }
  }
  const actorIds = [...actors].sort((a, b) => a - b);
  const indices = new Map(actorIds.map((actor, index) => [actor, index]));
  const indexOf = (actor: number): number => {
    const index = indices.get(actor);
    if (index === undefined) throw new Error("Missing actor");
    return index;
  };
  writer.uint(actorIds.length);
  for (const actor of actorIds) writer.uint(actor);
  writer.uint(inserts.length);
  const nextSeq = new Map<number, number>();
  for (const op of inserts) {
    writer.uint(indexOf(op.actor));
    writer.uint(op.seq === (nextSeq.get(op.actor) ?? 1) ? 0 : op.seq);
    writer.uint(op.time === op.seq ? 0 : op.time);
    writer.uint(
      op.after === null ? 0 : op.after.actor === op.actor ? 1 : indexOf(op.after.actor) + 2,
    );
    if (op.after !== null)
      writer.uint(op.after.actor === op.actor ? op.seq - op.after.seq : op.after.seq);
    writer.string(op.text);
    nextSeq.set(op.actor, op.seq + op.text.length);
  }
  writer.uint(spans.length);
  for (const span of spans) {
    writer.uint(indexOf(span.actor));
    writer.uint(span.seq);
    writer.uint(span.length);
  }
  return writer.finish();
}

/** Parse and validate the complete frame before exposing any operations. */
export function decodeOperations(bytes: Uint8Array): Operation[] {
  const reader = new Reader(bytes);
  for (const byte of MAGIC) {
    if (bytes[reader.offset++] !== byte) throw new Error("Invalid update magic or version");
  }
  const actors: number[] = [];
  const actorCount = reader.count();
  for (let i = 0; i < actorCount; i++) actors.push(reader.uint());
  if (new Set(actors).size !== actors.length) throw new Error("Duplicate actor table entry");
  const actorAt = (index: number): number => {
    const actor = actors[index];
    if (actor === undefined) throw new Error("Invalid actor index");
    return actor;
  };
  const operations: Operation[] = [];
  const insertCount = reader.count();
  const nextSeq = new Map<number, number>();
  for (let i = 0; i < insertCount; i++) {
    const actor = actorAt(reader.uint());
    const seq = reader.uint() || (nextSeq.get(actor) ?? 1);
    const time = reader.uint() || seq;
    const origin = reader.uint();
    const after =
      origin === 0
        ? null
        : origin === 1
          ? { actor, seq: seq - reader.uint() }
          : { actor: actorAt(origin - 2), seq: reader.uint() };
    const text = reader.string();
    const op: Insert = { kind: "insert", actor, seq, time, after, text };
    validateInsert(op);
    nextSeq.set(actor, seq + text.length);
    operations.push(op);
  }
  const spanCount = reader.count();
  const spans: Span[] = [];
  for (let i = 0; i < spanCount; i++) {
    const span = { actor: actorAt(reader.uint()), seq: reader.uint(), length: reader.uint() };
    validateSpan(span);
    spans.push(span);
  }
  operations.push({ kind: "delete", spans });
  integer(reader.offset, "update offset");
  if (reader.offset !== bytes.length) throw new Error("Trailing bytes in update");
  return operations;
}
