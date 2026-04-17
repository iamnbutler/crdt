import { describe, expect, test } from "bun:test";
import { SumTree } from "../sum-tree/index.js";
import { createFragment, fragmentSummaryOps, locatorDimension } from "./fragment.js";
import { MIN_LOCATOR, compareLocators } from "./locator.js";
import type { FragmentSummary, Locator, OperationId } from "./types.js";
import { MIN_OPERATION_ID, replicaId } from "./types.js";

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

describe("cursor itemIndex works correctly", () => {
  test("cursor seeks to correct positions", () => {
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

describe("fragmentSummaryOps", () => {
  function makeSummary(overrides: Partial<FragmentSummary> = {}): FragmentSummary {
    return {
      visibleLen: 0,
      visibleLines: 0,
      deletedLen: 0,
      deletedLines: 0,
      maxInsertionId: MIN_OPERATION_ID,
      maxLocator: MIN_LOCATOR,
      itemCount: 0,
      ...overrides,
    };
  }

  test("identity returns zero values with sentinel extremes", () => {
    const id = fragmentSummaryOps.identity();
    expect(id.visibleLen).toBe(0);
    expect(id.visibleLines).toBe(0);
    expect(id.deletedLen).toBe(0);
    expect(id.deletedLines).toBe(0);
    expect(id.itemCount).toBe(0);
    expect(id.maxInsertionId).toBe(MIN_OPERATION_ID);
    expect(id.maxLocator).toBe(MIN_LOCATOR);
  });

  test("combine sums all numeric fields", () => {
    const left = makeSummary({
      visibleLen: 3,
      visibleLines: 1,
      deletedLen: 2,
      deletedLines: 0,
      itemCount: 1,
    });
    const right = makeSummary({
      visibleLen: 5,
      visibleLines: 2,
      deletedLen: 4,
      deletedLines: 1,
      itemCount: 2,
    });
    const result = fragmentSummaryOps.combine(left, right);
    expect(result.visibleLen).toBe(8);
    expect(result.visibleLines).toBe(3);
    expect(result.deletedLen).toBe(6);
    expect(result.deletedLines).toBe(1);
    expect(result.itemCount).toBe(3);
  });

  test("combine picks larger maxInsertionId by replicaId", () => {
    const left = makeSummary({ maxInsertionId: { replicaId: replicaId(1), counter: 99 } });
    const right = makeSummary({ maxInsertionId: { replicaId: replicaId(2), counter: 0 } });
    // replicaId(2) > replicaId(1), so right wins despite lower counter
    const result = fragmentSummaryOps.combine(left, right);
    expect(result.maxInsertionId.replicaId).toBe(replicaId(2));
    expect(result.maxInsertionId.counter).toBe(0);
  });

  test("combine picks larger maxInsertionId by counter when replicaIds tie", () => {
    const left = makeSummary({ maxInsertionId: { replicaId: replicaId(1), counter: 10 } });
    const right = makeSummary({ maxInsertionId: { replicaId: replicaId(1), counter: 5 } });
    const result = fragmentSummaryOps.combine(left, right);
    expect(result.maxInsertionId.counter).toBe(10);
  });

  test("combine uses left maxInsertionId when both are equal", () => {
    const leftId: OperationId = { replicaId: replicaId(1), counter: 7 };
    const left = makeSummary({ maxInsertionId: leftId });
    const right = makeSummary({ maxInsertionId: { replicaId: replicaId(1), counter: 7 } });
    const result = fragmentSummaryOps.combine(left, right);
    expect(result.maxInsertionId).toBe(leftId);
  });

  test("combine picks larger maxLocator", () => {
    const left = makeSummary({ maxLocator: { levels: [100] } });
    const right = makeSummary({ maxLocator: { levels: [200] } });
    const result = fragmentSummaryOps.combine(left, right);
    expect(compareLocators(result.maxLocator, { levels: [200] })).toBe(0);
  });

  test("combine uses left maxLocator when both are equal", () => {
    const leftLocator: Locator = { levels: [50] };
    const left = makeSummary({ maxLocator: leftLocator });
    const right = makeSummary({ maxLocator: { levels: [50] } });
    const result = fragmentSummaryOps.combine(left, right);
    expect(result.maxLocator).toBe(leftLocator);
  });

  test("left identity: combine(identity, x) propagates x's values", () => {
    const id = fragmentSummaryOps.identity();
    const x = makeSummary({
      visibleLen: 7,
      itemCount: 2,
      maxInsertionId: { replicaId: replicaId(3), counter: 4 },
    });
    const result = fragmentSummaryOps.combine(id, x);
    expect(result.visibleLen).toBe(7);
    expect(result.itemCount).toBe(2);
    expect(result.maxInsertionId.replicaId).toBe(replicaId(3));
  });

  test("right identity: combine(x, identity) propagates x's values", () => {
    const id = fragmentSummaryOps.identity();
    const x = makeSummary({
      visibleLen: 4,
      itemCount: 1,
      maxInsertionId: { replicaId: replicaId(5), counter: 2 },
    });
    const result = fragmentSummaryOps.combine(x, id);
    expect(result.visibleLen).toBe(4);
    expect(result.itemCount).toBe(1);
    expect(result.maxInsertionId.replicaId).toBe(replicaId(5));
  });

  test("real fragment summaries combine correctly", () => {
    const frag1 = createFragment(
      { replicaId: replicaId(1), counter: 0 },
      0,
      makeLocator(100),
      "Hello\n",
      true,
    );
    const frag2 = createFragment(
      { replicaId: replicaId(2), counter: 0 },
      0,
      makeLocator(200),
      "World",
      false,
    );
    const combined = fragmentSummaryOps.combine(frag1.summary(), frag2.summary());
    expect(combined.visibleLen).toBe(6); // "Hello\n"
    expect(combined.visibleLines).toBe(1);
    expect(combined.deletedLen).toBe(5); // "World" deleted
    expect(combined.deletedLines).toBe(0);
    expect(combined.itemCount).toBe(2);
    // replicaId(2) > replicaId(1), so frag2's insertionId wins
    expect(combined.maxInsertionId.replicaId).toBe(replicaId(2));
    // locator [200] > locator [100], so frag2's locator wins
    expect(compareLocators(combined.maxLocator, makeLocator(200))).toBe(0);
  });
});
