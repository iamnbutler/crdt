import { existsSync, mkdirSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const FIXTURES_DIR = join(import.meta.dir, "..", "fixtures");
const EDITING_TRACE_PATH = join(FIXTURES_DIR, "editing-trace.json");

// Kleppmann's editing trace - 260K operations from real editing sessions
// Source: https://github.com/automerge/automerge-perf
// The file is a JavaScript module with `const edits = [...]` and `const finalText = "..."` format
const EDITING_TRACE_URL =
  "https://raw.githubusercontent.com/automerge/automerge-perf/master/edit-by-index/editing-trace.js";

interface EditOperation {
  position: number;
  deleteCount: number;
  insertText: string;
}

interface EditingTrace {
  operations: EditOperation[];
  finalText: string;
}

// Parse the JavaScript file which has format:
// const edits = [[pos, del, text], ...]  (text may be omitted for delete-only)
// const finalText = "..."
function parseEditingTraceJs(content: string): EditingTrace {
  // Use Function constructor to safely evaluate the JS and extract the values
  // The file exports: const edits = [...]; const finalText = "..."; module.exports = { edits, finalText }
  // We can extract by creating a mock module object and evaluating

  // Extract edits array - match from "const edits = [" to the next "const" or "if"
  const editsMatch = content.match(/const\s+edits\s*=\s*\[([\s\S]*?)\];/);
  if (!editsMatch) {
    throw new Error("Could not parse editing-trace.js: expected 'const edits = [...]' format");
  }

  // Extract finalText
  const finalTextMatch = content.match(/const\s+finalText\s*=\s*"((?:[^"\\]|\\.)*)"/);
  if (!finalTextMatch) {
    throw new Error(
      "Could not parse editing-trace.js: expected 'const finalText = \"...\"' format",
    );
  }

  // Parse edits array manually - each line is [pos, del] or [pos, del, "text"]
  const editsContent = editsMatch[1];
  if (editsContent === undefined) {
    throw new Error("Could not extract edits content from editing-trace.js");
  }
  const operations: EditOperation[] = [];

  // Match each array entry: [num, num] or [num, num, "string"]
  const entryRegex = /\[(\d+),\s*(\d+)(?:,\s*"((?:[^"\\]|\\.)*)")?\]/g;
  let match: RegExpExecArray | null = entryRegex.exec(editsContent);
  while (match !== null) {
    const posStr = match[1];
    const delStr = match[2];
    if (posStr !== undefined && delStr !== undefined) {
      const position = Number.parseInt(posStr, 10);
      const deleteCount = Number.parseInt(delStr, 10);
      const insertText = match[3] !== undefined ? JSON.parse(`"${match[3]}"`) : "";
      operations.push({ position, deleteCount, insertText });
    }
    match = entryRegex.exec(editsContent);
  }

  // Unescape the finalText
  const finalTextRaw = finalTextMatch[1];
  if (finalTextRaw === undefined) {
    throw new Error("Could not extract finalText from editing-trace.js");
  }
  const finalText = JSON.parse(`"${finalTextRaw}"`) as string;

  return { operations, finalText };
}

async function downloadAndConvert(url: string, dest: string): Promise<void> {
  console.log(`Downloading ${url}...`);

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download: ${response.status} ${response.statusText}`);
  }

  const jsContent = await response.text();
  console.log("Parsing and converting to JSON...");

  const trace = parseEditingTraceJs(jsContent);
  console.log(`Parsed ${trace.operations.length} operations`);

  const dir = dirname(dest);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  await writeFile(dest, JSON.stringify(trace));
  console.log(`Saved to ${dest}`);
}

async function main(): Promise<void> {
  if (existsSync(EDITING_TRACE_PATH)) {
    console.log("Editing trace already exists, skipping download.");
    console.log(`Delete ${EDITING_TRACE_PATH} to re-download.`);
    return;
  }

  await downloadAndConvert(EDITING_TRACE_URL, EDITING_TRACE_PATH);
  console.log("Done!");
}

main().catch((err: unknown) => {
  console.error("Error:", err);
  process.exit(1);
});
