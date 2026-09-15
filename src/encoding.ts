import { compressBlock, decompressBlock } from "./compression.js";
import {
  type Operation,
  type Span,
  integer,
  validateInsert,
  validateOrigin,
  validateRunRange,
  validateSpan,
} from "./types.js";

const MAGIC = [82, 84, 88, 2]; // RTX, current research format
const MAX_BLOCK = 64 * 1024 * 1024;
const MAX_RUNS = 1_000_000;

export interface EncodedRun {
  readonly actor: number;
  readonly seq: number;
  readonly time: number;
  readonly originActor: number;
  readonly originSeq: number;
  readonly text: string;
  readonly deleted: boolean;
}

export interface Frame {
  readonly complete: boolean;
  readonly runs: EncodedRun[];
  readonly spans: Span[];
}

class Writer {
  private bytes = new Uint8Array(1024);
  private length = 0;

  byte(value: number): void {
    if (this.length === this.bytes.length) {
      if (this.length >= MAX_BLOCK) throw new RangeError("Update block exceeds 64 MiB");
      const bigger = new Uint8Array(this.bytes.length * 2);
      bigger.set(this.bytes);
      this.bytes = bigger;
    }
    this.bytes[this.length++] = value;
  }

  uint(value: number): void {
    if (value < 128) {
      this.byte(value);
      return;
    }
    let remaining = value;
    while (remaining >= 128) {
      this.byte((remaining % 128) + 128);
      remaining = Math.floor(remaining / 128);
    }
    this.byte(remaining);
  }

  string(value: string): void {
    this.uint(value.length);
    // UTF-16 code-unit varints preserve lone surrogates, unlike TextEncoder.
    for (let i = 0; i < value.length; i++) this.uint(value.charCodeAt(i));
  }

  column(values: readonly number[]): void {
    let start = 0;
    while (start < values.length) {
      let end = start + 1;
      while (end < values.length && values[end] === values[start]) end++;
      if (end - start >= 2) {
        this.uint((end - start) * 2 + 1);
        this.uint(values[start] ?? 0);
      } else {
        while (end < values.length) {
          if (end + 1 < values.length && values[end] === values[end + 1]) break;
          end++;
        }
        this.uint((end - start) * 2);
        for (let i = start; i < end; i++) this.uint(values[i] ?? 0);
      }
      start = end;
    }
  }

  finish(): Uint8Array {
    return this.bytes.slice(0, this.length);
  }
}

class Reader {
  offset = 0;
  constructor(readonly bytes: Uint8Array) {}

  uint(): number {
    const first = this.bytes[this.offset++];
    if (first === undefined) throw new Error("Truncated update");
    if (first < 128) return first;
    let value = first & 127;
    let multiplier = 128;
    for (let i = 1; i < 8; i++) {
      const byte = this.bytes[this.offset++];
      if (byte === undefined) throw new Error("Truncated update");
      value += (byte & 127) * multiplier;
      if (!Number.isSafeInteger(value)) throw new Error("Integer overflow in update");
      if (byte < 128) return value;
      multiplier *= 128;
    }
    throw new Error("Invalid varint in update");
  }

  count(limit: number): number {
    const count = this.uint();
    if (count > limit) throw new Error("Invalid count in update");
    return count;
  }

  string(): string {
    const count = this.count(this.bytes.length - this.offset);
    const units = new Uint16Array(count);
    for (let i = 0; i < count; i++) {
      const unit = this.uint();
      if (unit > 65535) throw new Error("Invalid UTF-16 unit in update");
      units[i] = unit;
    }
    const chunks: string[] = [];
    for (let i = 0; i < count; i += 8192) {
      chunks.push(String.fromCharCode(...units.subarray(i, i + 8192)));
    }
    return chunks.join("");
  }

  column(count: number): number[] {
    const values: number[] = new Array(count);
    let index = 0;
    while (index < count) {
      const tag = this.uint();
      const size = Math.floor(tag / 2);
      if (size === 0 || size > count - index) throw new Error("Invalid column run length");
      if (tag % 2 === 1) {
        values.fill(this.uint(), index, index + size);
        index += size;
      } else {
        for (let i = 0; i < size; i++) values[index++] = this.uint();
      }
    }
    return values;
  }
}

