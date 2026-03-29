import { describe, expect, test } from "bun:test";
import { TextBuffer } from "./index.js";

describe("crdt public API", () => {
  test("TextBuffer: insert and read back via main package", () => {
    const buf = TextBuffer.fromString("hello");
    buf.insert(5, " world");
    expect(buf.getText()).toBe("hello world");
  });

  test("TextBuffer: delete via main package", () => {
    const buf = TextBuffer.fromString("hello world");
    buf.delete(5, 11);
    expect(buf.getText()).toBe("hello");
  });

  test("TextBuffer: empty buffer round-trip", () => {
    const buf = TextBuffer.create();
    expect(buf.getText()).toBe("");
    buf.insert(0, "first");
    expect(buf.getText()).toBe("first");
    buf.delete(0, 5);
    expect(buf.getText()).toBe("");
  });
});
