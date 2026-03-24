import { describe, expect, test } from "bun:test";
import {
  AnchorSet,
  Bias,
  type InsertionFragment,
  MAX_ANCHOR,
  MIN_ANCHOR,
  type OperationId,
  SimpleSnapshot,
  anchorsEqual,
  compareAnchors,
  compareOperationIds,
  createAnchor,
  createRangeEndAnchor,
  createRangeStartAnchor,
  deserializeAnchor,
  isMaxAnchor,
  isMinAnchor,
  resolveAnchor,
  resolveAnchorRange,
  serializeAnchor,
  withBias,
} from "./index.ts";

/**
 * Helper to create a simple document with fragments.
 * Each fragment represents text from a single insertion operation.
 */
function createDocument(
  parts: Array<{
    replicaId: number;
    localSeq: number;
    text: string;
    deleted?: boolean;
  }>,
): SimpleSnapshot {
  const fragments: InsertionFragment[] = [];
  let fullText = "";

  for (const part of parts) {
    fragments.push({
      insertionId: { replicaId: part.replicaId, localSeq: part.localSeq },
      startOffset: 0,
      endOffset: part.text.length,
      isDeleted: part.deleted ?? false,
      utf16Len: part.deleted ? 0 : part.text.length,
    });

    if (!part.deleted) {
      fullText += part.text;
    }
  }

  return new SimpleSnapshot(fragments, fullText);
}

/**
 * Helper to create a document from split fragments.
 * Used to test fragment splitting scenarios.
 */
function createSplitDocument(
  fragments: Array<{
    replicaId: number;
    localSeq: number;
    startOffset: number;
    endOffset: number;
    text: string;
    deleted?: boolean;
  }>,
): SimpleSnapshot {
  const frags: InsertionFragment[] = [];
  let fullText = "";

  for (const f of fragments) {
    frags.push({
      insertionId: { replicaId: f.replicaId, localSeq: f.localSeq },
      startOffset: f.startOffset,
      endOffset: f.endOffset,
      isDeleted: f.deleted ?? false,
      utf16Len: f.deleted ? 0 : f.text.length,
    });

    if (!f.deleted) {
      fullText += f.text;
    }
  }

  return new SimpleSnapshot(frags, fullText);
}

describe("Anchor types", () => {
  test("MIN_ANCHOR has correct shape", () => {
    expect(MIN_ANCHOR.insertionId.replicaId).toBe(0);
    expect(MIN_ANCHOR.insertionId.localSeq).toBe(0);
    expect(MIN_ANCHOR.offset).toBe(0);
    expect(MIN_ANCHOR.bias).toBe(Bias.Right);
  });

  test("MAX_ANCHOR has correct shape", () => {
    expect(MAX_ANCHOR.insertionId.replicaId).toBe(0xffffffff);
    expect(MAX_ANCHOR.insertionId.localSeq).toBe(0xffffffff);
    expect(MAX_ANCHOR.offset).toBe(0);
    expect(MAX_ANCHOR.bias).toBe(Bias.Left);
  });

  test("compareOperationIds orders correctly", () => {
    const id1: OperationId = { replicaId: 1, localSeq: 5 };
    const id2: OperationId = { replicaId: 1, localSeq: 10 };
    const id3: OperationId = { replicaId: 2, localSeq: 1 };

    expect(compareOperationIds(id1, id2)).toBeLessThan(0);
    expect(compareOperationIds(id2, id1)).toBeGreaterThan(0);
    expect(compareOperationIds(id1, id3)).toBeLessThan(0);
    expect(compareOperationIds(id1, id1)).toBe(0);
  });

  test("anchorsEqual compares all fields", () => {
    const a1 = { insertionId: { replicaId: 1, localSeq: 1 }, offset: 5, bias: Bias.Left };
    const a2 = { insertionId: { replicaId: 1, localSeq: 1 }, offset: 5, bias: Bias.Left };
    const a3 = { insertionId: { replicaId: 1, localSeq: 1 }, offset: 5, bias: Bias.Right };
    const a4 = { insertionId: { replicaId: 1, localSeq: 1 }, offset: 6, bias: Bias.Left };

    expect(anchorsEqual(a1, a2)).toBe(true);
    expect(anchorsEqual(a1, a3)).toBe(false);
    expect(anchorsEqual(a1, a4)).toBe(false);
  });

  test("compareAnchors orders by insertionId, then offset, then bias", () => {
    const a1 = { insertionId: { replicaId: 1, localSeq: 1 }, offset: 0, bias: Bias.Left };
    const a2 = { insertionId: { replicaId: 1, localSeq: 1 }, offset: 1, bias: Bias.Left };
    const a3 = { insertionId: { replicaId: 1, localSeq: 1 }, offset: 1, bias: Bias.Right };
    const a4 = { insertionId: { replicaId: 2, localSeq: 1 }, offset: 0, bias: Bias.Left };

    expect(compareAnchors(a1, a2)).toBeLessThan(0);
    expect(compareAnchors(a2, a3)).toBeLessThan(0);
    expect(compareAnchors(a3, a4)).toBeLessThan(0);
  });
});

