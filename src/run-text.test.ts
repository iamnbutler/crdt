import { describe, expect, test } from "bun:test";
import { loadEditingTrace } from "../benchmarks/fixtures.js";
import { RunText } from "./run-text.js";
import type { Id, Insert, Operation } from "./types.js";

function random(seed: number): () => number {
  let state = seed + 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x100000000;
  };
}

function shuffled<T>(values: readonly T[], rng: () => number): T[] {
  const result = [...values];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const a = result[i];
    const b = result[j];
    if (a !== undefined && b !== undefined) {
      result[i] = b;
      result[j] = a;
    }
  }
  return result;
}

function key(id: Id | null): string {
  return id === null ? "root" : `${id.actor}:${id.seq}`;
}

/** Deliberately slow per-character RGA oracle, with no runs or positional index. */
function reference(operations: readonly Operation[]): string {
  interface Character {
    actor: number;
    seq: number;
    time: number;
    value: string;
  }
  const children = new Map<string, Character[]>();
  const seen = new Set<string>();
  const deleted = new Set<string>();
  for (const op of operations) {
    if (op.kind === "delete") {
      for (const span of op.spans) {
        for (let seq = span.seq; seq < span.seq + span.length; seq++) {
          deleted.add(key({ actor: span.actor, seq }));
        }
      }
    } else {
      for (let i = 0; i < op.text.length; i++) {
        const id = { actor: op.actor, seq: op.seq + i };
        if (seen.has(key(id))) continue;
        seen.add(key(id));
        const parent = key(i === 0 ? op.after : { actor: op.actor, seq: op.seq + i - 1 });
        let siblings = children.get(parent);
        if (siblings === undefined) {
          siblings = [];
          children.set(parent, siblings);
        }
        siblings.push({ ...id, time: op.time + i, value: op.text.charAt(i) });
      }
    }
  }
  for (const siblings of children.values()) {
    siblings.sort((a, b) => a.time - b.time || a.actor - b.actor);
  }
  const stack = [...(children.get("root") ?? [])];
  const result: string[] = [];
  while (stack.length > 0) {
    const char = stack.pop();
    if (char === undefined) break;
    if (!deleted.has(key(char))) result.push(char.value);
    const next = children.get(key(char));
    if (next !== undefined) stack.push(...next);
  }
  return result.join("");
}

