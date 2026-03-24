import { describe, expect, it } from "bun:test";
import { Arena, INVALID_NODE_ID, nodeId } from "./index.js";

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

    it("resets epoch tracking state", () => {
      const arena = new Arena<{ value: number }>();
      arena.advanceEpoch();
      arena.advanceEpoch();
      arena.registerSnapshot([]);

      arena.reset();

      expect(arena.currentEpoch).toBe(0);
      expect(arena.getActiveSnapshots().length).toBe(0);
    });
  });

  describe("epoch tracking", () => {
    it("starts at epoch 0", () => {
      const arena = new Arena();
      expect(arena.currentEpoch).toBe(0);
    });

    it("advances epoch", () => {
      const arena = new Arena();
      expect(arena.advanceEpoch()).toBe(1);
      expect(arena.advanceEpoch()).toBe(2);
      expect(arena.currentEpoch).toBe(2);
    });

    it("tracks epoch when nodes are allocated", () => {
      const arena = new Arena();

      const id1 = arena.allocate(); // Epoch 0
      arena.advanceEpoch();
      const id2 = arena.allocate(); // Epoch 1
      arena.advanceEpoch();
      const id3 = arena.allocate(); // Epoch 2

      expect(arena.getEpoch(id1)).toBe(0);
      expect(arena.getEpoch(id2)).toBe(1);
      expect(arena.getEpoch(id3)).toBe(2);
    });

    it("cloned nodes get current epoch, not source epoch", () => {
      const arena = new Arena<{ value: number }>();

      const id1 = arena.allocate();
      arena.setLeaf(id1, 1);
      expect(arena.getEpoch(id1)).toBe(0);

      arena.advanceEpoch();
      arena.advanceEpoch();

      const id2 = arena.clone(id1);
      expect(arena.getEpoch(id2)).toBe(2); // Current epoch, not 0
    });
  });

  describe("snapshot registration", () => {
    it("registers snapshot with epoch", () => {
      const arena = new Arena();
      const id1 = arena.allocate();
      arena.advanceEpoch();

      const reg = arena.registerSnapshot([id1]);

      expect(reg.id).toBe(1);
      expect(reg.epoch).toBe(1);
      expect(reg.rootIds).toEqual([id1]);
      expect(reg.createdAt).toBeLessThanOrEqual(Date.now());
    });

    it("tracks active snapshots", () => {
      const arena = new Arena();
      const id = arena.allocate();

      expect(arena.getActiveSnapshots().length).toBe(0);

      const reg1 = arena.registerSnapshot([id]);
      const reg2 = arena.registerSnapshot([id]);

      expect(arena.getActiveSnapshots().length).toBe(2);
      expect(arena.getSnapshot(reg1.id)).toBe(reg1);
      expect(arena.getSnapshot(reg2.id)).toBe(reg2);
    });

    it("releases snapshot", () => {
      const arena = new Arena();
      const id = arena.allocate();

      const reg = arena.registerSnapshot([id]);
      expect(arena.getActiveSnapshots().length).toBe(1);

      arena.releaseSnapshot(reg);
      expect(arena.getActiveSnapshots().length).toBe(0);
      expect(arena.getSnapshot(reg.id)).toBeUndefined();
    });

    it("releasing already released snapshot returns 0", () => {
      const arena = new Arena();
      const reg = arena.registerSnapshot([]);

      arena.releaseSnapshot(reg);
      const result = arena.releaseSnapshot(reg);

      expect(result).toBe(0);
    });
  });

  describe("minLiveEpoch", () => {
    it("returns currentEpoch + 1 when no snapshots", () => {
      const arena = new Arena();
      arena.advanceEpoch();
      arena.advanceEpoch();

      expect(arena.minLiveEpoch).toBe(3); // currentEpoch (2) + 1
    });

    it("tracks minimum epoch across snapshots", () => {
      const arena = new Arena();

      arena.advanceEpoch(); // Epoch 1
      const reg1 = arena.registerSnapshot([]);

      arena.advanceEpoch(); // Epoch 2
      arena.advanceEpoch(); // Epoch 3
      const reg2 = arena.registerSnapshot([]);

      expect(arena.minLiveEpoch).toBe(1); // Min of snapshots at epoch 1 and 3

      arena.releaseSnapshot(reg1);
      expect(arena.minLiveEpoch).toBe(3); // Now only snapshot at epoch 3

      arena.releaseSnapshot(reg2);
      expect(arena.minLiveEpoch).toBe(4); // No snapshots, currentEpoch (3) + 1
    });
  });

  describe("expired snapshots", () => {
    it("finds expired snapshots", async () => {
      const arena = new Arena();

      const reg1 = arena.registerSnapshot([]);
      await new Promise((r) => setTimeout(r, 50));
      const reg2 = arena.registerSnapshot([]);

      const expired = arena.getExpiredSnapshots(25);
      expect(expired).toContain(reg1.id);
      expect(expired.length).toBe(1);

      arena.releaseSnapshot(reg1);
      arena.releaseSnapshot(reg2);
    });
  });

  describe("stats", () => {
    it("returns arena statistics", () => {
      const arena = new Arena();
      arena.allocate();
      arena.allocate();
      arena.advanceEpoch();
      const reg = arena.registerSnapshot([]);

      const stats = arena.stats();

      expect(stats.capacity).toBeGreaterThan(0);
      expect(stats.allocated).toBe(2);
      expect(stats.freeListSize).toBe(0);
      expect(stats.utilizationPercent).toBeGreaterThan(0);
      expect(stats.currentEpoch).toBe(1);
      expect(stats.activeSnapshots).toBe(1);
      expect(stats.minLiveEpoch).toBe(1);

      arena.releaseSnapshot(reg);
    });
  });

  describe("reclamation", () => {
    it("tryReclaim returns 0 when no snapshots", () => {
      const arena = new Arena();
      arena.allocate();
      arena.allocate();

      // With no snapshots, tryReclaim has no roots to mark
      const freed = arena.tryReclaim();
      expect(freed).toBe(0);
    });

    it("reclaimWithRoots frees unreachable nodes", () => {
      const arena = new Arena<unknown>();

      // Create a simple tree: root -> child1, child2
      const child1 = arena.allocate();
      const child2 = arena.allocate();
      const root1 = arena.allocate();
      arena.setLeaf(child1, 0);
      arena.setLeaf(child2, 0);
      arena.setInternal(root1, 2, [child1, child2]);

      // Create orphan nodes
      const orphan1 = arena.allocate();
      const orphan2 = arena.allocate();
      arena.setLeaf(orphan1, 0);
      arena.setLeaf(orphan2, 0);

      expect(arena.allocated).toBe(5);

      // Reclaim with root1 as live root
      const freed = arena.reclaimWithRoots([root1]);

      expect(freed).toBe(2); // orphan1 and orphan2
      expect(arena.allocated).toBe(3);
      expect(arena.isAllocated(root1)).toBe(true);
      expect(arena.isAllocated(child1)).toBe(true);
      expect(arena.isAllocated(child2)).toBe(true);
      expect(arena.isAllocated(orphan1)).toBe(false);
      expect(arena.isAllocated(orphan2)).toBe(false);
    });

    it("reclaimWithRoots respects snapshot epochs", () => {
      const arena = new Arena<unknown>();

      // Epoch 0: create initial nodes
      const old1 = arena.allocate();
      const old2 = arena.allocate();
      arena.setLeaf(old1, 0);
      arena.setLeaf(old2, 0);

      arena.advanceEpoch(); // Epoch 1

      // Take snapshot at epoch 1
      const reg = arena.registerSnapshot([old1]);

      arena.advanceEpoch(); // Epoch 2

      // Create more nodes in epoch 2
      const new1 = arena.allocate();
      arena.setLeaf(new1, 0);

      // Reclaim with new1 as current root
      // old2 is unreachable from new1 BUT old1 is in snapshot
      const freed = arena.reclaimWithRoots([new1]);

      // old2 should be freed (not reachable from new1 or snapshot)
      // old1 should be kept (reachable from snapshot)
      expect(freed).toBe(1); // Only old2
      expect(arena.isAllocated(old1)).toBe(true);
      expect(arena.isAllocated(old2)).toBe(false);
      expect(arena.isAllocated(new1)).toBe(true);

      arena.releaseSnapshot(reg);
    });
  });
});
