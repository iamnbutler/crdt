import { describe, expect, test } from "bun:test";
import { SumTree } from "../sum-tree/index.js";
import { createFragment, fragmentSummaryOps, locatorDimension } from "./fragment.js";
import { compareLocators } from "./locator.js";
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
    expect(compareLocators(item!.locator, makeLocator(20))).toBe(0);
  });
});
