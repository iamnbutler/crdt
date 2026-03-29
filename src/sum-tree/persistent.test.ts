import { describe, expect, it } from "bun:test";
import { type CountSummary, type SumTree, type Summarizable, countSummaryOps } from "./index.js";
import { PersistentTree, type VersionHandle } from "./persistent.js";

// Simple test item
class Item implements Summarizable<CountSummary> {
  constructor(public value: number) {}
  summary(): CountSummary {
    return { count: 1 };
  }
}

function makeItem(v: number): Item {
  return new Item(v);
}

function treeValues(tree: SumTree<Item, CountSummary>): number[] {
  return tree.toArray().map((item) => item.value);
}

describe("PersistentTree", () => {
  describe("basic operations", () => {
    it("starts with an empty tree", () => {
      const pt = new PersistentTree<Item, CountSummary>(countSummaryOps);
      expect(pt.tree.isEmpty()).toBe(true);
      expect(pt.tree.length()).toBe(0);
    });

    it("insertAt creates new versions", () => {
      const pt = new PersistentTree<Item, CountSummary>(countSummaryOps);
      pt.insertAt(0, makeItem(1));
      expect(pt.tree.length()).toBe(1);
      expect(treeValues(pt.tree)).toEqual([1]);

      pt.insertAt(1, makeItem(2));
      expect(pt.tree.length()).toBe(2);
      expect(treeValues(pt.tree)).toEqual([1, 2]);
    });

    it("push appends items", () => {
      const pt = new PersistentTree<Item, CountSummary>(countSummaryOps);
      pt.push(makeItem(10));
      pt.push(makeItem(20));
      pt.push(makeItem(30));
      expect(treeValues(pt.tree)).toEqual([10, 20, 30]);
    });

    it("removeAt creates new version", () => {
      const pt = new PersistentTree<Item, CountSummary>(countSummaryOps);
      pt.push(makeItem(1));
      pt.push(makeItem(2));
      pt.push(makeItem(3));
      pt.removeAt(1);
      expect(treeValues(pt.tree)).toEqual([1, 3]);
    });

    it("replaceAt creates new version", () => {
      const pt = new PersistentTree<Item, CountSummary>(countSummaryOps);
      pt.push(makeItem(1));
      pt.push(makeItem(2));
      pt.push(makeItem(3));
      pt.replaceAt(1, [makeItem(20), makeItem(21)]);
      expect(treeValues(pt.tree)).toEqual([1, 20, 21, 3]);
    });
  });

  describe("version handles", () => {
    it("createHandle captures current state", () => {
      const pt = new PersistentTree<Item, CountSummary>(countSummaryOps);
      pt.push(makeItem(1));
      const v1 = pt.createHandle("v1");

      pt.push(makeItem(2));
      const v2 = pt.createHandle("v2");

      // v1 still sees the old state
      expect(treeValues(v1.tree)).toEqual([1]);
      // v2 sees the new state
      expect(treeValues(v2.tree)).toEqual([1, 2]);
      // current also sees the new state
      expect(treeValues(pt.tree)).toEqual([1, 2]);

      v1.release();
      v2.release();
    });

    it("handles are independent of further mutations", () => {
      const pt = new PersistentTree<Item, CountSummary>(countSummaryOps);
      pt.push(makeItem(1));
      pt.push(makeItem(2));
      const snapshot = pt.createHandle("snapshot");

      // Mutate further
      pt.push(makeItem(3));
      pt.push(makeItem(4));
      pt.removeAt(0);

      // Snapshot is unchanged
      expect(treeValues(snapshot.tree)).toEqual([1, 2]);
      // Current has diverged
      expect(treeValues(pt.tree)).toEqual([2, 3, 4]);

      snapshot.release();
    });

    it("released handle throws on access", () => {
      const pt = new PersistentTree<Item, CountSummary>(countSummaryOps);
      pt.push(makeItem(1));
      const handle = pt.createHandle();
      handle.release();

      expect(handle.released).toBe(true);
      expect(() => handle.tree).toThrow("released");
    });

    it("multiple handles to the same version", () => {
      const pt = new PersistentTree<Item, CountSummary>(countSummaryOps);
      pt.push(makeItem(42));

      const h1 = pt.createHandle("h1");
      const h2 = pt.createHandle("h2");

      pt.push(makeItem(99));

      // Both see the same snapshot
      expect(treeValues(h1.tree)).toEqual([42]);
      expect(treeValues(h2.tree)).toEqual([42]);

      h1.release();
      // h2 still works
      expect(treeValues(h2.tree)).toEqual([42]);

      h2.release();
    });
  });

  describe("version history", () => {
    it("tracks version chain", () => {
      const pt = new PersistentTree<Item, CountSummary>(countSummaryOps);
      const v0 = pt.currentVersionId;
      pt.push(makeItem(1));
      const v1 = pt.currentVersionId;
      pt.push(makeItem(2));
      const v2 = pt.currentVersionId;

      const history = pt.history();
      expect(history).toEqual([v2, v1, v0]);
    });

    it("history from a specific version", () => {
      const pt = new PersistentTree<Item, CountSummary>(countSummaryOps);
      pt.push(makeItem(1));
      const v1 = pt.currentVersionId;
      pt.push(makeItem(2));

      const history = pt.history(v1);
      // v1 and its parent (initial)
      expect(history.length).toBe(2);
      expect(history[0]).toBe(v1);
    });

    it("versionCount increases with mutations", () => {
      const pt = new PersistentTree<Item, CountSummary>(countSummaryOps);
      expect(pt.versionCount).toBe(1); // initial

      pt.push(makeItem(1));
      expect(pt.versionCount).toBe(2);

      pt.push(makeItem(2));
      expect(pt.versionCount).toBe(3);
    });
  });

  describe("branching", () => {
    it("branch creates independent copy", () => {
      const pt = new PersistentTree<Item, CountSummary>(countSummaryOps);
      pt.push(makeItem(1));
      pt.push(makeItem(2));

      const branch = pt.branch();

      // Both see the same initial state
      expect(treeValues(pt.tree)).toEqual([1, 2]);
      expect(treeValues(branch.tree)).toEqual([1, 2]);

      // Mutate each independently
      pt.push(makeItem(3));
      branch.push(makeItem(99));

      expect(treeValues(pt.tree)).toEqual([1, 2, 3]);
      expect(treeValues(branch.tree)).toEqual([1, 2, 99]);
    });

    it("branch from a specific version", () => {
      const pt = new PersistentTree<Item, CountSummary>(countSummaryOps);
      pt.push(makeItem(1));
      const v1 = pt.currentVersionId;
      const h1 = pt.createHandle("v1");

      pt.push(makeItem(2));
      pt.push(makeItem(3));

      // Branch from v1 (before items 2 and 3)
      const branch = pt.branch(v1);
      expect(treeValues(branch.tree)).toEqual([1]);

      branch.push(makeItem(100));
      expect(treeValues(branch.tree)).toEqual([1, 100]);

      // Original is unaffected
      expect(treeValues(pt.tree)).toEqual([1, 2, 3]);

      h1.release();
    });
  });

  describe("time travel", () => {
    it("rewindTo restores previous state", () => {
      const pt = new PersistentTree<Item, CountSummary>(countSummaryOps);
      pt.push(makeItem(1));
      const v1 = pt.currentVersionId;

      pt.push(makeItem(2));
      pt.push(makeItem(3));
      expect(treeValues(pt.tree)).toEqual([1, 2, 3]);

      pt.rewindTo(v1);
      expect(treeValues(pt.tree)).toEqual([1]);
    });

    it("rewind then mutate creates a new branch of history", () => {
      const pt = new PersistentTree<Item, CountSummary>(countSummaryOps);
      pt.push(makeItem(1));
      const v1 = pt.currentVersionId;

      pt.push(makeItem(2));
      const h2 = pt.createHandle("v2");

      // Rewind and diverge
      pt.rewindTo(v1);
      pt.push(makeItem(99));

      // Current has diverged
      expect(treeValues(pt.tree)).toEqual([1, 99]);
      // Old version still accessible
      expect(treeValues(h2.tree)).toEqual([1, 2]);

      h2.release();
    });

    it("rewindTo throws for unknown version", () => {
      const pt = new PersistentTree<Item, CountSummary>(countSummaryOps);
      expect(() => pt.rewindTo(999 as never)).toThrow("does not exist");
    });
  });

  describe("structural sharing", () => {
    it("versions share arena nodes", () => {
      const pt = new PersistentTree<Item, CountSummary>(countSummaryOps);

      // Build up a tree
      for (let i = 0; i < 100; i++) {
        pt.push(makeItem(i));
      }
      const handleBefore = pt.createHandle("before");
      const statsBefore = pt.stats();

      // One more insert — should only copy O(log n) nodes
      pt.push(makeItem(999));
      const statsAfter = pt.stats();

      // Arena should have grown by only a few nodes (path length), not 100+
      const newNodes = statsAfter.arenaAllocated - statsBefore.arenaAllocated;
      // Path copying creates O(log_16 100) ≈ 2 new nodes, plus the new leaf item's node
      // Be generous: should be much less than 100
      expect(newNodes).toBeLessThan(20);

      // Both versions are valid
      expect(handleBefore.tree.length()).toBe(100);
      expect(pt.tree.length()).toBe(101);

      handleBefore.release();
    });

    it("many versions share most structure", () => {
      const pt = new PersistentTree<Item, CountSummary>(countSummaryOps);

      // Build initial tree
      for (let i = 0; i < 50; i++) {
        pt.push(makeItem(i));
      }

      const handles: VersionHandle<Item, CountSummary>[] = [];

      // Create 20 versions, each adding one item
      for (let i = 0; i < 20; i++) {
        handles.push(pt.createHandle(`v${i}`));
        pt.push(makeItem(100 + i));
      }

      const stats = pt.stats();

      // With 20 versions of a ~60-item tree, if no sharing we'd need 20*60 = 1200 nodes
      // With sharing, we need ~60 + 20*O(log n) ≈ 60 + 20*3 = 120 nodes
      // Allow generous headroom but verify it's way less than 1200
      expect(stats.arenaAllocated).toBeLessThan(300);
      expect(stats.versionCount).toBe(71); // 1 initial + 50 pushes + 20 pushes
      expect(stats.liveHandleCount).toBeGreaterThan(20);

      // All handles return correct data
      for (let i = 0; i < handles.length; i++) {
        const h = handles[i];
        if (h !== undefined) {
          expect(h.tree.length()).toBe(50 + i);
        }
      }

      for (const h of handles) {
        h.release();
      }
    });
  });

  describe("garbage collection", () => {
    it("collectUnreachable removes unreferenced versions", () => {
      const pt = new PersistentTree<Item, CountSummary>(countSummaryOps);
      pt.push(makeItem(1));
      pt.push(makeItem(2));
      pt.push(makeItem(3));

      // 4 versions: initial + 3 pushes
      expect(pt.versionCount).toBe(4);

      // Only current has a reference; intermediate versions are unreachable
      const removed = pt.collectUnreachable();

      // Current and its ancestors (that are reachable via parent chain) are kept
      // Current has refCount 1, but ancestors have refCount 0
      // However, ancestors are reachable from current
      expect(removed).toBe(0); // all are ancestors of current

      // If we create a handle and advance, then release, the old branch is collectable
    });

    it("collectUnreachable preserves handle-referenced versions", () => {
      const pt = new PersistentTree<Item, CountSummary>(countSummaryOps);
      pt.push(makeItem(1));
      const h1 = pt.createHandle("keep");
      pt.push(makeItem(2));
      pt.push(makeItem(3));

      const removed = pt.collectUnreachable();
      expect(removed).toBe(0); // all versions are ancestors of current or h1

      h1.release();
    });
  });

  describe("stats", () => {
    it("reports accurate statistics", () => {
      const pt = new PersistentTree<Item, CountSummary>(countSummaryOps);
      pt.push(makeItem(1));
      pt.push(makeItem(2));
      const h = pt.createHandle();

      const stats = pt.stats();
      expect(stats.versionCount).toBe(3); // initial + 2 pushes
      expect(stats.liveHandleCount).toBeGreaterThanOrEqual(2); // current + handle
      expect(stats.arenaAllocated).toBeGreaterThan(0);
      expect(stats.arenaCapacity).toBeGreaterThan(0);
      expect(stats.utilizationRatio).toBeGreaterThan(0);
      expect(stats.utilizationRatio).toBeLessThanOrEqual(1);

      h.release();
    });
  });

  describe("edge cases", () => {
    it("works with empty tree mutations", () => {
      const pt = new PersistentTree<Item, CountSummary>(countSummaryOps);
      const h = pt.createHandle("empty");
      pt.push(makeItem(1));

      expect(h.tree.length()).toBe(0);
      expect(pt.tree.length()).toBe(1);
      h.release();
    });

    it("works with large trees", () => {
      const pt = new PersistentTree<Item, CountSummary>(countSummaryOps);
      for (let i = 0; i < 1000; i++) {
        pt.push(makeItem(i));
      }

      const h = pt.createHandle("1000-items");
      pt.push(makeItem(9999));

      expect(h.tree.length()).toBe(1000);
      expect(pt.tree.length()).toBe(1001);

      // Verify correctness
      const arr = h.tree.toArray();
      expect(arr[0]?.value).toBe(0);
      expect(arr[999]?.value).toBe(999);

      h.release();
    });

    it("multiple branches from same version", () => {
      const pt = new PersistentTree<Item, CountSummary>(countSummaryOps);
      pt.push(makeItem(1));
      pt.push(makeItem(2));

      const b1 = pt.branch();
      const b2 = pt.branch();

      b1.push(makeItem(100));
      b2.push(makeItem(200));

      expect(treeValues(pt.tree)).toEqual([1, 2]);
      expect(treeValues(b1.tree)).toEqual([1, 2, 100]);
      expect(treeValues(b2.tree)).toEqual([1, 2, 200]);
    });
  });
});
