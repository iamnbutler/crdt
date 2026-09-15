import { type EncodedRun, type Frame, decodeFrame, encodeFrame } from "./encoding.js";
import { Intervals } from "./intervals.js";
import {
  Run,
  Sequence,
  idBuild,
  idFind,
  idInsert,
  idNext,
  idRemove,
  previousSibling,
  siblingInsert,
} from "./sequence.js";
import {
  type Anchor,
  type Delete,
  type Id,
  type Insert,
  type Operation,
  type Span,
  type StateVector,
  integer,
  validateInsert,
  validateSpan,
} from "./types.js";

class Actor {
  root: Run | null = null;
  received = 0;
  readonly deleted = new Intervals();
}

function randomActor(): number {
  const words = crypto.getRandomValues(new Uint32Array(2));
  return ((words[0] ?? 0) & 0x1fffff) * 0x100000000 + (words[1] ?? 0);
}

/**
 * A run-compressed RGA text CRDT. Character identity and sibling ordering are
 * independent of physical run boundaries. Local edits use a positional splay
 * tree; remote references use a separate per-actor interval treap.
 */
export class RunText {
  private tree = new Sequence();
  private rootChildren: Run | null = null;
  private actors = new Map<number, Actor>();
  private readonly waiting = new Map<number, Map<number, Map<string, Insert>>>();
  private nextSeq = 1;
  private lamport = 0;
  private random = 0x6d2b79f5;
  private cachedText: string | null = "";
  private cachedState: Uint8Array | null = null;
  private pending = 0;

  constructor(readonly actor = randomActor()) {
    integer(actor, "actor");
  }

  get length(): number {
    return this.tree.root?.total ?? 0;
  }

  get stats(): { runs: number; actors: number; pending: number } {
    return { runs: this.tree.count, actors: this.actors.size, pending: this.pending };
  }

  getText(): string {
    if (this.cachedText !== null) return this.cachedText;
    const chunks: string[] = [];
    for (let node = this.tree.head; node !== null; node = node.next) {
      if (!node.deleted) chunks.push(node.text);
    }
    this.cachedText = chunks.join("");
    return this.cachedText;
  }

  toString(): string {
    return this.getText();
  }

  /** A stable gap reference. Left bias stays before text inserted at the gap. */
  anchorAt(offset: number, bias: "left" | "right" = "right"): Anchor {
    this.position(offset);
    if (bias === "left" && offset === 0) return { edge: "start" };
    if (bias === "right" && offset === this.length) return { edge: "end" };
    const position = bias === "left" ? offset - 1 : offset;
    const node = this.tree.seek(position);
    return {
      id: { actor: node.actor, seq: node.seq + position - (node.left?.total ?? 0) },
      side: bias === "left" ? "after" : "before",
    };
  }

  resolve(anchor: Anchor): number | null {
    if ("edge" in anchor) return anchor.edge === "start" ? 0 : this.length;
    const node = this.find(anchor.id);
    if (node === null) return null;
    this.tree.splay(node);
    return (
      (node.left?.total ?? 0) +
      (node.deleted ? 0 : anchor.id.seq - node.seq + (anchor.side === "after" ? 1 : 0))
    );
  }

  insert(offset: number, text: string): Insert {
    this.position(offset);
    if (text.length === 0) throw new RangeError("Insert text must be nonempty");
    integer(this.nextSeq + text.length, "sequence end", 1);
    integer(this.lamport + text.length + 1, "time end", 1);
    this.cachedState = null;
    let left: Run | null = null;
    if (offset > 0) {
      left = this.tree.seek(offset - 1);
      const inner = offset - (left.left?.total ?? 0);
      if (inner < left.text.length) this.split(left, inner);
    }
    const after =
      left === null ? null : { actor: left.actor, seq: left.seq + left.text.length - 1 };
    const op: Insert = {
      kind: "insert",
      actor: this.actor,
      seq: this.nextSeq,
      time: this.lamport + 1,
      after,
      text,
    };
    const depth = left === null ? 0 : left.depth + left.text.length;
    this.place(left, op, depth, left);
    this.nextSeq += text.length;
    this.lamport += text.length;
    const state = this.actorState(this.actor);
    if (state.received + 1 === op.seq) state.received = this.nextSeq - 1;
    if (this.waiting.size > 0) {
      const queue: Insert[] = [];
      this.drain(op.actor, op.seq, op.text.length, queue);
      for (let i = 0; i < queue.length; i++) {
        const next = queue[i];
        if (next !== undefined) this.integrate(next, queue);
      }
    }
    this.cachedText = null;
    return op;
  }

