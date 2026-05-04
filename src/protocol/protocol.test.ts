/**
 * Tests for the CRDT collaboration protocol.
 */

import { describe, expect, test } from "bun:test";
import { cloneVersionVector, createVersionVector, observeVersion } from "../text/clock.js";
import { TextBuffer } from "../text/text-buffer.js";
import { replicaId, transactionId } from "../text/types.js";
import type { DeleteOperation, InsertOperation, Operation, UndoOperation } from "../text/types.js";

import { createFragment } from "../text/fragment.js";
import { MIN_LOCATOR } from "../text/locator.js";
import { AwarenessManager, deserializeAwareness, serializeAwareness } from "./awareness.js";
import { OperationQueue } from "./operation-queue.js";
import {
  SequentialReplicaIdAssigner,
  generateRandomReplicaId,
  isValidReplicaId,
} from "./replica-id.js";
import {
  BinaryReader,
  BinaryWriter,
  deserializeOperation,
  deserializeOperations,
  deserializeSnapshot,
  serializeOperation,
  serializeOperations,
  serializeSnapshot,
} from "./serialization.js";
import { applySnapshot, createSnapshot, getSnapshotText, requiresFullSync, snapshotsEqual } from "./state-sync.js";
import { MAX_QUEUE_SIZE, type SerializedFragment, type StateSnapshot, ValidationError } from "./types.js";
import {
  type ValidationContext,
  isCausallyReady,
  validateOperation,
  validateOperationStrict,
} from "./validation.js";

// ---------------------------------------------------------------------------
// Serialization Tests
// ---------------------------------------------------------------------------

describe("Binary Serialization", () => {
  describe("BinaryWriter/BinaryReader", () => {
    test("writeU8/readU8", () => {
      const writer = new BinaryWriter();
      writer.writeU8(0);
      writer.writeU8(255);
      writer.writeU8(128);

      const reader = new BinaryReader(writer.finish());
      expect(reader.readU8()).toBe(0);
      expect(reader.readU8()).toBe(255);
      expect(reader.readU8()).toBe(128);
    });

    test("writeU32/readU32", () => {
      const writer = new BinaryWriter();
      writer.writeU32(0);
      writer.writeU32(0xffffffff);
      writer.writeU32(0x12345678);

      const reader = new BinaryReader(writer.finish());
      expect(reader.readU32()).toBe(0);
      expect(reader.readU32()).toBe(0xffffffff);
      expect(reader.readU32()).toBe(0x12345678);
    });

    test("writeVarUint/readVarUint", () => {
      const writer = new BinaryWriter();
      writer.writeVarUint(0);
      writer.writeVarUint(127);
      writer.writeVarUint(128);
      writer.writeVarUint(16383);
      writer.writeVarUint(16384);
      writer.writeVarUint(1000000);

      const reader = new BinaryReader(writer.finish());
      expect(reader.readVarUint()).toBe(0);
      expect(reader.readVarUint()).toBe(127);
      expect(reader.readVarUint()).toBe(128);
      expect(reader.readVarUint()).toBe(16383);
      expect(reader.readVarUint()).toBe(16384);
      expect(reader.readVarUint()).toBe(1000000);
    });

    test("writeVarInt/readVarInt", () => {
      const writer = new BinaryWriter();
      writer.writeVarInt(0);
      writer.writeVarInt(1);
      writer.writeVarInt(-1);
      writer.writeVarInt(63);
      writer.writeVarInt(-64);
      writer.writeVarInt(1000000);
      writer.writeVarInt(-1000000);

      const reader = new BinaryReader(writer.finish());
      expect(reader.readVarInt()).toBe(0);
      expect(reader.readVarInt()).toBe(1);
      expect(reader.readVarInt()).toBe(-1);
      expect(reader.readVarInt()).toBe(63);
      expect(reader.readVarInt()).toBe(-64);
      expect(reader.readVarInt()).toBe(1000000);
      expect(reader.readVarInt()).toBe(-1000000);
    });

    test("writeString/readString", () => {
      const writer = new BinaryWriter();
      writer.writeString("");
      writer.writeString("hello");
      writer.writeString("Hello, World! 🌍");

      const reader = new BinaryReader(writer.finish());
      expect(reader.readString()).toBe("");
      expect(reader.readString()).toBe("hello");
      expect(reader.readString()).toBe("Hello, World! 🌍");
    });

    test("writeBool/readBool", () => {
      const writer = new BinaryWriter();
      writer.writeBool(true);
      writer.writeBool(false);

      const reader = new BinaryReader(writer.finish());
      expect(reader.readBool()).toBe(true);
      expect(reader.readBool()).toBe(false);
    });
  });

  describe("Operation Serialization", () => {
    test("serialize/deserialize insert operation", () => {
      const op: InsertOperation = {
        type: "insert",
        id: { replicaId: replicaId(1), counter: 5 },
        text: "Hello, World!",
        after: { insertionId: { replicaId: replicaId(0), counter: 0 }, offset: 0 },
        before: {
          insertionId: { replicaId: replicaId(0xffffffff), counter: 0xffffffff },
          offset: 0,
        },
        version: new Map([[replicaId(1), 5]]),
        locator: { levels: [0.5] },
      };

      const bytes = serializeOperation(op);
      const deserialized = deserializeOperation(bytes) as InsertOperation;

      expect(deserialized.type).toBe("insert");
      expect(deserialized.id.replicaId).toBe(replicaId(1));
      expect(deserialized.id.counter).toBe(5);
      expect(deserialized.text).toBe("Hello, World!");
      expect(deserialized.version.get(replicaId(1))).toBe(5);
    });

    test("serialize/deserialize delete operation", () => {
      const op: DeleteOperation = {
        type: "delete",
        id: { replicaId: replicaId(2), counter: 10 },
        ranges: [
          { insertionId: { replicaId: replicaId(1), counter: 5 }, offset: 0, length: 5 },
          { insertionId: { replicaId: replicaId(1), counter: 5 }, offset: 7, length: 6 },
        ],
        version: new Map([
          [replicaId(1), 5],
          [replicaId(2), 10],
        ]),
      };

      const bytes = serializeOperation(op);
      const deserialized = deserializeOperation(bytes) as DeleteOperation;

      expect(deserialized.type).toBe("delete");
      expect(deserialized.id.replicaId).toBe(replicaId(2));
      expect(deserialized.id.counter).toBe(10);
      expect(deserialized.ranges.length).toBe(2);
      expect(deserialized.ranges[0]?.length).toBe(5);
      expect(deserialized.ranges[1]?.offset).toBe(7);
    });

    test("serialize/deserialize undo operation", () => {
      const op: UndoOperation = {
        type: "undo",
        id: { replicaId: replicaId(1), counter: 20 },
        transactionId: transactionId(5),
        counts: [
          { operationId: { replicaId: replicaId(1), counter: 10 }, count: 1 },
          { operationId: { replicaId: replicaId(1), counter: 15 }, count: 1 },
        ],
        version: new Map([[replicaId(1), 20]]),
      };

      const bytes = serializeOperation(op);
      const deserialized = deserializeOperation(bytes) as UndoOperation;

      expect(deserialized.type).toBe("undo");
      expect(deserialized.id.counter).toBe(20);
      expect(deserialized.transactionId).toBe(transactionId(5));
      expect(deserialized.counts.length).toBe(2);
    });

    test("serialize/deserialize batch operations", () => {
      const ops: Operation[] = [
        {
          type: "insert",
          id: { replicaId: replicaId(1), counter: 0 },
          text: "A",
          after: { insertionId: { replicaId: replicaId(0), counter: 0 }, offset: 0 },
          before: {
            insertionId: { replicaId: replicaId(0xffffffff), counter: 0xffffffff },
            offset: 0,
          },
          version: new Map([[replicaId(1), 0]]),
          locator: MIN_LOCATOR,
        },
        {
          type: "delete",
          id: { replicaId: replicaId(2), counter: 0 },
          ranges: [],
          version: new Map([[replicaId(2), 0]]),
        },
      ];

      const bytes = serializeOperations(ops);
      const deserialized = deserializeOperations(bytes);

      expect(deserialized.length).toBe(2);
      expect(deserialized[0]?.type).toBe("insert");
      expect(deserialized[1]?.type).toBe("delete");
    });
  });

  describe("Snapshot Serialization", () => {
    test("serialize/deserialize state snapshot", () => {
      const snapshot: StateSnapshot = {
        version: 1,
        replicaId: replicaId(1),
        versionVector: new Map([
          [replicaId(1), 5],
          [replicaId(2), 3],
        ]),
        fragments: [
          {
            insertionId: { replicaId: replicaId(1), counter: 0 },
            insertionOffset: 0,
            locatorLevels: [0.5],
            baseLocatorLevels: [0.5],
            length: 5,
            visible: true,
            deletions: [],
            text: "Hello",
          },
        ],
        undoCounts: [{ operationId: { replicaId: replicaId(1), counter: 0 }, count: 0 }],
      };

      const bytes = serializeSnapshot(snapshot);
      const deserialized = deserializeSnapshot(bytes);

      expect(deserialized.version).toBe(1);
      expect(deserialized.replicaId).toBe(replicaId(1));
      expect(deserialized.versionVector.get(replicaId(1))).toBe(5);
      expect(deserialized.versionVector.get(replicaId(2))).toBe(3);
      expect(deserialized.fragments.length).toBe(1);
      expect(deserialized.fragments[0]?.text).toBe("Hello");
    });
  });
});

