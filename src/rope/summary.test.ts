import { describe, expect, it } from "bun:test";
import { textSummaryOps } from "../sum-tree/index.js";
import { byteLength, computeTextSummary } from "./summary.js";

// ---------------------------------------------------------------------------
// byteLength
// ---------------------------------------------------------------------------

describe("byteLength", () => {
  it("empty string", () => {
    expect(byteLength("")).toBe(0);
  });

  it("ASCII string", () => {
    expect(byteLength("hello")).toBe(5);
  });

  it("multi-byte UTF-8 (CJK)", () => {
    // Each CJK character is 3 bytes in UTF-8
    expect(byteLength("你好")).toBe(6);
  });

  it("emoji (4-byte UTF-8)", () => {
    // 🎉 is U+1F389, 4 bytes in UTF-8
    expect(byteLength("🎉")).toBe(4);
  });

  it("mixed ASCII and multi-byte", () => {
    // "a" = 1 byte, "é" = 2 bytes, "你" = 3 bytes, "🎉" = 4 bytes
    expect(byteLength("aé你🎉")).toBe(1 + 2 + 3 + 4);
  });
});

// ---------------------------------------------------------------------------
// computeTextSummary
// ---------------------------------------------------------------------------

describe("computeTextSummary", () => {
  it("empty string", () => {
    const s = computeTextSummary("");
    expect(s.lines).toBe(0);
    expect(s.utf16Len).toBe(0);
    expect(s.bytes).toBe(0);
    expect(s.lastLineLen).toBe(0);
    expect(s.lastLineBytes).toBe(0);
  });

  it("single newline", () => {
    const s = computeTextSummary("\n");
    expect(s.lines).toBe(1);
    expect(s.utf16Len).toBe(1);
    expect(s.bytes).toBe(1);
    expect(s.lastLineLen).toBe(0);
    expect(s.lastLineBytes).toBe(0);
  });

  it("multiple consecutive newlines", () => {
    const s = computeTextSummary("\n\n\n");
    expect(s.lines).toBe(3);
    expect(s.utf16Len).toBe(3);
    expect(s.lastLineLen).toBe(0);
  });

  it("text without trailing newline", () => {
    const s = computeTextSummary("abc");
    expect(s.lines).toBe(0);
    expect(s.utf16Len).toBe(3);
    expect(s.bytes).toBe(3);
    expect(s.lastLineLen).toBe(3);
    expect(s.lastLineBytes).toBe(3);
  });

  it("text with trailing newline", () => {
    const s = computeTextSummary("abc\n");
    expect(s.lines).toBe(1);
    expect(s.utf16Len).toBe(4);
    expect(s.lastLineLen).toBe(0);
    expect(s.lastLineBytes).toBe(0);
  });

  it("multiple lines with content", () => {
    const s = computeTextSummary("abc\ndef\nghi");
    expect(s.lines).toBe(2);
    expect(s.utf16Len).toBe(11);
    expect(s.lastLineLen).toBe(3);
    expect(s.lastLineBytes).toBe(3);
  });

  // CRLF handling: computeTextSummary only counts \n as line breaks.
  // The CRDT normalizes line endings upstream.
  it("CRLF: \\r\\n counts as one line (only \\n counted)", () => {
    const s = computeTextSummary("abc\r\ndef");
    expect(s.lines).toBe(1);
    // \r is just a regular character contributing to length
    expect(s.utf16Len).toBe(8); // a b c \r \n d e f
    // lastLine is "def"
    expect(s.lastLineLen).toBe(3);
  });

  it("lone \\r does not count as a line break", () => {
    const s = computeTextSummary("abc\rdef");
    expect(s.lines).toBe(0);
    expect(s.utf16Len).toBe(7);
    // The entire string is the "last line"
    expect(s.lastLineLen).toBe(7);
  });

  it("multi-byte UTF-8 on last line", () => {
    const s = computeTextSummary("line1\n你好");
    expect(s.lines).toBe(1);
    // "你好" is 2 UTF-16 code units, 6 UTF-8 bytes
    expect(s.lastLineLen).toBe(2);
    expect(s.lastLineBytes).toBe(6);
  });

  it("emoji (surrogate pair) on last line", () => {
    const s = computeTextSummary("a\n🎉");
    expect(s.lines).toBe(1);
    // 🎉 is 2 UTF-16 code units (surrogate pair), 4 UTF-8 bytes
    expect(s.lastLineLen).toBe(2);
    expect(s.lastLineBytes).toBe(4);
  });

  it("empty lines between content", () => {
    const s = computeTextSummary("a\n\n\nb");
    expect(s.lines).toBe(3);
    expect(s.lastLineLen).toBe(1);
    expect(s.lastLineBytes).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// textSummaryOps.combine
// ---------------------------------------------------------------------------

describe("textSummaryOps.combine", () => {
  it("identity is neutral", () => {
    const id = textSummaryOps.identity();
    const s = computeTextSummary("hello\nworld");
    const combined = textSummaryOps.combine(id, s);
    expect(combined).toEqual(s);
    const combined2 = textSummaryOps.combine(s, id);
    expect(combined2).toEqual(s);
  });

  it("combines two chunks without newlines", () => {
    const a = computeTextSummary("abc");
    const b = computeTextSummary("def");
    const c = textSummaryOps.combine(a, b);
    expect(c.lines).toBe(0);
    expect(c.utf16Len).toBe(6);
    // lastLineLen should be sum since no newline in right
    expect(c.lastLineLen).toBe(6);
    expect(c.lastLineBytes).toBe(6);
  });

  it("combines chunks where right has newline", () => {
    const a = computeTextSummary("abc");
    const b = computeTextSummary("\ndef");
    const c = textSummaryOps.combine(a, b);
    expect(c.lines).toBe(1);
    expect(c.utf16Len).toBe(7);
    // right has a newline so lastLineLen comes from right only
    expect(c.lastLineLen).toBe(3);
    expect(c.lastLineBytes).toBe(3);
  });

  it("combines chunks where left has newline but right doesn't", () => {
    const a = computeTextSummary("abc\n");
    const b = computeTextSummary("def");
    const c = textSummaryOps.combine(a, b);
    expect(c.lines).toBe(1);
    // right has no newline, so lastLineLen = left.lastLineLen + right.lastLineLen
    // left.lastLineLen = 0 (ends with newline), right.lastLineLen = 3
    expect(c.lastLineLen).toBe(3);
  });

  it("associativity with multi-byte characters", () => {
    const a = computeTextSummary("hello\n");
    const b = computeTextSummary("你");
    const c = computeTextSummary("好\nend");

    const ab_c = textSummaryOps.combine(textSummaryOps.combine(a, b), c);
    const a_bc = textSummaryOps.combine(a, textSummaryOps.combine(b, c));
    expect(ab_c).toEqual(a_bc);
  });

  it("associativity across four chunks", () => {
    const chunks = ["ab\n", "cd", "\nef\n", "gh"].map(computeTextSummary);
    // ((a . b) . c) . d
    const left = chunks.reduce(
      (acc, s) => textSummaryOps.combine(acc, s),
      textSummaryOps.identity(),
    );
    // a . (b . (c . d))
    const right = chunks.reduceRight(
      (acc, s) => textSummaryOps.combine(s, acc),
      textSummaryOps.identity(),
    );
    expect(left).toEqual(right);
  });
});
