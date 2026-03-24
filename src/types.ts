/**
 * Branded Types for the CRDT Public API
 *
 * These types provide compile-time safety by distinguishing values
 * that are structurally identical but semantically different.
 *
 * @example
 * ```ts
 * import { LineNumber, Utf16Offset, lineNumber, utf16Offset } from "@iamnbutler/crdt";
 *
 * const line: LineNumber = lineNumber(5);
 * const offset: Utf16Offset = utf16Offset(42);
 *
 * // Type error: cannot assign Utf16Offset to LineNumber
 * // const bad: LineNumber = offset;
 * ```
 */

// ---------------------------------------------------------------------------
// LineNumber: 0-based line index in a document
// ---------------------------------------------------------------------------

/**
 * A 0-based line number in the document.
 *
 * Line numbers are integers starting from 0 for the first line.
 * Use the `lineNumber()` function to create values of this type.
 */
export type LineNumber = number & { readonly __brand: "LineNumber" };

/**
 * Create a LineNumber from a plain number.
 *
 * @param n - The 0-based line index
 * @returns A branded LineNumber
 *
 * @example
 * ```ts
 * const first = lineNumber(0);
 * const tenth = lineNumber(9);
 * ```
 */
export function lineNumber(n: number): LineNumber {
  return n as LineNumber;
}

// ---------------------------------------------------------------------------
// Utf16Offset: UTF-16 code unit offset in a document
// ---------------------------------------------------------------------------

/**
 * A UTF-16 code unit offset in the document.
 *
 * This is the standard string index in JavaScript/TypeScript.
 * Surrogate pairs (emoji, etc.) occupy 2 UTF-16 code units.
 */
export type Utf16Offset = number & { readonly __brand: "Utf16Offset" };

/**
 * Create a Utf16Offset from a plain number.
 *
 * @param n - The UTF-16 offset
 * @returns A branded Utf16Offset
 *
 * @example
 * ```ts
 * const start = utf16Offset(0);
 * const mid = utf16Offset(50);
 * ```
 */
export function utf16Offset(n: number): Utf16Offset {
  return n as Utf16Offset;
}

// ---------------------------------------------------------------------------
// ByteOffset: Byte offset (UTF-8) in a document
// ---------------------------------------------------------------------------

/**
 * A byte offset (UTF-8 encoding) in the document.
 *
 * Useful for interoperability with systems that use byte offsets
 * (e.g., LSP, some editors, file I/O).
 */
export type ByteOffset = number & { readonly __brand: "ByteOffset" };

/**
 * Create a ByteOffset from a plain number.
 *
 * @param n - The byte offset
 * @returns A branded ByteOffset
 *
 * @example
 * ```ts
 * const start = byteOffset(0);
 * const pos = byteOffset(128);
 * ```
 */
export function byteOffset(n: number): ByteOffset {
  return n as ByteOffset;
}

// ---------------------------------------------------------------------------
// Column: 0-based column number in a line
// ---------------------------------------------------------------------------

/**
 * A 0-based column number within a line.
 *
 * Column numbers are UTF-16 code units from the start of the line.
 */
export type Column = number & { readonly __brand: "Column" };

/**
 * Create a Column from a plain number.
 *
 * @param n - The 0-based column index
 * @returns A branded Column
 */
export function column(n: number): Column {
  return n as Column;
}

// ---------------------------------------------------------------------------
// Position: line and column pair
// ---------------------------------------------------------------------------

/**
 * A position in the document specified by line and column.
 *
 * Both line and column are 0-based indices.
 */
export interface LineColumn {
  readonly line: LineNumber;
  readonly col: Column;
}

/**
 * Create a LineColumn position.
 *
 * @param line - 0-based line number
 * @param col - 0-based column number
 */
export function lineColumn(line: number, col: number): LineColumn {
  return {
    line: lineNumber(line),
    col: column(col),
  };
}
