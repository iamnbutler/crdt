/**
 * Tests for state-sync.ts
 *
 * Covers:
 * - createSnapshot / applySnapshot round-trip
 * - requiresFullSync edge cases
 * - snapshotsEqual
 * - getSnapshotText
 */

import { describe, expect, it } from "bun:test";
import { createVersionVector, observeVersion } from "../text/clock.js";
import { createFragment } from "../text/fragment.js";
import { MIN_LOCATOR } from "../text/locator.js";
import { replicaId } from "../text/types.js";
import {
  applySnapshot,
  createSnapshot,
  getSnapshotText,
  requiresFullSync,
  snapshotsEqual,
} from "./state-sync.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeOpId(replica: number, counter: number) {
  return { replicaId: replicaId(replica), counter };
}

function makeFragment(text: string, replica: number, counter: number, visible = true) {
  return createFragment(makeOpId(replica, counter), 0, MIN_LOCATOR, text, visible);
}

// ---------------------------------------------------------------------------
// createSnapshot / applySnapshot
// ---------------------------------------------------------------------------

describe("createSnapshot", () => {
  it("creates a snapshot from empty context", () => {
    const snapshot = createSnapshot({
      replicaId: replicaId(1),
      versionVector: createVersionVector(),
      fragments: [],
      undoCounts: [],
    });

    expect(snapshot.replicaId).toBe(replicaId(1));
    expect(snapshot.fragments).toHaveLength(0);
    expect(snapshot.undoCounts).toHaveLength(0);
    expect(snapshot.versionVector.size).toBe(0);
  });

  it("copies version vector entries", () => {
    const vv = createVersionVector();
    observeVersion(vv, replicaId(1), 10);
    observeVersion(vv, replicaId(2), 20);

    const snapshot = createSnapshot({
      replicaId: replicaId(1),
      versionVector: vv,
      fragments: [],
      undoCounts: [],
    });

    expect(snapshot.versionVector.get(replicaId(1))).toBe(10);
    expect(snapshot.versionVector.get(replicaId(2))).toBe(20);
  });

  it("mutations to original vv don't affect snapshot", () => {
    const vv = createVersionVector();
    observeVersion(vv, replicaId(1), 5);

    const snapshot = createSnapshot({
      replicaId: replicaId(1),
      versionVector: vv,
      fragments: [],
      undoCounts: [],
    });

    observeVersion(vv, replicaId(1), 99);

    expect(snapshot.versionVector.get(replicaId(1))).toBe(5);
  });

  it("serializes fragment fields correctly", () => {
    const frag = makeFragment("hello", 1, 0);
    const snapshot = createSnapshot({
      replicaId: replicaId(1),
      versionVector: createVersionVector(),
      fragments: [frag],
      undoCounts: [],
    });

    const sf = snapshot.fragments[0];
    expect(snapshot.fragments).toHaveLength(1);
    expect(sf?.text).toBe("hello");
    expect(sf?.visible).toBe(true);
    expect(sf?.insertionId.replicaId).toBe(replicaId(1));
    expect(sf?.insertionId.counter).toBe(0);
    expect(sf?.length).toBe(5);
    expect(sf?.insertionOffset).toBe(0);
  });

  it("serializes deleted fragment", () => {
    const frag = makeFragment("bye", 1, 0, false);
    const snapshot = createSnapshot({
      replicaId: replicaId(1),
      versionVector: createVersionVector(),
      fragments: [frag],
      undoCounts: [],
    });

    expect(snapshot.fragments[0]?.visible).toBe(false);
  });

  it("serializes undo counts", () => {
    const snapshot = createSnapshot({
      replicaId: replicaId(1),
      versionVector: createVersionVector(),
      fragments: [],
      undoCounts: [
        { operationId: makeOpId(1, 5), count: 2 },
        { operationId: makeOpId(2, 3), count: 1 },
      ],
    });

    expect(snapshot.undoCounts).toHaveLength(2);
    expect(snapshot.undoCounts[0]?.count).toBe(2);
    expect(snapshot.undoCounts[1]?.count).toBe(1);
  });
});

