import { describe, expect, it } from "bun:test";
import { byteLength, computeTextSummary, textSummaryOps } from "./summary.js";

// ---------------------------------------------------------------------------
// computeTextSummary: edge cases
// ---------------------------------------------------------------------------

describe("computeTextSummary edge cases", () => {
  it("empty string produces zero summary", () => {
    const s = computeTextSummary("");
    expect(s.lines).toBe(0);
    expect(s.utf16Len).toBe(0);
    expect(s.bytes).toBe(0);
    expect(s.lastLineLen).toBe(0);
    expect(s.lastLineBytes).toBe(0);
  });

  it("single newline produces one line with empty last line", () => {
    const s = computeTextSummary("\n");
    expect(s.lines).toBe(1);
    expect(s.utf16Len).toBe(1);
    expect(s.lastLineLen).toBe(0);
    expect(s.lastLineBytes).toBe(0);
  });

  it("multiple consecutive newlines count each line", () => {
    const s = computeTextSummary("\n\n\n");
    expect(s.lines).toBe(3);
    expect(s.utf16Len).toBe(3);
    expect(s.lastLineLen).toBe(0);
    expect(s.lastLineBytes).toBe(0);
  });

  it("text ending with newline has zero lastLineLen", () => {
    const s = computeTextSummary("hello\n");
    expect(s.lines).toBe(1);
    expect(s.utf16Len).toBe(6);
    expect(s.lastLineLen).toBe(0);
    expect(s.lastLineBytes).toBe(0);
  });

  it("text not ending with newline has nonzero lastLineLen", () => {
    const s = computeTextSummary("hello\nworld");
    expect(s.lines).toBe(1);
    expect(s.utf16Len).toBe(11);
    expect(s.lastLineLen).toBe(5);
    expect(s.lastLineBytes).toBe(5);
  });

  it("CRLF is not specially handled (\\r remains in last line)", () => {
    // computeTextSummary only counts \n as line breaks.
    // \r is treated as a regular character. The CRDT normalizes
    // line endings upstream before text reaches this function.
    const s = computeTextSummary("abc\r\ndef");
    expect(s.lines).toBe(1); // only one \n
    expect(s.utf16Len).toBe(8); // a,b,c,\r,\n,d,e,f
    expect(s.lastLineLen).toBe(3); // "def"
    expect(s.lastLineBytes).toBe(3);
  });

  it("lone \\r does not count as a line break", () => {
    const s = computeTextSummary("abc\rdef");
    expect(s.lines).toBe(0);
    expect(s.utf16Len).toBe(7);
    expect(s.lastLineLen).toBe(7); // entire string is "last line"
  });

  it("handles multi-byte UTF-8 characters correctly", () => {
    // "你好" = 2 chars, 6 bytes in UTF-8
    const s = computeTextSummary("你好");
    expect(s.lines).toBe(0);
    expect(s.utf16Len).toBe(2);
    expect(s.bytes).toBe(6);
    expect(s.lastLineLen).toBe(2);
    expect(s.lastLineBytes).toBe(6);
  });

  it("handles emoji (surrogate pairs) correctly", () => {
    // "😀" is a surrogate pair: 2 UTF-16 code units, 4 UTF-8 bytes
    const s = computeTextSummary("😀");
    expect(s.lines).toBe(0);
    expect(s.utf16Len).toBe(2); // surrogate pair
    expect(s.bytes).toBe(4);
    expect(s.lastLineLen).toBe(2);
    expect(s.lastLineBytes).toBe(4);
  });

  it("multi-byte characters on last line after newline", () => {
    const s = computeTextSummary("hello\n你好世界");
    expect(s.lines).toBe(1);
    expect(s.lastLineLen).toBe(4); // 4 CJK chars
    expect(s.lastLineBytes).toBe(12); // 4 × 3 bytes
  });

  it("emoji after newline on last line", () => {
    const s = computeTextSummary("line1\n😀😀");
    expect(s.lines).toBe(1);
    expect(s.lastLineLen).toBe(4); // 2 emojis × 2 code units
    expect(s.lastLineBytes).toBe(8); // 2 emojis × 4 bytes
  });

  it("many empty lines (only newlines)", () => {
    const text = "\n".repeat(100);
    const s = computeTextSummary(text);
    expect(s.lines).toBe(100);
    expect(s.utf16Len).toBe(100);
    expect(s.lastLineLen).toBe(0);
  });

  it("single character without newline", () => {
    const s = computeTextSummary("x");
    expect(s.lines).toBe(0);
    expect(s.utf16Len).toBe(1);
    expect(s.bytes).toBe(1);
    expect(s.lastLineLen).toBe(1);
    expect(s.lastLineBytes).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// byteLength edge cases
// ---------------------------------------------------------------------------

describe("byteLength", () => {
  it("empty string is 0 bytes", () => {
    expect(byteLength("")).toBe(0);
  });

  it("ASCII is 1 byte per char", () => {
    expect(byteLength("hello")).toBe(5);
  });

  it("2-byte UTF-8 (Latin extended)", () => {
    // "ñ" (U+00F1) is 2 bytes in UTF-8
    expect(byteLength("ñ")).toBe(2);
  });

  it("3-byte UTF-8 (CJK)", () => {
    // "你" (U+4F60) is 3 bytes in UTF-8
    expect(byteLength("你")).toBe(3);
  });

  it("4-byte UTF-8 (emoji)", () => {
    // "😀" (U+1F600) is 4 bytes in UTF-8
    expect(byteLength("😀")).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// textSummaryOps.combine: edge cases
// ---------------------------------------------------------------------------

describe("textSummaryOps.combine edge cases", () => {
  it("combining two empty-line chunks", () => {
    const left = computeTextSummary("\n");
    const right = computeTextSummary("\n");
    const combined = textSummaryOps.combine(left, right);
    expect(combined.lines).toBe(2);
    expect(combined.utf16Len).toBe(2);
    expect(combined.lastLineLen).toBe(0);
  });

  it("combining text with trailing newline + empty string", () => {
    const left = computeTextSummary("abc\n");
    const right = computeTextSummary("");
    const combined = textSummaryOps.combine(left, right);
    expect(combined.lines).toBe(1);
    expect(combined.utf16Len).toBe(4);
    expect(combined.lastLineLen).toBe(0);
  });

  it("combining empty string + text with leading newline", () => {
    const left = computeTextSummary("");
    const right = computeTextSummary("\nabc");
    const combined = textSummaryOps.combine(left, right);
    expect(combined.lines).toBe(1);
    expect(combined.utf16Len).toBe(4);
    expect(combined.lastLineLen).toBe(3);
  });

  it("combining preserves bytes across multi-byte boundaries", () => {
    const left = computeTextSummary("你好\n");
    const right = computeTextSummary("世界");
    const combined = textSummaryOps.combine(left, right);
    expect(combined.lines).toBe(1);
    expect(combined.bytes).toBe(13); // 4 CJK × 3 bytes + 1 newline
    expect(combined.lastLineBytes).toBe(6); // "世界" = 6 bytes
  });

  it("4-way associativity with multi-byte and newlines", () => {
    const a = computeTextSummary("你\n");
    const b = computeTextSummary("好");
    const c = computeTextSummary("\n世");
    const d = computeTextSummary("界\n");

    const ab = textSummaryOps.combine(a, b);
    const cd = textSummaryOps.combine(c, d);
    const abcd = textSummaryOps.combine(ab, cd);

    const bc = textSummaryOps.combine(b, c);
    const abc = textSummaryOps.combine(a, bc);
    const abcd2 = textSummaryOps.combine(abc, d);

    expect(abcd).toEqual(abcd2);
    expect(abcd.lines).toBe(3);
  });
});
