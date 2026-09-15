/** IDs address UTF-16 code units, matching JavaScript string offsets. */
export interface Id {
  readonly actor: number;
  readonly seq: number;
}

export interface Insert {
  readonly kind: "insert";
  readonly actor: number;
  readonly seq: number;
  /** Lamport time of the first code unit. Following units increment it. */
  readonly time: number;
  readonly after: Id | null;
  readonly text: string;
}

export interface Span {
  readonly actor: number;
  readonly seq: number;
  readonly length: number;
}

export interface Delete {
  readonly kind: "delete";
  readonly spans: readonly Span[];
}

export type Operation = Insert | Delete;
/** Highest contiguous insertion sequence received from each actor. */
export type StateVector = ReadonlyMap<number, number>;

export type Anchor =
  | { readonly edge: "start" | "end" }
  | { readonly id: Id; readonly side: "before" | "after" };

export function integer(value: number, name: string, min = 0): void {
  if (!Number.isSafeInteger(value) || value < min) {
    throw new RangeError(`${name} must be a safe integer >= ${min}`);
  }
}

export function validateInsert(op: Insert): void {
  if (typeof op.text !== "string" || op.text.length === 0) {
    throw new TypeError("Insert text must be a nonempty string");
  }
  validateRunRange(op.actor, op.seq, op.time, op.text.length);
  if (op.after !== null) {
    validateOrigin(op.actor, op.seq, op.after.actor, op.after.seq);
  }
}

export function validateRunRange(actor: number, seq: number, time: number, length: number): void {
  integer(actor, "actor");
  integer(seq, "seq", 1);
  integer(time, "time", 1);
  integer(length, "length", 1);
  integer(seq + length, "sequence end", 1);
  integer(time + length, "time end", 1);
}

export function validateOrigin(
  actor: number,
  seq: number,
  originActor: number,
  originSeq: number,
): void {
  integer(originActor, "origin actor");
  integer(originSeq, "origin sequence", 1);
  if (originActor === actor && originSeq >= seq)
    throw new Error("An actor cannot insert after its own future operation");
}

export function validateSpan(span: Span): void {
  integer(span.actor, "actor");
  integer(span.seq, "seq", 1);
  integer(span.length, "length", 1);
  integer(span.seq + span.length, "span end", 1);
}
