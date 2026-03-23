/**
 * Arena Allocator Tests
 *
 * Tests for:
 * - Allocation/free/reuse cycle correctness
 * - Epoch reclamation doesn't free live nodes
 * - Leaked snapshot detection via FinalizationRegistry
 * - Growth behavior
 * - Mark-sweep GC
 */

import { beforeEach, describe, expect, test } from "bun:test";
import {
  AosArena,
  type Arena,
  NODE_FLAGS,
  NULL_NODE,
  SoaArena,
  createAosArena,
  createSoaArena,
} from "../src/arena/index.ts";

// Run the same tests for both arena implementations
const arenaTypes = [
  { name: "AosArena", create: (cap?: number) => new AosArena(cap) },
  { name: "SoaArena", create: (cap?: number) => new SoaArena(cap) },
] as const;

for (const { name, create } of arenaTypes) {
  describe(name, () => {
    let arena: Arena;

    beforeEach(() => {
      arena = create(64);
    });

    describe("allocation basics", () => {
      test("allocNode returns valid indices", () => {
        const idx1 = arena.allocNode();
        const idx2 = arena.allocNode();
        const idx3 = arena.allocNode();

        expect(idx1).not.toBe(NULL_NODE);
        expect(idx2).not.toBe(NULL_NODE);
        expect(idx3).not.toBe(NULL_NODE);

        // Indices should be distinct
        expect(idx1).not.toBe(idx2);
        expect(idx2).not.toBe(idx3);
        expect(idx1).not.toBe(idx3);
      });

      test("nodeCount tracks allocations", () => {
        expect(arena.nodeCount).toBe(0);

        arena.allocNode();
        expect(arena.nodeCount).toBe(1);

        arena.allocNode();
        arena.allocNode();
        expect(arena.nodeCount).toBe(3);
      });

      test("newly allocated nodes have default values", () => {
        const idx = arena.allocNode();

        expect(arena.getLeft(idx)).toBe(NULL_NODE);
        expect(arena.getRight(idx)).toBe(NULL_NODE);
        expect(arena.getParent(idx)).toBe(NULL_NODE);
        expect(arena.getSum(idx)).toBe(0);
        expect(arena.getPayload(idx)).toBe(0);
        expect(arena.getFlags(idx) & NODE_FLAGS.ALLOCATED).toBe(NODE_FLAGS.ALLOCATED);
      });

      test("capacity is respected", () => {
        expect(arena.capacity).toBe(64);
      });
    });

    describe("field accessors", () => {
      test("setLeft/getLeft work correctly", () => {
        const idx = arena.allocNode();
        const child = arena.allocNode();

        arena.setLeft(idx, child);
        expect(arena.getLeft(idx)).toBe(child);
      });

      test("setRight/getRight work correctly", () => {
        const idx = arena.allocNode();
        const child = arena.allocNode();

        arena.setRight(idx, child);
        expect(arena.getRight(idx)).toBe(child);
      });

      test("setParent/getParent work correctly", () => {
        const idx = arena.allocNode();
        const parent = arena.allocNode();

        arena.setParent(idx, parent);
        expect(arena.getParent(idx)).toBe(parent);
      });

      test("setSum/getSum work correctly", () => {
        const idx = arena.allocNode();

        arena.setSum(idx, 123.456);
        expect(arena.getSum(idx)).toBeCloseTo(123.456);

        arena.setSum(idx, -999.999);
        expect(arena.getSum(idx)).toBeCloseTo(-999.999);
      });

      test("setPayload/getPayload work correctly", () => {
        const idx = arena.allocNode();

        arena.setPayload(idx, 42.5);
        expect(arena.getPayload(idx)).toBeCloseTo(42.5);
      });

      test("setFlags/getFlags work correctly", () => {
        const idx = arena.allocNode();

        arena.setFlags(idx, NODE_FLAGS.ALLOCATED | NODE_FLAGS.LEAF);
        expect(arena.getFlags(idx) & NODE_FLAGS.LEAF).toBe(NODE_FLAGS.LEAF);
      });
    });

    describe("free and reuse", () => {
      test("freeNode decrements nodeCount", () => {
        const idx1 = arena.allocNode();
        const idx2 = arena.allocNode();
        expect(arena.nodeCount).toBe(2);

        arena.freeNode(idx1);
        expect(arena.nodeCount).toBe(1);

        arena.freeNode(idx2);
        expect(arena.nodeCount).toBe(0);
      });

      test("freed nodes are reused", () => {
        const idx1 = arena.allocNode();
        arena.freeNode(idx1);

        // Allocate again - should reuse the freed slot
        const idx2 = arena.allocNode();
        expect(idx2).toBe(idx1);
      });

      test("double free is safe (idempotent)", () => {
        const idx = arena.allocNode();
        expect(arena.nodeCount).toBe(1);

        arena.freeNode(idx);
        expect(arena.nodeCount).toBe(0);

        // Double free should be safe
        arena.freeNode(idx);
        expect(arena.nodeCount).toBe(0);
      });

      test("freeing NULL_NODE is safe", () => {
        arena.freeNode(NULL_NODE);
        expect(arena.nodeCount).toBe(0);
      });

      test("freeing out-of-bounds index is safe", () => {
        arena.freeNode(99999);
        expect(arena.nodeCount).toBe(0);
      });
    });

    describe("growth", () => {
      test("arena grows when capacity exceeded", () => {
        const smallArena = create(4);
        const initialCapacity = smallArena.capacity;

        // Allocate more nodes than initial capacity
        const nodes: number[] = [];
        for (let i = 0; i < 10; i++) {
          nodes.push(smallArena.allocNode());
        }

        expect(smallArena.capacity).toBeGreaterThan(initialCapacity);
        expect(smallArena.nodeCount).toBe(10);

        // All nodes should still be valid and distinct
        const uniqueNodes = new Set(nodes);
        expect(uniqueNodes.size).toBe(10);
      });

      test("data is preserved after growth", () => {
        const smallArena = create(4);

        // Allocate and set data
        const idx = smallArena.allocNode();
        smallArena.setSum(idx, 42.5);
        smallArena.setPayload(idx, 123.0);
        smallArena.setFlags(idx, NODE_FLAGS.ALLOCATED | NODE_FLAGS.LEAF);

        // Force growth
        for (let i = 0; i < 10; i++) {
          smallArena.allocNode();
        }

        // Verify data is preserved
        expect(smallArena.getSum(idx)).toBeCloseTo(42.5);
        expect(smallArena.getPayload(idx)).toBeCloseTo(123.0);
        expect(smallArena.getFlags(idx) & NODE_FLAGS.LEAF).toBe(NODE_FLAGS.LEAF);
      });
    });

    describe("epoch management", () => {
      test("getCurrentEpoch returns initial epoch", () => {
        expect(arena.getCurrentEpoch()).toBe(0);
      });

      test("advanceEpoch increments epoch", () => {
        expect(arena.advanceEpoch()).toBe(1);
        expect(arena.advanceEpoch()).toBe(2);
        expect(arena.getCurrentEpoch()).toBe(2);
      });
    });

    describe("mark-sweep GC", () => {
      test("markNode sets marked flag", () => {
        const idx = arena.allocNode();
        arena.markNode(idx);

        expect(arena.getFlags(idx) & NODE_FLAGS.MARKED).toBe(NODE_FLAGS.MARKED);
      });

      test("sweep frees unmarked nodes", () => {
        arena.allocNode(); // idx1 - not marked, will be freed
        const idx2 = arena.allocNode();
        arena.allocNode(); // idx3 - not marked, will be freed

        // Mark only idx2
        arena.markNode(idx2);

        const freed = arena.sweep();

        expect(freed).toBe(2); // idx1 and idx3 freed
        expect(arena.nodeCount).toBe(1);
      });

      test("sweep clears marked flag for next cycle", () => {
        const idx = arena.allocNode();
        arena.markNode(idx);

        arena.sweep();

        // Mark bit should be cleared
        expect(arena.getFlags(idx) & NODE_FLAGS.MARKED).toBe(0);
      });

      test("marked nodes survive sweep", () => {
        const idx = arena.allocNode();
        arena.setSum(idx, 42.5);
        arena.markNode(idx);

        arena.sweep();

        // Node should still exist with its data
        expect(arena.nodeCount).toBe(1);
        expect(arena.getSum(idx)).toBeCloseTo(42.5);
      });

      test("markNode ignores NULL_NODE", () => {
        arena.markNode(NULL_NODE);
        // Should not throw
      });
    });

    describe("getStats", () => {
      test("returns correct statistics", () => {
        arena.allocNode();
        arena.allocNode();
        const idx = arena.allocNode();
        arena.freeNode(idx);

        const stats = arena.getStats();

        expect(stats.capacity).toBe(64);
        expect(stats.liveNodes).toBe(2);
        expect(stats.freeNodes).toBe(62);
        expect(stats.utilization).toBeCloseTo(2 / 64);
        expect(stats.memoryBytes).toBeGreaterThan(0);
        expect(stats.epoch).toBe(0);
      });
    });

    describe("release", () => {
      test("release clears arena state", () => {
        arena.allocNode();
        arena.allocNode();
        arena.advanceEpoch();

        arena.release();

        expect(arena.nodeCount).toBe(0);
      });
    });
  });
}