describe("applySnapshot", () => {
  it("reconstructs empty snapshot", () => {
    const snapshot = createSnapshot({
      replicaId: replicaId(1),
      versionVector: createVersionVector(),
      fragments: [],
      undoCounts: [],
    });

    const result = applySnapshot(snapshot);

    expect(result.fragments).toHaveLength(0);
    expect(result.versionVector.size).toBe(0);
    expect(result.undoCounts.size).toBe(0);
  });

  it("round-trips fragments through create/apply", () => {
    const frag1 = makeFragment("hello ", 1, 0);
    const frag2 = makeFragment("world", 2, 0);
    const vv = createVersionVector();
    observeVersion(vv, replicaId(1), 0);
    observeVersion(vv, replicaId(2), 0);

    const snapshot = createSnapshot({
      replicaId: replicaId(1),
      versionVector: vv,
      fragments: [frag1, frag2],
      undoCounts: [],
    });

    const result = applySnapshot(snapshot);

    expect(result.fragments).toHaveLength(2);
    expect(result.fragments[0]?.text).toBe("hello ");
    expect(result.fragments[1]?.text).toBe("world");
    expect(result.fragments[0]?.visible).toBe(true);
    expect(result.fragments[1]?.visible).toBe(true);
  });

  it("round-trips version vector", () => {
    const vv = createVersionVector();
    observeVersion(vv, replicaId(1), 42);
    observeVersion(vv, replicaId(3), 7);

    const snapshot = createSnapshot({
      replicaId: replicaId(1),
      versionVector: vv,
      fragments: [],
      undoCounts: [],
    });

    const result = applySnapshot(snapshot);

    expect(result.versionVector.get(replicaId(1))).toBe(42);
    expect(result.versionVector.get(replicaId(3))).toBe(7);
  });

  it("round-trips undo counts", () => {
    const snapshot = createSnapshot({
      replicaId: replicaId(1),
      versionVector: createVersionVector(),
      fragments: [],
      undoCounts: [
        { operationId: makeOpId(1, 5), count: 3 },
        { operationId: makeOpId(2, 8), count: 1 },
      ],
    });

    const result = applySnapshot(snapshot);

    expect(result.undoCounts.get("1:5")).toBe(3);
    expect(result.undoCounts.get("2:8")).toBe(1);
  });

  it("applies the locator levels from the snapshot", () => {
    const frag = makeFragment("x", 1, 0);
    const snapshot = createSnapshot({
      replicaId: replicaId(1),
      versionVector: createVersionVector(),
      fragments: [frag],
      undoCounts: [],
    });

    const result = applySnapshot(snapshot);
    const locLevels = result.fragments[0]?.locator.levels;
    expect(locLevels).toEqual(MIN_LOCATOR.levels);
  });
});

// ---------------------------------------------------------------------------
// requiresFullSync
// ---------------------------------------------------------------------------