  /** Delete a count of UTF-16 code units, starting at offset. */
  delete(offset: number, length: number): Delete {
    this.position(offset);
    integer(length, "length");
    if (offset + length > this.length) throw new RangeError("Delete exceeds the document");
    this.cachedState = null;
    const spans: Span[] = [];
    let remaining = length;
    while (remaining > 0) {
      let node = this.tree.seek(offset);
      const inner = offset - (node.left?.total ?? 0);
      if (inner > 0) node = this.split(node, inner);
      const count = Math.min(remaining, node.text.length);
      if (count < node.text.length) this.split(node, count);
      const previous = spans[spans.length - 1];
      if (
        previous !== undefined &&
        previous.actor === node.actor &&
        previous.seq + previous.length === node.seq
      ) {
        spans[spans.length - 1] = {
          actor: node.actor,
          seq: previous.seq,
          length: previous.length + count,
        };
      } else spans.push({ actor: node.actor, seq: node.seq, length: count });
      this.actorState(node.actor).deleted.add(node.seq, node.seq + count);
      node.deleted = true;
      this.tree.changed(node);
      this.coalesce(node);
      remaining -= count;
    }
    this.cachedText = null;
    return { kind: "delete", spans };
  }

  /** Apply an operation once, many times, or before its dependencies. */
  apply(op: Operation): void {
    this.cachedState = null;
    if (op.kind === "delete") {
      for (const span of op.spans) validateSpan(span);
      for (const span of op.spans) {
        this.actorState(span.actor).deleted.add(span.seq, span.seq + span.length);
        this.deleteKnown(span.actor, span.seq, span.seq + span.length);
      }
    } else if (op.kind === "insert") {
      validateInsert(op);
      const queue: Insert[] = [op];
      for (let i = 0; i < queue.length; i++) {
        const next = queue[i];
        if (next !== undefined) this.integrate(next, queue);
      }
    } else throw new TypeError("Unknown operation kind");
    this.cachedText = null;
  }

  stateVector(): StateVector {
    const result = new Map<number, number>();
    for (const [actor, state] of this.actors) {
      if (state.received > 0) result.set(actor, state.received);
    }
    return result;
  }

  /** Full CRDT state, or missing insertions plus the deletion set. */
  encode(since?: StateVector): Uint8Array {
    if (since === undefined && this.cachedState !== null) return this.cachedState.slice();
    const runs: EncodedRun[] = [];
    const spans: Span[] = [];
    if (since !== undefined) {
      for (const [actor, seq] of since) {
        integer(actor, "state actor");
        integer(seq, "state sequence");
      }
    }
    // Identity order is already indexed: no export allocation or global sort.
    const stack: Run[] = [];
    for (const actor of [...this.actors.keys()].sort((a, b) => a - b)) {
      let node = this.actors.get(actor)?.root ?? null;
      while (node !== null || stack.length > 0) {
        while (node !== null) {
          stack.push(node);
          node = node.idLeft;
        }
        const run = stack.pop();
        if (run === undefined) break;
        const skip = Math.max(0, (since?.get(actor) ?? 0) + 1 - run.seq);
        if (skip < run.text.length)
          runs.push(
            skip === 0
              ? run
              : {
                  actor,
                  seq: run.seq + skip,
                  time: run.time + skip,
                  originActor: actor,
                  originSeq: run.seq + skip - 1,
                  text: run.text.slice(skip),
                  deleted: run.deleted,
                },
          );
        node = run.idRight;
      }
    }
    for (const byCounter of this.waiting.values()) {
      for (const byId of byCounter.values()) {
        for (const op of byId.values())
          runs.push({
            actor: op.actor,
            seq: op.seq,
            time: op.time,
            originActor: op.after?.actor ?? 0,
            originSeq: op.after?.seq ?? 0,
            text: op.text,
            deleted: false,
          });
      }
    }
    for (const [actor, state] of this.actors) {
      for (const range of state.deleted.ranges)
        spans.push({ actor, seq: range.start, length: range.end - range.start });
    }
    const bytes = encodeFrame(runs, spans, since === undefined && this.pending === 0);
    if (since === undefined) {
      this.cachedState = bytes;
      return bytes.slice();
    }
    return bytes;
  }

