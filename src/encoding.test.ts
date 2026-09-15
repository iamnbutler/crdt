import { expect, test } from "bun:test";
import { loadEditingTrace } from "../benchmarks/fixtures.js";
import { decodeFrame, decodeOperations, encodeFrame, encodeOperations } from "./encoding.js";
import { RunText } from "./run-text.js";

test("binary state round-trips exact UTF-16, actor IDs, and deletion history", () => {
  const a = new RunText(Number.MAX_SAFE_INTEGER);
  a.insert(0, "a😀\ud800\udfff\r\n中\0");
  a.delete(2, 1);
  const b = RunText.decode(a.encode(), 2);
  expect(b.getText()).toBe(a.getText());
  expect(b.stateVector()).toEqual(a.stateVector());
  const del = b.delete(0, 1);
  a.apply(del);
  expect(a.getText()).toBe(b.getText());
  b.check();
});

test("disconnected replicas exchange binary deltas repeatedly", () => {
  const a = new RunText(1);
  a.insert(0, "hello");
  const b = a.fork(2);
  for (let i = 0; i < 100; i++) {
    a.insert(Math.floor(a.length / 2), "ab");
    b.insert(Math.floor(b.length / 2), "cd");
    a.delete(0, 1);
    b.delete(b.length - 1, 1);
    const fromA = a.encode(b.stateVector());
    const fromB = b.encode(a.stateVector());
    a.merge(fromB);
    b.merge(fromA);
    a.merge(fromB);
    b.merge(fromA);
    expect(a.getText()).toBe(b.getText());
    expect(a.stats.pending).toBe(0);
    expect(b.stats.pending).toBe(0);
    a.check();
    b.check();
  }
});

test("an incomplete replica can persist and forward pending insertions and deletions", () => {
  const source = new RunText(1);
  const first = source.insert(0, "a");
  const second = source.insert(1, "b");
  const del = source.delete(0, 2);
  const partial = new RunText(2);
  partial.apply(second);
  partial.apply(del);
  const restored = RunText.decode(partial.encode(), 3);
  expect(restored.stats.pending).toBe(1);
  restored.apply(first);
  expect(restored.getText()).toBe("");
  expect(restored.stats.pending).toBe(0);
  expect(restored.stateVector().get(1)).toBe(2);
});

test("truncated or malformed frames do not mutate a receiver", () => {
  const source = new RunText(1);
  source.insert(0, "hello");
  const bytes = source.encode();
  const target = new RunText(2);
  target.insert(0, "safe");
  for (let length = 0; length < bytes.length; length++) {
    expect(() => target.merge(bytes.slice(0, length))).toThrow();
    expect(target.getText()).toBe("safe");
  }
  expect(() => decodeOperations(new Uint8Array([...bytes, 0]))).toThrow();
  expect(() =>
    decodeOperations(new Uint8Array([82, 84, 88, 1, 255, 255, 255, 255, 255, 255, 255, 255])),
  ).toThrow();
});

test("long strings and empty documents round-trip", () => {
  const doc = new RunText(1);
  expect(RunText.decode(doc.encode()).length).toBe(0);
  doc.insert(0, "😀x".repeat(50_000));
  expect(RunText.decode(doc.encode()).getText()).toBe(doc.getText());
  const ops = doc.export();
  expect(decodeOperations(encodeOperations(ops))).toEqual(ops);
});

test("full trace state restores, then supports further concurrent editing", async () => {
  const trace = await loadEditingTrace();
  if (trace === null) throw new Error("Missing editing trace");
  const source = new RunText(1);
  for (const op of trace.operations) {
    if (op.deleteCount) source.delete(op.position, op.deleteCount);
    if (op.insertText) source.insert(op.position, op.insertText);
  }
  const copy = RunText.decode(source.encode(), 2);
  expect(copy.getText()).toBe(trace.finalText);
  const a = source.insert(10, "AAA");
  const b = copy.insert(10, "BBB");
  source.apply(b);
  copy.apply(a);
  expect(source.getText()).toBe(copy.getText());
  copy.check();
});

test("cached snapshots are isolated from callers and invalidated by every edit type", () => {
  const a = new RunText(1);
  a.insert(0, "abc");
  const first = a.encode();
  const second = a.encode();
  first.fill(255);
  expect(RunText.decode(second).getText()).toBe("abc");
  expect(RunText.decode(a.encode()).getText()).toBe("abc");
  a.insert(1, "X");
  expect(RunText.decode(a.encode()).getText()).toBe("aXbc");
  a.delete(0, 1);
  expect(RunText.decode(a.encode()).getText()).toBe("Xbc");
  const b = a.fork(2);
  a.apply(b.insert(0, "Y"));
  expect(RunText.decode(a.encode()).getText()).toBe("YXbc");
  a.apply(b.delete(0, 1));
  expect(RunText.decode(a.encode()).getText()).toBe("Xbc");
  const input = a.encode();
  const restored = RunText.decode(input);
  input.fill(0);
  expect(RunText.decode(restored.encode()).getText()).toBe("Xbc");
});

test("deleted text is omitted but anchors and future insert origins survive", () => {
  const source = new RunText(1);
  source.insert(0, "abcdef");
  const anchor = source.anchorAt(3, "left");
  const offline = source.fork(2);
  source.delete(1, 4);
  const frame = decodeFrame(source.encode());
  expect(frame.runs.filter((run) => run.deleted).every((run) => /^\0+$/.test(run.text))).toBe(true);
  const restored = RunText.decode(source.encode(), 3);
  expect(restored.resolve(anchor)).toBe(source.resolve(anchor));
  const op = offline.insert(3, "X");
  source.apply(op);
  restored.apply(op);
  expect(restored.getText()).toBe("aXf");
  expect(restored.getText()).toBe(source.getText());
  restored.check();
});

test("malformed complete snapshots never partially replace an empty receiver", () => {
  const source = new RunText(1);
  source.insert(0, "ab");
  source.insert(1, "X");
  const frame = decodeFrame(source.encode());
  const bad = [
    encodeFrame([...frame.runs].reverse(), frame.spans, true),
    encodeFrame([...frame.runs, ...frame.runs], frame.spans, true),
    encodeFrame(frame.runs, [{ actor: 1, seq: 1, length: 1 }], true),
    encodeFrame(
      frame.runs.map((run) => ({ ...run, originActor: 99, originSeq: 1 })),
      frame.spans,
      true,
    ),
  ];
  for (const bytes of bad) {
    const target = new RunText(2);
    expect(() => target.merge(bytes)).toThrow();
    expect(target.getText()).toBe("");
    expect(target.stats.runs).toBe(0);
    expect(target.stateVector().size).toBe(0);
    target.check();
  }
});
