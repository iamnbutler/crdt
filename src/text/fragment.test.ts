import { describe, expect, test } from "bun:test";
import { SumTree } from "../sum-tree/index.js";
import {
  createFragment,
  deleteFragment,
  fragmentSummaryOps,
  locatorDimension,
  splitFragment,
  withVisibility,
} from "./fragment.js";
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
    const frags = [
      createFragment(makeOpId(1), 0, makeLocator(10), "a", true),
      createFragment(makeOpId(2), 0, makeLocator(20), "b", true),
      createFragment(makeOpId(3), 0, makeLocator(30), "c", true),
    ];

    const tree = SumTree.fromItems(frags, fragmentSummaryOps);
    const cursor = tree.cursor(locatorDimension);

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
    const frags = [
      createFragment(makeOpId(1), 0, makeLocator(10), "a", true),
      createFragment(makeOpId(2), 0, makeLocator(20), "b", true),
      createFragment(makeOpId(3), 0, makeLocator(30), "c", true),
    ];

    const tree = SumTree.fromItems(frags, fragmentSummaryOps);
    const cursor = tree.cursor(locatorDimension);

    cursor.seekForward(makeLocator(15), "right");
    expect(cursor.itemIndex()).toBe(1);

    cursor.reset();
    cursor.seekForward(makeLocator(25), "right");
    expect(cursor.itemIndex()).toBe(2);
  });
});

describe("createFragment", () => {
  test("visible fragment summary has correct visibleLen", () => {
    const frag = createFragment(makeOpId(1), 0, makeLocator(1), "hello", true);
    const s = frag.summary();
    expect(s.visibleLen).toBe(5);
    expect(s.visibleLines).toBe(0);
    expect(s.deletedLen).toBe(0);
    expect(s.deletedLines).toBe(0);
    expect(s.itemCount).toBe(1);
  });

  test("invisible fragment summary has correct deletedLen", () => {
    const frag = createFragment(makeOpId(1), 0, makeLocator(1), "hello", false);
    const s = frag.summary();
    expect(s.visibleLen).toBe(0);
    expect(s.visibleLines).toBe(0);
    expect(s.deletedLen).toBe(5);
    expect(s.deletedLines).toBe(0);
    expect(s.itemCount).toBe(1);
  });

  test("fragment with newlines counts lines correctly", () => {
    const frag = createFragment(makeOpId(1), 0, makeLocator(1), "a\nb\nc", true);
    const s = frag.summary();
    expect(s.visibleLen).toBe(5);
    expect(s.visibleLines).toBe(2);
  });

  test("invisible fragment with newlines tracks deleted lines", () => {
    const frag = createFragment(makeOpId(1), 0, makeLocator(1), "a\nb\nc", false);
    const s = frag.summary();
    expect(s.deletedLen).toBe(5);
    expect(s.deletedLines).toBe(2);
  });

  test("empty text fragment", () => {
    const frag = createFragment(makeOpId(1), 0, makeLocator(1), "", true);
    const s = frag.summary();
    expect(s.visibleLen).toBe(0);
    expect(s.visibleLines).toBe(0);
    expect(frag.length).toBe(0);
  });

  test("baseLocator defaults to locator when not provided", () => {
    const loc = makeLocator(5, 10);
    const frag = createFragment(makeOpId(1), 0, loc, "x", true);
    expect(compareLocators(frag.baseLocator, loc)).toBe(0);
  });

  test("baseLocator is preserved when provided", () => {
    const loc = makeLocator(5, 10);
    const base = makeLocator(5);
    const frag = createFragment(makeOpId(1), 3, loc, "x", true, [], base);
    expect(compareLocators(frag.baseLocator, base)).toBe(0);
    expect(compareLocators(frag.locator, loc)).toBe(0);
  });
});