  merge(update: Uint8Array): void {
    const frame = decodeFrame(update);
    if (frame.complete && this.actors.size === 0 && this.pending === 0) {
      const loaded = new RunText(this.actor);
      loaded.restore(frame);
      this.tree = loaded.tree;
      this.actors = loaded.actors;
      this.rootChildren = loaded.rootChildren;
      this.nextSeq = loaded.nextSeq;
      this.lamport = loaded.lamport;
      this.random = loaded.random;
      this.cachedText = loaded.cachedText;
      this.cachedState = update.slice();
      return;
    }
    const spans = [...frame.spans];
    for (const run of frame.runs) {
      if (run.deleted) spans.push({ actor: run.actor, seq: run.seq, length: run.text.length });
    }
    this.apply({ kind: "delete", spans });
    for (const run of frame.runs)
      this.apply({
        kind: "insert",
        actor: run.actor,
        seq: run.seq,
        time: run.time,
        after: run.originSeq === 0 ? null : { actor: run.originActor, seq: run.originSeq },
        text: run.text,
      });
  }

  /** Rebuild indexes from a complete snapshot, without replaying edit history. */
  private restore(frame: Frame): void {
    interface Group {
      state: Actor;
      ends: Map<number, Run>;
      nodes: Run[];
    }
    const groups = new Map<number, Group>();
    const groupFor = (actor: number): Group => {
      let group = groups.get(actor);
      if (group === undefined) {
        group = { state: this.actorState(actor), ends: new Map(), nodes: [] };
        groups.set(actor, group);
      }
      return group;
    };
    for (const span of frame.spans)
      groupFor(span.actor).state.deleted.add(span.seq, span.seq + span.length);
    const nodes: Run[] = [];
    for (const run of frame.runs) {
      const group = groupFor(run.actor);
      const previous = group.nodes[group.nodes.length - 1];
      if (previous !== undefined && previous.seq + previous.text.length > run.seq)
        throw new Error("Unsorted or overlapping snapshot IDs");
      const node = new Run(
        run.actor,
        run.seq,
        run.time,
        run.originActor,
        run.originSeq,
        0,
        run.text,
        run.deleted,
        this.priority(),
      );
      group.nodes.push(node);
      group.ends.set(node.seq + node.text.length - 1, node);
      nodes.push(node);
      this.lamport = Math.max(this.lamport, run.time + run.text.length - 1);
      if (run.actor === this.actor)
        this.nextSeq = Math.max(this.nextSeq, run.seq + run.text.length);
    }
    for (const group of groups.values()) {
      group.state.root = idBuild(group.nodes);
      let deletionIndex = 0;
      const ranges = group.state.deleted.ranges;
      for (const node of group.nodes) {
        if (node.seq === group.state.received + 1)
          group.state.received = node.seq + node.text.length - 1;
        while (deletionIndex < ranges.length && (ranges[deletionIndex]?.end ?? 0) <= node.seq)
          deletionIndex++;
        const range = ranges[deletionIndex];
        const end = node.seq + node.text.length;
        if (node.deleted) {
          if (range === undefined || range.start > node.seq || range.end < end) {
            group.state.deleted.add(node.seq, end);
            deletionIndex = group.state.deleted.lowerBound(node.seq);
          }
        } else if (range !== undefined && range.start < end)
          throw new Error("Inconsistent snapshot visibility");
      }
    }
    for (const node of nodes) {
      if (node.originSeq === 0) this.rootChildren = siblingInsert(this.rootChildren, node);
      else {
        const parent = groups.get(node.originActor)?.ends.get(node.originSeq);
        if (parent === undefined) throw new Error("Invalid snapshot origin");
        if (node.time <= parent.time + parent.text.length - 1)
          throw new Error("Invalid snapshot time");
        parent.children = siblingInsert(parent.children, node);
      }
    }
    // Traverse the RGA once to build the positional index and materialized text.
    const pending: Run[] = [];
    const siblings: Run[] = [];
    const ordered: Run[] = [];
    const text: string[] = [];
    const pushChildren = (root: Run | null, depth: number): void => {
      let node = root;
      while (node !== null || siblings.length > 0) {
        while (node !== null) {
          siblings.push(node);
          node = node.siblingLeft;
        }
        const next = siblings.pop();
        if (next === undefined) break;
        next.depth = depth;
        pending.push(next);
        node = next.siblingRight;
      }
    };
    pushChildren(this.rootChildren, 0);
    while (pending.length > 0) {
      const node = pending.pop();
      if (node === undefined) break;
      ordered.push(node);
      if (!node.deleted) text.push(node.text);
      pushChildren(node.children, node.depth + node.text.length);
    }
    if (ordered.length !== nodes.length) throw new Error("Disconnected snapshot runs");
    this.tree.load(ordered);
    this.cachedText = text.join("");
  }