describe("MIN/MAX anchors", () => {
  test("MIN_ANCHOR resolves to document start", () => {
    const doc = createDocument([{ replicaId: 1, localSeq: 1, text: "Hello, World!" }]);

    expect(resolveAnchor(doc, MIN_ANCHOR)).toBe(0);
  });

  test("MAX_ANCHOR resolves to document end", () => {
    const doc = createDocument([{ replicaId: 1, localSeq: 1, text: "Hello, World!" }]);

    expect(resolveAnchor(doc, MAX_ANCHOR)).toBe(13);
  });

  test("MIN/MAX anchors work on empty document", () => {
    const empty = new SimpleSnapshot([], "");

    expect(resolveAnchor(empty, MIN_ANCHOR)).toBe(0);
    expect(resolveAnchor(empty, MAX_ANCHOR)).toBe(0);
  });

  test("isMinAnchor and isMaxAnchor identify sentinels", () => {
    expect(isMinAnchor(MIN_ANCHOR)).toBe(true);
    expect(isMaxAnchor(MIN_ANCHOR)).toBe(false);
    expect(isMinAnchor(MAX_ANCHOR)).toBe(false);
    expect(isMaxAnchor(MAX_ANCHOR)).toBe(true);

    const regular = { insertionId: { replicaId: 1, localSeq: 1 }, offset: 0, bias: Bias.Left };
    expect(isMinAnchor(regular)).toBe(false);
    expect(isMaxAnchor(regular)).toBe(false);
  });
});

describe("createAnchor", () => {
  test("creates anchor at beginning of document", () => {
    const doc = createDocument([{ replicaId: 1, localSeq: 1, text: "Hello" }]);
    const anchor = createAnchor(doc, 0, Bias.Right);

    expect(anchor.insertionId.replicaId).toBe(1);
    expect(anchor.insertionId.localSeq).toBe(1);
    expect(anchor.offset).toBe(0);
    expect(anchor.bias).toBe(Bias.Right);
  });

  test("creates anchor in middle of document", () => {
    const doc = createDocument([{ replicaId: 1, localSeq: 1, text: "Hello" }]);
    const anchor = createAnchor(doc, 3, Bias.Left);

    expect(anchor.offset).toBe(3);
    expect(resolveAnchor(doc, anchor)).toBe(3);
  });

  test("creates anchor at end of fragment", () => {
    const doc = createDocument([
      { replicaId: 1, localSeq: 1, text: "Hello" },
      { replicaId: 1, localSeq: 2, text: "World" },
    ]);

    // Offset 5 is at the boundary between "Hello" and "World"
    const anchorLeft = createAnchor(doc, 5, Bias.Left);
    const anchorRight = createAnchor(doc, 5, Bias.Right);

    expect(resolveAnchor(doc, anchorLeft)).toBe(5);
    expect(resolveAnchor(doc, anchorRight)).toBe(5);
  });

  test("clamps offset to valid range", () => {
    const doc = createDocument([{ replicaId: 1, localSeq: 1, text: "Hello" }]);

    const anchorNegative = createAnchor(doc, -10, Bias.Left);
    const anchorOverflow = createAnchor(doc, 100, Bias.Right);

    expect(resolveAnchor(doc, anchorNegative)).toBe(0);
    expect(resolveAnchor(doc, anchorOverflow)).toBe(5);
  });

  test("returns MIN_ANCHOR for empty doc with left bias", () => {
    const empty = new SimpleSnapshot([], "");
    const anchor = createAnchor(empty, 0, Bias.Left);
    expect(isMinAnchor(anchor)).toBe(true);
  });

  test("returns MAX_ANCHOR for empty doc with right bias", () => {
    const empty = new SimpleSnapshot([], "");
    const anchor = createAnchor(empty, 0, Bias.Right);
    expect(isMaxAnchor(anchor)).toBe(true);
  });
});

