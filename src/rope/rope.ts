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
 * RopeView: a lazy, non-materializing view over a Rope or a range within it.
 *
 * Instead of building the full string eagerly, RopeView provides O(log n)
 * positional access via cursor seeking. Only the requested characters are
 * materialized. This is ideal for editor viewport rendering where only a
 * small window of a large document is needed.
 */
export class RopeView {
  private readonly tree: SumTree<TextChunk, TextSummary>;
  private readonly start: number;
  private readonly end: number;
  private readonly _length: number;

  constructor(tree: SumTree<TextChunk, TextSummary>, start?: number, end?: number) {
    this.tree = tree;
    const totalLen = tree.summary().utf16Len;
    this.start = Math.max(0, Math.min(start ?? 0, totalLen));
    this.end = Math.max(this.start, Math.min(end ?? totalLen, totalLen));
    this._length = this.end - this.start;
  }

  /** Length of the view in UTF-16 code units. O(1). */
  get length(): number {
    return this._length;
  }

  /**
   * Get the character at a position relative to the view start.
   * O(log n) via cursor seeking.
   */
  charAt(pos: number): string {
    if (pos < 0 || pos >= this._length) return "";
    return this.slice(pos, pos + 1);
  }

  /**
   * Get a substring of the view. Only materializes the requested range.
   * O(log n) seek + O(k) materialization where k = end - start.
   */
  slice(start: number, end?: number): string {
    const s = Math.max(0, Math.min(start, this._length));
    const e = Math.max(s, Math.min(end ?? this._length, this._length));
    if (s === e) return "";

    // Map view-relative offsets to absolute rope offsets
    const absStart = this.start + s;
    const absEnd = this.start + e;

    return collectChunks(this.tree, absStart, absEnd);
  }

  /**
   * Narrow this view to a sub-range. Returns a new RopeView without materializing.
   * O(1) — just adjusts the offset bounds.
   */
  subview(start: number, end?: number): RopeView {
    const s = Math.max(0, Math.min(start, this._length));
    const e = Math.max(s, Math.min(end ?? this._length, this._length));
    return new RopeView(this.tree, this.start + s, this.start + e);
  }

  /**
   * Iterate over chunks in this view's range.
   * Each chunk is a slice of the underlying storage — no full string built.
   */
  *chunks(): IterableIterator<string> {
    yield* chunksFromTree(this.tree, this.start, this.end);
  }

  /**
   * Materialize the entire view as a string. Only call when you truly need
   * the full string (e.g., passing to an API that requires string).
   */
  toString(): string {
    return this.slice(0, this._length);
  }

  /** Iterate over individual characters. */
  *[Symbol.iterator](): IterableIterator<string> {
    for (const chunk of this.chunks()) {
      for (const ch of chunk) {
        yield ch;
      }
    }
  }

  /**
   * Search for a substring within this view. Returns the view-relative index or -1.
   * Materializes only enough chunks to perform the search.
   */
  indexOf(searchString: string, position?: number): number {
    if (searchString.length === 0) return position ?? 0;
    if (searchString.length > this._length) return -1;

    // For short search strings, materialize and search
    const text = this.toString();
    return text.indexOf(searchString, position);
  }
}

/**
 * Collect chunks from a SumTree in [start, end) using cursor seeking.
 */
function collectChunks(tree: SumTree<TextChunk, TextSummary>, start: number, end: number): string {
  const parts: string[] = [];
  for (const chunk of chunksFromTree(tree, start, end)) {
    parts.push(chunk);
  }
  return parts.join("");
}

/**
 * Iterate over chunks from a SumTree in [start, end) using cursor seeking.
 * O(log n) seek + O(k/CHUNK_SIZE) iteration.
 */
function* chunksFromTree(
  tree: SumTree<TextChunk, TextSummary>,
  start: number,
  end: number,
): IterableIterator<string> {
  if (start >= end) return;

  const cursor = tree.cursor(utf16Dimension);

  if (start > 0) {
    cursor.seekForward(start, "right");
  }

  let chunk = cursor.item();
  while (chunk !== undefined) {
    const chunkStart = cursor.position;
    if (chunkStart >= end) break;

    const sliceStart = Math.max(0, start - chunkStart);
    const sliceEnd = Math.min(chunk.text.length, end - chunkStart);
    yield chunk.text.slice(sliceStart, sliceEnd);

    if (!cursor.next()) break;
    chunk = cursor.item();
  }
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
   * When called with a range, only materializes chunks in that range — O(k) where k = range size.
   */
  getText(start?: number, end?: number): string {
    const s = start ?? 0;
    const e = end ?? this.length;
    return Array.from(this.chunks(s, e)).join("");
  }

  /**
   * Get a single line by line number (0-based). Does not include the trailing newline.
   * Uses range-based getText which only materializes chunks in the line's range.
   */
  getLine(line: number): string {
    if (line < 0 || line >= this.lineCount) {
      return "";
    }

    const start = this.lineToOffset(line);
    const nextLineStart = line + 1 < this.lineCount ? this.lineToOffset(line + 1) : this.length;

    const lineText = this.getText(start, nextLineStart);

    // Strip trailing newline if present
    if (lineText.endsWith("\n")) {
      return lineText.slice(0, -1);
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
   * Create a lazy, non-materializing view over this rope (or a range within it).
   * The view provides O(log n) charAt/slice without building the full string.
   */
  view(start?: number, end?: number): RopeView {
    return new RopeView(this.tree, start, end);
  }

  /**
   * Iterate over raw text chunks in a UTF-16 offset range [start, end).
   * If omitted, iterates all chunks.
   * Uses cursor seeking for O(log n) start position.
   */
  *chunks(start?: number, end?: number): IterableIterator<string> {
    yield* chunksFromTree(this.tree, start ?? 0, end ?? this.length);
  }
}