describe("splitFragment", () => {
  test("splits text at given offset", () => {
    const frag = createFragment(makeOpId(1), 0, makeLocator(100), "hello", true);
    const [left, right] = splitFragment(frag, 2);

    expect(left.text).toBe("he");
    expect(right.text).toBe("llo");
  });

  test("preserves visibility in both halves", () => {
    const frag = createFragment(makeOpId(1), 0, makeLocator(100), "hello", true);
    const [left, right] = splitFragment(frag, 2);

    expect(left.visible).toBe(true);
    expect(right.visible).toBe(true);
  });

  test("preserves visibility for invisible fragments", () => {
    const frag = createFragment(makeOpId(1), 0, makeLocator(100), "hello", false);
    const [left, right] = splitFragment(frag, 2);

    expect(left.visible).toBe(false);
    expect(right.visible).toBe(false);
  });

  test("left and right summaries are correct", () => {
    const frag = createFragment(makeOpId(1), 0, makeLocator(100), "ab\ncd", true);
    const [left, right] = splitFragment(frag, 3); // split after "ab\n"

    expect(left.summary().visibleLen).toBe(3);
    expect(left.summary().visibleLines).toBe(1);
    expect(right.summary().visibleLen).toBe(2);
    expect(right.summary().visibleLines).toBe(0);
  });

  test("split at beginning gives empty left", () => {
    const frag = createFragment(makeOpId(1), 0, makeLocator(100), "hello", true);
    const [left, right] = splitFragment(frag, 0);

    expect(left.text).toBe("");
    expect(right.text).toBe("hello");
  });

  test("split at end gives empty right", () => {
    const frag = createFragment(makeOpId(1), 0, makeLocator(100), "hello", true);
    const [left, right] = splitFragment(frag, 5);

    expect(left.text).toBe("hello");
    expect(right.text).toBe("");
  });

  test("preserves insertionId in both halves", () => {
    const opId = makeOpId(42);
    const frag = createFragment(opId, 0, makeLocator(100), "hello", true);
    const [left, right] = splitFragment(frag, 2);

    expect(left.insertionId.counter).toBe(42);
    expect(right.insertionId.counter).toBe(42);
  });

  test("right half has correct insertionOffset", () => {
    const frag = createFragment(makeOpId(1), 5, makeLocator(100), "hello", true);
    const [left, right] = splitFragment(frag, 2);

    expect(left.insertionOffset).toBe(5);
    expect(right.insertionOffset).toBe(7); // 5 + 2
  });

  test("locators use baseLocator as parent", () => {
    const baseLoc = makeLocator(50);
    const frag = createFragment(makeOpId(1), 0, makeLocator(100), "hello", true, [], baseLoc);
    const [left, right] = splitFragment(frag, 2);

    // Left locator: [...baseLocator, 2*0] = [50, 0]
    expect(left.locator.levels).toEqual([50, 0]);
    // Right locator: [...baseLocator, 2*2] = [50, 4]
    expect(right.locator.levels).toEqual([50, 4]);
  });

  test("split preserves deletions list", () => {
    const delId = makeOpId(99);
    const frag = createFragment(makeOpId(1), 0, makeLocator(100), "hello", false, [delId]);
    const [left, right] = splitFragment(frag, 2);

    expect(left.deletions).toEqual([delId]);
    expect(right.deletions).toEqual([delId]);
  });

  test("both halves preserve baseLocator", () => {
    const baseLoc = makeLocator(50);
    const frag = createFragment(makeOpId(1), 0, makeLocator(100), "hello", true, [], baseLoc);
    const [left, right] = splitFragment(frag, 2);

    expect(compareLocators(left.baseLocator, baseLoc)).toBe(0);
    expect(compareLocators(right.baseLocator, baseLoc)).toBe(0);
  });
});

describe("deleteFragment", () => {
  test("marks fragment as invisible", () => {
    const frag = createFragment(makeOpId(1), 0, makeLocator(1), "hello", true);
    const deleted = deleteFragment(frag, makeOpId(5));

    expect(deleted.visible).toBe(false);
  });

  test("adds deletion ID to deletions list", () => {
    const frag = createFragment(makeOpId(1), 0, makeLocator(1), "hello", true);
    const deleted = deleteFragment(frag, makeOpId(5));

    expect(deleted.deletions.length).toBe(1);
    expect(deleted.deletions[0]?.counter).toBe(5);
  });

  test("preserves existing deletions", () => {
    const frag = createFragment(makeOpId(1), 0, makeLocator(1), "hello", false, [makeOpId(3)]);
    const deleted = deleteFragment(frag, makeOpId(5));

    expect(deleted.deletions.length).toBe(2);
    expect(deleted.deletions[0]?.counter).toBe(3);
    expect(deleted.deletions[1]?.counter).toBe(5);
  });

  test("preserves text content", () => {
    const frag = createFragment(makeOpId(1), 0, makeLocator(1), "hello", true);
    const deleted = deleteFragment(frag, makeOpId(5));

    expect(deleted.text).toBe("hello");
  });

  test("summary moves metrics from visible to deleted", () => {
    const frag = createFragment(makeOpId(1), 0, makeLocator(1), "a\nb", true);
    const deleted = deleteFragment(frag, makeOpId(5));
    const s = deleted.summary();

    expect(s.visibleLen).toBe(0);
    expect(s.visibleLines).toBe(0);
    expect(s.deletedLen).toBe(3);
    expect(s.deletedLines).toBe(1);
  });
});

