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
  });
});