// ---------------------------------------------------------------------------
// Operation Queue Tests
// ---------------------------------------------------------------------------

describe("OperationQueue", () => {
  test("accepts and applies ready operations immediately", () => {
    const queue = new OperationQueue();
    const applied: Operation[] = [];
    const localVersion = createVersionVector();

    const op: InsertOperation = {
      type: "insert",
      id: { replicaId: replicaId(1), counter: 0 },
      text: "Hello",
      after: { insertionId: { replicaId: replicaId(0), counter: 0 }, offset: 0 },
      before: { insertionId: { replicaId: replicaId(0xffffffff), counter: 0xffffffff }, offset: 0 },
      version: new Map([[replicaId(1), 0]]),
      locator: MIN_LOCATOR,
    };

    const result = queue.enqueue(
      op,
      () => true, // Fragment always exists
      (o) => applied.push(o),
      localVersion,
    );

    expect(result.accepted).toBe(true);
    expect(result.ready).toBe(true);
    expect(result.overflow).toBe(false);
    expect(applied.length).toBe(1);
    expect(applied[0]).toBe(op);
  });

  test("defers operations with missing dependencies", () => {
    const queue = new OperationQueue();
    const applied: Operation[] = [];
    const localVersion = createVersionVector();
    const knownFragments = new Set<string>();

    const op: InsertOperation = {
      type: "insert",
      id: { replicaId: replicaId(1), counter: 1 },
      text: "World",
      after: { insertionId: { replicaId: replicaId(1), counter: 0 }, offset: 0 },
      before: { insertionId: { replicaId: replicaId(0xffffffff), counter: 0xffffffff }, offset: 0 },
      version: new Map([[replicaId(1), 1]]),
      locator: MIN_LOCATOR,
    };

    const result = queue.enqueue(
      op,
      (id) => knownFragments.has(`${id.replicaId}:${id.counter}`),
      (o) => applied.push(o),
      localVersion,
    );

    expect(result.accepted).toBe(true);
    expect(result.ready).toBe(false);
    expect(result.overflow).toBe(false);
    expect(applied.length).toBe(0);
    expect(queue.pendingCount).toBe(1);
  });

  test("flushes deferred operations when dependencies become available", () => {
    const queue = new OperationQueue();
    const applied: Operation[] = [];
    const localVersion = createVersionVector();
    const knownFragments = new Set<string>();

    // First, a deferred op
    const op2: InsertOperation = {
      type: "insert",
      id: { replicaId: replicaId(1), counter: 1 },
      text: "World",
      after: { insertionId: { replicaId: replicaId(1), counter: 0 }, offset: 5 },
      before: { insertionId: { replicaId: replicaId(0xffffffff), counter: 0xffffffff }, offset: 0 },
      version: new Map([[replicaId(1), 1]]),
      locator: MIN_LOCATOR,
    };

    queue.enqueue(
      op2,
      (id) => knownFragments.has(`${id.replicaId}:${id.counter}`),
      (o) => {
        applied.push(o);
        knownFragments.add(`${o.id.replicaId}:${o.id.counter}`);
      },
      localVersion,
    );

    expect(applied.length).toBe(0);
    expect(queue.pendingCount).toBe(1);

    // Now the dependency arrives
    const op1: InsertOperation = {
      type: "insert",
      id: { replicaId: replicaId(1), counter: 0 },
      text: "Hello",
      after: { insertionId: { replicaId: replicaId(0), counter: 0 }, offset: 0 },
      before: { insertionId: { replicaId: replicaId(0xffffffff), counter: 0xffffffff }, offset: 0 },
      version: new Map([[replicaId(1), 0]]),
      locator: MIN_LOCATOR,
    };

    queue.enqueue(
      op1,
      (id) => knownFragments.has(`${id.replicaId}:${id.counter}`),
      (o) => {
        applied.push(o);
        knownFragments.add(`${o.id.replicaId}:${o.id.counter}`);
      },
      localVersion,
    );

    expect(applied.length).toBe(2);
    expect(applied[0]?.id.counter).toBe(0);
    expect(applied[1]?.id.counter).toBe(1);
    expect(queue.pendingCount).toBe(0);
  });

  test("tracks deferred replicas", () => {
    const queue = new OperationQueue();
    const localVersion = createVersionVector();

    const op1: InsertOperation = {
      type: "insert",
      id: { replicaId: replicaId(1), counter: 1 },
      text: "A",
      after: { insertionId: { replicaId: replicaId(1), counter: 0 }, offset: 0 },
      before: { insertionId: { replicaId: replicaId(0xffffffff), counter: 0xffffffff }, offset: 0 },
      version: new Map([[replicaId(1), 1]]),
      locator: MIN_LOCATOR,
    };

    const op2: InsertOperation = {
      type: "insert",
      id: { replicaId: replicaId(2), counter: 1 },
      text: "B",
      after: { insertionId: { replicaId: replicaId(2), counter: 0 }, offset: 0 },
      before: { insertionId: { replicaId: replicaId(0xffffffff), counter: 0xffffffff }, offset: 0 },
      version: new Map([[replicaId(2), 1]]),
      locator: MIN_LOCATOR,
    };

    queue.enqueue(
      op1,
      () => false,
      () => {
        /* no-op */
      },
      localVersion,
    );
    queue.enqueue(
      op2,
      () => false,
      () => {
        /* no-op */
      },
      localVersion,
    );

    expect(queue.deferredReplicas.size).toBe(2);
    expect(queue.deferredReplicas.has(replicaId(1))).toBe(true);
    expect(queue.deferredReplicas.has(replicaId(2))).toBe(true);
  });

  test("rejects duplicate operations", () => {
    const queue = new OperationQueue();
    const applied: Operation[] = [];
    const localVersion = createVersionVector();

    const op: InsertOperation = {
      type: "insert",
      id: { replicaId: replicaId(1), counter: 0 },
      text: "Hello",
      after: { insertionId: { replicaId: replicaId(0), counter: 0 }, offset: 0 },
      before: { insertionId: { replicaId: replicaId(0xffffffff), counter: 0xffffffff }, offset: 0 },
      version: new Map([[replicaId(1), 0]]),
      locator: MIN_LOCATOR,
    };

    // First enqueue
    queue.enqueue(
      op,
      () => true,
      (o) => applied.push(o),
      localVersion,
    );
    expect(applied.length).toBe(1);

    // Duplicate
    const result = queue.enqueue(
      op,
      () => true,
      (o) => applied.push(o),
      localVersion,
    );
    expect(result.accepted).toBe(false);
    expect(applied.length).toBe(1);
  });

  test("triggers overflow when max size exceeded", () => {
    const queue = new OperationQueue(5); // Small max size for testing
    const localVersion = createVersionVector();

    // Fill the queue
    for (let i = 0; i < 5; i++) {
      const op: InsertOperation = {
        type: "insert",
        id: { replicaId: replicaId(1), counter: i + 1 },
        text: "X",
        after: { insertionId: { replicaId: replicaId(1), counter: i }, offset: 0 },
        before: {
          insertionId: { replicaId: replicaId(0xffffffff), counter: 0xffffffff },
          offset: 0,
        },
        version: new Map([[replicaId(1), i + 1]]),
        locator: MIN_LOCATOR,
      };
      queue.enqueue(
        op,
        () => false,
        () => {
          /* no-op */
        },
        localVersion,
      );
    }

    expect(queue.pendingCount).toBe(5);
    expect(queue.overflowed).toBe(false);

    // One more should overflow
    const overflowOp: InsertOperation = {
      type: "insert",
      id: { replicaId: replicaId(1), counter: 100 },
      text: "Y",
      after: { insertionId: { replicaId: replicaId(1), counter: 99 }, offset: 0 },
      before: { insertionId: { replicaId: replicaId(0xffffffff), counter: 0xffffffff }, offset: 0 },
      version: new Map([[replicaId(1), 100]]),
      locator: MIN_LOCATOR,
    };

    const result = queue.enqueue(
      overflowOp,
      () => false,
      () => {
        /* no-op */
      },
      localVersion,
    );
    expect(result.overflow).toBe(true);
    expect(queue.overflowed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Validation Tests
// ---------------------------------------------------------------------------

describe("Operation Validation", () => {
  test("validates correct operation", () => {
    const op: InsertOperation = {
      type: "insert",
      id: { replicaId: replicaId(1), counter: 0 },
      text: "Hello",
      after: { insertionId: { replicaId: replicaId(0), counter: 0 }, offset: 0 },
      before: { insertionId: { replicaId: replicaId(0xffffffff), counter: 0xffffffff }, offset: 0 },
      version: new Map([[replicaId(1), 0]]),
      locator: MIN_LOCATOR,
    };

    const context: ValidationContext = {
      replicaCounters: new Map(),
      localVersion: createVersionVector(),
      fragmentExists: () => true,
    };

    const result = validateOperation(op, context);
    expect(result.valid).toBe(true);
    expect(result.error).toBe(ValidationError.None);
  });

  test("rejects operation with wrong replica ID", () => {
    const op: InsertOperation = {
      type: "insert",
      id: { replicaId: replicaId(1), counter: 0 },
      text: "Hello",
      after: { insertionId: { replicaId: replicaId(0), counter: 0 }, offset: 0 },
      before: { insertionId: { replicaId: replicaId(0xffffffff), counter: 0xffffffff }, offset: 0 },
      version: new Map([[replicaId(1), 0]]),
      locator: MIN_LOCATOR,
    };

    const context: ValidationContext = {
      expectedSender: replicaId(2), // Expecting replica 2
      replicaCounters: new Map(),
      localVersion: createVersionVector(),
      fragmentExists: () => true,
    };

    const result = validateOperation(op, context);
    expect(result.valid).toBe(false);
    expect(result.error).toBe(ValidationError.InvalidReplicaId);
  });

  test("rejects delete operation with unknown fragment reference", () => {
    const op: DeleteOperation = {
      type: "delete",
      id: { replicaId: replicaId(1), counter: 5 },
      ranges: [{ insertionId: { replicaId: replicaId(1), counter: 0 }, offset: 0, length: 5 }],
      version: new Map([[replicaId(1), 5]]),
    };

    const context: ValidationContext = {
      replicaCounters: new Map(),
      localVersion: createVersionVector(),
      fragmentExists: () => false, // Fragment doesn't exist
    };

    const result = validateOperation(op, context);
    expect(result.valid).toBe(false);
    expect(result.error).toBe(ValidationError.UnknownReference);
  });

  test("rejects delete operation with non-positive length", () => {
    const op: DeleteOperation = {
      type: "delete",
      id: { replicaId: replicaId(1), counter: 5 },
      ranges: [{ insertionId: { replicaId: replicaId(1), counter: 0 }, offset: 0, length: 0 }],
      version: new Map([[replicaId(1), 5]]),
    };

    const context: ValidationContext = {
      replicaCounters: new Map(),
      localVersion: createVersionVector(),
      fragmentExists: () => true,
    };

    const result = validateOperation(op, context);
    expect(result.valid).toBe(false);
    expect(result.error).toBe(ValidationError.InvalidDeleteRange);
  });

  test("isCausallyReady checks version vector", () => {
    const op: InsertOperation = {
      type: "insert",
      id: { replicaId: replicaId(2), counter: 0 },
      text: "Hello",
      after: { insertionId: { replicaId: replicaId(0), counter: 0 }, offset: 0 },
      before: { insertionId: { replicaId: replicaId(0xffffffff), counter: 0xffffffff }, offset: 0 },
      version: new Map([
        [replicaId(1), 5],
        [replicaId(2), 0],
      ]), // Requires replica 1 counter 5
      locator: MIN_LOCATOR,
    };

    // Local version doesn't have replica 1
    const localVersion1 = createVersionVector();
    expect(isCausallyReady(op, localVersion1)).toBe(false);

    // Local version has replica 1 but not high enough
    const localVersion2 = createVersionVector();
    observeVersion(localVersion2, replicaId(1), 4);
    expect(isCausallyReady(op, localVersion2)).toBe(false);

    // Local version is sufficient
    const localVersion3 = createVersionVector();
    observeVersion(localVersion3, replicaId(1), 5);
    expect(isCausallyReady(op, localVersion3)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Replica ID Assignment Tests
// ---------------------------------------------------------------------------

describe("Replica ID Assignment", () => {
  test("SequentialReplicaIdAssigner assigns sequential IDs", () => {
    const assigner = new SequentialReplicaIdAssigner();

    const id1 = assigner.assign("client-1");
    const id2 = assigner.assign("client-2");
    const id3 = assigner.assign("client-3");

    expect(id1).toBe(replicaId(1));
    expect(id2).toBe(replicaId(2));
    expect(id3).toBe(replicaId(3));
  });

  test("SequentialReplicaIdAssigner returns same ID for same client", () => {
    const assigner = new SequentialReplicaIdAssigner();

    const id1 = assigner.assign("client-1");
    const id2 = assigner.assign("client-1");

    expect(id1).toBe(id2);
    expect(assigner.totalAssigned).toBe(1);
  });

  test("SequentialReplicaIdAssigner tracks active replicas", () => {
    const assigner = new SequentialReplicaIdAssigner();

    const id1 = assigner.assign("client-1");
    const id2 = assigner.assign("client-2");

    expect(assigner.activeCount).toBe(2);
    expect(assigner.isActive(id1)).toBe(true);

    assigner.release(id1);

    expect(assigner.activeCount).toBe(1);
    expect(assigner.isActive(id1)).toBe(false);
    expect(assigner.isActive(id2)).toBe(true);
  });

  test("generateRandomReplicaId generates valid IDs", () => {
    for (let i = 0; i < 100; i++) {
      const id = generateRandomReplicaId();
      expect(isValidReplicaId(id)).toBe(true);
      expect(id).toBeGreaterThan(0);
      expect(id).toBeLessThanOrEqual(0x3fffffff);
    }
  });
});

// ---------------------------------------------------------------------------
// Awareness Tests
// ---------------------------------------------------------------------------

describe("Awareness Protocol", () => {
  test("AwarenessManager manages local state", () => {
    const manager = new AwarenessManager(replicaId(1));

    manager.setCursor({ offset: 10 });
    manager.setUser({ name: "Alice", color: "#ff0000" });

    const state = manager.getLocalState();
    expect(state.replicaId).toBe(replicaId(1));
    expect(state.cursor?.offset).toBe(10);
    expect(state.user?.name).toBe("Alice");
    expect(state.timestamp).toBeGreaterThan(0);
  });

  test("AwarenessManager applies remote updates", () => {
    const manager = new AwarenessManager(replicaId(1));

    const remoteState = {
      replicaId: replicaId(2),
      cursor: { offset: 20 },
      user: { name: "Bob" },
      timestamp: Date.now(),
    };

    manager.applyRemote(remoteState);

    const retrieved = manager.getState(replicaId(2));
    expect(retrieved?.cursor?.offset).toBe(20);
    expect(retrieved?.user?.name).toBe("Bob");
  });

  test("AwarenessManager ignores updates from self", () => {
    const manager = new AwarenessManager(replicaId(1));

    manager.setCursor({ offset: 10 });

    const selfUpdate = {
      replicaId: replicaId(1),
      cursor: { offset: 999 },
      timestamp: Date.now(),
    };

    manager.applyRemote(selfUpdate);

    // Should still have original cursor
    const state = manager.getLocalState();
    expect(state.cursor?.offset).toBe(10);
  });

  test("AwarenessManager uses last-write-wins", () => {
    const manager = new AwarenessManager(replicaId(1));

    const now = Date.now();

    manager.applyRemote({
      replicaId: replicaId(2),
      cursor: { offset: 10 },
      timestamp: now,
    });

    manager.applyRemote({
      replicaId: replicaId(2),
      cursor: { offset: 20 },
      timestamp: now + 100, // Newer
    });

    manager.applyRemote({
      replicaId: replicaId(2),
      cursor: { offset: 5 },
      timestamp: now - 100, // Older, should be ignored
    });

    const state = manager.getState(replicaId(2));
    expect(state?.cursor?.offset).toBe(20);
  });

  test("serialize/deserialize awareness state", () => {
    const state = {
      replicaId: replicaId(5),
      cursor: { offset: 100, anchorOffset: 50 },
      user: { name: "Charlie", color: "#00ff00", avatarUrl: "https://example.com/avatar.png" },
      custom: { typing: true, lastActive: 12345 },
      timestamp: Date.now(),
    };

    const bytes = serializeAwareness(state);
    const deserialized = deserializeAwareness(bytes);

    expect(deserialized.replicaId).toBe(replicaId(5));
    expect(deserialized.cursor?.offset).toBe(100);
    expect(deserialized.cursor?.anchorOffset).toBe(50);
    expect(deserialized.user?.name).toBe("Charlie");
    expect(deserialized.user?.color).toBe("#00ff00");
    // biome-ignore lint/complexity/useLiteralKeys: index signature requires bracket access
    expect(deserialized.custom?.["typing"]).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// State Sync Tests
// ---------------------------------------------------------------------------

describe("State Sync", () => {
  test("create and apply snapshot round-trip", () => {
    const buf = TextBuffer.fromString("Hello, World!", replicaId(1));
    buf.insert(7, "CRDT ");

    // Get fragments from buffer
    const snap = buf.snapshot();
    const fragments: SerializedFragment[] = [];
    let visLen = 0;
    snap.visitFragments((frag) => {
      // Convert anchor fragment to our Fragment type
      // This is a simplified version - in real code we'd expose fragments directly
      fragments.push({
        insertionId: {
          replicaId: replicaId(frag.insertionId.replicaId),
          counter: frag.insertionId.localSeq,
        },
        insertionOffset: frag.startOffset,
        locatorLevels: [0.5],
        baseLocatorLevels: [0.5],
        length: frag.endOffset - frag.startOffset,
        visible: !frag.isDeleted,
        deletions: [],
        text: !frag.isDeleted ? snap.getText(visLen, visLen + frag.utf16Len) : "",
      });
      visLen += frag.utf16Len;
      return true;
    });
    snap.release();

    const snapshot: StateSnapshot = {
      version: 1,
      replicaId: replicaId(1),
      versionVector: cloneVersionVector(buf.version),
      fragments: fragments,
      undoCounts: [],
    };

    const text = getSnapshotText(snapshot);
    expect(text).toBe("Hello, CRDT World!");
  });

  test("snapshotsEqual compares correctly", () => {
    const snap1: StateSnapshot = {
      version: 1,
      replicaId: replicaId(1),
      versionVector: new Map([[replicaId(1), 5]]),
      fragments: [
        {
          insertionId: { replicaId: replicaId(1), counter: 0 },
          insertionOffset: 0,
          locatorLevels: [0.5],
          baseLocatorLevels: [0.5],
          length: 5,
          visible: true,
          deletions: [],
          text: "Hello",
        },
      ],
      undoCounts: [],
    };

    const snap2: StateSnapshot = {
      version: 1,
      replicaId: replicaId(1),
      versionVector: new Map([[replicaId(1), 5]]),
      fragments: [
        {
          insertionId: { replicaId: replicaId(1), counter: 0 },
          insertionOffset: 0,
          locatorLevels: [0.5],
          baseLocatorLevels: [0.5],
          length: 5,
          visible: true,
          deletions: [],
          text: "Hello",
        },
      ],
      undoCounts: [],
    };

    expect(snapshotsEqual(snap1, snap2)).toBe(true);

    // Different text - create a new snapshot with modified fragment
    const snap3: StateSnapshot = {
      ...snap2,
      fragments: [{ ...(snap2.fragments[0] as SerializedFragment), text: "World" }],
    };
    expect(snapshotsEqual(snap1, snap3)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Convergence Tests
// ---------------------------------------------------------------------------

describe("Convergence", () => {
  test("3 replicas converge with random operations", () => {
    // Create 3 replicas
    const buf1 = TextBuffer.create(replicaId(1));
    const buf2 = TextBuffer.create(replicaId(2));
    const buf3 = TextBuffer.create(replicaId(3));

    const allOps: Operation[] = [];

    // Generate random operations on each replica
    const rng = mulberry32(42); // Seeded RNG for reproducibility

    for (let round = 0; round < 100; round++) {
      // Each replica does an operation
      for (const buf of [buf1, buf2, buf3]) {
        const len = buf.length;
        const action = rng() < 0.7 ? "insert" : "delete";

        let op: Operation;
        if (action === "insert" || len === 0) {
          const pos = Math.floor(rng() * (len + 1));
          const text = String.fromCharCode(65 + Math.floor(rng() * 26));
          op = buf.insert(pos, text);
        } else {
          const start = Math.floor(rng() * len);
          const end = Math.min(start + 1 + Math.floor(rng() * 3), len);
          op = buf.delete(start, end);
        }
        allOps.push(op);
      }
    }

    // Apply all operations to all replicas
    for (const op of allOps) {
      if (op.id.replicaId !== buf1.replicaId) buf1.applyRemote(op);
      if (op.id.replicaId !== buf2.replicaId) buf2.applyRemote(op);
      if (op.id.replicaId !== buf3.replicaId) buf3.applyRemote(op);
    }

    // All replicas should converge
    const text1 = buf1.getText();
    const text2 = buf2.getText();
    const text3 = buf3.getText();

    expect(text1).toBe(text2);
    expect(text2).toBe(text3);
  });

  test("deferred operations applied in correct causal order", () => {
    const buf1 = TextBuffer.create(replicaId(1));
    const buf2 = TextBuffer.create(replicaId(2));

    // buf1: insert "Hello"
    const op1 = buf1.insert(0, "Hello");

    // buf1: insert " World" after "Hello"
    const op2 = buf1.insert(5, " World");

    // Apply to buf2 in reverse order (simulating out-of-order network)
    buf2.applyRemote(op2); // Should be deferred
    buf2.applyRemote(op1); // Should apply, then op2 should flush

    expect(buf2.getText()).toBe("Hello World");
  });
});

// ---------------------------------------------------------------------------
// requiresFullSync Tests
// ---------------------------------------------------------------------------

describe("requiresFullSync", () => {
  test("returns false for empty version vectors", () => {
    const local = createVersionVector();
    const remote = createVersionVector();
    expect(requiresFullSync(local, remote)).toBe(false);
  });

  test("returns false when local and remote are identical", () => {
    const local = createVersionVector();
    observeVersion(local, replicaId(1), 10);
    observeVersion(local, replicaId(2), 5);
    const remote = cloneVersionVector(local);
    expect(requiresFullSync(local, remote)).toBe(false);
  });

  test("returns true when remote has a replica local does not know about", () => {
    const local = createVersionVector();
    observeVersion(local, replicaId(1), 10);
    const remote = createVersionVector();
    observeVersion(remote, replicaId(1), 10);
    observeVersion(remote, replicaId(2), 1); // new replica
    expect(requiresFullSync(local, remote)).toBe(true);
  });

  test("returns false when version gap is exactly 1000", () => {
    const local = createVersionVector();
    observeVersion(local, replicaId(1), 0);
    const remote = createVersionVector();
    observeVersion(remote, replicaId(1), 1000);
    expect(requiresFullSync(local, remote)).toBe(false);
  });

  test("returns true when version gap exceeds 1000", () => {
    const local = createVersionVector();
    observeVersion(local, replicaId(1), 0);
    const remote = createVersionVector();
    observeVersion(remote, replicaId(1), 1001);
    expect(requiresFullSync(local, remote)).toBe(true);
  });

  test("returns false when local is ahead of remote", () => {
    const local = createVersionVector();
    observeVersion(local, replicaId(1), 2000);
    const remote = createVersionVector();
    observeVersion(remote, replicaId(1), 100);
    expect(requiresFullSync(local, remote)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// validateOperationStrict Tests
// ---------------------------------------------------------------------------

describe("validateOperationStrict", () => {
  test("accepts structurally valid and causally ready operation", () => {
    const op: InsertOperation = {
      type: "insert",
      id: { replicaId: replicaId(1), counter: 0 },
      text: "Hello",
      after: { insertionId: { replicaId: replicaId(0), counter: 0 }, offset: 0 },
      before: { insertionId: { replicaId: replicaId(0xffffffff), counter: 0xffffffff }, offset: 0 },
      version: new Map([[replicaId(1), 0]]),
      locator: MIN_LOCATOR,
    };

    const context: ValidationContext = {
      replicaCounters: new Map(),
      localVersion: createVersionVector(),
      fragmentExists: () => true,
    };

    const result = validateOperationStrict(op, context);
    expect(result.valid).toBe(true);
    expect(result.error).toBe(ValidationError.None);
  });

  test("rejects structurally valid but causally unready operation", () => {
    // Operation from replica 2 that requires replica 1's counter 5
    const op: InsertOperation = {
      type: "insert",
      id: { replicaId: replicaId(2), counter: 0 },
      text: "Hello",
      after: { insertionId: { replicaId: replicaId(0), counter: 0 }, offset: 0 },
      before: { insertionId: { replicaId: replicaId(0xffffffff), counter: 0xffffffff }, offset: 0 },
      version: new Map([
        [replicaId(1), 5],
        [replicaId(2), 0],
      ]),
      locator: MIN_LOCATOR,
    };

    const context: ValidationContext = {
      replicaCounters: new Map(),
      localVersion: createVersionVector(), // local hasn't seen replica 1's operations
      fragmentExists: () => true,
    };

    const result = validateOperationStrict(op, context);
    expect(result.valid).toBe(false);
    expect(result.error).toBe(ValidationError.InconsistentVersion);
  });

  test("propagates structural validation errors before checking causal readiness", () => {
    const op: InsertOperation = {
      type: "insert",
      id: { replicaId: replicaId(1), counter: 0 },
      text: "Hello",
      after: { insertionId: { replicaId: replicaId(0), counter: 0 }, offset: 0 },
      before: { insertionId: { replicaId: replicaId(0xffffffff), counter: 0xffffffff }, offset: 0 },
      version: new Map([[replicaId(1), 0]]),
      locator: MIN_LOCATOR,
    };

    const context: ValidationContext = {
      expectedSender: replicaId(99), // wrong sender
      replicaCounters: new Map(),
      localVersion: createVersionVector(),
      fragmentExists: () => true,
    };

    const result = validateOperationStrict(op, context);
    expect(result.valid).toBe(false);
    expect(result.error).toBe(ValidationError.InvalidReplicaId);
  });
});

// ---------------------------------------------------------------------------
// Additional validateOperation edge cases
// ---------------------------------------------------------------------------

describe("validateOperation edge cases", () => {
  test("rejects insert referencing missing non-sentinel after fragment", () => {
    const op: InsertOperation = {
      type: "insert",
      id: { replicaId: replicaId(1), counter: 1 },
      text: "x",
      // non-sentinel after (replicaId 1, not the sentinel replicaId 0)
      after: { insertionId: { replicaId: replicaId(1), counter: 0 }, offset: 0 },
      before: { insertionId: { replicaId: replicaId(0xffffffff), counter: 0xffffffff }, offset: 0 },
      version: new Map([[replicaId(1), 1]]),
      locator: MIN_LOCATOR,
    };

    const context: ValidationContext = {
      replicaCounters: new Map(),
      localVersion: createVersionVector(),
      fragmentExists: () => false,
    };

    const result = validateOperation(op, context);
    expect(result.valid).toBe(false);
    expect(result.error).toBe(ValidationError.UnknownReference);
  });

  test("rejects insert referencing missing non-sentinel before fragment", () => {
    const op: InsertOperation = {
      type: "insert",
      id: { replicaId: replicaId(1), counter: 1 },
      text: "x",
      after: { insertionId: { replicaId: replicaId(0), counter: 0 }, offset: 0 },
      // non-sentinel before (replicaId 1, not the sentinel 0xffffffff)
      before: { insertionId: { replicaId: replicaId(1), counter: 0 }, offset: 0 },
      version: new Map([[replicaId(1), 1]]),
      locator: MIN_LOCATOR,
    };

    const context: ValidationContext = {
      replicaCounters: new Map(),
      localVersion: createVersionVector(),
      fragmentExists: () => false,
    };

    const result = validateOperation(op, context);
    expect(result.valid).toBe(false);
    expect(result.error).toBe(ValidationError.UnknownReference);
  });

  test("rejects undo operation with negative count", () => {
    const op: UndoOperation = {
      type: "undo",
      id: { replicaId: replicaId(1), counter: 5 },
      transactionId: transactionId(1),
      counts: [{ operationId: { replicaId: replicaId(1), counter: 0 }, count: -1 }],
      version: new Map([[replicaId(1), 5]]),
    };

    const context: ValidationContext = {
      replicaCounters: new Map(),
      localVersion: createVersionVector(),
      fragmentExists: () => true,
    };

    const result = validateOperation(op, context);
    expect(result.valid).toBe(false);
    expect(result.error).toBe(ValidationError.InconsistentVersion);
  });

  test("accepts undo operation with zero count", () => {
    const op: UndoOperation = {
      type: "undo",
      id: { replicaId: replicaId(1), counter: 5 },
      transactionId: transactionId(1),
      counts: [{ operationId: { replicaId: replicaId(1), counter: 0 }, count: 0 }],
      version: new Map([[replicaId(1), 5]]),
    };

    const context: ValidationContext = {
      replicaCounters: new Map(),
      localVersion: createVersionVector(),
      fragmentExists: () => true,
    };

    const result = validateOperation(op, context);
    expect(result.valid).toBe(true);
  });

  test("rejects operation with inconsistent version vector", () => {
    // counter=5 but version vector says only counter=3 for this replica
    const op: InsertOperation = {
      type: "insert",
      id: { replicaId: replicaId(1), counter: 5 },
      text: "x",
      after: { insertionId: { replicaId: replicaId(0), counter: 0 }, offset: 0 },
      before: { insertionId: { replicaId: replicaId(0xffffffff), counter: 0xffffffff }, offset: 0 },
      version: new Map([[replicaId(1), 3]]), // claims only 3 but counter is 5
      locator: MIN_LOCATOR,
    };

    const context: ValidationContext = {
      replicaCounters: new Map(),
      localVersion: createVersionVector(),
      fragmentExists: () => true,
    };

    const result = validateOperation(op, context);
    expect(result.valid).toBe(false);
    expect(result.error).toBe(ValidationError.InconsistentVersion);
  });
});

// ---------------------------------------------------------------------------
// OperationQueue: Additional Methods
// ---------------------------------------------------------------------------

describe("OperationQueue: flush()", () => {
  test("flush applies all pending operations when dependencies become available", () => {
    const queue = new OperationQueue();
    const applied: Operation[] = [];
    const localVersion = createVersionVector();

    const op: InsertOperation = {
      type: "insert",
      id: { replicaId: replicaId(1), counter: 1 },
      text: "Deferred",
      after: { insertionId: { replicaId: replicaId(1), counter: 0 }, offset: 0 },
      before: { insertionId: { replicaId: replicaId(0xffffffff), counter: 0xffffffff }, offset: 0 },
      version: new Map([[replicaId(1), 1]]),
      locator: MIN_LOCATOR,
    };

    queue.enqueue(op, () => false, (o) => applied.push(o), localVersion);
    expect(queue.pendingCount).toBe(1);
    expect(applied.length).toBe(0);

    const count = queue.flush(
      (id) => id.replicaId === replicaId(1) && id.counter === 0,
      (o) => applied.push(o),
      localVersion,
    );

    expect(count).toBe(1);
    expect(applied.length).toBe(1);
    expect(applied[0]?.id.counter).toBe(1);
    expect(queue.pendingCount).toBe(0);
  });

  test("flush returns 0 and leaves unresolvable ops pending", () => {
    const queue = new OperationQueue();
    const applied: Operation[] = [];
    const localVersion = createVersionVector();

    const op: InsertOperation = {
      type: "insert",
      id: { replicaId: replicaId(1), counter: 1 },
      text: "Still waiting",
      after: { insertionId: { replicaId: replicaId(1), counter: 0 }, offset: 0 },
      before: { insertionId: { replicaId: replicaId(0xffffffff), counter: 0xffffffff }, offset: 0 },
      version: new Map([[replicaId(1), 1]]),
      locator: MIN_LOCATOR,
    };

    queue.enqueue(op, () => false, (o) => applied.push(o), localVersion);

    const count = queue.flush(() => false, (o) => applied.push(o), localVersion);

    expect(count).toBe(0);
    expect(applied.length).toBe(0);
    expect(queue.pendingCount).toBe(1);
  });

  test("flush applies a chain of dependent operations when root becomes available", () => {
    const queue = new OperationQueue();
    const applied: Operation[] = [];
    const localVersion = createVersionVector();
    const known = new Set<string>();

    // op2 depends on op1; op1 depends on op0 (not yet known)
    const op1: InsertOperation = {
      type: "insert",
      id: { replicaId: replicaId(1), counter: 1 },
      text: "B",
      after: { insertionId: { replicaId: replicaId(1), counter: 0 }, offset: 0 },
      before: { insertionId: { replicaId: replicaId(0xffffffff), counter: 0xffffffff }, offset: 0 },
      version: new Map([[replicaId(1), 1]]),
      locator: MIN_LOCATOR,
    };
    const op2: InsertOperation = {
      type: "insert",
      id: { replicaId: replicaId(1), counter: 2 },
      text: "C",
      after: { insertionId: { replicaId: replicaId(1), counter: 1 }, offset: 0 },
      before: { insertionId: { replicaId: replicaId(0xffffffff), counter: 0xffffffff }, offset: 0 },
      version: new Map([[replicaId(1), 2]]),
      locator: MIN_LOCATOR,
    };

    queue.enqueue(
      op1,
      (id) => known.has(`${id.replicaId}:${id.counter}`),
      (o) => {
        applied.push(o);
        known.add(`${o.id.replicaId}:${o.id.counter}`);
      },
      localVersion,
    );
    queue.enqueue(
      op2,
      (id) => known.has(`${id.replicaId}:${id.counter}`),
      (o) => {
        applied.push(o);
        known.add(`${o.id.replicaId}:${o.id.counter}`);
      },
      localVersion,
    );
    expect(queue.pendingCount).toBe(2);

    // Make op0 known, then flush
    known.add(`${replicaId(1)}:0`);
    const count = queue.flush(
      (id) => known.has(`${id.replicaId}:${id.counter}`),
      (o) => {
        applied.push(o);
        known.add(`${o.id.replicaId}:${o.id.counter}`);
      },
      localVersion,
    );

    expect(count).toBe(2);
    expect(applied.length).toBe(2);
    expect(applied[0]?.id.counter).toBe(1);
    expect(applied[1]?.id.counter).toBe(2);
    expect(queue.pendingCount).toBe(0);
  });
});

describe("OperationQueue: stats, clear, resetOverflow, getPending, getHighestCounter", () => {
  test("stats reflects initial empty state", () => {
    const queue = new OperationQueue();
    const stats = queue.stats;

    expect(stats.pendingCount).toBe(0);
    expect(stats.deferredReplicaCount).toBe(0);
    expect(stats.deferredReplicas.size).toBe(0);
    expect(stats.maxSize).toBe(MAX_QUEUE_SIZE);
    expect(stats.overflowed).toBe(false);
  });

  test("stats updates when operations are deferred", () => {
    const queue = new OperationQueue();
    const localVersion = createVersionVector();

    const op: InsertOperation = {
      type: "insert",
      id: { replicaId: replicaId(7), counter: 1 },
      text: "X",
      after: { insertionId: { replicaId: replicaId(7), counter: 0 }, offset: 0 },
      before: { insertionId: { replicaId: replicaId(0xffffffff), counter: 0xffffffff }, offset: 0 },
      version: new Map([[replicaId(7), 1]]),
      locator: MIN_LOCATOR,
    };

    queue.enqueue(op, () => false, () => { /* no-op */ }, localVersion);

    const stats = queue.stats;
    expect(stats.pendingCount).toBe(1);
    expect(stats.deferredReplicaCount).toBe(1);
    expect(stats.deferredReplicas.has(replicaId(7))).toBe(true);
  });

  test("clear removes all pending operations and resets overflow", () => {
    const queue = new OperationQueue(2);
    const localVersion = createVersionVector();

    const makePendingOp = (counter: number): InsertOperation => ({
      type: "insert",
      id: { replicaId: replicaId(1), counter },
      text: "X",
      after: { insertionId: { replicaId: replicaId(1), counter: counter + 100 }, offset: 0 },
      before: { insertionId: { replicaId: replicaId(0xffffffff), counter: 0xffffffff }, offset: 0 },
      version: new Map([[replicaId(1), counter]]),
      locator: MIN_LOCATOR,
    });

    queue.enqueue(makePendingOp(0), () => false, () => { /* no-op */ }, localVersion);
    queue.enqueue(makePendingOp(1), () => false, () => { /* no-op */ }, localVersion);
    queue.enqueue(makePendingOp(2), () => false, () => { /* no-op */ }, localVersion); // triggers overflow
    expect(queue.pendingCount).toBe(2);
    expect(queue.overflowed).toBe(true);

    queue.clear();

    expect(queue.pendingCount).toBe(0);
    expect(queue.deferredReplicas.size).toBe(0);
    expect(queue.overflowed).toBe(false);
  });

  test("clear preserves applied set for idempotency", () => {
    const queue = new OperationQueue();
    const applied: Operation[] = [];
    const localVersion = createVersionVector();

    const op: InsertOperation = {
      type: "insert",
      id: { replicaId: replicaId(1), counter: 0 },
      text: "Applied",
      after: { insertionId: { replicaId: replicaId(0), counter: 0 }, offset: 0 },
      before: { insertionId: { replicaId: replicaId(0xffffffff), counter: 0xffffffff }, offset: 0 },
      version: new Map([[replicaId(1), 0]]),
      locator: MIN_LOCATOR,
    };

    queue.enqueue(op, () => true, (o) => applied.push(o), localVersion);
    expect(applied.length).toBe(1);

    queue.clear();

    // The same op should still be rejected as a duplicate after clear()
    const result = queue.enqueue(op, () => true, (o) => applied.push(o), localVersion);
    expect(result.accepted).toBe(false);
    expect(applied.length).toBe(1);
  });

  test("resetOverflow clears overflow flag without clearing pending ops", () => {
    const queue = new OperationQueue(1);
    const localVersion = createVersionVector();

    const op1: InsertOperation = {
      type: "insert",
      id: { replicaId: replicaId(1), counter: 1 },
      text: "A",
      after: { insertionId: { replicaId: replicaId(1), counter: 0 }, offset: 0 },
      before: { insertionId: { replicaId: replicaId(0xffffffff), counter: 0xffffffff }, offset: 0 },
      version: new Map([[replicaId(1), 1]]),
      locator: MIN_LOCATOR,
    };
    const op2: InsertOperation = {
      type: "insert",
      id: { replicaId: replicaId(1), counter: 2 },
      text: "B",
      after: { insertionId: { replicaId: replicaId(1), counter: 1 }, offset: 0 },
      before: { insertionId: { replicaId: replicaId(0xffffffff), counter: 0xffffffff }, offset: 0 },
      version: new Map([[replicaId(1), 2]]),
      locator: MIN_LOCATOR,
    };

    queue.enqueue(op1, () => false, () => { /* no-op */ }, localVersion);
    queue.enqueue(op2, () => false, () => { /* no-op */ }, localVersion); // overflow

    expect(queue.overflowed).toBe(true);
    expect(queue.pendingCount).toBe(1);

    queue.resetOverflow();

    expect(queue.overflowed).toBe(false);
    expect(queue.pendingCount).toBe(1); // pending ops remain
  });

  test("getHighestCounter returns -1 for unknown replica", () => {
    const queue = new OperationQueue();
    expect(queue.getHighestCounter(replicaId(99))).toBe(-1);
  });

  test("getHighestCounter tracks highest applied counter and never decreases", () => {
    const queue = new OperationQueue();
    const localVersion = createVersionVector();

    const op5: InsertOperation = {
      type: "insert",
      id: { replicaId: replicaId(1), counter: 5 },
      text: "A",
      after: { insertionId: { replicaId: replicaId(0), counter: 0 }, offset: 0 },
      before: { insertionId: { replicaId: replicaId(0xffffffff), counter: 0xffffffff }, offset: 0 },
      version: new Map([[replicaId(1), 5]]),
      locator: MIN_LOCATOR,
    };
    const op3: InsertOperation = {
      type: "insert",
      id: { replicaId: replicaId(1), counter: 3 },
      text: "B",
      after: { insertionId: { replicaId: replicaId(0), counter: 0 }, offset: 0 },
      before: { insertionId: { replicaId: replicaId(0xffffffff), counter: 0xffffffff }, offset: 0 },
      version: new Map([[replicaId(1), 3]]),
      locator: MIN_LOCATOR,
    };

    queue.enqueue(op5, () => true, () => { /* no-op */ }, localVersion);
    expect(queue.getHighestCounter(replicaId(1))).toBe(5);

    // Applying an earlier op should not lower the counter
    queue.enqueue(op3, () => true, () => { /* no-op */ }, localVersion);
    expect(queue.getHighestCounter(replicaId(1))).toBe(5);
  });

  test("getPending returns read-only view of deferred operations", () => {
    const queue = new OperationQueue();
    const localVersion = createVersionVector();

    expect(queue.getPending().length).toBe(0);

    const op: InsertOperation = {
      type: "insert",
      id: { replicaId: replicaId(1), counter: 1 },
      text: "Pending",
      after: { insertionId: { replicaId: replicaId(1), counter: 0 }, offset: 0 },
      before: { insertionId: { replicaId: replicaId(0xffffffff), counter: 0xffffffff }, offset: 0 },
      version: new Map([[replicaId(1), 1]]),
      locator: MIN_LOCATOR,
    };

    queue.enqueue(op, () => false, () => { /* no-op */ }, localVersion);

    const pending = queue.getPending();
    expect(pending.length).toBe(1);
    expect(pending[0]?.id.counter).toBe(1);
    expect(pending[0]?.type).toBe("insert");
  });
});

// ---------------------------------------------------------------------------
// State Sync: createSnapshot / applySnapshot
// ---------------------------------------------------------------------------

describe("createSnapshot / applySnapshot", () => {
  test("createSnapshot serializes a visible fragment into snapshot", () => {
    const rid = replicaId(1);
    const opId = { replicaId: rid, counter: 0 };
    const fragment = createFragment(opId, 0, MIN_LOCATOR, "Hello", true);
    const versionVector = new Map([[rid, 0]]);

    const snapshot = createSnapshot({
      replicaId: rid,
      versionVector,
      fragments: [fragment],
      undoCounts: [],
    });

    expect(snapshot.version).toBe(1);
    expect(snapshot.replicaId).toBe(rid);
    expect(snapshot.fragments.length).toBe(1);
    expect(snapshot.fragments[0]?.text).toBe("Hello");
    expect(snapshot.fragments[0]?.visible).toBe(true);
    expect(snapshot.fragments[0]?.length).toBe(5);
    expect(snapshot.versionVector.get(rid)).toBe(0);
    expect(snapshot.undoCounts.length).toBe(0);
  });

  test("applySnapshot reconstructs fragments from snapshot", () => {
    const rid = replicaId(1);
    const opId = { replicaId: rid, counter: 0 };
    const fragment = createFragment(opId, 0, MIN_LOCATOR, "World", true);
    const versionVector = new Map([[rid, 5]]);

    const snapshot = createSnapshot({
      replicaId: rid,
      versionVector,
      fragments: [fragment],
      undoCounts: [{ operationId: opId, count: 1 }],
    });

    const result = applySnapshot(snapshot);

    expect(result.fragments.length).toBe(1);
    expect(result.fragments[0]?.text).toBe("World");
    expect(result.fragments[0]?.visible).toBe(true);
    expect(result.versionVector.get(rid)).toBe(5);
    expect(result.undoCounts.get(`${rid}:0`)).toBe(1);
  });

  test("round-trip preserves visible and deleted fragments", () => {
    const rid1 = replicaId(1);
    const rid2 = replicaId(2);
    const opId1 = { replicaId: rid1, counter: 0 };
    const opId2 = { replicaId: rid2, counter: 0 };

    const frag1 = createFragment(opId1, 0, MIN_LOCATOR, "Hello", true);
    const frag2 = createFragment(opId2, 0, { levels: [0.5] }, " World", false, [opId1]);

    const versionVector = new Map([[rid1, 0], [rid2, 0]]);

    const snapshot = createSnapshot({
      replicaId: rid1,
      versionVector,
      fragments: [frag1, frag2],
      undoCounts: [{ operationId: opId1, count: 2 }],
    });

    const result = applySnapshot(snapshot);

    expect(result.fragments.length).toBe(2);
    expect(result.fragments[0]?.text).toBe("Hello");
    expect(result.fragments[0]?.visible).toBe(true);
    expect(result.fragments[0]?.deletions.length).toBe(0);
    expect(result.fragments[1]?.text).toBe(" World");
    expect(result.fragments[1]?.visible).toBe(false);
    expect(result.fragments[1]?.deletions.length).toBe(1);
    expect(result.versionVector.get(rid1)).toBe(0);
    expect(result.versionVector.get(rid2)).toBe(0);
    expect(result.undoCounts.get(`${rid1}:0`)).toBe(2);
  });

  test("round-trip on empty document produces empty result", () => {
    const rid = replicaId(1);

    const snapshot = createSnapshot({
      replicaId: rid,
      versionVector: createVersionVector(),
      fragments: [],
      undoCounts: [],
    });

    expect(snapshot.fragments.length).toBe(0);
    expect(snapshot.undoCounts.length).toBe(0);

    const result = applySnapshot(snapshot);
    expect(result.fragments.length).toBe(0);
    expect(result.undoCounts.size).toBe(0);
    expect(result.versionVector.size).toBe(0);
  });

  test("createSnapshot clones version vector (mutations do not affect snapshot)", () => {
    const rid = replicaId(1);
    const versionVector = new Map([[rid, 3]]);

    const snapshot = createSnapshot({
      replicaId: rid,
      versionVector,
      fragments: [],
      undoCounts: [],
    });

    // Mutate the original version vector
    versionVector.set(rid, 999);

    // Snapshot should be unaffected
    expect(snapshot.versionVector.get(rid)).toBe(3);
  });

  test("applySnapshot max-wins undo counts deduplicate by operationId", () => {
    const rid = replicaId(1);
    const opId = { replicaId: rid, counter: 0 };

    const snapshot = createSnapshot({
      replicaId: rid,
      versionVector: createVersionVector(),
      fragments: [],
      undoCounts: [
        { operationId: opId, count: 3 },
        { operationId: { replicaId: rid, counter: 1 }, count: 1 },
      ],
    });

    const result = applySnapshot(snapshot);
    expect(result.undoCounts.get(`${rid}:0`)).toBe(3);
    expect(result.undoCounts.get(`${rid}:1`)).toBe(1);
    expect(result.undoCounts.size).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Simple seeded RNG for reproducible tests. */
function mulberry32(initialSeed: number): () => number {
  let seed = initialSeed;
  return () => {
    seed = seed + 0x6d2b79f5;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