describe("withVisibility", () => {
  test("returns same fragment if visibility unchanged", () => {
    const frag = createFragment(makeOpId(1), 0, makeLocator(1), "hello", true);
    const same = withVisibility(frag, true);

    expect(same).toBe(frag); // same reference
  });

  test("makes visible fragment invisible", () => {
    const frag = createFragment(makeOpId(1), 0, makeLocator(1), "hello", true);
    const hidden = withVisibility(frag, false);

    expect(hidden.visible).toBe(false);
    expect(hidden.summary().visibleLen).toBe(0);
    expect(hidden.summary().deletedLen).toBe(5);
  });

  test("makes invisible fragment visible", () => {
    const frag = createFragment(makeOpId(1), 0, makeLocator(1), "hello", false);
    const shown = withVisibility(frag, true);

    expect(shown.visible).toBe(true);
    expect(shown.summary().visibleLen).toBe(5);
    expect(shown.summary().deletedLen).toBe(0);
  });

  test("preserves text and metadata", () => {
    const baseLoc = makeLocator(50);
    const frag = createFragment(
      makeOpId(1),
      3,
      makeLocator(100),
      "hello",
      true,
      [makeOpId(2)],
      baseLoc,
    );
    const toggled = withVisibility(frag, false);

    expect(toggled.text).toBe("hello");
    expect(toggled.insertionOffset).toBe(3);
    expect(toggled.deletions).toEqual([makeOpId(2)]);
    expect(compareLocators(toggled.baseLocator, baseLoc)).toBe(0);
  });
});

describe("fragmentSummaryOps", () => {
  test("identity returns all zeros", () => {
    const id = fragmentSummaryOps.identity();
    expect(id.visibleLen).toBe(0);
    expect(id.visibleLines).toBe(0);
    expect(id.deletedLen).toBe(0);
    expect(id.deletedLines).toBe(0);
    expect(id.itemCount).toBe(0);
  });

  test("combine sums all numeric fields", () => {
    const a = createFragment(makeOpId(1), 0, makeLocator(10), "ab\n", true).summary();
    const b = createFragment(makeOpId(2), 0, makeLocator(20), "cd", false).summary();
    const combined = fragmentSummaryOps.combine(a, b);

    expect(combined.visibleLen).toBe(3); // "ab\n"
    expect(combined.visibleLines).toBe(1);
    expect(combined.deletedLen).toBe(2); // "cd"
    expect(combined.deletedLines).toBe(0);
    expect(combined.itemCount).toBe(2);
  });

  test("combine takes max locator", () => {
    const a = createFragment(makeOpId(1), 0, makeLocator(10), "a", true).summary();
    const b = createFragment(makeOpId(2), 0, makeLocator(20), "b", true).summary();
    const combined = fragmentSummaryOps.combine(a, b);

    expect(compareLocators(combined.maxLocator, makeLocator(20))).toBe(0);
  });

  test("combine takes max insertionId", () => {
    const a = createFragment(makeOpId(5), 0, makeLocator(10), "a", true).summary();
    const b = createFragment(makeOpId(3), 0, makeLocator(20), "b", true).summary();
    const combined = fragmentSummaryOps.combine(a, b);

    expect(combined.maxInsertionId.counter).toBe(5);
  });

  test("getItemCount returns itemCount field", () => {
    const s = createFragment(makeOpId(1), 0, makeLocator(1), "x", true).summary();
    const getItemCount = fragmentSummaryOps.getItemCount;
    expect(getItemCount).toBeDefined();
    if (getItemCount !== undefined) {
      expect(getItemCount(s)).toBe(1);
    }
  });
});
