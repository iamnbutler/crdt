import { describe, expect, test } from "bun:test";
import {
  TextBuffer,
  Arena,
  Rope,
  PROTOCOL_VERSION,
  generateReplicaId,
} from "./index.js";

describe("main module exports", () => {
  test("exports TextBuffer", () => {
    const buf = TextBuffer.create();
    expect(buf.length).toBe(0);
    buf.insert(0, "hello");
    expect(buf.getText()).toBe("hello");
  });

  test("exports Arena", () => {
    const arena = new Arena<number>();
    expect(arena).toBeInstanceOf(Arena);
    const id = arena.allocate();
    expect(id).toBeDefined();
  });

  test("exports Rope", () => {
    const rope = Rope.from("hello world");
    expect(rope.getText()).toBe("hello world");
  });

  test("exports PROTOCOL_VERSION", () => {
    expect(typeof PROTOCOL_VERSION).toBe("string");
    expect(PROTOCOL_VERSION.length).toBeGreaterThan(0);
  });

  test("exports generateReplicaId", () => {
    const id = generateReplicaId();
    expect(id).toBeDefined();
  });
});
