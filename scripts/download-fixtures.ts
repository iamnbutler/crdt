import { existsSync, mkdirSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const FIXTURES_DIR = join(import.meta.dir, "..", "fixtures");
const EDITING_TRACE_PATH = join(FIXTURES_DIR, "editing-trace.json");

// Kleppmann's editing trace - 260K operations from real editing sessions
// Source: https://github.com/automerge/automerge-perf
const EDITING_TRACE_URL =
  "https://raw.githubusercontent.com/automerge/automerge-perf/master/edit-by-index/sequential_traces/editing-trace.json";

async function downloadFile(url: string, dest: string): Promise<void> {
  console.log(`Downloading ${url}...`);

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download: ${response.status} ${response.statusText}`);
  }

  const content = await response.text();

  const dir = dirname(dest);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  await writeFile(dest, content);
  console.log(`Saved to ${dest}`);
}

async function main(): Promise<void> {
  if (existsSync(EDITING_TRACE_PATH)) {
    console.log("Editing trace already exists, skipping download.");
    console.log(`Delete ${EDITING_TRACE_PATH} to re-download.`);
    return;
  }

  await downloadFile(EDITING_TRACE_URL, EDITING_TRACE_PATH);
  console.log("Done!");
}

main().catch((err: unknown) => {
  console.error("Error:", err);
  process.exit(1);
});