describe("resolveAnchor", () => {
  test("resolves anchor to correct offset", () => {
    const doc = createDocument([{ replicaId: 1, localSeq: 1, text: "Hello, World!" }]);
    const anchor = createAnchor(doc, 7, Bias.Left);

    expect(resolveAnchor(doc, anchor)).toBe(7);
  });

  test("resolves anchor in multi-fragment document", () => {
    const doc = createDocument([
      { replicaId: 1, localSeq: 1, text: "Hello" },
      { replicaId: 2, localSeq: 1, text: ", " },
      { replicaId: 1, localSeq: 2, text: "World" },
    ]);

    // Create anchors in each fragment
    const anchor1 = createAnchor(doc, 2, Bias.Left); // In "Hello"
    const anchor2 = createAnchor(doc, 6, Bias.Left); // In ", "
    const anchor3 = createAnchor(doc, 10, Bias.Left); // In "World"

    expect(resolveAnchor(doc, anchor1)).toBe(2);
    expect(resolveAnchor(doc, anchor2)).toBe(6);
    expect(resolveAnchor(doc, anchor3)).toBe(10);
  });
});

describe("anchor survives insertions (issue test 1)", () => {
  test("anchor at offset P still points to same character after insert before P", () => {
    // Initial document: "Hello"
    // Anchor at offset 2 (the 'l' character)
    const doc1 = createDocument([{ replicaId: 1, localSeq: 1, text: "Hello" }]);
    const anchor = createAnchor(doc1, 2, Bias.Left);

    // Verify anchor points to 'l'
    expect(doc1.getText()[resolveAnchor(doc1, anchor)]).toBe("l");

    // After insert "XX" at position 0: "XXHello"
    // The anchor should now resolve to offset 4 (still the 'l')
    const doc2 = createDocument([
      { replicaId: 2, localSeq: 1, text: "XX" },
      { replicaId: 1, localSeq: 1, text: "Hello" },
    ]);

    const resolvedOffset = resolveAnchor(doc2, anchor);
    expect(resolvedOffset).toBe(4);
    expect(doc2.getText()[resolvedOffset]).toBe("l");
  });

  test("anchor survives multiple insertions", () => {
    // Start with "World"
    const doc1 = createDocument([{ replicaId: 1, localSeq: 1, text: "World" }]);
    const anchor = createAnchor(doc1, 0, Bias.Right); // Start of "World"

    // Insert "Hello, " before
    const doc2 = createDocument([
      { replicaId: 2, localSeq: 1, text: "Hello, " },
      { replicaId: 1, localSeq: 1, text: "World" },
    ]);

    expect(resolveAnchor(doc2, anchor)).toBe(7);
    expect(doc2.getText()[resolveAnchor(doc2, anchor)]).toBe("W");

    // Insert "!" after
    const doc3 = createDocument([
      { replicaId: 2, localSeq: 1, text: "Hello, " },
      { replicaId: 1, localSeq: 1, text: "World" },
      { replicaId: 2, localSeq: 2, text: "!" },
    ]);

    expect(resolveAnchor(doc3, anchor)).toBe(7);
    expect(doc3.getText()[resolveAnchor(doc3, anchor)]).toBe("W");
  });
});

describe("anchor behavior at deletion (issue test 2)", () => {
  test("Left bias anchor moves to previous position when character deleted", () => {
    // Initial: "Hello"
    const doc1 = createDocument([{ replicaId: 1, localSeq: 1, text: "Hello" }]);
    const anchor = createAnchor(doc1, 2, Bias.Left); // At 'l'

    // Delete 'l' at position 2: "Helo" - represented as split fragment
    const doc2 = createSplitDocument([
      { replicaId: 1, localSeq: 1, startOffset: 0, endOffset: 2, text: "He" },
      { replicaId: 1, localSeq: 1, startOffset: 2, endOffset: 3, text: "l", deleted: true },
      { replicaId: 1, localSeq: 1, startOffset: 3, endOffset: 5, text: "lo" },
    ]);

    // Anchor to deleted content should resolve based on bias
    // Since we're using a simple snapshot, deleted fragments don't move position
    const resolved = resolveAnchor(doc2, anchor);
    expect(resolved).toBe(2); // Position is preserved (fragment start)
  });

  test("Right bias anchor moves to next position when character deleted", () => {
    // Initial: "Hello"
    const doc1 = createDocument([{ replicaId: 1, localSeq: 1, text: "Hello" }]);
    const anchor = createAnchor(doc1, 2, Bias.Right); // At 'l'

    // Delete 'l': "Helo"
    const doc2 = createSplitDocument([
      { replicaId: 1, localSeq: 1, startOffset: 0, endOffset: 2, text: "He" },
      { replicaId: 1, localSeq: 1, startOffset: 2, endOffset: 3, text: "l", deleted: true },
      { replicaId: 1, localSeq: 1, startOffset: 3, endOffset: 5, text: "lo" },
    ]);

    const resolved = resolveAnchor(doc2, anchor);
    expect(resolved).toBe(2); // Deleted fragment keeps position at start
  });
});