  static decode(update: Uint8Array, actor = randomActor()): RunText {
    const doc = new RunText(actor);
    doc.merge(update);
    return doc;
  }

  fork(actor = randomActor()): RunText {
    if (actor === this.actor) throw new Error("A fork must use a distinct actor ID");
    return RunText.decode(this.encode(), actor);
  }

  /** Causally sorted insertion runs plus all observed deletions. */
  export(since: StateVector = new Map()): Operation[] {
    const inserts: Insert[] = [];
    const spans: Span[] = [];
    for (const [actor, seq] of since) {
      integer(actor, "state actor");
      integer(seq, "state sequence");
    }
    for (let node = this.tree.head; node !== null; node = node.next) {
      const skip = Math.max(0, (since.get(node.actor) ?? 0) + 1 - node.seq);
      if (skip >= node.text.length) continue;
      inserts.push({
        kind: "insert",
        actor: node.actor,
        seq: node.seq + skip,
        time: node.time + skip,
        after:
          skip > 0
            ? { actor: node.actor, seq: node.seq + skip - 1 }
            : node.originSeq === 0
              ? null
              : { actor: node.originActor, seq: node.originSeq },
        text: node.text.slice(skip),
      });
    }
    for (const byCounter of this.waiting.values()) {
      for (const byId of byCounter.values()) {
        for (const op of byId.values()) inserts.push(op);
      }
    }
    inserts.sort((a, b) => a.time - b.time || a.actor - b.actor || a.seq - b.seq);
    for (const [actor, state] of this.actors) {
      for (const range of state.deleted.ranges) {
        spans.push({ actor, seq: range.start, length: range.end - range.start });
      }
    }
    return [...inserts, { kind: "delete", spans }];
  }

  private position(offset: number): void {
    integer(offset, "offset");
    if (offset > this.length) throw new RangeError("Offset exceeds the document");
  }

  private actorState(actor: number): Actor {
    let state = this.actors.get(actor);
    if (state === undefined) {
      state = new Actor();
      this.actors.set(actor, state);
    }
    return state;
  }

  private find(id: Id): Run | null {
    return idFind(this.actors.get(id.actor)?.root ?? null, id.seq);
  }

  private priority(): number {
    let value = this.random;
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    this.random = value >>> 0;
    return this.random;
  }

  private addIndex(node: Run): void {
    const state = this.actorState(node.actor);
    state.root = idInsert(state.root, node);
  }