describe("requiresFullSync", () => {
  it("returns false when vectors are equal", () => {
    const local = createVersionVector();
    const remote = createVersionVector();
    observeVersion(local, replicaId(1), 10);
    observeVersion(remote, replicaId(1), 10);

    expect(requiresFullSync(local, remote)).toBe(false);
  });

  it("returns false when local is ahead", () => {
    const local = createVersionVector();
    const remote = createVersionVector();
    observeVersion(local, replicaId(1), 100);
    observeVersion(remote, replicaId(1), 50);

    expect(requiresFullSync(local, remote)).toBe(false);
  });

  it("returns false for small gap where remote is slightly ahead", () => {
    const local = createVersionVector();
    const remote = createVersionVector();
    observeVersion(local, replicaId(1), 10);
    observeVersion(remote, replicaId(1), 500); // gap of 490 < 1000

    expect(requiresFullSync(local, remote)).toBe(false);
  });

  it("returns true when remote has unknown replica", () => {
    const local = createVersionVector();
    const remote = createVersionVector();
    observeVersion(remote, replicaId(99), 1);

    expect(requiresFullSync(local, remote)).toBe(true);
  });

  it("returns true when gap exceeds 1000", () => {
    const local = createVersionVector();
    const remote = createVersionVector();
    observeVersion(local, replicaId(1), 0);
    observeVersion(remote, replicaId(1), 1001);

    expect(requiresFullSync(local, remote)).toBe(true);
  });

  it("returns false for empty remote vector", () => {
    const local = createVersionVector();
    const remote = createVersionVector();
    observeVersion(local, replicaId(1), 5);

    expect(requiresFullSync(local, remote)).toBe(false);
  });

  it("returns false for empty local and remote vectors", () => {
    expect(requiresFullSync(createVersionVector(), createVersionVector())).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// snapshotsEqual
// ---------------------------------------------------------------------------

describe("snapshotsEqual", () => {
  it("returns true for two empty snapshots", () => {
    const a = createSnapshot({
      replicaId: replicaId(1),
      versionVector: createVersionVector(),
      fragments: [],
      undoCounts: [],
    });
    const b = createSnapshot({
      replicaId: replicaId(2),
      versionVector: createVersionVector(),
      fragments: [],
      undoCounts: [],
    });

    expect(snapshotsEqual(a, b)).toBe(true);
  });

  it("returns true for identical content", () => {
    const vv = createVersionVector();
    observeVersion(vv, replicaId(1), 5);
    const frag = makeFragment("hello", 1, 0);
    const ctx = {
      replicaId: replicaId(1),
      versionVector: vv,
      fragments: [frag],
      undoCounts: [{ operationId: makeOpId(1, 3), count: 1 }],
    };

    const a = createSnapshot(ctx);
    const b = createSnapshot(ctx);

    expect(snapshotsEqual(a, b)).toBe(true);
  });

  it("returns false when version vectors differ", () => {
    const vv1 = createVersionVector();
    observeVersion(vv1, replicaId(1), 5);
    const vv2 = createVersionVector();
    observeVersion(vv2, replicaId(1), 6);

    const a = createSnapshot({
      replicaId: replicaId(1),
      versionVector: vv1,
      fragments: [],
      undoCounts: [],
    });
    const b = createSnapshot({
      replicaId: replicaId(1),
      versionVector: vv2,
      fragments: [],
      undoCounts: [],
    });

    expect(snapshotsEqual(a, b)).toBe(false);
  });

  it("returns false when fragment counts differ", () => {
    const frag = makeFragment("hello", 1, 0);
    const a = createSnapshot({
      replicaId: replicaId(1),
      versionVector: createVersionVector(),
      fragments: [frag],
      undoCounts: [],
    });
    const b = createSnapshot({
      replicaId: replicaId(1),
      versionVector: createVersionVector(),
      fragments: [],
      undoCounts: [],
    });

    expect(snapshotsEqual(a, b)).toBe(false);
  });

  it("returns false when fragment text differs", () => {
    const a = createSnapshot({
      replicaId: replicaId(1),
      versionVector: createVersionVector(),
      fragments: [makeFragment("hello", 1, 0)],
      undoCounts: [],
    });
    const b = createSnapshot({
      replicaId: replicaId(1),
      versionVector: createVersionVector(),
      fragments: [makeFragment("world", 1, 0)],
      undoCounts: [],
    });

    expect(snapshotsEqual(a, b)).toBe(false);
  });

  it("returns false when undo count entries differ", () => {
    const a = createSnapshot({
      replicaId: replicaId(1),
      versionVector: createVersionVector(),
      fragments: [],
      undoCounts: [{ operationId: makeOpId(1, 0), count: 1 }],
    });
    const b = createSnapshot({
      replicaId: replicaId(1),
      versionVector: createVersionVector(),
      fragments: [],
      undoCounts: [{ operationId: makeOpId(1, 0), count: 2 }],
    });

    expect(snapshotsEqual(a, b)).toBe(false);
  });

  it("returns false when fragment visibility differs", () => {
    const a = createSnapshot({
      replicaId: replicaId(1),
      versionVector: createVersionVector(),
      fragments: [makeFragment("hi", 1, 0, true)],
      undoCounts: [],
    });
    const b = createSnapshot({
      replicaId: replicaId(1),
      versionVector: createVersionVector(),
      fragments: [makeFragment("hi", 1, 0, false)],
      undoCounts: [],
    });

    expect(snapshotsEqual(a, b)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getSnapshotText
// ---------------------------------------------------------------------------

describe("getSnapshotText", () => {
  it("returns empty string for empty snapshot", () => {
    const snapshot = createSnapshot({
      replicaId: replicaId(1),
      versionVector: createVersionVector(),
      fragments: [],
      undoCounts: [],
    });

    expect(getSnapshotText(snapshot)).toBe("");
  });

  it("concatenates visible fragment text", () => {
    const snapshot = createSnapshot({
      replicaId: replicaId(1),
      versionVector: createVersionVector(),
      fragments: [makeFragment("hello ", 1, 0, true), makeFragment("world", 2, 0, true)],
      undoCounts: [],
    });

    expect(getSnapshotText(snapshot)).toBe("hello world");
  });

  it("skips invisible fragments", () => {
    const snapshot = createSnapshot({
      replicaId: replicaId(1),
      versionVector: createVersionVector(),
      fragments: [
        makeFragment("hello ", 1, 0, true),
        makeFragment("deleted", 2, 0, false),
        makeFragment("world", 3, 0, true),
      ],
      undoCounts: [],
    });

    expect(getSnapshotText(snapshot)).toBe("hello world");
  });

  it("returns empty string when all fragments are invisible", () => {
    const snapshot = createSnapshot({
      replicaId: replicaId(1),
      versionVector: createVersionVector(),
      fragments: [makeFragment("hidden", 1, 0, false)],
      undoCounts: [],
    });

    expect(getSnapshotText(snapshot)).toBe("");
  });
});