describe("anchor survives fragment split (issue test 3)", () => {
  test("anchor survives when fragment is split by concurrent edit", () => {
    // Initial: "Hello" as one fragment
    const doc1 = createDocument([{ replicaId: 1, localSeq: 1, text: "Hello" }]);
    const anchor = createAnchor(doc1, 3, Bias.Left); // At second 'l'

    // Concurrent edit splits the fragment: "He" + "X" + "llo"
    // The original "Hello" fragment is split into two parts
    const doc2 = createSplitDocument([
      { replicaId: 1, localSeq: 1, startOffset: 0, endOffset: 2, text: "He" },
      { replicaId: 2, localSeq: 1, startOffset: 0, endOffset: 1, text: "X" }, // Concurrent insert
      { replicaId: 1, localSeq: 1, startOffset: 2, endOffset: 5, text: "llo" },
    ]);

    // Anchor at offset 3 in original "Hello" should now point into "llo" fragment
    // Original offset 3 (second 'l') is at startOffset=2 + 1 = offset 1 in "llo"
    const resolved = resolveAnchor(doc2, anchor);
    expect(resolved).toBe(4); // "He" (2) + "X" (1) + 1 into "llo"
    expect(doc2.getText()).toBe("HeXllo");
    expect(doc2.getText()[resolved]).toBe("l");
  });

  test("anchor survives multiple splits", () => {
    // Original: "ABCDE"
    const doc1 = createDocument([{ replicaId: 1, localSeq: 1, text: "ABCDE" }]);
    const anchor = createAnchor(doc1, 2, Bias.Left); // At 'C'

    // Split into A|BC|DE with insertions
    const doc2 = createSplitDocument([
      { replicaId: 1, localSeq: 1, startOffset: 0, endOffset: 1, text: "A" },
      { replicaId: 2, localSeq: 1, startOffset: 0, endOffset: 1, text: "X" },
      { replicaId: 1, localSeq: 1, startOffset: 1, endOffset: 3, text: "BC" },
      { replicaId: 2, localSeq: 2, startOffset: 0, endOffset: 1, text: "Y" },
      { replicaId: 1, localSeq: 1, startOffset: 3, endOffset: 5, text: "DE" },
    ]);

    const resolved = resolveAnchor(doc2, anchor);
    expect(doc2.getText()).toBe("AXBCYDE");
    expect(doc2.getText()[resolved]).toBe("C");
  });
});

