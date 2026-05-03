import { describe, expect, it } from "bun:test";
import { Arena, INVALID_NODE_ID, epoch, nodeId } from "./index.js";

describe("Arena", () => {
  describe("allocation", () => {
    it("creates an arena with default capacity", () => {
      const arena = new Arena();
      expect(arena.capacity).toBeGreaterThan(0);
      expect(arena.allocated).toBe(0);
    });

    it("allocates nodes with incrementing IDs", () => {
      const arena = new Arena();
      const id1 = arena.allocate();
      const id2 = arena.allocate();
      const id3 = arena.allocate();

      expect(id1).toBe(nodeId(1));
      expect(id2).toBe(nodeId(2));
      expect(id3).toBe(nodeId(3));
    });

    it("tracks allocated count", () => {
      const arena = new Arena();
      arena.allocate();
      arena.allocate();
      arena.allocate();

      expect(arena.allocated).toBe(3);
    });

    it("marks nodes as allocated", () => {
      const arena = new Arena();
      const id = arena.allocate();

      expect(arena.isAllocated(id)).toBe(true);
      expect(arena.isAllocated(INVALID_NODE_ID)).toBe(false);
      expect(arena.isAllocated(nodeId(999))).toBe(false);
    });
  });

  describe("free and reuse", () => {
    it("frees nodes and reuses IDs", () => {
      const arena = new Arena();
      const id1 = arena.allocate();
      arena.allocate(); // Allocate second node to ensure arena has multiple nodes

      arena.free(id1);
      expect(arena.isAllocated(id1)).toBe(false);
      expect(arena.allocated).toBe(1);

      // Next allocation should reuse freed ID
      const id3 = arena.allocate();
      expect(id3).toBe(id1);
    });

    it("throws when freeing unallocated node", () => {
      const arena = new Arena();
      expect(() => arena.free(INVALID_NODE_ID)).toThrow();
      expect(() => arena.free(nodeId(999))).toThrow();
    });
  });

  describe("node types", () => {
    it("sets and checks leaf nodes", () => {
      const arena = new Arena();
      const id = arena.allocate();

      arena.setLeaf(id, 5);
      expect(arena.isLeaf(id)).toBe(true);
      expect(arena.isInternal(id)).toBe(false);
      expect(arena.getCount(id)).toBe(5);
    });

    it("sets and checks internal nodes", () => {
      const arena = new Arena<unknown>();
      const child1 = arena.allocate();
      const child2 = arena.allocate();
      const parent = arena.allocate();

      arena.setInternal(parent, 2, [child1, child2]);
      expect(arena.isInternal(parent)).toBe(true);
      expect(arena.isLeaf(parent)).toBe(false);
      expect(arena.getCount(parent)).toBe(2);
      expect(arena.getChildren(parent)).toEqual([child1, child2]);
    });
  });

  describe("node data", () => {
    it("stores and retrieves items", () => {
      const arena = new Arena<{ value: number }>();
      const id = arena.allocate();

      arena.setItem(id, { value: 42 });
      expect(arena.getItem(id)).toEqual({ value: 42 });
    });

    it("stores and retrieves height", () => {
      const arena = new Arena();
      const id = arena.allocate();

      arena.setHeight(id, 3);
      expect(arena.getHeight(id)).toBe(3);
    });

    it("stores and retrieves parent", () => {
      const arena = new Arena();
      const child = arena.allocate();
      const parent = arena.allocate();

      arena.setParent(child, parent);
      expect(arena.getParent(child)).toBe(parent);
    });
  });

  describe("children management", () => {
    it("gets child by index", () => {
      const arena = new Arena<unknown>();
      const child1 = arena.allocate();
      const child2 = arena.allocate();
      const child3 = arena.allocate();
      const parent = arena.allocate();

      arena.setInternal(parent, 3, [child1, child2, child3]);

      expect(arena.getChild(parent, 0)).toBe(child1);
      expect(arena.getChild(parent, 1)).toBe(child2);
      expect(arena.getChild(parent, 2)).toBe(child3);
      expect(arena.getChild(parent, 3)).toBe(INVALID_NODE_ID);
      expect(arena.getChild(parent, -1)).toBe(INVALID_NODE_ID);
    });

    it("sets children array", () => {
      const arena = new Arena<unknown>();
      const child1 = arena.allocate();
      const child2 = arena.allocate();
      const parent = arena.allocate();

      arena.setInternal(parent, 2, [child1, child2]);
      arena.setChildren(parent, [child2, child1]); // Reverse order

      expect(arena.getChildren(parent)).toEqual([child2, child1]);
      expect(arena.getCount(parent)).toBe(2);
    });
  });

  describe("cloning", () => {
    it("clones a node", () => {
      const arena = new Arena<{ value: number }>();
      const original = arena.allocate();
      arena.setLeaf(original, 5);
      arena.setItem(original, { value: 42 });
      arena.setHeight(original, 2);

      const cloned = arena.clone(original);

      expect(cloned).not.toBe(original);
      expect(arena.isLeaf(cloned)).toBe(true);
      expect(arena.getCount(cloned)).toBe(5);
      expect(arena.getItem(cloned)).toEqual({ value: 42 });
      expect(arena.getHeight(cloned)).toBe(2);
    });

    it("clones internal nodes with children", () => {
      const arena = new Arena<unknown>();
      const child1 = arena.allocate();
      const child2 = arena.allocate();
      const original = arena.allocate();

      arena.setInternal(original, 2, [child1, child2]);

      const cloned = arena.clone(original);

      expect(arena.isInternal(cloned)).toBe(true);
      expect(arena.getChildren(cloned)).toEqual([child1, child2]);
    });
  });

  describe("growth", () => {
    it("grows automatically when capacity is exceeded", () => {
      const arena = new Arena(4); // Small initial capacity
      const ids = [];

      for (let i = 0; i < 10; i++) {
        ids.push(arena.allocate());
      }

      expect(arena.capacity).toBeGreaterThanOrEqual(10);
      expect(arena.allocated).toBe(10);

      // Verify all nodes are still valid
      for (const id of ids) {
        expect(arena.isAllocated(id)).toBe(true);
      }
    });
  });

  describe("reset", () => {
    it("resets the arena to empty state", () => {
      const arena = new Arena<{ value: number }>();
      const id1 = arena.allocate();
      const id2 = arena.allocate();
      arena.setItem(id1, { value: 1 });
      arena.setItem(id2, { value: 2 });

      arena.reset();

      expect(arena.allocated).toBe(0);
      expect(arena.isAllocated(id1)).toBe(false);
      expect(arena.isAllocated(id2)).toBe(false);
    });
  });

  describe("epoch tracking", () => {
    it("starts at epoch 1 with minLiveEpoch equal to currentEpoch", () => {
      const arena = new Arena();
      expect(arena.currentEpoch).toBe(epoch(1));
      expect(arena.minLiveEpoch).toBe(epoch(1));
    });

    it("advanceEpoch increments currentEpoch and returns new value", () => {
      const arena = new Arena();
      const e2 = arena.advanceEpoch();
      expect(e2).toBe(epoch(2));
      expect(arena.currentEpoch).toBe(epoch(2));
      const e3 = arena.advanceEpoch();
      expect(e3).toBe(epoch(3));
    });

    it("getEpoch returns the epoch when a node was allocated", () => {
      const arena = new Arena();
      const id1 = arena.allocate();
      arena.advanceEpoch();
      const id2 = arena.allocate();

      expect(arena.getEpoch(id1)).toBe(epoch(1));
      expect(arena.getEpoch(id2)).toBe(epoch(2));
    });

    it("retainEpoch and releaseEpoch track ref counts", () => {
      const arena = new Arena();
      const e = arena.currentEpoch;

      arena.retainEpoch(e);
      expect(arena.minLiveEpoch).toBe(e);

      const released = arena.releaseEpoch(e);
      expect(released).toBe(true);
    });

    it("multiple retains require multiple releases", () => {
      const arena = new Arena();
      const e = arena.currentEpoch;

      arena.retainEpoch(e);
      arena.retainEpoch(e);

      const firstRelease = arena.releaseEpoch(e);
      expect(firstRelease).toBe(false);

      const secondRelease = arena.releaseEpoch(e);
      expect(secondRelease).toBe(true);
    });

    it("minLiveEpoch tracks the minimum retained epoch", () => {
      const arena = new Arena();
      const e1 = arena.currentEpoch;
      arena.retainEpoch(e1);
      arena.advanceEpoch();
      const e2 = arena.currentEpoch;
      arena.retainEpoch(e2);

      expect(arena.minLiveEpoch).toBe(e1);

      arena.releaseEpoch(e1);
      expect(arena.minLiveEpoch).toBe(e2);

      arena.releaseEpoch(e2);
      expect(arena.minLiveEpoch).toBe(arena.currentEpoch);
    });

    it("reset clears epoch state back to initial", () => {
      const arena = new Arena();
      arena.advanceEpoch();
      arena.advanceEpoch();
      const e = arena.currentEpoch;
      arena.retainEpoch(e);

      arena.reset();

      expect(arena.currentEpoch).toBe(epoch(1));
      expect(arena.minLiveEpoch).toBe(epoch(1));
    });
  });

  describe("mark-sweep garbage collection", () => {
    it("markReachable finds all descendants from a root", () => {
      const arena = new Arena<unknown>();
      const leaf1 = arena.allocate();
      const leaf2 = arena.allocate();
      const leaf3 = arena.allocate();
      const internal = arena.allocate();
      const root = arena.allocate();

      arena.setLeaf(leaf1, 1);
      arena.setLeaf(leaf2, 1);
      arena.setLeaf(leaf3, 1);
      arena.setInternal(internal, 2, [leaf1, leaf2]);
      arena.setInternal(root, 2, [internal, leaf3]);

      const live = arena.markReachable([root]);

      expect(live.has(root)).toBe(true);
      expect(live.has(internal)).toBe(true);
      expect(live.has(leaf1)).toBe(true);
      expect(live.has(leaf2)).toBe(true);
      expect(live.has(leaf3)).toBe(true);
      expect(live.size).toBe(5);
    });

    it("markReachable does not include unreachable (orphan) nodes", () => {
      const arena = new Arena<unknown>();
      const root = arena.allocate();
      const orphan = arena.allocate();
      arena.setLeaf(root, 1);
      arena.setLeaf(orphan, 1);

      const live = arena.markReachable([root]);

      expect(live.has(root)).toBe(true);
      expect(live.has(orphan)).toBe(false);
      expect(live.size).toBe(1);
    });

    it("markReachable handles INVALID_NODE_ID in roots without panic", () => {
      const arena = new Arena<unknown>();
      const root = arena.allocate();
      arena.setLeaf(root, 1);

      const live = arena.markReachable([INVALID_NODE_ID, root]);

      expect(live.has(root)).toBe(true);
      expect(live.size).toBe(1);
    });

    it("markReachable returns empty set for no roots", () => {
      const arena = new Arena<unknown>();
      arena.allocate();

      const live = arena.markReachable([]);
      expect(live.size).toBe(0);
    });

    it("sweepBefore frees unreachable old-epoch nodes", () => {
      const arena = new Arena<unknown>();
      const id1 = arena.allocate();
      arena.advanceEpoch();
      const id2 = arena.allocate();

      const liveSet = new Set([id2]);
      const freed = arena.sweepBefore(epoch(2), liveSet);

      expect(freed).toBe(1);
      expect(arena.isAllocated(id1)).toBe(false);
      expect(arena.isAllocated(id2)).toBe(true);
    });

    it("sweepBefore does not free nodes allocated at or after the epoch", () => {
      const arena = new Arena<unknown>();
      arena.advanceEpoch();
      const id = arena.allocate();

      const freed = arena.sweepBefore(epoch(2), new Set());

      expect(freed).toBe(0);
      expect(arena.isAllocated(id)).toBe(true);
    });

    it("sweepBefore does not free live-set nodes even if old", () => {
      const arena = new Arena<unknown>();
      const id = arena.allocate();

      const freed = arena.sweepBefore(epoch(999), new Set([id]));

      expect(freed).toBe(0);
      expect(arena.isAllocated(id)).toBe(true);
    });

    it("collectGarbage frees orphans before minLiveEpoch, keeps reachable nodes", () => {
      const arena = new Arena<unknown>();

      const orphan = arena.allocate();
      const root = arena.allocate();
      arena.setLeaf(orphan, 1);
      arena.setLeaf(root, 1);

      arena.advanceEpoch();
      const liveEpoch = arena.currentEpoch;
      arena.retainEpoch(liveEpoch);

      const newNode = arena.allocate();
      arena.setLeaf(newNode, 1);

      const freed = arena.collectGarbage([root]);

      expect(freed).toBe(1);
      expect(arena.isAllocated(orphan)).toBe(false);
      expect(arena.isAllocated(root)).toBe(true);
      expect(arena.isAllocated(newNode)).toBe(true);
    });

    it("collectGarbage frees nothing when no snapshots and all nodes reachable", () => {
      const arena = new Arena<unknown>();
      const leaf = arena.allocate();
      const root = arena.allocate();
      arena.setLeaf(leaf, 1);
      arena.setInternal(root, 1, [leaf]);

      const freed = arena.collectGarbage([root]);
      expect(freed).toBe(0);
    });
  });

  describe("utilization", () => {
    it("reports zero stats for empty arena", () => {
      const arena = new Arena();
      const stats = arena.utilization();
      expect(stats.allocated).toBe(0);
      expect(stats.free).toBe(0);
      expect(stats.total).toBe(0);
      expect(stats.liveEpochs).toBe(0);
      expect(stats.currentEpoch).toBe(epoch(1));
      expect(stats.minLiveEpoch).toBe(epoch(1));
    });

    it("tracks allocated and freed counts", () => {
      const arena = new Arena();
      const id1 = arena.allocate();
      arena.allocate();
      arena.allocate();
      arena.free(id1);

      const stats = arena.utilization();
      expect(stats.allocated).toBe(2);
      expect(stats.free).toBe(1);
      expect(stats.total).toBe(3);
    });

    it("tracks live epoch count", () => {
      const arena = new Arena();
      const e = arena.currentEpoch;
      arena.retainEpoch(e);

      expect(arena.utilization().liveEpochs).toBe(1);

      arena.releaseEpoch(e);
      expect(arena.utilization().liveEpochs).toBe(0);
    });

    it("utilizationRatio is 0 for empty arena", () => {
      const arena = new Arena();
      expect(arena.utilization().utilizationRatio).toBe(0);
    });
  });
});
