/**
 * Benchmarks for protocol serialization/deserialization.
 *
 * Target: <50ms for 1M-line document serialization.
 */

import { bench, group, run, summary } from "mitata";
import {
  BinaryReader,
  BinaryWriter,
  deserializeOperations,
  deserializeSnapshot,
  serializeOperations,
  serializeSnapshot,
} from "../src/protocol/serialization.js";
import type { SerializedFragment, StateSnapshot } from "../src/protocol/types.js";
import { MIN_LOCATOR } from "../src/text/locator.js";
import { replicaId } from "../src/text/types.js";
import type { InsertOperation, Operation } from "../src/text/types.js";

const isCI = process.argv.includes("--ci");

console.log("Preparing benchmark data...\n");

// Generate synthetic operations
function generateInsertOp(index: number): InsertOperation {
  return {
    type: "insert",
    id: { replicaId: replicaId(1), counter: index },
    text: `Line ${index}: This is some sample text content for benchmarking.\n`,
    after: { insertionId: { replicaId: replicaId(0), counter: 0 }, offset: 0 },
    before: { insertionId: { replicaId: replicaId(0xffffffff), counter: 0xffffffff }, offset: 0 },
    version: new Map([[replicaId(1), index]]),
    locator: MIN_LOCATOR,
  };
}

// Pre-generate operations for benchmarks
const ops1K: Operation[] = Array.from({ length: 1000 }, (_, i) => generateInsertOp(i));
const ops10K: Operation[] = Array.from({ length: 10000 }, (_, i) => generateInsertOp(i));
const ops100K: Operation[] = Array.from({ length: 100000 }, (_, i) => generateInsertOp(i));

// Pre-serialize for deserialization benchmarks
const serializedOps1K = serializeOperations(ops1K);
const serializedOps10K = serializeOperations(ops10K);
const serializedOps100K = serializeOperations(ops100K);

console.log(`Prepared operation batches:
  1K ops: ${(serializedOps1K.byteLength / 1024).toFixed(2)} KB
  10K ops: ${(serializedOps10K.byteLength / 1024).toFixed(2)} KB
  100K ops: ${(serializedOps100K.byteLength / 1024 / 1024).toFixed(2)} MB
`);

// Generate synthetic snapshots
function generateSnapshot(lineCount: number): StateSnapshot {
  const fragments: SerializedFragment[] = [];
  for (let i = 0; i < lineCount; i++) {
    fragments.push({
      insertionId: { replicaId: replicaId(1), counter: i },
      insertionOffset: 0,
      locatorLevels: [i / lineCount],
      baseLocatorLevels: [i / lineCount],
      length: 60,
      visible: true,
      deletions: [],
      text: `Line ${i}: This is some sample text content for benchmarking.\n`,
    });
  }
  return {
    version: 1,
    replicaId: replicaId(1),
    versionVector: new Map([[replicaId(1), lineCount - 1]]),
    fragments,
    undoCounts: [],
  };
}

const snapshot1K = generateSnapshot(1000);
const snapshot10K = generateSnapshot(10000);
const snapshot100K = generateSnapshot(100000);
const snapshot1M = generateSnapshot(1000000);

// Pre-serialize for deserialization benchmarks
const serializedSnapshot1K = serializeSnapshot(snapshot1K);
const serializedSnapshot10K = serializeSnapshot(snapshot10K);
const serializedSnapshot100K = serializeSnapshot(snapshot100K);

console.log(`Prepared snapshots:
  1K lines: ${(serializedSnapshot1K.byteLength / 1024).toFixed(2)} KB
  10K lines: ${(serializedSnapshot10K.byteLength / 1024).toFixed(2)} KB
  100K lines: ${(serializedSnapshot100K.byteLength / 1024 / 1024).toFixed(2)} MB
`);

// ---------------------------------------------------------------------------
// Benchmarks
// ---------------------------------------------------------------------------

summary(() => {
  bench("noop", () => {
    // baseline
  });
});

// Binary writer/reader micro-benchmarks
group("binary-writer", () => {
  bench("write 10K varints", () => {
    const writer = new BinaryWriter(64 * 1024);
    for (let i = 0; i < 10000; i++) {
      writer.writeVarUint(i);
    }
    return writer.finish();
  });

  bench("write 10K strings", () => {
    const writer = new BinaryWriter(512 * 1024);
    for (let i = 0; i < 10000; i++) {
      writer.writeString(`Line ${i}: sample text`);
    }
    return writer.finish();
  });
});

