// Summary and dimension implementations for rope text chunks

import type { TextSummary } from "../sum-tree/index.js";
import type { TextChunk } from "./types.js";

// Re-export the summary and dimension implementations from sum-tree.
// The SumTree already provides the correct TextSummary monoid and all
// dimension types needed for rope operations.
export {
  textSummaryOps,
  lineDimension,
  utf16Dimension,
  byteDimension,
  pointDimension,
} from "../sum-tree/index.js";

export type { TextSummary, Point } from "../sum-tree/index.js";

/**
 * Module-level TextEncoder singleton to avoid per-call allocation.
 */
const textEncoder = new TextEncoder();

/**
 * Compute the byte length of a string (UTF-8 encoded).
 */
export function byteLength(str: string): number {
  return textEncoder.encode(str).byteLength;
}

/**
 * Compute the TextSummary for a given string.
 */
export function computeTextSummary(text: string): TextSummary {
  let lines = 0;
  let lastLineStart = 0;

  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 0x0a) {
      // '\n'
      lines++;
      lastLineStart = i + 1;
    }
  }

  const lastLineText = text.slice(lastLineStart);

  return {
    lines,
    utf16Len: text.length,
    bytes: byteLength(text),
    lastLineLen: lastLineText.length,
    lastLineBytes: byteLength(lastLineText),
  };
}

/**
 * Create a TextChunk from a string. The chunk precomputes its summary.
 */
export function createTextChunk(text: string): TextChunk {
  const s = computeTextSummary(text);
  return {
    text,
    summary() {
      return s;
    },
  };
}
