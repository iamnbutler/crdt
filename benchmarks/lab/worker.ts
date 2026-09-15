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
  // The old engine's existing unit suite misses a real trace failure. Locate
  // that failure before spending minutes timing a known-invalid full replay.
  if (name === "legacy") {
    const probe = factory.create();
    let expected = "";
    let failure = 0;
    for (let i = 0; i < Math.min(workload.edits.length, 1000); i++) {
      const op = workload.edits[i];
      if (op === undefined) break;
      if (op.deleteCount) probe.delete(op.position, op.deleteCount);
      if (op.insertText) probe.insert(op.position, op.insertText);
      expected =
        expected.slice(0, op.position) +
        op.insertText +
        expected.slice(op.position + op.deleteCount);
      if (probe.text() !== expected) {
        failure = i + 1;
        break;
      }
    }
    probe.dispose();
    if (failure > 0) {
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
        detail: `First incorrect text at edit ${failure}. Timing excluded.`,
      });
      continue;
    }
  }
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
    if (name === "run") throw new Error(`RunText failed ${workload.id}`);
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
      "Encode full trace state",
      encodeSamples,
      1,
      "Retains CRDT identities and deletion state; Yjs uses compact update V2.",
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
      "Uncompressed transport bytes from each library's native format.",
      "bytes",
    ),
  );
  traceDoc.dispose();
}

// A separate two-replica merge: shared base, independent appended text, a
// concurrent deletion, then exchange full snapshots. No equality assumptions
// between distinct CRDT algorithms; each library must converge with itself.
if (name !== "legacy") {
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
