import { describe, expect, test } from "bun:test";
import {
  RESERVED_REPLICA_IDS,
  SequentialReplicaIdAssigner,
  generateRandomReplicaId,
  generateSecureReplicaId,
  isValidReplicaId,
} from "./replica-id.js";

describe("SequentialReplicaIdAssigner custom startId", () => {
  test("starts assigning from custom startId", () => {
    const assigner = new SequentialReplicaIdAssigner(100);
    const id = assigner.assign("client-1");
    expect(id).toBe(100);
    expect(assigner.assign("client-2")).toBe(101);
  });
});

describe("SequentialReplicaIdAssigner getReplicaId", () => {
  test("returns assigned ID for known client", () => {
    const assigner = new SequentialReplicaIdAssigner();
    const id = assigner.assign("client-1");
    expect(assigner.getReplicaId("client-1")).toBe(id);
  });

  test("returns undefined for unknown client", () => {
    const assigner = new SequentialReplicaIdAssigner();
    expect(assigner.getReplicaId("unknown")).toBeUndefined();
  });
});

describe("SequentialReplicaIdAssigner getActiveReplicas", () => {
  test("returns set of active replica IDs", () => {
    const assigner = new SequentialReplicaIdAssigner();
    const id1 = assigner.assign("client-1");
    const id2 = assigner.assign("client-2");
    const active = assigner.getActiveReplicas();
    expect(active.has(id1)).toBe(true);
    expect(active.has(id2)).toBe(true);
    expect(active.size).toBe(2);
  });

  test("released IDs are removed from active set", () => {
    const assigner = new SequentialReplicaIdAssigner();
    const id1 = assigner.assign("client-1");
    assigner.assign("client-2");
    assigner.release(id1);
    expect(assigner.getActiveReplicas().has(id1)).toBe(false);
  });
});

describe("SequentialReplicaIdAssigner releaseByClientId", () => {
  test("deactivates replica by client ID", () => {
    const assigner = new SequentialReplicaIdAssigner();
    const id = assigner.assign("client-1");
    expect(assigner.isActive(id)).toBe(true);
    assigner.releaseByClientId("client-1");
    expect(assigner.isActive(id)).toBe(false);
  });

  test("no-op for unknown client ID", () => {
    const assigner = new SequentialReplicaIdAssigner();
    assigner.assign("client-1");
    // Should not throw
    assigner.releaseByClientId("nonexistent");
    expect(assigner.activeCount).toBe(1);
  });

  test("re-assigning after releaseByClientId reactivates the same ID", () => {
    const assigner = new SequentialReplicaIdAssigner();
    const id = assigner.assign("client-1");
    assigner.releaseByClientId("client-1");
    expect(assigner.isActive(id)).toBe(false);

    const reassigned = assigner.assign("client-1");
    expect(reassigned).toBe(id); // same ID returned
    expect(assigner.isActive(id)).toBe(true);
  });
});

describe("SequentialReplicaIdAssigner exportState/fromState", () => {
  test("exportState captures nextId and assignments", () => {
    const assigner = new SequentialReplicaIdAssigner();
    assigner.assign("client-1");
    assigner.assign("client-2");

    const state = assigner.exportState();
    expect(state.nextId).toBe(3);
    expect(state.assignments).toHaveLength(2);
  });

  test("fromState restores assignments and continues sequencing", () => {
    const assigner = new SequentialReplicaIdAssigner();
    const id1 = assigner.assign("client-1");
    assigner.assign("client-2");

    const restored = SequentialReplicaIdAssigner.fromState(assigner.exportState());

    // Known clients resolve to same IDs
    expect(restored.getReplicaId("client-1")).toBe(id1);
    expect(restored.totalAssigned).toBe(2);

    // Next new client gets ID continuing from where we left off
    const id3 = restored.assign("client-3");
    expect(id3).toBe(3);
  });

  test("fromState does not restore active replicas (reconnect required)", () => {
    const assigner = new SequentialReplicaIdAssigner();
    assigner.assign("client-1");

    const restored = SequentialReplicaIdAssigner.fromState(assigner.exportState());
    // Active replicas are not persisted; clients must re-assign to become active
    expect(restored.activeCount).toBe(0);

    // Re-assigning marks them active again
    restored.assign("client-1");
    expect(restored.activeCount).toBe(1);
  });

  test("roundtrip preserves full assignment history", () => {
    const assigner = new SequentialReplicaIdAssigner(10);
    const idA = assigner.assign("a");
    const idB = assigner.assign("b");
    const idC = assigner.assign("c");

    const restored = SequentialReplicaIdAssigner.fromState(assigner.exportState());
    expect(restored.getReplicaId("a")).toBe(idA);
    expect(restored.getReplicaId("b")).toBe(idB);
    expect(restored.getReplicaId("c")).toBe(idC);
  });
});

describe("isValidReplicaId boundaries", () => {
  test("valid: 1 (minimum positive)", () => {
    expect(isValidReplicaId(1)).toBe(true);
  });

  test("valid: 0x3fffffff (maximum allowed)", () => {
    expect(isValidReplicaId(0x3fffffff)).toBe(true);
  });

  test("invalid: 0 (reserved sentinel)", () => {
    expect(isValidReplicaId(0)).toBe(false);
  });

  test("invalid: negative number", () => {
    expect(isValidReplicaId(-1)).toBe(false);
  });

  test("invalid: exceeds 0x3fffffff", () => {
    expect(isValidReplicaId(0x40000000)).toBe(false);
  });

  test("invalid: non-integer float", () => {
    expect(isValidReplicaId(1.5)).toBe(false);
  });

  test("invalid: NaN", () => {
    expect(isValidReplicaId(Number.NaN)).toBe(false);
  });
});

describe("generateSecureReplicaId", () => {
  test("generates a valid replica ID", () => {
    const id = generateSecureReplicaId();
    expect(isValidReplicaId(id)).toBe(true);
  });

  test("generates non-zero IDs", () => {
    for (let i = 0; i < 20; i++) {
      expect(generateSecureReplicaId()).toBeGreaterThan(0);
    }
  });
});

describe("generateRandomReplicaId avoids reserved IDs", () => {
  test("never generates MIN reserved ID (0)", () => {
    for (let i = 0; i < 100; i++) {
      expect(generateRandomReplicaId()).not.toBe(RESERVED_REPLICA_IDS.MIN);
    }
  });
});