/** Encode physical runs directly; deleted text is omitted, identities retained. */
export function encodeFrame(
  runs: readonly EncodedRun[],
  spans: readonly Span[],
  complete: boolean,
): Uint8Array {
  if (runs.length > MAX_RUNS || spans.length > MAX_RUNS)
    throw new RangeError("Too many update records");
  const actors = new Set<number>();
  for (const run of runs) {
    actors.add(run.actor);
    if (run.originSeq !== 0) actors.add(run.originActor);
  }
  for (const span of spans) actors.add(span.actor);
  const actorIds = [...actors].sort((a, b) => a - b);
  const indices = new Map(actorIds.map((actor, index) => [actor, index]));
  const indexOf = (actor: number): number => {
    const index = indices.get(actor);
    if (index === undefined) throw new Error("Missing actor");
    return index;
  };
  const writer = new Writer();
  writer.uint(actorIds.length);
  for (const actor of actorIds) writer.uint(actor);
  writer.uint(runs.length);
  const actorColumn: number[] = [];
  const seqColumn: number[] = [];
  const timeColumn: number[] = [];
  const originColumn: number[] = [];
  const referenceColumn: number[] = [];
  const lengthColumn: number[] = [];
  const text: string[] = [];
  const nextSeq = new Map<number, number>();
  let units = 0;
  for (const run of runs) {
    actorColumn.push(indexOf(run.actor));
    seqColumn.push(run.seq === (nextSeq.get(run.actor) ?? 1) ? 0 : run.seq);
    timeColumn.push(run.time === run.seq ? 0 : run.time);
    originColumn.push(
      run.originSeq === 0 ? 0 : run.originActor === run.actor ? 1 : indexOf(run.originActor) + 2,
    );
    referenceColumn.push(
      run.originSeq === 0
        ? 0
        : run.originActor === run.actor
          ? run.seq - run.originSeq
          : run.originSeq,
    );
    lengthColumn.push(run.text.length * 2 + (run.deleted ? 1 : 0));
    if (!run.deleted) text.push(run.text);
    units += run.text.length;
    if (units > MAX_BLOCK) throw new RangeError("Update text exceeds 64 Mi code units");
    nextSeq.set(run.actor, run.seq + run.text.length);
  }
  for (const column of [
    actorColumn,
    seqColumn,
    timeColumn,
    originColumn,
    referenceColumn,
    lengthColumn,
  ])
    writer.column(column);
  writer.string(text.join(""));
  writer.uint(spans.length);
  writer.column(spans.map((span) => indexOf(span.actor)));
  writer.column(spans.map((span) => span.seq));
  writer.column(spans.map((span) => span.length));
  const raw = writer.finish();
  if (raw.length > MAX_BLOCK) throw new RangeError("Update block exceeds 64 MiB");
  const compressed = raw.length >= 64 ? compressBlock(raw) : raw;
  const useCompression = compressed.length < raw.length;
  const payload = useCompression ? compressed : raw;
  const header = new Writer();
  for (const byte of MAGIC) header.byte(byte);
  header.byte((complete ? 1 : 0) + (useCompression ? 2 : 0));
  header.uint(raw.length);
  const prefix = header.finish();
  const result = new Uint8Array(prefix.length + payload.length);
  result.set(prefix);
  result.set(payload, prefix.length);
  return result;
}

