// Rope: text storage as SumTree<TextChunk>
// Provides O(log n) insert, delete, offset<->line/col conversions

import { SumTree, type TextSummary } from "../sum-tree/index.js";
import { createTextChunk, lineDimension, textSummaryOps, utf16Dimension } from "./summary.js";
import { CHUNK_TARGET, type TextChunk } from "./types.js";

/**
 * Normalize line endings: replace \r\n and lone \r with \n.
 */
function normalizeLineEndings(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

/**
 * Check if a code unit is a high surrogate (0xD800..0xDBFF).
 */
function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

/**
 * Find a safe split point at or before `pos` that doesn't break a surrogate pair.
 * If pos falls between a high and low surrogate, back up by one.
 */
function safeSplitPoint(text: string, pos: number): number {
  if (pos <= 0) return 0;
  if (pos >= text.length) return text.length;

  // If the character just before the split is a high surrogate,
  // we'd be splitting between high and low surrogate — back up.
  const codeBefore = text.charCodeAt(pos - 1);
  if (isHighSurrogate(codeBefore)) {
    return pos - 1;
  }

  return pos;
}

/**
 * Split a string into chunks of approximately CHUNK_TARGET size,
 * respecting surrogate pair boundaries.
 */
function chunkText(text: string): TextChunk[] {
  if (text.length === 0) {
    return [];
  }

  if (text.length <= CHUNK_TARGET) {
    return [createTextChunk(text)];
  }

  const chunks: TextChunk[] = [];
  let offset = 0;

  while (offset < text.length) {
    let end = Math.min(offset + CHUNK_TARGET, text.length);
    end = safeSplitPoint(text, end);

    // Avoid creating a tiny trailing chunk — merge into previous
    if (text.length - end > 0 && text.length - end < Math.floor(CHUNK_TARGET / 4)) {
      end = text.length;
    }

    chunks.push(createTextChunk(text.slice(offset, end)));
    offset = end;
  }

  return chunks;
}

/**
 * Rope: an immutable text storage structure backed by SumTree<TextChunk>.
 *
 * All mutation methods return a new Rope (structural sharing via path copying).
 * Provides O(log n) positional operations (insert, delete, offset<->line/col).
 */
export class Rope {
  private readonly tree: SumTree<TextChunk, TextSummary>;

  private constructor(tree: SumTree<TextChunk, TextSummary>) {
    this.tree = tree;
  }

  /**
   * Create an empty Rope.
   */
  static empty(): Rope {
    return new Rope(new SumTree<TextChunk, TextSummary>(textSummaryOps));
  }

  /**
   * Create a Rope from a string.
   * Normalizes CRLF and CR to LF. Splits into chunks of ~CHUNK_TARGET size.
   */
  static from(text: string): Rope {
    const normalized = normalizeLineEndings(text);
    if (normalized.length === 0) {
      return Rope.empty();
    }

    const chunks = chunkText(normalized);
    const tree = SumTree.fromItems(chunks, textSummaryOps);
    return new Rope(tree);
  }

  /**
   * Insert text at the given UTF-16 offset. Returns a new Rope.
   *
   * TODO: The SumTree's slice()/concat() currently collect all items into arrays (O(n)),
   * so true O(log n) tree surgery requires SumTree-level improvements (node-level split
   * and merge without materializing items). For now we rebuild from the spliced string,
   * which is O(n) but correct.
   */
  insert(offset: number, text: string): Rope {
    if (text.length === 0) return this;

    const normalized = normalizeLineEndings(text);
    const len = this.length;

    // Clamp offset
    const insertOffset = Math.max(0, Math.min(offset, len));

    // Reconstruct from the modified string.
    const current = this.getText();
    const newText = current.slice(0, insertOffset) + normalized + current.slice(insertOffset);
    return Rope.from(newText);
  }

  /**
   * Delete text in range [start, end). Returns a new Rope.
   *
   * TODO: Same as insert() — true O(log n) tree surgery requires SumTree-level
   * split/concat that operates on nodes rather than materializing item arrays.
   */
  delete(start: number, end: number): Rope {
    const len = this.length;
    const s = Math.max(0, Math.min(start, len));
    const e = Math.max(s, Math.min(end, len));

    if (s === e) return this;

    const current = this.getText();
    const newText = current.slice(0, s) + current.slice(e);
    return Rope.from(newText);
  }

  /**
   * Convert a line number (0-based) to the UTF-16 offset of the start of that line.
   * O(log n) via SumTree cursor seek by line dimension, then O(CHUNK_SIZE) local scan.
   */
  lineToOffset(line: number): number {
    if (line <= 0) return 0;

    const totalLines = this.lineCount;
    // Line number beyond last line returns length
    if (line >= totalLines) return this.length;

    // Seek to the chunk containing the target line boundary.
    // seekForward(line, "left") lands on the chunk whose accumulated
    // line count first reaches or exceeds `line`.
    const cursor = this.tree.cursor(lineDimension);
    cursor.seekForward(line, "left");

    const chunk = cursor.item();
    if (chunk === undefined) {
      return this.length;
    }

    // cursor.position = accumulated lines BEFORE the current item.
    // suffix() includes the current chunk and everything after, so:
    //   prefixUtf16 = total.utf16Len - suffix.utf16Len
    const suffixSummary = cursor.suffix();
    const prefixUtf16 = this.tree.summary().utf16Len - suffixSummary.utf16Len;
    const prefixLines = cursor.position;

    // Within this chunk, find where the (line - prefixLines)-th newline is.
    const linesNeeded = line - prefixLines;
    let linesFound = 0;
    const chunkStr = chunk.text;

    for (let i = 0; i < chunkStr.length; i++) {
      if (chunkStr.charCodeAt(i) === 0x0a) {
        linesFound++;
        if (linesFound === linesNeeded) {
          return prefixUtf16 + i + 1;
        }
      }
    }

    // Should not reach here for valid input, but fall back to end of chunk
    return prefixUtf16 + chunkStr.length;
  }

  /**
   * Convert a UTF-16 offset to {line, col} (both 0-based).
   * O(log n) via SumTree cursor seek by utf16 dimension, then O(CHUNK_SIZE) local scan.
   */
  offsetToLineCol(offset: number): { line: number; col: number } {
    const len = this.length;
    const clampedOffset = Math.max(0, Math.min(offset, len));

    if (clampedOffset === 0) {
      return { line: 0, col: 0 };
    }

    // Seek to the chunk containing the target utf16 offset.
    const cursor = this.tree.cursor(utf16Dimension);
    cursor.seekForward(clampedOffset, "left");

    const chunk = cursor.item();
    if (chunk === undefined) {
      // Offset is at the very end
      const total = this.tree.summary();
      return { line: total.lines, col: total.lastLineLen };
    }

    // cursor.position = accumulated utf16 of all items BEFORE the current item.
    // suffix() includes the current chunk and everything after.
    const suffixSummary = cursor.suffix();
    const totalSummary = this.tree.summary();
    const prefixLines = totalSummary.lines - suffixSummary.lines;
    const prefixUtf16 = cursor.position;

    // Offset within the current chunk
    const offsetInChunk = clampedOffset - prefixUtf16;
    const chunkStr = chunk.text;

    // Scan within the chunk to count newlines before the target offset.
    let line = prefixLines;
    let lastNewlineInChunk = -1;

    for (let i = 0; i < offsetInChunk; i++) {
      if (chunkStr.charCodeAt(i) === 0x0a) {
        line++;
        lastNewlineInChunk = i;
      }
    }

    // Compute column. If a newline was found in this chunk before our offset,
    // the column is relative to that newline. Otherwise, the current line started
    // in a previous chunk and we use lineToOffset (also O(log n)) to find it.
    let col: number;
    if (lastNewlineInChunk >= 0) {
      col = offsetInChunk - (lastNewlineInChunk + 1);
    } else {
      // No newline in this chunk before the offset. The line started earlier.
      const lineStartOffset = this.lineToOffset(line);
      col = clampedOffset - lineStartOffset;
    }

    return { line, col };
  }

  /**
   * Get the full text of the rope (or a slice).
   */
  getText(start?: number, end?: number): string {
    const parts: string[] = [];
    const items = this.tree.toArray();
    for (const chunk of items) {
      parts.push(chunk.text);
    }
    const full = parts.join("");

    if (start !== undefined || end !== undefined) {
      const s = start ?? 0;
      const e = end ?? full.length;
      return full.slice(s, e);
    }
    return full;
  }

  /**
   * Get a single line by line number (0-based). Does not include the trailing newline.
   */
  getLine(line: number): string {
    if (line < 0 || line >= this.lineCount) {
      return "";
    }

    const start = this.lineToOffset(line);
    const nextLineStart = line + 1 < this.lineCount ? this.lineToOffset(line + 1) : this.length;

    let lineText = this.getText(start, nextLineStart);

    // Strip trailing newline if present
    if (lineText.endsWith("\n")) {
      lineText = lineText.slice(0, -1);
    }

    return lineText;
  }

  /**
   * Number of lines in the rope.
   * A document with N newlines has N+1 lines.
   */
  get lineCount(): number {
    const summary = this.tree.summary();
    return summary.lines + 1;
  }

  /**
   * Total UTF-16 length of the rope.
   */
  get length(): number {
    return this.tree.summary().utf16Len;
  }

  /**
   * Iterate over lines in a range [startLine, endLine).
   * Both parameters are 0-based. If omitted, iterates all lines.
   */
  *lines(startLine?: number, endLine?: number): IterableIterator<string> {
    const start = startLine ?? 0;
    const end = endLine ?? this.lineCount;
    const clamped = Math.min(end, this.lineCount);

    for (let i = start; i < clamped; i++) {
      yield this.getLine(i);
    }
  }

  /**
   * Iterate over raw text chunks in a UTF-16 offset range [start, end).
   * If omitted, iterates all chunks.
   */
  *chunks(start?: number, end?: number): IterableIterator<string> {
    const s = start ?? 0;
    const e = end ?? this.length;

    let offset = 0;
    for (const chunkText of this.chunksIter()) {
      const chunkStart = offset;
      const chunkEnd = offset + chunkText.length;

      if (chunkEnd <= s) {
        offset = chunkEnd;
        continue;
      }
      if (chunkStart >= e) {
        break;
      }

      const sliceStart = Math.max(0, s - chunkStart);
      const sliceEnd = Math.min(chunkText.length, e - chunkStart);
      yield chunkText.slice(sliceStart, sliceEnd);

      offset = chunkEnd;
    }
  }

  /**
   * Internal: iterate over all chunk text strings using cursor traversal.
   */
  private *chunksIter(): IterableIterator<string> {
    const cursor = this.tree.cursor(utf16Dimension);
    let chunk = cursor.item();
    while (chunk !== undefined) {
      yield chunk.text;
      if (!cursor.next()) break;
      chunk = cursor.item();
    }
  }
}
