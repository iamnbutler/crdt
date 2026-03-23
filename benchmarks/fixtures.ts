import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const FIXTURES_DIR = join(import.meta.dir, "..", "fixtures");
const EDITING_TRACE_PATH = join(FIXTURES_DIR, "editing-trace.json");

export interface EditOperation {
  position: number;
  deleteCount: number;
  insertText: string;
}

export interface EditingTrace {
  operations: EditOperation[];
  finalText: string;
}

export async function loadEditingTrace(): Promise<EditingTrace | null> {
  if (!existsSync(EDITING_TRACE_PATH)) {
    console.warn("Editing trace not found. Run `bun run fixtures:download` to fetch it.");
    return null;
  }

  const content = await readFile(EDITING_TRACE_PATH, "utf-8");
  return JSON.parse(content) as EditingTrace;
}

export function getEditingTracePath(): string {
  return EDITING_TRACE_PATH;
}