/** Parse the whole frame before mutating a replica. */
export function decodeFrame(bytes: Uint8Array): Frame {
  const header = new Reader(bytes);
  for (const byte of MAGIC) {
    if (bytes[header.offset++] !== byte) throw new Error("Invalid update magic or version");
  }
  const flags = header.uint();
  if (flags > 3) throw new Error("Invalid update flags");
  const size = header.count(MAX_BLOCK);
  const payload = bytes.subarray(header.offset);
  const raw = flags & 2 ? decompressBlock(payload, size) : payload;
  if (raw.length !== size) throw new Error("Invalid update byte length");
  const reader = new Reader(raw);
  const actors: number[] = [];
  const actorCount = reader.count(raw.length);
  for (let i = 0; i < actorCount; i++) actors.push(reader.uint());
  if (new Set(actors).size !== actors.length) throw new Error("Duplicate actor table entry");
  const actorAt = (index: number): number => {
    const actor = actors[index];
    if (actor === undefined) throw new Error("Invalid actor index");
    return actor;
  };
  const count = reader.count(MAX_RUNS);
  const actorColumn = reader.column(count);
  const seqColumn = reader.column(count);
  const timeColumn = reader.column(count);
  const originColumn = reader.column(count);
  const referenceColumn = reader.column(count);
  const lengthColumn = reader.column(count);
  const text = reader.string();
  const runs: EncodedRun[] = [];
  const nextSeq = new Map<number, number>();
  const tombstones = new Map<number, string>();
  let offset = 0;
  let units = 0;
  for (let i = 0; i < count; i++) {
    const actor = actorAt(actorColumn[i] ?? -1);
    const seq = seqColumn[i] || (nextSeq.get(actor) ?? 1);
    const time = timeColumn[i] || seq;
    const origin = originColumn[i] ?? 0;
    const reference = referenceColumn[i] ?? 0;
    const originActor = origin === 0 ? 0 : origin === 1 ? actor : actorAt(origin - 2);
    const originSeq = origin === 0 ? 0 : origin === 1 ? seq - reference : reference;
    if (origin === 0 && reference !== 0) throw new Error("Invalid root reference");
    const packedLength = lengthColumn[i] ?? 0;
    const length = Math.floor(packedLength / 2);
    const deleted = packedLength % 2 === 1;
    units += length;
    if (length === 0 || units > MAX_BLOCK) throw new Error("Invalid run length");
    validateRunRange(actor, seq, time, length);
    if (origin !== 0) validateOrigin(actor, seq, originActor, originSeq);
    if (!deleted && offset + length > text.length) throw new Error("Missing run text");
    let content: string;
    if (deleted) {
      const cached = tombstones.get(length);
      content = cached ?? "\0".repeat(length);
      if (cached === undefined) tombstones.set(length, content);
    } else {
      content = text.slice(offset, offset + length);
      offset += length;
    }
    nextSeq.set(actor, seq + length);
    runs.push({
      actor,
      seq,
      time,
      originActor,
      originSeq,
      text: content,
      deleted,
    });
  }
  if (offset !== text.length) throw new Error("Unused run text");
  const spanCount = reader.count(MAX_RUNS);
  const spanActors = reader.column(spanCount);
  const spanSeqs = reader.column(spanCount);
  const spanLengths = reader.column(spanCount);
  const spans: Span[] = [];
  for (let i = 0; i < spanCount; i++) {
    const span = {
      actor: actorAt(spanActors[i] ?? -1),
      seq: spanSeqs[i] ?? 0,
      length: spanLengths[i] ?? 0,
    };
    validateSpan(span);
    spans.push(span);
  }
  integer(reader.offset, "update offset");
  if (reader.offset !== raw.length) throw new Error("Trailing bytes in update");
  return { complete: Boolean(flags & 1), runs, spans };
}

export function encodeOperations(operations: readonly Operation[]): Uint8Array {
  const runs: EncodedRun[] = [];
  const spans: Span[] = [];
  for (const op of operations) {
    if (op.kind === "insert") {
      validateInsert(op);
      runs.push({
        actor: op.actor,
        seq: op.seq,
        time: op.time,
        originActor: op.after?.actor ?? 0,
        originSeq: op.after?.seq ?? 0,
        text: op.text,
        deleted: false,
      });
    } else {
      for (const span of op.spans) {
        validateSpan(span);
        spans.push(span);
      }
    }
  }
  return encodeFrame(runs, spans, false);
}

export function decodeOperations(bytes: Uint8Array): Operation[] {
  const frame = decodeFrame(bytes);
  const operations: Operation[] = frame.runs.map((run) => ({
    kind: "insert",
    actor: run.actor,
    seq: run.seq,
    time: run.time,
    after: run.originSeq === 0 ? null : { actor: run.originActor, seq: run.originSeq },
    text: run.text,
  }));
  const spans = [...frame.spans];
  for (const run of frame.runs)
    if (run.deleted) spans.push({ actor: run.actor, seq: run.seq, length: run.text.length });
  operations.push({ kind: "delete", spans });
  return operations;
}