  private split(node: Run, offset: number): Run {
    const right = new Run(
      node.actor,
      node.seq + offset,
      node.time + offset,
      node.actor,
      node.seq + offset - 1,
      node.depth + offset,
      node.text.slice(offset),
      node.deleted,
      this.priority(),
    );
    node.text = node.text.slice(0, offset);
    right.children = node.children;
    node.children = right;
    this.tree.changed(node);
    this.tree.insertAfter(node, right);
    this.addIndex(right);
    return right;
  }

  private place(left: Run | null, op: Insert, depth: number, origin: Run | null): void {
    if (
      left !== null &&
      left.children === null &&
      !left.deleted &&
      left.actor === op.actor &&
      left.seq + left.text.length === op.seq &&
      left.time + left.text.length === op.time &&
      left.depth + left.text.length === depth &&
      left.text.length + op.text.length <= 4096 &&
      op.after?.actor === left.actor &&
      op.after.seq === op.seq - 1
    ) {
      left.text += op.text;
      this.tree.changed(left);
    } else {
      const node = new Run(
        op.actor,
        op.seq,
        op.time,
        op.after?.actor ?? 0,
        op.after?.seq ?? 0,
        depth,
        op.text,
        false,
        this.priority(),
      );
      this.tree.insertAfter(left, node);
      this.addIndex(node);
      if (origin === null) this.rootChildren = siblingInsert(this.rootChildren, node);
      else origin.children = siblingInsert(origin.children, node);
    }
  }

  private coalesce(node: Run): void {
    let left = node;
    const prev = left.prev;
    if (prev !== null && this.canMerge(prev, left)) {
      this.mergeRuns(prev, left);
      left = prev;
    }
    const next = left.next;
    if (next !== null && this.canMerge(left, next)) this.mergeRuns(left, next);
  }

  private canMerge(left: Run, right: Run): boolean {
    return (
      left.deleted === right.deleted &&
      left.children === right &&
      right.siblingLeft === null &&
      right.siblingRight === null &&
      left.actor === right.actor &&
      left.seq + left.text.length === right.seq &&
      left.time + left.text.length === right.time &&
      right.originActor === left.actor &&
      right.originSeq === right.seq - 1 &&
      left.text.length + right.text.length <= 4096
    );
  }

  private mergeRuns(left: Run, right: Run): void {
    const state = this.actorState(right.actor);
    state.root = idRemove(state.root, right.seq);
    this.tree.remove(right);
    left.children = right.children;
    left.text += right.text;
    this.tree.changed(left);
  }

  private integrate(original: Insert, queue: Insert[]): void {
    this.lamport = Math.max(this.lamport, original.time + original.text.length - 1);
    if (original.actor === this.actor) {
      this.nextSeq = Math.max(this.nextSeq, original.seq + original.text.length);
    }
    const state = this.actorState(original.actor);
    let seq = original.seq;
    const end = seq + original.text.length;
    while (seq < end) {
      const known = idFind(state.root, seq);
      if (known === null) break;
      seq = known.seq + known.text.length;
    }
    if (seq >= end) return;
    const overlapping = idNext(state.root, seq);
    if (overlapping !== null && overlapping.seq < end) {
      throw new Error("Conflicting insertion ranges: actor IDs must be unique");
    }
    const skip = seq - original.seq;
    const op: Insert =
      skip === 0
        ? original
        : {
            kind: "insert",
            actor: original.actor,
            seq,
            time: original.time + skip,
            after: { actor: original.actor, seq: seq - 1 },
            text: original.text.slice(skip),
          };
    let left: Run | null = null;
    let depth = 0;
    if (op.after !== null) {
      left = this.find(op.after);
      if (left === null) {
        this.defer(op);
        return;
      }
      const offset = op.after.seq - left.seq + 1;
      if (op.time <= left.time + offset - 1) throw new Error("Insert time must follow its origin");
      depth = left.depth + offset;
      if (offset < left.text.length) this.split(left, offset);
    }
    // Locate a sibling by key, then jump over its entire subtree. Reversed
    // delivery must not scan all previous concurrent siblings on every insert.
    const origin = left;
    const siblings = origin === null ? this.rootChildren : origin.children;
    const previous = previousSibling(siblings, op.time, op.actor);
    if (previous !== null) left = this.tree.subtreeEnd(previous);
    this.place(left, op, depth, origin);
    const deletions = state.deleted.ranges;
    for (let i = state.deleted.lowerBound(seq); i < deletions.length; i++) {
      const range = deletions[i];
      if (range === undefined || range.start >= end) break;
      if (range.end > seq)
        this.deleteKnown(op.actor, Math.max(seq, range.start), Math.min(end, range.end));
    }
    let known = idFind(state.root, state.received + 1);
    while (known !== null) {
      state.received = known.seq + known.text.length - 1;
      known = idFind(state.root, state.received + 1);
    }
    this.drain(op.actor, seq, end - seq, queue);
  }