group("binary-reader", () => {
  const varintData = (() => {
    const writer = new BinaryWriter();
    for (let i = 0; i < 10000; i++) {
      writer.writeVarUint(i);
    }
    return writer.finish();
  })();

  const stringData = (() => {
    const writer = new BinaryWriter();
    for (let i = 0; i < 10000; i++) {
      writer.writeString(`Line ${i}: sample text`);
    }
    return writer.finish();
  })();

  bench("read 10K varints", () => {
    const reader = new BinaryReader(varintData);
    let sum = 0;
    for (let i = 0; i < 10000; i++) {
      sum += reader.readVarUint();
    }
    return sum;
  });

  bench("read 10K strings", () => {
    const reader = new BinaryReader(stringData);
    let len = 0;
    for (let i = 0; i < 10000; i++) {
      len += reader.readString().length;
    }
    return len;
  });
});

// Operation serialization
group("operation-serialization", () => {
  bench("serialize 1K ops", () => {
    return serializeOperations(ops1K);
  });

  bench("serialize 10K ops", () => {
    return serializeOperations(ops10K);
  });

  bench("serialize 100K ops", () => {
    return serializeOperations(ops100K);
  });
});

group("operation-deserialization", () => {
  bench("deserialize 1K ops", () => {
    return deserializeOperations(serializedOps1K);
  });

  bench("deserialize 10K ops", () => {
    return deserializeOperations(serializedOps10K);
  });

  bench("deserialize 100K ops", () => {
    return deserializeOperations(serializedOps100K);
  });
});

// Snapshot serialization (the main target: <50ms for 1M lines)
group("snapshot-serialization", () => {
  bench("serialize 1K-line snapshot", () => {
    return serializeSnapshot(snapshot1K);
  });

  bench("serialize 10K-line snapshot", () => {
    return serializeSnapshot(snapshot10K);
  });

  bench("serialize 100K-line snapshot", () => {
    return serializeSnapshot(snapshot100K);
  });

  // Target: <50ms
  bench("serialize 1M-line snapshot", () => {
    return serializeSnapshot(snapshot1M);
  });
});

group("snapshot-deserialization", () => {
  bench("deserialize 1K-line snapshot", () => {
    return deserializeSnapshot(serializedSnapshot1K);
  });

  bench("deserialize 10K-line snapshot", () => {
    return deserializeSnapshot(serializedSnapshot10K);
  });

  bench("deserialize 100K-line snapshot", () => {
    return deserializeSnapshot(serializedSnapshot100K);
  });
});

// Round-trip benchmarks
group("round-trip", () => {
  bench("serialize+deserialize 10K ops", () => {
    const bytes = serializeOperations(ops10K);
    return deserializeOperations(bytes);
  });

  bench("serialize+deserialize 10K-line snapshot", () => {
    const bytes = serializeSnapshot(snapshot10K);
    return deserializeSnapshot(bytes);
  });
});

// Run benchmarks
console.log("\nRunning benchmarks...\n");
await run({
  format: isCI ? "json" : "mitata",
});

// Print summary with target check
if (!isCI) {
  console.log("\n--- Target Check ---");
  const start = performance.now();
  const serialized1M = serializeSnapshot(snapshot1M);
  const serializeTime = performance.now() - start;

  const deserializeStart = performance.now();
  deserializeSnapshot(serialized1M);
  const deserializeTime = performance.now() - deserializeStart;

  console.log(`1M-line snapshot serialization: ${serializeTime.toFixed(2)}ms (target: <50ms)`);
  console.log(`1M-line snapshot deserialization: ${deserializeTime.toFixed(2)}ms`);
  console.log(`Total round-trip: ${(serializeTime + deserializeTime).toFixed(2)}ms`);
  console.log(`Serialized size: ${(serialized1M.byteLength / 1024 / 1024).toFixed(2)} MB`);

  if (serializeTime < 50) {
    console.log("\n\u2713 Target met: serialize 1M lines in <50ms");
  } else {
    console.log(`\n\u2717 Target NOT met: serialize 1M lines took ${serializeTime.toFixed(2)}ms`);
  }
}