describe("RunText", () => {
  test("anchors retain their bias through remote edits and deletion", () => {
    const doc = new RunText(1);
    doc.insert(0, "abcd");
    const left = doc.anchorAt(2, "left");
    const right = doc.anchorAt(2, "right");
    const peer = doc.fork(2);
    doc.apply(peer.insert(2, "XY"));
    expect(doc.resolve(left)).toBe(2);
    expect(doc.resolve(right)).toBe(4);
    doc.delete(0, 6);
    expect(doc.resolve(left)).toBe(0);
    expect(doc.resolve(right)).toBe(0);
    doc.insert(0, "Z");
    expect(doc.resolve(left)).toBe(1);
    expect(doc.resolve(right)).toBe(1);
  });

  test("reversed delivery of 20K root siblings uses indexed ordering", () => {
    const a = new RunText(1);
    const operations: Insert[] = [];
    for (let i = 0; i < 20_000; i++)
      operations.push(a.insert(0, String.fromCharCode(65 + (i % 26))));
    const b = new RunText(2);
    for (const op of operations.toReversed()) b.apply(op);
    expect(b.getText()).toBe(a.getText());
    b.check();
  });

  for (let seed = 0; seed < 40; seed++) {
    test(`replicas reload while edits and dependencies are in flight, seed ${seed}`, () => {
      const rng = random(seed + 4000);
      const docs = [new RunText(1), new RunText(2), new RunText(3)];
      const operations: Operation[] = [];
      for (let step = 0; step < 400; step++) {
        const index = Math.floor(rng() * docs.length);
        const doc = docs[index];
        if (doc === undefined) throw new Error("Missing replica");
        if (rng() < 0.35 && operations.length > 0) {
          const op = operations[Math.floor(rng() * operations.length)];
          if (op !== undefined) doc.apply(op);
        } else {
          const offset = Math.floor(rng() * (doc.length + 1));
          if (offset < doc.length && rng() < 0.35)
            operations.push(doc.delete(offset, Math.min(3, doc.length - offset)));
          else
            operations.push(doc.insert(offset, ["abc", "😀", "\ud800x", "\r\n"][step % 4] ?? "x"));
        }
        if (step % 7 === 0) {
          const offset = Math.floor(doc.length / 2);
          const anchor = doc.anchorAt(offset);
          const restored = RunText.decode(doc.encode(), doc.actor);
          expect(restored.getText()).toBe(doc.getText());
          expect(restored.stateVector()).toEqual(doc.stateVector());
          expect(restored.resolve(anchor)).toBe(offset);
          restored.check();
          docs[index] = restored;
        }
      }
      const expected = reference(operations);
      for (const doc of docs) {
        for (const op of shuffled(operations, rng)) doc.apply(op);
        expect(doc.getText()).toBe(expected);
        expect(doc.stats.pending).toBe(0);
        doc.check();
      }
    });
  }

  for (let seed = 0; seed < 30; seed++) {
    test(`partial delivery interleaved with local editing, seed ${seed}`, () => {
      const rng = random(seed + 1000);
      const docs = [new RunText(1), new RunText(2), new RunText(3)];
      const ops: Operation[] = [];
      for (let i = 0; i < 500; i++) {
        const doc = docs[Math.floor(rng() * docs.length)];
        if (doc === undefined) throw new Error("Missing replica");
        if (rng() < 0.45 && ops.length > 0) {
          const op = ops[Math.floor(rng() * ops.length)];
          if (op !== undefined) doc.apply(op);
        } else {
          const offset = Math.floor(rng() * (doc.length + 1));
          if (offset < doc.length && rng() < 0.3)
            ops.push(doc.delete(offset, Math.min(4, doc.length - offset)));
          else ops.push(doc.insert(offset, String.fromCharCode(64 + doc.actor).repeat(2)));
        }
        doc.check();
      }
      const expected = reference(ops);
      for (const doc of docs) {
        for (const op of shuffled(ops, rng)) doc.apply(op);
        expect(doc.getText()).toBe(expected);
        expect(doc.stats.pending).toBe(0);
        const restored = RunText.decode(doc.encode());
        expect(restored.getText()).toBe(expected);
        restored.check();
      }
    });
  }
  test("compresses actual storage while preserving operation identities", () => {
    const doc = new RunText(1);
    const ops: Insert[] = [];
    for (const char of "hello") ops.push(doc.insert(doc.length, char));
    expect(doc.getText()).toBe("hello");
    expect(doc.stats.runs).toBe(1);
    const other = new RunText(2);
    for (const op of ops.toReversed()) other.apply(op);
    expect(other.getText()).toBe("hello");
    expect(other.stats.pending).toBe(0);
    const removed = other.delete(1, 3);
    doc.apply(removed);
    expect(doc.getText()).toBe("ho");
    expect(doc.getText()).toBe(other.getText());
    doc.check();
    other.check();
  });

  test("concurrent inserts stay convergent after runs are split differently", () => {
    const a = new RunText(1);
    const b = new RunText(2);
    const seed = a.insert(0, "AB");
    b.apply(seed);
    const c = a.insert(1, "C");
    const d = b.insert(1, "D");
    const e = a.insert(2, "E");
    a.apply(d);
    b.apply(e);
    b.apply(c);
    expect(a.getText()).toBe("ADCEB");
    expect(a.getText()).toBe(b.getText());
    expect(a.getText()).toBe(reference([seed, c, d, e]));
    a.check();
    b.check();
  });

  test("observed deletes preserve concurrent inserts and can arrive first", () => {
    const a = new RunText(1);
    const b = new RunText(2);
    const seed = a.insert(0, "hello");
    b.apply(seed);
    const del = a.delete(1, 3);
    const insert = b.insert(2, "X");
    a.apply(insert);
    b.apply(del);
    const c = new RunText(3);
    for (const op of [del, insert, seed, del, seed, insert]) c.apply(op);
    expect(a.getText()).toBe("hXo");
    expect(b.getText()).toBe(a.getText());
    expect(c.getText()).toBe(a.getText());
    expect(c.stats.pending).toBe(0);
    c.check();
  });

  test("deletion-only updates are not lost behind an insertion state vector", () => {
    const a = new RunText(1);
    const b = new RunText(2);
    a.insert(0, "hello");
    for (const op of a.export()) b.apply(op);
    const since = b.stateVector();
    a.delete(1, 3);
    for (const op of a.export(since)) b.apply(op);
    expect(b.getText()).toBe("ho");
    expect(a.stateVector()).toEqual(b.stateVector());
  });

  test("state vectors acknowledge only contiguous ranges", () => {
    const a = new RunText(1);
    const first = a.insert(0, "abc");
    const second = a.insert(0, "d");
    const b = new RunText(2);
    b.apply(second);
    expect(b.stateVector().get(1)).toBeUndefined();
    for (const op of a.export(b.stateVector())) b.apply(op);
    expect(b.getText()).toBe("dabc");
    expect(b.stateVector().get(1)).toBe(4);
    b.apply(first);
    expect(b.getText()).toBe("dabc");
  });

  test("partial overlapping updates, split packets, and duplicate deliveries", () => {
    const a = new RunText(1);
    const first = a.insert(0, "ab");
    a.insert(2, "cd");
    const b = new RunText(2);
    b.apply(first);
    for (const op of a.export()) b.apply(op);
    const insertion = b.insert(1, "X");
    a.apply(insertion);
    a.delete(2, 1);
    for (const op of a.export().toReversed()) b.apply(op);
    expect(b.getText()).toBe("aXcd");
    expect(a.getText()).toBe(b.getText());
    b.check();
  });

  test("long causal chains drain without recursion", () => {
    const a = new RunText(1);
    const b = new RunText(2);
    const ops: Insert[] = [];
    for (let i = 0; i < 20_000; i++) ops.push(a.insert(i, "x"));
    for (const op of ops.toReversed()) b.apply(op);
    expect(b.getText()).toBe("x".repeat(20_000));
    expect(b.stats.pending).toBe(0);
    expect(b.stats.runs).toBeLessThan(10);
    b.check();
  });

  test("UTF-16 offsets preserve surrogate pairs, lone surrogates, and CRLF", () => {
    const a = new RunText(1);
    const op = a.insert(0, "a😀\r\n\ud800中");
    const removed = a.delete(2, 1);
    const b = new RunText(2);
    b.apply(removed);
    b.apply(op);
    expect(a.getText()).toBe("a\ud83d\r\n\ud800中");
    expect(b.getText()).toBe(a.getText());
    b.check();
  });

  test("rejects invalid local offsets without changing the document", () => {
    const a = new RunText(1);
    a.insert(0, "abc");
    for (const offset of [-1, 4, 0.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => a.insert(offset, "x")).toThrow();
    }
    expect(() => a.delete(1, 3)).toThrow();
    expect(a.getText()).toBe("abc");
  });

  for (let seed = 0; seed < 80; seed++) {
    test(`local edits match string splices, seed ${seed}`, () => {
      const rng = random(seed);
      const doc = new RunText(1);
      let expected = "";
      for (let i = 0; i < 400; i++) {
        const offset = Math.floor(rng() * (expected.length + 1));
        if (offset < expected.length && rng() < 0.4) {
          const length = Math.min(expected.length - offset, Math.ceil(rng() * 8));
          doc.delete(offset, length);
          expected = expected.slice(0, offset) + expected.slice(offset + length);
        } else {
          const text = String.fromCharCode(65 + Math.floor(rng() * 26)).repeat(
            1 + Math.floor(rng() * 8),
          );
          doc.insert(offset, text);
          expected = expected.slice(0, offset) + text + expected.slice(offset);
        }
        expect(doc.getText()).toBe(expected);
        doc.check();
      }
    });

    test(`three replicas match an independent RGA under shuffled delivery, seed ${seed}`, () => {
      const rng = random(seed);
      const docs = [new RunText(1), new RunText(2), new RunText(3)];
      const operations: Operation[] = [];
      for (let round = 0; round < 4; round++) {
        for (const doc of docs) {
          for (let edit = 0; edit < 25; edit++) {
            const offset = Math.floor(rng() * (doc.length + 1));
            if (offset < doc.length && rng() < 0.35) {
              operations.push(
                doc.delete(offset, Math.min(doc.length - offset, 1 + Math.floor(rng() * 6))),
              );
            } else {
              operations.push(
                doc.insert(
                  offset,
                  String.fromCharCode(64 + doc.actor).repeat(1 + Math.floor(rng() * 5)),
                ),
              );
            }
          }
        }
        const expected = reference(operations);
        for (const doc of docs) {
          for (const op of shuffled(operations, rng)) doc.apply(op);
          expect(doc.getText()).toBe(expected);
          expect(doc.stats.pending).toBe(0);
          doc.check();
        }
      }
    });
  }

  test("the entire Kleppmann trace produces the exact expected document", async () => {
    const trace = await loadEditingTrace();
    if (trace === null) throw new Error("Run bun run fixtures:download before testing");
    const doc = new RunText(1);
    for (const op of trace.operations) {
      if (op.deleteCount > 0) doc.delete(op.position, op.deleteCount);
      if (op.insertText.length > 0) doc.insert(op.position, op.insertText);
    }
    expect(doc.getText()).toBe(trace.finalText);
    doc.check();
    expect(doc.stats.runs).toBeLessThan(30_000);
  });
});
