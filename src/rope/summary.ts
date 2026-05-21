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
 *
 * Single-pass scan: counts newlines, finds the last-line start, and detects
 * whether the string is pure ASCII. When ASCII, UTF-8 byte counts equal UTF-16
 * lengths and no TextEncoder.encode pass is needed. When the text has no
 * newline, lastLine metrics equal the whole-string metrics — no second encode.
 */
export function computeTextSummary(text: string): TextSummary {
  const utf16Len = text.length;
  let lines = 0;
  let lastLineStart = 0;
  let isAscii = true;

  for (let i = 0; i < utf16Len; i++) {
    const code = text.charCodeAt(i);
    if (code === 0x0a) {
      lines++;
      lastLineStart = i + 1;
    } else if (code > 0x7f) {
      isAscii = false;
    }
  }

  if (isAscii) {
    // ASCII: 1 char === 1 UTF-8 byte. No encoder calls needed.
    const lastLineLen = utf16Len - lastLineStart;
    return {
      lines,
      utf16Len,
      bytes: utf16Len,
      lastLineLen,
      lastLineBytes: lastLineLen,
    };
  }

  const bytes = textEncoder.encode(text).byteLength;
  if (lastLineStart === 0) {
    // No newline: lastLine metrics are the whole-string metrics. Avoid the
    // second encode of an identical slice.
    return { lines, utf16Len, bytes, lastLineLen: utf16Len, lastLineBytes: bytes };
  }

  const lastLineText = text.slice(lastLineStart);
  return {
    lines,
    utf16Len,
    bytes,
    lastLineLen: lastLineText.length,
    lastLineBytes: textEncoder.encode(lastLineText).byteLength,
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
