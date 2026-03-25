import { describe, expect, test } from "bun:test";
import { SumTree } from "../sum-tree/index.js";
import { createFragment, fragmentSummaryOps, locatorDimension } from "./fragment.js";
import { compareLocators } from "./locator.js";
import { TextBuffer } from "./text-buffer.js";
import type { Locator, OperationId } from "./types.js";
import { replicaId } from "./types.js";

function makeOpId(counter: number): OperationId {
  return { replicaId: replicaId(1), counter };
}

function makeLocator(...levels: number[]): Locator {
  return { levels };
}

describe("locatorDimension", () => {
  test("measure returns fragment maxLocator from summary", () => {
    const frag = createFragment(makeOpId(1), 0, makeLocator(100), "hello", true);
    const measured = locatorDimension.measure(frag.summary());
    expect(compareLocators(measured, makeLocator(100))).toBe(0);
  });

  test("cursor can seek to locator position in tree", () => {
    // Create fragments with locators [10], [20], [30]
    const frags = [
      createFragment(makeOpId(1), 0, makeLocator(10), "a", true),
      createFragment(makeOpId(2), 0, makeLocator(20), "b", true),
      createFragment(makeOpId(3), 0, makeLocator(30), "c", true),
    ];

    const tree = SumTree.fromItems(frags, fragmentSummaryOps);
    const cursor = tree.cursor(locatorDimension);

    // Seek to locator [15] - should land at fragment with [20]
    cursor.seekForward(makeLocator(15), "right");
    const item = cursor.item();
    expect(item).not.toBeNull();
    if (item !== undefined) {
      expect(compareLocators(item.locator, makeLocator(20))).toBe(0);
    }
  });
});

// Helper type for accessing private methods in tests
type TextBufferPrivate = {
  findInsertIndexByLocator(loc: Locator): number;
  fragments: { length(): number };
};

describe("findInsertIndexByLocator", () => {
  test("finds correct index for locator at end", () => {
    const buf = TextBuffer.create();
    buf.insert(0, "abc");

    const testLocator = makeLocator(Number.MAX_SAFE_INTEGER);
    // Access private method via type assertion for testing
    const bufPrivate = buf as unknown as TextBufferPrivate;
    const index = bufPrivate.findInsertIndexByLocator(testLocator);
    // Access private fragments field via type assertion for testing
    const fragCount = bufPrivate.fragments.length();
    expect(index).toBe(fragCount);
  });

  test("finds correct index for locator at start", () => {
    const buf = TextBuffer.create();
    buf.insert(0, "abc");

    const testLocator = makeLocator(0);
    const bufPrivate = buf as unknown as TextBufferPrivate;
    const index = bufPrivate.findInsertIndexByLocator(testLocator);
    expect(index).toBe(0);
  });

  test("returns 0 for empty buffer", () => {
    const buf = TextBuffer.create();

    const testLocator = makeLocator(100);
    const bufPrivate = buf as unknown as TextBufferPrivate;
    const index = bufPrivate.findInsertIndexByLocator(testLocator);
    expect(index).toBe(0);
  });

  test("cursor itemIndex works correctly", () => {
    // Create fragments with locators [10], [20], [30]
    const frags = [
      createFragment(makeOpId(1), 0, makeLocator(10), "a", true),
      createFragment(makeOpId(2), 0, makeLocator(20), "b", true),
      createFragment(makeOpId(3), 0, makeLocator(30), "c", true),
    ];

    const tree = SumTree.fromItems(frags, fragmentSummaryOps);
    const cursor = tree.cursor(locatorDimension);

    // Seek to locator [15] - should land at fragment with [20], which is index 1
    cursor.seekForward(makeLocator(15), "right");
    expect(cursor.itemIndex()).toBe(1);

    // Seek to locator [25] - should land at fragment with [30], which is index 2
    cursor.reset();
    cursor.seekForward(makeLocator(25), "right");
    expect(cursor.itemIndex()).toBe(2);
  });
});
