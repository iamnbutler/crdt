import { describe, expect, test } from "bun:test";
import {
  MAX_LOCATOR,
  MIN_LOCATOR,
  OperationQueue,
  Rope,
  SumTree,
  TextBuffer,
  compareLocators,
  locatorBetween,
} from "./index.js";

describe("package entry point", () => {
  test("SumTree is constructable via fromItems", () => {
    expect(typeof SumTree.fromItems).toBe("function");
  });

  test("Rope round-trips text", () => {
    const rope = Rope.from("hello world");
    expect(rope.getText()).toBe("hello world");
    expect(rope.length).toBe(11);
  });

  test("TextBuffer insert and read", () => {
    const buffer = TextBuffer.fromString("hello");
    buffer.insert(5, " world");
    expect(buffer.getText()).toBe("hello world");
  });

  test("locatorBetween produces ordered locators", () => {
    const mid = locatorBetween(MIN_LOCATOR, MAX_LOCATOR);
    expect(compareLocators(MIN_LOCATOR, mid)).toBeLessThan(0);
    expect(compareLocators(mid, MAX_LOCATOR)).toBeLessThan(0);
  });

  test("OperationQueue is constructable", () => {
    const queue = new OperationQueue();
    expect(queue.pendingCount).toBe(0);
  });
});
