import { mkdir } from "node:fs/promises";
import { arch, cpus, platform, release, totalmem } from "node:os";
import { join } from "node:path";
import { loadEditingTrace } from "../benchmarks/fixtures.js";
import type { LibraryResult } from "../benchmarks/lab/worker.js";

const root = join(import.meta.dir, "..");
const quick = process.argv.includes("--quick");
const selection = process.argv.find((arg) => arg.startsWith("--libraries="));
const libraries = selection?.slice("--libraries=".length).split(",") ?? [
  "run",
  "loro",
  "yjs",
  "automerge",
  "legacy",
];
const directory = quick ? join(root, ".lab-quick") : join(root, "site/public/lab");

async function git(args: string[]): Promise<string> {
  const child = Bun.spawn(["git", ...args], { cwd: root, stdout: "pipe", stderr: "pipe" });
  const output = await new Response(child.stdout).text();
  if ((await child.exited) !== 0) throw new Error(await new Response(child.stderr).text());
  return output.trim();
}

const tracked = [
  "src",
  "benchmarks/lab",
  "benchmarks/fixtures.ts",
  "scripts/measure.ts",
  "scripts/download-fixtures.ts",
  "package.json",
  "bun.lock",
];
const dirty = await git(["status", "--porcelain", "--", ...tracked]);
if (dirty !== "" && !quick)
  throw new Error("Commit the engine and benchmark sources before recording publishable results.");
const filenames = (await git(["ls-files", "--", ...tracked])).split("\n").filter(Boolean).sort();
const hasher = new Bun.CryptoHasher("sha256");
for (const path of filenames) {
  hasher.update(path);
  hasher.update("\0");
  hasher.update(await Bun.file(join(root, path)).arrayBuffer());
}
const sha = await git(["rev-parse", "HEAD"]);
const timestamp = new Date().toISOString();
const fixtureData = await loadEditingTrace();
if (fixtureData === null) throw new Error("Missing editing trace");
const cpu = cpus()[0]?.model ?? "Unknown CPU";
const hardware = `${platform()}-${arch()}-${cpu}`;
const results: LibraryResult[] = [];
const verification = Bun.spawn([process.execPath, "test", "src"], {
  cwd: root,
  stdout: "pipe",
  stderr: "pipe",
});
const [testOut, testErr, testExit] = await Promise.all([
  new Response(verification.stdout).text(),
  new Response(verification.stderr).text(),
  verification.exited,
]);
if (testExit !== 0)
  throw new Error(`Tests failed; no measurements published.\n${testOut}\n${testErr}`);
const passed = Number(/(\d+) pass/.exec(testOut + testErr)?.[1]);
if (!Number.isSafeInteger(passed) || passed < 1) throw new Error("Cannot verify test count");
console.log(`${passed} tests passed. Starting measurements.`);
for (const library of libraries) {
  console.log(`Measuring ${library} in a fresh process (sequential execution)…`);
  const args = [process.execPath, "run", "benchmarks/lab/worker.ts", library];
  if (quick) args.push("--quick");
  const child = Bun.spawn(args, { cwd: root, stdout: "pipe", stderr: "inherit" });
  const output = await new Response(child.stdout).text();
  const status = await child.exited;
  if (status !== 0) throw new Error(`${library} exited ${status}; no result will be published`);
  const result: LibraryResult = JSON.parse(output);
  if (result.id !== library || !Array.isArray(result.measurements))
    throw new Error("Invalid worker result");
  results.push(result);
}
const run = {
  schema: 1,
  id: `${timestamp.replaceAll(":", "-")}-${sha.slice(0, 7)}`,
  timestamp,
  revision: sha,
  sourceHash: hasher.digest("hex"),
  sourceDirty: dirty !== "",
  validation: { command: "bun test src", passed, failed: 0 },
  quick,
  environment: {
    hardware,
    cpu,
    platform: platform(),
    arch: arch(),
    os: release(),
    runtime: `Bun ${Bun.version}`,
    logicalCpus: cpus().length,
    totalMemory: totalmem(),
  },
  fixture: {
    sha256: new Bun.CryptoHasher("sha256")
      .update(await Bun.file(join(root, "fixtures/editing-trace.json")).arrayBuffer())
      .digest("hex"),
    operations: fixtureData.operations.length,
    finalLength: fixtureData.finalText.length,
    source: "https://github.com/automerge/automerge-perf/tree/master/edit-by-index",
  },
  methodology: {
    samples: quick ? 3 : 5,
    warmup: "One complete untimed run of each workload",
    timing:
      "Sequential isolated processes; fresh documents; materialization included; GC and validation outside timers",
    batching:
      "Full trace: one bulk transaction. Synthetic and 10K live trace: one transaction per edit.",
    scope:
      "Plain text, UTF-16 offsets. No observers, rich text, undo manager, or network transport. Native full-state formats; Yjs update V2.",
    correctness:
      "Every timed output checked against an exact string oracle; decoded text verified; two replicas must converge.",
  },
  libraries: results,
};
await mkdir(directory, { recursive: true });
await Bun.write(join(directory, `${run.id}.json`), `${JSON.stringify(run, null, 2)}\n`);
await Bun.write(join(directory, "latest.json"), `${JSON.stringify(run, null, 2)}\n`);
const indexFile = Bun.file(join(directory, "index.json"));
const previous: { id: string; timestamp: string; revision: string; hardware: string }[] =
  (await indexFile.exists()) ? await indexFile.json() : [];
const index = [
  { id: run.id, timestamp, revision: sha, hardware },
  ...previous.filter((entry) => entry.id !== run.id),
].slice(0, 100);
await Bun.write(indexFile, `${JSON.stringify(index, null, 2)}\n`);
console.log(`Recorded ${run.id} in ${directory}`);
for (const library of results) {
  const trace = library.measurements.find((measurement) => measurement.id === "trace");
  console.log(
    `${library.name}: ${trace?.status === "ok" ? `${trace.median?.toFixed(2)} ms` : trace?.detail}`,
  );
}
