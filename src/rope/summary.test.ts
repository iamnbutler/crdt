import { describe, expect, test } from "bun:test";
import { byteLength, computeTextSummary } from "./summary.js";

describe("byteLength", () => {
  test("ASCII string", () => {
    expect(byteLength("hello")).toBe(5);
  });

  test("empty string", () => {
    expect(byteLength("")).toBe(0);
  });

  test("2-byte UTF-8 characters", () => {
    // é is U+00E9 → 2 bytes in UTF-8
    expect(byteLength("é")).toBe(2);
    expect(byteLength("café")).toBe(5); // c=1, a=1, f=1, é=2
  });

  test("3-byte UTF-8 characters (CJK)", () => {
    // 中 is U+4E2D → 3 bytes in UTF-8
    expect(byteLength("中")).toBe(3);
    expect(byteLength("中文")).toBe(6);
  });

  test("4-byte UTF-8 characters (emoji)", () => {
    // 😀 is U+1F600 → 4 bytes in UTF-8
    expect(byteLength("😀")).toBe(4);
    expect(byteLength("a😀b")).toBe(6); // a=1, 😀=4, b=1
  });

  test("combining characters", () => {
    // e + combining acute accent (U+0301) → e is 1 byte, accent is 2 bytes
    expect(byteLength("e\u0301")).toBe(3);
  });

  test("newlines", () => {
    expect(byteLength("\n")).toBe(1);
    expect(byteLength("\r\n")).toBe(2);
    expect(byteLength("\r")).toBe(1);
  });
});

describe("computeTextSummary", () => {
  test("empty string", () => {
    const s = computeTextSummary("");
    expect(s.lines).toBe(0);
    expect(s.utf16Len).toBe(0);
    expect(s.bytes).toBe(0);
    expect(s.lastLineLen).toBe(0);
    expect(s.lastLineBytes).toBe(0);
  });

  test("single line without newline", () => {
    const s = computeTextSummary("hello");
    expect(s.lines).toBe(0);
    expect(s.utf16Len).toBe(5);
    expect(s.bytes).toBe(5);
    expect(s.lastLineLen).toBe(5);
    expect(s.lastLineBytes).toBe(5);
  });

  test("single newline", () => {
    const s = computeTextSummary("\n");
    expect(s.lines).toBe(1);
    expect(s.utf16Len).toBe(1);
    expect(s.bytes).toBe(1);
    expect(s.lastLineLen).toBe(0);
    expect(s.lastLineBytes).toBe(0);
  });

  test("multiple consecutive newlines", () => {
    const s = computeTextSummary("\n\n\n");
    expect(s.lines).toBe(3);
    expect(s.utf16Len).toBe(3);
    expect(s.bytes).toBe(3);
    expect(s.lastLineLen).toBe(0);
    expect(s.lastLineBytes).toBe(0);
  });

  test("text ending with newline", () => {
    const s = computeTextSummary("hello\n");
    expect(s.lines).toBe(1);
    expect(s.utf16Len).toBe(6);
    expect(s.bytes).toBe(6);
    expect(s.lastLineLen).toBe(0);
    expect(s.lastLineBytes).toBe(0);
  });

  test("two lines", () => {
    const s = computeTextSummary("hello\nworld");
    expect(s.lines).toBe(1);
    expect(s.utf16Len).toBe(11);
    expect(s.bytes).toBe(11);
    expect(s.lastLineLen).toBe(5);
    expect(s.lastLineBytes).toBe(5);
  });

  test("multiple lines", () => {
    const s = computeTextSummary("a\nb\nc\nd");
    expect(s.lines).toBe(3);
    expect(s.utf16Len).toBe(7);
    expect(s.bytes).toBe(7);
    expect(s.lastLineLen).toBe(1);
    expect(s.lastLineBytes).toBe(1);
  });

  // CRLF edge cases - computeTextSummary receives pre-normalized text,
  // but we verify behavior if called on non-normalized text
  test("CRLF counts only LF as line break", () => {
    // If text is not normalized, \r\n has \n at index 1
    const s = computeTextSummary("\r\n");
    expect(s.lines).toBe(1);
    // \r is still part of the text before the \n
    expect(s.utf16Len).toBe(2);
    expect(s.lastLineLen).toBe(0);
  });

  test("lone CR is not treated as line break", () => {
    const s = computeTextSummary("hello\rworld");
    expect(s.lines).toBe(0);
    expect(s.lastLineLen).toBe(11); // entire string is one "line"
  });

  test("mixed CRLF and LF (non-normalized input)", () => {
    // "a\r\nb\nc" - \r\n at index 1-2, \n at index 4
    const s = computeTextSummary("a\r\nb\nc");
    expect(s.lines).toBe(2); // only counts \n characters
    expect(s.lastLineLen).toBe(1); // "c"
  });

  // Empty-line edge cases
  test("empty lines between text", () => {
    const s = computeTextSummary("a\n\nb");
    expect(s.lines).toBe(2);
    expect(s.lastLineLen).toBe(1);
  });

  test("multiple empty lines at start", () => {
    const s = computeTextSummary("\n\nhello");
    expect(s.lines).toBe(2);
    expect(s.lastLineLen).toBe(5);
    expect(s.lastLineBytes).toBe(5);
  });

  test("only empty lines ending with text", () => {
    const s = computeTextSummary("\n\n\nhi");
    expect(s.lines).toBe(3);
    expect(s.lastLineLen).toBe(2);
  });

  // Multi-byte UTF-8 edge cases
  test("emoji on last line (surrogate pair)", () => {
    const s = computeTextSummary("line1\n😀");
    expect(s.lines).toBe(1);
    expect(s.lastLineLen).toBe(2); // surrogate pair = 2 UTF-16 units
    expect(s.lastLineBytes).toBe(4); // 4 bytes in UTF-8
    expect(s.utf16Len).toBe(8); // "line1\n" = 6, "😀" = 2
    expect(s.bytes).toBe(10); // "line1\n" = 6, "😀" = 4
  });

  test("CJK characters", () => {
    const s = computeTextSummary("中文\n测试");
    expect(s.lines).toBe(1);
    expect(s.lastLineLen).toBe(2);
    expect(s.lastLineBytes).toBe(6); // 2 CJK chars × 3 bytes
    expect(s.utf16Len).toBe(5); // "中文\n测试"
    expect(s.bytes).toBe(13); // 3+3+1+3+3
  });

  test("mixed ASCII and multi-byte on last line", () => {
    const s = computeTextSummary("abc\nhéllo");
    expect(s.lines).toBe(1);
    expect(s.lastLineLen).toBe(5); // h, é, l, l, o
    expect(s.lastLineBytes).toBe(6); // h=1, é=2, l=1, l=1, o=1
  });

  test("single character string", () => {
    const s = computeTextSummary("x");
    expect(s.lines).toBe(0);
    expect(s.utf16Len).toBe(1);
    expect(s.bytes).toBe(1);
    expect(s.lastLineLen).toBe(1);
    expect(s.lastLineBytes).toBe(1);
  });
});