describe("anchor survives undo/redo (issue test 4)", () => {
  test("anchor survives undo: insert then undo", () => {
    // Original: "Hello"
    const doc1 = createDocument([{ replicaId: 1, localSeq: 1, text: "Hello" }]);
    const anchor = createAnchor(doc1, 2, Bias.Left); // At 'l'

    // After insert "XX" at position 2: "HeXXllo"
    const doc2 = createSplitDocument([
      { replicaId: 1, localSeq: 1, startOffset: 0, endOffset: 2, text: "He" },
      { replicaId: 2, localSeq: 1, startOffset: 0, endOffset: 2, text: "XX" },
      { replicaId: 1, localSeq: 1, startOffset: 2, endOffset: 5, text: "llo" },
    ]);

    // Anchor should still point to 'l' in "llo"
    expect(doc2.getText()[resolveAnchor(doc2, anchor)]).toBe("l");

    // After undo (delete "XX"): back to "Hello"
    const doc3 = createSplitDocument([
      { replicaId: 1, localSeq: 1, startOffset: 0, endOffset: 2, text: "He" },
      { replicaId: 2, localSeq: 1, startOffset: 0, endOffset: 2, text: "XX", deleted: true },
      { replicaId: 1, localSeq: 1, startOffset: 2, endOffset: 5, text: "llo" },
    ]);

    // Anchor should still point to 'l'
    const resolved = resolveAnchor(doc3, anchor);
    expect(doc3.getText()).toBe("Hello");
    expect(doc3.getText()[resolved]).toBe("l");
  });

  test("anchor survives redo after undo", () => {
    // Original with "Hello"
    const doc1 = createDocument([{ replicaId: 1, localSeq: 1, text: "Hello" }]);
    const anchor = createAnchor(doc1, 4, Bias.Left); // At 'o'

    // Delete "ll" -> "Heo"
    const doc2 = createSplitDocument([
      { replicaId: 1, localSeq: 1, startOffset: 0, endOffset: 2, text: "He" },
      { replicaId: 1, localSeq: 1, startOffset: 2, endOffset: 4, text: "ll", deleted: true },
      { replicaId: 1, localSeq: 1, startOffset: 4, endOffset: 5, text: "o" },
    ]);

    expect(doc2.getText()).toBe("Heo");
    expect(doc2.getText()[resolveAnchor(doc2, anchor)]).toBe("o");

    // Undo delete -> back to "Hello"
    const doc3 = createSplitDocument([
      { replicaId: 1, localSeq: 1, startOffset: 0, endOffset: 2, text: "He" },
      { replicaId: 1, localSeq: 1, startOffset: 2, endOffset: 4, text: "ll" },
      { replicaId: 1, localSeq: 1, startOffset: 4, endOffset: 5, text: "o" },
    ]);

    expect(doc3.getText()).toBe("Hello");
    expect(doc3.getText()[resolveAnchor(doc3, anchor)]).toBe("o");

    // Redo delete -> "Heo"
    const doc4 = createSplitDocument([
      { replicaId: 1, localSeq: 1, startOffset: 0, endOffset: 2, text: "He" },
      { replicaId: 1, localSeq: 1, startOffset: 2, endOffset: 4, text: "ll", deleted: true },
      { replicaId: 1, localSeq: 1, startOffset: 4, endOffset: 5, text: "o" },
    ]);

    expect(doc4.getText()).toBe("Heo");
    expect(doc4.getText()[resolveAnchor(doc4, anchor)]).toBe("o");
  });
});

describe("anchor serialization", () => {
  test("serialize and deserialize anchor", () => {
    const anchor = {
      insertionId: { replicaId: 42, localSeq: 123 },
      offset: 7,
      bias: Bias.Left,
    };

    const serialized = serializeAnchor(anchor);
    expect(serialized).toBe("42:123:7:0");

    const deserialized = deserializeAnchor(serialized);
    expect(deserialized).not.toBeNull();
    if (deserialized) {
      expect(anchorsEqual(anchor, deserialized)).toBe(true);
    }
  });

  test("deserialize returns null for invalid input", () => {
    expect(deserializeAnchor("invalid")).toBeNull();
    expect(deserializeAnchor("1:2:3")).toBeNull(); // Missing bias
    expect(deserializeAnchor("a:b:c:d")).toBeNull(); // Non-numeric
    expect(deserializeAnchor("1:2:3:2")).toBeNull(); // Invalid bias
  });
});

describe("range anchors", () => {
  test("createRangeStartAnchor uses Right bias", () => {
    const doc = createDocument([{ replicaId: 1, localSeq: 1, text: "Hello" }]);
    const anchor = createRangeStartAnchor(doc, 2);
    expect(anchor.bias).toBe(Bias.Right);
  });

  test("createRangeEndAnchor uses Left bias", () => {
    const doc = createDocument([{ replicaId: 1, localSeq: 1, text: "Hello" }]);
    const anchor = createRangeEndAnchor(doc, 4);
    expect(anchor.bias).toBe(Bias.Left);
  });

  test("resolveAnchorRange returns correct range", () => {
    const doc = createDocument([{ replicaId: 1, localSeq: 1, text: "Hello, World!" }]);
    const start = createRangeStartAnchor(doc, 0);
    const end = createRangeEndAnchor(doc, 5);

    const range = resolveAnchorRange(doc, start, end);
    expect(range.start).toBe(0);
    expect(range.end).toBe(5);
    expect(range.collapsed).toBe(false);
  });

  test("resolveAnchorRange handles collapsed range", () => {
    const doc = createDocument([{ replicaId: 1, localSeq: 1, text: "Hello" }]);
    const anchor = createAnchor(doc, 3, Bias.Left);

    const range = resolveAnchorRange(doc, anchor, anchor);
    expect(range.start).toBe(3);
    expect(range.end).toBe(3);
    expect(range.collapsed).toBe(true);
  });
});

