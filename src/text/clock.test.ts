import { describe, expect, test } from "bun:test";
import {
  LamportClock,
  createVersionVector,
  happenedBefore,
  observeVersion,
} from "./clock.js";
import { replicaId } from "./types.js";

describe("LamportClock initialCounter", () => {
  test("starts at provided initial counter", () => {
    const rid = replicaId(1);
    const clock = new LamportClock(rid, 100);
    const id = clock.tick();
    expect(id.counter).toBe(100);
  });

  test("counter property reflects current value before and after tick", () => {
    const rid = replicaId(1);
    const clock = new LamportClock(rid, 50);
    expect(clock.counter).toBe(50);
    clock.tick();
    expect(clock.counter).toBe(51);
  });

  test("observe advances past initial counter", () => {
    const rid = replicaId(1);
    const clock = new LamportClock(rid, 200);
    clock.observe(300);
    expect(clock.counter).toBe(301);
  });

  test("observe does not go below initial counter", () => {
    const rid = replicaId(1);
    const clock = new LamportClock(rid, 200);
    clock.observe(50);
    expect(clock.counter).toBe(200);
  });
});

// happenedBefore edge cases not covered in text-buffer.test.ts
describe("happenedBefore edge cases", () => {
  test("equal vectors: neither happened before the other", () => {
    const a = createVersionVector();
    const b = createVersionVector();
    const rid = replicaId(1);
    observeVersion(a, rid, 5);
    observeVersion(b, rid, 5);

    expect(happenedBefore(a, b)).toBe(false);
    expect(happenedBefore(b, a)).toBe(false);
  });

  test("two empty vectors: neither happened before the other", () => {
    const a = createVersionVector();
    const b = createVersionVector();

    expect(happenedBefore(a, b)).toBe(false);
    expect(happenedBefore(b, a)).toBe(false);
  });

  test("empty vector happened before non-empty vector", () => {
    const empty = createVersionVector();
    const nonEmpty = createVersionVector();
    observeVersion(nonEmpty, replicaId(1), 1);

    expect(happenedBefore(empty, nonEmpty)).toBe(true);
    expect(happenedBefore(nonEmpty, empty)).toBe(false);
  });

  test("a with unknown rid is not before b", () => {
    const a = createVersionVector();
    const b = createVersionVector();
    observeVersion(a, replicaId(1), 5);
    observeVersion(b, replicaId(2), 5);

    // a has rid1 not in b → a cannot have happened before b
    expect(happenedBefore(a, b)).toBe(false);
  });

  test("same vector object does not happen before itself", () => {
    const vv = createVersionVector();
    observeVersion(vv, replicaId(1), 10);

    expect(happenedBefore(vv, vv)).toBe(false);
  });

  test("a before b when a is strict subset with lower counters", () => {
    const a = createVersionVector();
    const b = createVersionVector();
    const rid1 = replicaId(1);
    const rid2 = replicaId(2);
    observeVersion(a, rid1, 3);
    observeVersion(b, rid1, 3);
    observeVersion(b, rid2, 1); // b has extra entry

    expect(happenedBefore(a, b)).toBe(true);
    expect(happenedBefore(b, a)).toBe(false);
  });
});