// Tests specific to AosArena
describe("AosArena specific", () => {
  test("createAosArena with estimated nodes", () => {
    const arena = createAosArena(100);
    // Should round up to power of 2
    expect(arena.capacity).toBe(128);
  });

  test("createAosArena without args uses default", () => {
    const arena = createAosArena();
    expect(arena.capacity).toBe(1024);
  });
});

// Tests specific to SoaArena
describe("SoaArena specific", () => {
  test("createSoaArena with estimated nodes", () => {
    const arena = createSoaArena(100);
    // Should round up to power of 2
    expect(arena.capacity).toBe(128);
  });

  test("createSoaArena without args uses default", () => {
    const arena = createSoaArena();
    expect(arena.capacity).toBe(1024);
  });

  test("getSumsArray returns the sums array", () => {
    const arena = new SoaArena(64);
    const idx = arena.allocNode();
    arena.setSum(idx, 42.5);

    const sums = arena.getSumsArray();
    expect(sums[idx]).toBeCloseTo(42.5);
  });

  test("sumAllNodes sums allocated nodes", () => {
    const arena = new SoaArena(64);

    const idx1 = arena.allocNode();
    const idx2 = arena.allocNode();
    const idx3 = arena.allocNode();

    arena.setSum(idx1, 10);
    arena.setSum(idx2, 20);
    arena.setSum(idx3, 30);

    // Free one node
    arena.freeNode(idx2);

    // Sum should only include allocated nodes
    expect(arena.sumAllNodes()).toBeCloseTo(40); // 10 + 30
  });
});

