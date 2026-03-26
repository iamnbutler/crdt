import { describe, expect, test } from "bun:test";
import { TextBuffer } from "./text-buffer.js";
import { type Operation, replicaId } from "./types.js";

describe("insert performance - final targets", () => {
  test("10K sequential inserts under 100ms (issue #33 target)", () => {
    const start = performance.now();
    const buf = TextBuffer.create();
    for (let i = 0; i < 10000; i++) {
      buf.insert(buf.length, "x");
    }
    const elapsed = performance.now() - start;
    console.log(`10K inserts: ${elapsed.toFixed(0)}ms (target: <100ms)`);
    expect(elapsed).toBeLessThan(100);
  });
});

describe("remote insert performance", () => {
  test("applying 1K remote ops should be under 100ms", () => {
    const source = TextBuffer.create(replicaId(1));
    const ops: Operation[] = [];

    for (let i = 0; i < 1000; i++) {
      ops.push(source.insert(source.length, "x"));
    }

    const target = TextBuffer.create(replicaId(2));
    const start = performance.now();
    for (const op of ops) {
      target.applyRemote(op);
    }
    const elapsed = performance.now() - start;
    console.log(`1K remote ops: ${elapsed.toFixed(0)}ms (target: <100ms)`);
    expect(elapsed).toBeLessThan(100);
  });
});
