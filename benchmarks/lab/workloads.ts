import type { EditOperation, EditingTrace } from "../fixtures.js";

export interface Workload {
  id: string;
  label: string;
  edits: EditOperation[];
  expected: string;
  batched: boolean;
}

export function oracle(edits: readonly EditOperation[]): string {
  let text = "";
  for (const edit of edits) {
    if (edit.position < 0 || edit.position + edit.deleteCount > text.length) {
      throw new Error("Invalid workload offset");
    }
    text =
      text.slice(0, edit.position) + edit.insertText + text.slice(edit.position + edit.deleteCount);
  }
  return text;
}

export function workloads(trace: EditingTrace, quick: boolean): Workload[] {
  const count = quick ? 1000 : 10_000;
  const result: Workload[] = [];
  for (const kind of ["append", "prepend", "random"]) {
    const edits: EditOperation[] = [];
    let length = 0;
    let seed = 123456789;
    for (let i = 0; i < count; i++) {
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      const position =
        kind === "append" ? length : kind === "prepend" ? 0 : (seed >>> 0) % (length + 1);
      const remove = kind === "random" && i % 4 === 0 && position < length;
      edits.push({
        position,
        deleteCount: remove ? 1 : 0,
        insertText: remove ? "" : String.fromCharCode(97 + (i % 26)),
      });
      length += remove ? -1 : 1;
    }
    result.push({
      id: kind,
      label: `${kind === "random" ? "Random edits" : kind === "append" ? "Append" : "Prepend"} · ${count.toLocaleString()}`,
      edits,
      expected: oracle(edits),
      batched: false,
    });
  }
  const replay = quick ? trace.operations.slice(0, 10_000) : trace.operations;
  result.unshift({
    id: "trace",
    label: `Editing trace · ${replay.length.toLocaleString()}`,
    edits: replay,
    expected: quick ? oracle(replay) : trace.finalText,
    batched: true,
  });
  const live = trace.operations.slice(0, quick ? 1000 : 10_000);
  result.push({
    id: "live",
    label: `Individual edits · ${live.length.toLocaleString()}`,
    edits: live,
    expected: oracle(live),
    batched: false,
  });
  return result;
}
