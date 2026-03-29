import { describe, expect, test } from "bun:test";
import {
  FragmentRef,
  FragmentStore,
  createStoredFragment,
  deleteStoredFragment,
  isFragmentRef,
  splitStoredFragment,
  withStoredVisibility,
} from "./fragment-store.js";
import { createFragment } from "./fragment.js";
import type { Locator, OperationId, ReplicaId } from "./types.js";

// Helpers
function rid(n: number): ReplicaId {
  // biome-ignore lint/suspicious/noExplicitAny: branded type construction
  return n as any;
}

function opId(replicaId: number, counter: number): OperationId {
  return { replicaId: rid(replicaId), counter };
}

function loc(...levels: number[]): Locator {
  return { levels };
}

// ---------------------------------------------------------------------------
// FragmentStore basics
// ---------------------------------------------------------------------------

describe("FragmentStore", () => {
  test("allocate and read back fragment data", () => {
    const store = new FragmentStore(4);
    const id = opId(1, 0);
    const locator = loc(100);

    const ref = createStoredFragment(store, id, 0, locator, "hello", true);

    expect(store.count).toBe(1);
    expect(ref).toBeInstanceOf(FragmentRef);
    expect(ref.insertionId.replicaId).toBe(rid(1));
    expect(ref.insertionId.counter).toBe(0);
    expect(ref.insertionOffset).toBe(0);
    expect(ref.locator).toEqual(locator);
    expect(ref.baseLocator).toEqual(locator);
    expect(ref.text).toBe("hello");
    expect(ref.length).toBe(5);
    expect(ref.visible).toBe(true);
    expect(ref.deletions).toEqual([]);
  });

  test("summary is correct for visible fragment", () => {
    const store = new FragmentStore();
    const ref = createStoredFragment(store, opId(1, 0), 0, loc(50), "ab\ncd", true);

    const s = ref.summary();
    expect(s.visibleLen).toBe(5);
    expect(s.visibleLines).toBe(1);
    expect(s.deletedLen).toBe(0);
    expect(s.deletedLines).toBe(0);
    expect(s.itemCount).toBe(1);
  });

  test("summary is correct for deleted fragment", () => {
    const store = new FragmentStore();
    const ref = createStoredFragment(store, opId(1, 0), 0, loc(50), "ab\ncd", false);

    const s = ref.summary();
    expect(s.visibleLen).toBe(0);
    expect(s.visibleLines).toBe(0);
    expect(s.deletedLen).toBe(5);
    expect(s.deletedLines).toBe(1);
  });

  test("multiple allocations use distinct handles", () => {
    const store = new FragmentStore(4);
    const a = createStoredFragment(store, opId(1, 0), 0, loc(10), "a", true);
    const b = createStoredFragment(store, opId(1, 1), 0, loc(20), "b", true);
    const c = createStoredFragment(store, opId(1, 2), 0, loc(30), "c", true);

    expect(store.count).toBe(3);
    expect(a.handle).not.toBe(b.handle);
    expect(b.handle).not.toBe(c.handle);
    expect(a.text).toBe("a");
    expect(b.text).toBe("b");
    expect(c.text).toBe("c");
  });

  test("free and reuse handles", () => {
    const store = new FragmentStore(4);
    const a = createStoredFragment(store, opId(1, 0), 0, loc(10), "a", true);
    const handleA = a.handle;

    store.free(handleA);
    expect(store.count).toBe(0);

    const b = createStoredFragment(store, opId(2, 0), 0, loc(20), "b", true);
    // The freed handle should be reused
    expect(b.handle).toBe(handleA);
    expect(b.text).toBe("b");
  });

  test("grow when capacity exceeded", () => {
    const store = new FragmentStore(2);
    expect(store.capacity).toBe(2);

    createStoredFragment(store, opId(1, 0), 0, loc(1), "a", true);
    createStoredFragment(store, opId(1, 1), 0, loc(2), "b", true);
    const c = createStoredFragment(store, opId(1, 2), 0, loc(3), "c", true);

    expect(store.capacity).toBe(4); // Doubled
    expect(store.count).toBe(3);
    expect(c.text).toBe("c");
  });

  test("batch accessors expose typed arrays", () => {
    const store = new FragmentStore(4);
    createStoredFragment(store, opId(1, 0), 0, loc(10), "visible", true);
    createStoredFragment(store, opId(1, 1), 0, loc(20), "hidden", false);

    expect(store.visibilityArray[0]).toBe(1);
    expect(store.visibilityArray[1]).toBe(0);
    expect(store.replicaIdArray[0]).toBe(1);
    expect(store.counterArray[1]).toBe(1);
  });

  test("setVisible mutates visibility in place", () => {
    const store = new FragmentStore();
    const ref = createStoredFragment(store, opId(1, 0), 0, loc(10), "text", true);

    expect(ref.visible).toBe(true);
    store.setVisible(ref.handle, false);
    expect(ref.visible).toBe(false);
    expect(store.visibilityArray[ref.handle as number]).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// isFragmentRef type guard
// ---------------------------------------------------------------------------

describe("isFragmentRef", () => {
  test("returns true for FragmentRef", () => {
    const store = new FragmentStore();
    const ref = createStoredFragment(store, opId(1, 0), 0, loc(10), "x", true);
    expect(isFragmentRef(ref)).toBe(true);
  });

  test("returns false for plain Fragment", () => {
    const plain = createFragment(opId(1, 0), 0, loc(10), "x", true);
    expect(isFragmentRef(plain)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Store-backed fragment operations
// ---------------------------------------------------------------------------

describe("splitStoredFragment", () => {
  test("splits text and creates correct locators", () => {
    const store = new FragmentStore();
    const frag = createStoredFragment(store, opId(1, 0), 0, loc(100), "hello", true);

    const [left, right] = splitStoredFragment(store, frag, 2);

    expect(left.text).toBe("he");
    expect(right.text).toBe("llo");
    expect(left.insertionOffset).toBe(0);
    expect(right.insertionOffset).toBe(2);
    expect(left.visible).toBe(true);
    expect(right.visible).toBe(true);
    expect(left.insertionId).toEqual(opId(1, 0));
    expect(right.insertionId).toEqual(opId(1, 0));
  });

  test("frees original handle when safeToFree is true", () => {
    const store = new FragmentStore(4);
    const frag = createStoredFragment(store, opId(1, 0), 0, loc(100), "abc", true);
    expect(store.count).toBe(1);

    splitStoredFragment(store, frag, 1, true);
    // Original freed, 2 new allocated = net +1
    expect(store.count).toBe(2);
  });

  test("does NOT free original handle when safeToFree is false", () => {
    const store = new FragmentStore(4);
    const frag = createStoredFragment(store, opId(1, 0), 0, loc(100), "abc", true);

    splitStoredFragment(store, frag, 1, false);
    // Original NOT freed, 2 new allocated = net +2
    expect(store.count).toBe(3);
    // Original data still accessible
    expect(frag.text).toBe("abc");
  });

  test("works with plain Fragment objects", () => {
    const store = new FragmentStore();
    const plain = createFragment(opId(1, 0), 0, loc(100), "hello", true);

    const [left, right] = splitStoredFragment(store, plain, 3);

    expect(left.text).toBe("hel");
    expect(right.text).toBe("lo");
    expect(isFragmentRef(left)).toBe(true);
    expect(isFragmentRef(right)).toBe(true);
  });
});

describe("deleteStoredFragment", () => {
  test("creates invisible copy with deletion id", () => {
    const store = new FragmentStore();
    const frag = createStoredFragment(store, opId(1, 0), 0, loc(100), "hello", true);
    const delId = opId(2, 0);

    const deleted = deleteStoredFragment(store, frag, delId);

    expect(deleted.visible).toBe(false);
    expect(deleted.text).toBe("hello");
    expect(deleted.deletions).toEqual([delId]);
    expect(deleted.insertionId).toEqual(opId(1, 0));
  });

  test("preserves existing deletions", () => {
    const store = new FragmentStore();
    const frag = createStoredFragment(store, opId(1, 0), 0, loc(100), "x", false, [opId(2, 0)]);

    const deleted = deleteStoredFragment(store, frag, opId(3, 0));
    expect(deleted.deletions).toEqual([opId(2, 0), opId(3, 0)]);
  });
});

describe("withStoredVisibility", () => {
  test("toggles visibility", () => {
    const store = new FragmentStore();
    const frag = createStoredFragment(store, opId(1, 0), 0, loc(100), "text", true);

    const hidden = withStoredVisibility(store, frag, false);
    expect(hidden.visible).toBe(false);
    expect(hidden.summary().visibleLen).toBe(0);
    expect(hidden.summary().deletedLen).toBe(4);
  });

  test("returns same ref when visibility unchanged (for FragmentRef)", () => {
    const store = new FragmentStore();
    const frag = createStoredFragment(store, opId(1, 0), 0, loc(100), "text", true);

    const same = withStoredVisibility(store, frag, true);
    expect(same).toBe(frag); // Same object reference
  });

  test("migrates plain Fragment into store when visibility unchanged", () => {
    const store = new FragmentStore();
    const plain = createFragment(opId(1, 0), 0, loc(100), "text", true);

    const migrated = withStoredVisibility(store, plain, true);
    expect(isFragmentRef(migrated)).toBe(true);
    expect(migrated.text).toBe("text");
  });
});

// ---------------------------------------------------------------------------
// Integration: FragmentRef satisfies Fragment interface
// ---------------------------------------------------------------------------

describe("FragmentRef as Fragment interface", () => {
  test("has all required Fragment properties", () => {
    const store = new FragmentStore();
    const baseLoc = loc(50);
    const fragLoc = loc(50, 4);
    const ref = createStoredFragment(
      store,
      opId(1, 5),
      2,
      fragLoc,
      "world",
      true,
      [opId(2, 1)],
      baseLoc,
    );

    // Verify all Fragment interface properties
    expect(ref.insertionId).toEqual(opId(1, 5));
    expect(ref.insertionOffset).toBe(2);
    expect(ref.locator).toEqual(fragLoc);
    expect(ref.baseLocator).toEqual(baseLoc);
    expect(ref.length).toBe(5);
    expect(ref.visible).toBe(true);
    expect(ref.deletions).toEqual([opId(2, 1)]);
    expect(ref.text).toBe("world");
    expect(ref.summary).toBeFunction();
    expect(ref.summary().visibleLen).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// Handle stability under concurrent operations
// ---------------------------------------------------------------------------

describe("handle stability", () => {
  test("handles remain valid after other fragments are freed", () => {
    const store = new FragmentStore(4);
    const a = createStoredFragment(store, opId(1, 0), 0, loc(10), "aaa", true);
    const b = createStoredFragment(store, opId(1, 1), 0, loc(20), "bbb", true);
    const c = createStoredFragment(store, opId(1, 2), 0, loc(30), "ccc", true);

    // Free b (middle fragment)
    store.free(b.handle);

    // a and c still valid
    expect(a.text).toBe("aaa");
    expect(c.text).toBe("ccc");
    expect(store.count).toBe(2);
  });

  test("handles remain valid after store growth", () => {
    const store = new FragmentStore(2);
    const a = createStoredFragment(store, opId(1, 0), 0, loc(10), "aaa", true);
    const b = createStoredFragment(store, opId(1, 1), 0, loc(20), "bbb", true);

    // Force growth
    createStoredFragment(store, opId(1, 2), 0, loc(30), "ccc", true);
    expect(store.capacity).toBe(4);

    // Original handles still valid
    expect(a.text).toBe("aaa");
    expect(b.text).toBe("bbb");
  });
});