describe("withBias", () => {
  test("changes bias of anchor", () => {
    const anchor = { insertionId: { replicaId: 1, localSeq: 1 }, offset: 5, bias: Bias.Left };
    const withRight = withBias(anchor, Bias.Right);

    expect(withRight.bias).toBe(Bias.Right);
    expect(withRight.insertionId).toBe(anchor.insertionId);
    expect(withRight.offset).toBe(anchor.offset);
  });

  test("returns same anchor if bias unchanged", () => {
    const anchor = { insertionId: { replicaId: 1, localSeq: 1 }, offset: 5, bias: Bias.Left };
    const same = withBias(anchor, Bias.Left);

    expect(same).toBe(anchor); // Same object reference
  });
});

describe("AnchorSet", () => {
  test("add and get entries", () => {
    const set = new AnchorSet<{ name: string }>();
    const anchor = { insertionId: { replicaId: 1, localSeq: 1 }, offset: 0, bias: Bias.Left };

    const id = set.add(anchor, { name: "test" });
    const entry = set.get(id);

    expect(entry).toBeDefined();
    if (entry) {
      expect(entry.anchor).toEqual(anchor);
      expect(entry.data.name).toBe("test");
    }
  });

  test("remove entries", () => {
    const set = new AnchorSet<string>();
    const anchor = { insertionId: { replicaId: 1, localSeq: 1 }, offset: 0, bias: Bias.Left };

    const id = set.add(anchor, "test");
    expect(set.size).toBe(1);

    const removed = set.remove(id);
    expect(removed).toBe(true);
    expect(set.size).toBe(0);
    expect(set.get(id)).toBeUndefined();
  });

  test("updateData modifies data", () => {
    const set = new AnchorSet<number>();
    const anchor = { insertionId: { replicaId: 1, localSeq: 1 }, offset: 0, bias: Bias.Left };

    const id = set.add(anchor, 1);
    set.updateData(id, 2);

    const updated = set.get(id);
    expect(updated).toBeDefined();
    if (updated) {
      expect(updated.data).toBe(2);
    }
  });

  test("updateAnchor modifies anchor", () => {
    const set = new AnchorSet<string>();
    const anchor1 = { insertionId: { replicaId: 1, localSeq: 1 }, offset: 0, bias: Bias.Left };
    const anchor2 = { insertionId: { replicaId: 2, localSeq: 1 }, offset: 5, bias: Bias.Right };

    const id = set.add(anchor1, "test");
    set.updateAnchor(id, anchor2);

    const updatedEntry = set.get(id);
    expect(updatedEntry).toBeDefined();
    if (updatedEntry) {
      expect(updatedEntry.anchor).toEqual(anchor2);
    }
  });

  test("resolve single entry", () => {
    const doc = createDocument([{ replicaId: 1, localSeq: 1, text: "Hello" }]);
    const set = new AnchorSet<string>();
    const anchor = createAnchor(doc, 3, Bias.Left);

    const id = set.add(anchor, "cursor");
    const resolved = set.resolve(id, doc);

    expect(resolved).toBeDefined();
    if (resolved) {
      expect(resolved.offset).toBe(3);
      expect(resolved.data).toBe("cursor");
    }
  });

  test("resolveAll returns all entries in document order", () => {
    const doc = createDocument([
      { replicaId: 1, localSeq: 1, text: "Hello" },
      { replicaId: 2, localSeq: 1, text: "World" },
    ]);

    const set = new AnchorSet<string>();
    set.add(createAnchor(doc, 8, Bias.Left), "third");
    set.add(createAnchor(doc, 0, Bias.Right), "first");
    set.add(createAnchor(doc, 4, Bias.Left), "second");

    const resolved = set.resolveAll(doc);

    expect(resolved).toHaveLength(3);
    const [first, second, third] = resolved;
    expect(first?.data).toBe("first");
    expect(second?.data).toBe("second");
    expect(third?.data).toBe("third");
    expect(first?.offset).toBe(0);
    expect(second?.offset).toBe(4);
    expect(third?.offset).toBe(8);
  });

  test("resolveInRange returns entries within range", () => {
    const doc = createDocument([{ replicaId: 1, localSeq: 1, text: "Hello, World!" }]);
    const set = new AnchorSet<number>();

    set.add(createAnchor(doc, 0, Bias.Right), 1);
    set.add(createAnchor(doc, 5, Bias.Left), 2);
    set.add(createAnchor(doc, 7, Bias.Left), 3);
    set.add(createAnchor(doc, 12, Bias.Left), 4);

    const inRange = set.resolveInRange(doc, 4, 10);

    expect(inRange).toHaveLength(2);
    const [rangeFirst, rangeSecond] = inRange;
    expect(rangeFirst?.data).toBe(2);
    expect(rangeSecond?.data).toBe(3);
  });

  test("findByAnchor returns matching entries", () => {
    const set = new AnchorSet<string>();
    const anchor = { insertionId: { replicaId: 1, localSeq: 1 }, offset: 5, bias: Bias.Left };

    const id1 = set.add(anchor, "first");
    const id2 = set.add(anchor, "second");
    set.add(
      { insertionId: { replicaId: 2, localSeq: 1 }, offset: 0, bias: Bias.Left },
      "different",
    );

    const found = set.findByAnchor(anchor);
    expect(found).toHaveLength(2);
    expect(found).toContain(id1);
    expect(found).toContain(id2);
  });

  test("clear removes all entries", () => {
    const set = new AnchorSet<string>();
    set.add({ insertionId: { replicaId: 1, localSeq: 1 }, offset: 0, bias: Bias.Left }, "a");
    set.add({ insertionId: { replicaId: 1, localSeq: 2 }, offset: 0, bias: Bias.Left }, "b");

    expect(set.size).toBe(2);
    set.clear();
    expect(set.size).toBe(0);
  });

  test("iteration works correctly", () => {
    const set = new AnchorSet<number>();
    set.add({ insertionId: { replicaId: 1, localSeq: 1 }, offset: 0, bias: Bias.Left }, 1);
    set.add({ insertionId: { replicaId: 1, localSeq: 2 }, offset: 0, bias: Bias.Left }, 2);

    const entries = [...set];
    expect(entries).toHaveLength(2);

    const array = set.toArray();
    expect(array).toHaveLength(2);
  });

  test("resolveAll handles empty set", () => {
    const doc = createDocument([{ replicaId: 1, localSeq: 1, text: "Hello" }]);
    const set = new AnchorSet<string>();

    const resolved = set.resolveAll(doc);
    expect(resolved).toHaveLength(0);
  });

  test("resolveAll handles sentinel anchors", () => {
    const doc = createDocument([{ replicaId: 1, localSeq: 1, text: "Hello" }]);
    const set = new AnchorSet<string>();

    set.add(MIN_ANCHOR, "start");
    set.add(MAX_ANCHOR, "end");

    const resolved = set.resolveAll(doc);
    expect(resolved).toHaveLength(2);
    const [startEntry, endEntry] = resolved;
    expect(startEntry?.offset).toBe(0);
    expect(startEntry?.data).toBe("start");
    expect(endEntry?.offset).toBe(5);
    expect(endEntry?.data).toBe("end");
  });
});

describe("edge cases", () => {
  test("handles Unicode surrogate pairs", () => {
    // "Hello 🌍" - the emoji is a surrogate pair (2 UTF-16 code units)
    const doc = createDocument([{ replicaId: 1, localSeq: 1, text: "Hello 🌍" }]);

    expect(doc.length).toBe(8); // 6 + 2 (surrogate pair)

    const anchor = createAnchor(doc, 6, Bias.Left); // At start of emoji
    expect(resolveAnchor(doc, anchor)).toBe(6);
  });

  test("handles very long documents", () => {
    const longText = "x".repeat(10000);
    const doc = createDocument([{ replicaId: 1, localSeq: 1, text: longText }]);

    const anchor = createAnchor(doc, 5000, Bias.Left);
    expect(resolveAnchor(doc, anchor)).toBe(5000);
  });

  test("handles many fragments", () => {
    const parts = [];
    for (let i = 0; i < 100; i++) {
      parts.push({ replicaId: 1, localSeq: i + 1, text: "X" });
    }
    const doc = createDocument(parts);

    const anchor = createAnchor(doc, 50, Bias.Left);
    expect(resolveAnchor(doc, anchor)).toBe(50);
  });
});