  private deleteKnown(actor: number, start: number, end: number): void {
    const state = this.actorState(actor);
    let seq = start;
    while (seq < end) {
      let node = idFind(state.root, seq) ?? idNext(state.root, seq);
      if (node === null || node.seq >= end) break;
      if (node.deleted) {
        seq = node.seq + node.text.length;
        continue;
      }
      if (seq > node.seq) node = this.split(node, seq - node.seq);
      const count = Math.min(end - node.seq, node.text.length);
      if (count < node.text.length) this.split(node, count);
      seq = node.seq + count;
      node.deleted = true;
      this.tree.changed(node);
      this.coalesce(node);
    }
  }

  private defer(op: Insert): void {
    const after = op.after;
    if (after === null) throw new Error("A root insert cannot be deferred");
    let byCounter = this.waiting.get(after.actor);
    if (byCounter === undefined) {
      byCounter = new Map();
      this.waiting.set(after.actor, byCounter);
    }
    let byId = byCounter.get(after.seq);
    if (byId === undefined) {
      byId = new Map();
      byCounter.set(after.seq, byId);
    }
    const key = `${op.actor}:${op.seq}`;
    const previous = byId.get(key);
    if (previous === undefined) this.pending++;
    if (previous === undefined || previous.text.length < op.text.length) {
      byId.set(key, { ...op, after: { ...after } });
    }
  }

  private drain(actor: number, start: number, length: number, queue: Insert[]): void {
    const byCounter = this.waiting.get(actor);
    if (byCounter === undefined) return;
    for (let seq = start; seq < start + length; seq++) {
      const byId = byCounter.get(seq);
      if (byId === undefined) continue;
      byCounter.delete(seq);
      for (const op of byId.values()) {
        this.pending--;
        queue.push(op);
      }
    }
    if (byCounter.size === 0) this.waiting.delete(actor);
  }

  /** Expensive development check, intentionally absent from the edit path. */
  check(): void {
    let count = 0;
    let length = 0;
    let previous: Run | null = null;
    for (let node = this.tree.head; node !== null; node = node.next) {
      if (node.prev !== previous || node.text.length === 0) throw new Error("Broken run list");
      if (
        idFind(this.actors.get(node.actor)?.root ?? null, node.seq) !== node ||
        idFind(this.actors.get(node.actor)?.root ?? null, node.seq + node.text.length - 1) !== node
      ) {
        throw new Error("Broken ID index");
      }
      const total =
        (node.left?.total ?? 0) + (node.right?.total ?? 0) + (node.deleted ? 0 : node.text.length);
      if (
        node.total !== total ||
        (node.left !== null && node.left.parent !== node) ||
        (node.right !== null && node.right.parent !== node)
      )
        throw new Error("Broken positional index");
      if (!node.deleted) length += node.text.length;
      count++;
      if (count > this.tree.count) throw new Error("Cyclic run list");
      previous = node;
    }
    if (
      length !== this.length ||
      count !== this.tree.count ||
      previous !== this.tree.tail ||
      (this.tree.root !== null && this.tree.root.parent !== null)
    )
      throw new Error("Broken sequence");
  }
}
