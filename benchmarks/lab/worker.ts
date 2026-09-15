import { loadEditingTrace } from "../fixtures.js";
import { type Editor, adapter } from "./adapters.js";
import { type Workload, oracle, workloads } from "./workloads.js";

export interface Measurement {
  id: string;
  label: string;
  unit: "ms" | "bytes";
  operations: number;
  status: "ok" | "incorrect" | "unavailable";
  samples: number[];
  median: number | null;
  min: number | null;
  max: number | null;
  detail: string;
}

export interface LibraryResult {
  id: string;
  name: string;
  version: string;
  measurements: Measurement[];
}

const name = process.argv[2] ?? "run";
const quick = process.argv.includes("--quick");
const factory = await adapter(name);
const trace = await loadEditingTrace();
if (!trace) throw new Error("Missing trace; run bun run fixtures:download");
if (oracle(trace.operations) !== trace.finalText) throw new Error("Invalid editing trace fixture");
const cases = workloads(trace, quick);
const result: LibraryResult = {
  id: name,
  name: factory.name,
  version: factory.version,
  measurements: [],
};
const sampleCount = quick ? 3 : 5;

function summarize(
  id: string,
  label: string,
  samples: number[],
  operations: number,
  detail: string,
  unit: "ms" | "bytes" = "ms",
): Measurement {
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    id,
    label,
    unit,
    operations,
    status: "ok",
    samples,
    median: sorted[Math.floor(sorted.length / 2)] ?? null,
    min: sorted[0] ?? null,
    max: sorted[sorted.length - 1] ?? null,
    detail,
  };
}

function replay(doc: Editor, workload: Workload): void {
  const edit = (): void => {
    for (const op of workload.edits) {
      if (op.deleteCount) doc.delete(op.position, op.deleteCount);
      if (op.insertText) doc.insert(op.position, op.insertText);
    }
  };
  if (workload.batched) doc.batch(edit);
  else edit();
}

let traceDoc: Editor | null = null;
let traceExpected = "";
for (const workload of cases) {
  // One complete untimed warmup per workload. Every timed iteration uses a new
  // document; final text materialization is inside the timer, validation outside.
  const warmup = factory.create();
  replay(warmup, workload);
  if (warmup.text() !== workload.expected) {
    warmup.dispose();
    result.measurements.push({
      id: workload.id,
      label: workload.label,
      unit: "ms",
      operations: workload.edits.length,
      status: "incorrect",
      samples: [],
      median: null,
      min: null,
      max: null,
      detail: "Final text differs from the string oracle. Timing excluded.",
    });
    if (name === "run") throw new Error(`${factory.name} failed ${workload.id}`);
    continue;
  }
  warmup.dispose();
  const samples: number[] = [];
  for (let iteration = 0; iteration < sampleCount; iteration++) {
    Bun.gc(true);
    const start = performance.now();
    const doc = factory.create();
    replay(doc, workload);
    const actual = doc.text();
    const elapsed = performance.now() - start;
    if (actual !== workload.expected)
      throw new Error(`${factory.name}: invalid timed ${workload.id}`);
    samples.push(elapsed);
    if (workload.id === "trace" && iteration === sampleCount - 1) {
      traceDoc = doc;
      traceExpected = workload.expected;
    } else doc.dispose();
    console.error(
      `${factory.name} ${workload.id} ${iteration + 1}/${sampleCount}: ${elapsed.toFixed(2)} ms`,
    );
  }
  result.measurements.push(
    summarize(
      workload.id,
      workload.label,
      samples,
      workload.edits.length,
      workload.batched
        ? "One transaction for bulk replay; commit and final text included."
        : "Each edit commits individually; final text included.",
    ),
  );
}

if (traceDoc !== null) {
  const state = traceDoc.encode();
  const probe = factory.decode(state);
  if (probe.text() !== traceExpected) throw new Error(`${factory.name}: invalid persisted state`);
  probe.dispose();
  const encodeSamples: number[] = [];
  const decodeSamples: number[] = [];
  for (let i = 0; i < sampleCount; i++) {
    Bun.gc(true);
    let start = performance.now();
    const encoded = traceDoc.encode();
    encodeSamples.push(performance.now() - start);
    if (encoded.length === 0) throw new Error("Empty snapshot");
    start = performance.now();
    const doc = factory.decode(state);
    const actual = doc.text();
    decodeSamples.push(performance.now() - start);
    if (actual !== traceExpected) throw new Error("Invalid decoded text");
    doc.dispose();
  }
  result.measurements.push(
    summarize(
      "encode",
      "Encode unchanged state",
      encodeSamples,
      1,
      "Repeated encoding of an unchanged trace state after warmup. Native caches are allowed; Yjs uses update V2.",
    ),
  );
  result.measurements.push(
    summarize(
      "decode",
      "Load full trace state",
      decodeSamples,
      1,
      "Create a usable replica from encoded state and materialize its text.",
    ),
  );
  result.measurements.push(
    summarize(
      "size",
      "Full trace state size",
      [state.length],
      1,
      "Native saved-state bytes; no additional transport compression.",
      "bytes",
    ),
  );
  const changedSamples: number[] = [];
  for (let i = -1; i < sampleCount; i++) {
    const doc = factory.decode(state);
    const length = doc.length;
    doc.insert(length, "x");
    doc.delete(length, 1);
    Bun.gc(true);
    const start = performance.now();
    const encoded = doc.encode();
    const elapsed = performance.now() - start;
    const restored = factory.decode(encoded);
    if (restored.text() !== traceExpected) throw new Error("Invalid changed-state snapshot");
    if (i >= 0) changedSamples.push(elapsed);
    restored.dispose();
    doc.dispose();
  }
  result.measurements.push(
    summarize(
      "encode-changed",
      "Encode after editing",
      changedSamples,
      2,
      "First encoding after appending and deleting one character in a fresh trace replica. Setup and validation excluded.",
    ),
  );
  traceDoc.dispose();
}

// A separate two-replica merge: shared base, independent appended text, a
// concurrent deletion, then exchange full snapshots. No equality assumptions
// between distinct CRDT algorithms; each library must converge with itself.
{
  const mergeSamples: number[] = [];
  const count = quick ? 1000 : 5000;
  for (let i = -1; i < sampleCount; i++) {
    const a = factory.create();
    a.insert(0, "base");
    const b = factory.decode(a.encode());
    a.batch(() => {
      a.delete(0, 1);
      for (let j = 0; j < count; j++) a.insert(3 + j, "a");
    });
    b.batch(() => {
      for (let j = 0; j < count; j++) b.insert(4 + j, "b");
    });
    const fromA = a.encode();
    const fromB = b.encode();
    Bun.gc(true);
    const start = performance.now();
    a.merge(fromB);
    b.merge(fromA);
    const textA = a.text();
    const textB = b.text();
    const elapsed = performance.now() - start;
    if (textA !== textB || textA.length !== count * 2 + 3 || !textA.startsWith("ase")) {
      throw new Error(`${factory.name}: replicas did not converge`);
    }
    if (i >= 0) mergeSamples.push(elapsed);
    a.dispose();
    b.dispose();
  }
  result.measurements.push(
    summarize(
      "merge",
      `Merge two ${count.toLocaleString()}-edit peers`,
      mergeSamples,
      count * 2,
      "Both imports and final texts timed. Shared-base setup, local edits, and encoding excluded.",
    ),
  );
}

console.log(JSON.stringify(result));