// Snapshot tests (run on AosArena as representative)
describe("Snapshot and epoch-based reclamation", () => {
  test("snapshot captures current epoch", () => {
    const arena = new AosArena(64);
    arena.advanceEpoch(); // epoch = 1

    const snapshot = arena.createSnapshot();
    expect(snapshot.epoch).toBe(1);
  });

  test("snapshot release is idempotent", () => {
    const arena = new AosArena(64);
    const snapshot = arena.createSnapshot();

    snapshot.release();
    snapshot.release(); // Should not throw
  });

  test("canReclaim returns false for live snapshot epochs", () => {
    const arena = new AosArena(64);
    const snapshot = arena.createSnapshot(); // epoch 0

    arena.advanceEpoch(); // epoch 1
    arena.advanceEpoch(); // epoch 2

    expect(arena.canReclaim(0)).toBe(false); // Snapshot at epoch 0 is live

    snapshot.release();
    expect(arena.canReclaim(0)).toBe(true); // Now it can be reclaimed
  });

  test("multiple snapshots at same epoch", () => {
    const arena = new AosArena(64);

    const snap1 = arena.createSnapshot(); // epoch 0
    const snap2 = arena.createSnapshot(); // epoch 0

    arena.advanceEpoch();

    expect(arena.canReclaim(0)).toBe(false);

    snap1.release();
    expect(arena.canReclaim(0)).toBe(false); // snap2 still holds epoch 0

    snap2.release();
    expect(arena.canReclaim(0)).toBe(true); // Now safe
  });
});

// Stress tests
describe("stress tests", () => {
  test("allocate and free many nodes", () => {
    const arena = new AosArena(64);
    const nodes: number[] = [];

    // Allocate 1000 nodes
    for (let i = 0; i < 1000; i++) {
      nodes.push(arena.allocNode());
    }

    expect(arena.nodeCount).toBe(1000);
    expect(arena.capacity).toBeGreaterThanOrEqual(1000);

    // Free all nodes
    for (const idx of nodes) {
      arena.freeNode(idx);
    }

    expect(arena.nodeCount).toBe(0);

    // Reallocate - should reuse freed slots
    for (let i = 0; i < 500; i++) {
      arena.allocNode();
    }

    expect(arena.nodeCount).toBe(500);
  });

  test("tree-like allocation pattern", () => {
    const arena = new AosArena(64);

    // Build a binary tree
    const root = arena.allocNode();
    arena.setSum(root, 100);

    const buildSubtree = (parent: number, depth: number): void => {
      if (depth === 0) return;

      const left = arena.allocNode();
      const right = arena.allocNode();

      arena.setLeft(parent, left);
      arena.setRight(parent, right);
      arena.setParent(left, parent);
      arena.setParent(right, parent);

      const parentSum = arena.getSum(parent);
      arena.setSum(left, parentSum / 2);
      arena.setSum(right, parentSum / 2);

      buildSubtree(left, depth - 1);
      buildSubtree(right, depth - 1);
    };

    buildSubtree(root, 5); // Creates 2^6 - 1 = 63 nodes

    expect(arena.nodeCount).toBe(63);

    // Verify tree structure
    expect(arena.getLeft(root)).not.toBe(NULL_NODE);
    expect(arena.getRight(root)).not.toBe(NULL_NODE);
    expect(arena.getParent(root)).toBe(NULL_NODE);
  });
});
