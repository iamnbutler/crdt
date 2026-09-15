import { describe, expect, test } from "bun:test";
import { TextBuffer } from "./text-buffer.js";
import { type Operation, replicaId } from "./types.js";

// Wall-clock targets belong in the benchmark report, where the runtime and
// machine are recorded. Correctness must not depend on a hosted runner's load.
describe("large insert workloads", () => {
  test("10K sequential inserts preserve every character", () => {
    const buf = TextBuffer.create();
    for (let i = 0; i < 10000; i++) {
      buf.insert(buf.length, "x");
    }
    expect(buf.length).toBe(10000);
    expect(buf.getText()).toBe("x".repeat(10000));
  });
});

describe("large remote insert workloads", () => {
  test("applying 1K remote operations reproduces the source text", () => {
    const source = TextBuffer.create(replicaId(1));
    const ops: Operation[] = [];

    for (let i = 0; i < 1000; i++) {
      ops.push(source.insert(source.length, "x"));
    }

    const target = TextBuffer.create(replicaId(2));
    for (const op of ops) {
      target.applyRemote(op);
    }
    expect(target.length).toBe(1000);
    expect(target.getText()).toBe(source.getText());
  });
});
