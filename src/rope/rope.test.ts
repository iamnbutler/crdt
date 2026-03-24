import { describe, expect, it } from "bun:test";
import { Rope } from "./rope.js";
import { computeTextSummary, createTextChunk, textSummaryOps } from "./summary.js";
import { CHUNK_TARGET } from "./types.js";

describe("Rope", () => {
  describe("empty rope", () => {
    it("creates an empty rope", () => {
      const rope = Rope.empty();
      expect(rope.length).toBe(0);
      expect(rope.lineCount).toBe(1);
      expect(rope.getText()).toBe("");
    });

    it("creates empty rope from empty string", () => {
      const rope = Rope.from("");
      expect(rope.length).toBe(0);
      expect(rope.lineCount).toBe(1);
      expect(rope.getText()).toBe("");
    });

    it("getLine on empty rope returns empty string for line 0", () => {
      const rope = Rope.empty();
      expect(rope.getLine(0)).toBe("");
    });

    it("getLine on empty rope returns empty for out-of-bounds", () => {
      const rope = Rope.empty();
      expect(rope.getLine(1)).toBe("");
      expect(rope.getLine(-1)).toBe("");
    });

    it("lineToOffset on empty rope", () => {
      const rope = Rope.empty();
      expect(rope.lineToOffset(0)).toBe(0);
      expect(rope.lineToOffset(1)).toBe(0);
    });

    it("offsetToLineCol on empty rope", () => {
      const rope = Rope.empty();
      expect(rope.offsetToLineCol(0)).toEqual({ line: 0, col: 0 });
    });

    it("insert into empty rope", () => {
      const rope = Rope.empty().insert(0, "hello");
      expect(rope.getText()).toBe("hello");
      expect(rope.length).toBe(5);
    });

    it("delete on empty rope is no-op", () => {
      const rope = Rope.empty().delete(0, 0);
      expect(rope.getText()).toBe("");
    });
  });

  describe("single character operations", () => {
    it("insert single character", () => {
      const rope = Rope.from("").insert(0, "a");
      expect(rope.getText()).toBe("a");
      expect(rope.length).toBe(1);
      expect(rope.lineCount).toBe(1);
    });

    it("delete single character", () => {
      const rope = Rope.from("a").delete(0, 1);
      expect(rope.getText()).toBe("");
      expect(rope.length).toBe(0);
    });

    it("insert newline creates two lines", () => {
      const rope = Rope.from("").insert(0, "\n");
      expect(rope.lineCount).toBe(2);
      expect(rope.getLine(0)).toBe("");
      expect(rope.getLine(1)).toBe("");
    });

    it("delete newline merges lines", () => {
      const rope = Rope.from("a\nb").delete(1, 2);
      expect(rope.getText()).toBe("ab");
      expect(rope.lineCount).toBe(1);
    });
  });

  describe("multi-line insert/delete", () => {
    it("insert multi-line text", () => {
      const rope = Rope.from("hello world").insert(5, "\nfoo\nbar");
      expect(rope.getText()).toBe("hello\nfoo\nbar world");
      expect(rope.lineCount).toBe(3);
    });

    it("insert at beginning", () => {
      const rope = Rope.from("world").insert(0, "hello ");
      expect(rope.getText()).toBe("hello world");
    });

    it("insert at end", () => {
      const rope = Rope.from("hello").insert(5, " world");
      expect(rope.getText()).toBe("hello world");
    });

    it("insert clamps to valid range", () => {
      const rope = Rope.from("abc").insert(100, "d");
      expect(rope.getText()).toBe("abcd");
    });

    it("insert at negative offset clamps to 0", () => {
      const rope = Rope.from("abc").insert(-5, "x");
      expect(rope.getText()).toBe("xabc");
    });

    it("delete range in the middle", () => {
      const rope = Rope.from("hello world").delete(5, 6);
      expect(rope.getText()).toBe("helloworld");
    });

    it("delete entire content", () => {
      const rope = Rope.from("hello").delete(0, 5);
      expect(rope.getText()).toBe("");
      expect(rope.length).toBe(0);
    });

    it("delete with clamped range", () => {
      const rope = Rope.from("hello").delete(3, 100);
      expect(rope.getText()).toBe("hel");
    });

    it("delete empty range is no-op", () => {
      const rope = Rope.from("hello");
      const rope2 = rope.delete(2, 2);
      expect(rope2.getText()).toBe("hello");
    });

    it("sequential inserts build text correctly", () => {
      let rope = Rope.empty();
      rope = rope.insert(0, "a");
      rope = rope.insert(1, "b");
      rope = rope.insert(2, "c");
      rope = rope.insert(3, "d");
      expect(rope.getText()).toBe("abcd");
    });

    it("sequential deletes remove text correctly", () => {
      let rope = Rope.from("abcdef");
      rope = rope.delete(4, 6); // "abcd"
      rope = rope.delete(2, 4); // "ab"
      rope = rope.delete(0, 1); // "b"
      expect(rope.getText()).toBe("b");
    });
  });

  describe("lineToOffset and offsetToLineCol", () => {
    it("single line", () => {
      const rope = Rope.from("hello");
      expect(rope.lineToOffset(0)).toBe(0);
      expect(rope.offsetToLineCol(0)).toEqual({ line: 0, col: 0 });
      expect(rope.offsetToLineCol(3)).toEqual({ line: 0, col: 3 });
      expect(rope.offsetToLineCol(5)).toEqual({ line: 0, col: 5 });
    });

    it("two lines", () => {
      const rope = Rope.from("hello\nworld");
      expect(rope.lineToOffset(0)).toBe(0);
      expect(rope.lineToOffset(1)).toBe(6);
      expect(rope.offsetToLineCol(0)).toEqual({ line: 0, col: 0 });
      expect(rope.offsetToLineCol(5)).toEqual({ line: 0, col: 5 });
      expect(rope.offsetToLineCol(6)).toEqual({ line: 1, col: 0 });
      expect(rope.offsetToLineCol(11)).toEqual({ line: 1, col: 5 });
    });

    it("three lines", () => {
      const rope = Rope.from("aa\nbb\ncc");
      expect(rope.lineCount).toBe(3);
      expect(rope.lineToOffset(0)).toBe(0);
      expect(rope.lineToOffset(1)).toBe(3);
      expect(rope.lineToOffset(2)).toBe(6);
    });

    it("round-trip: lineToOffset -> offsetToLineCol", () => {
      const rope = Rope.from("line one\nline two\nline three\n");
      for (let line = 0; line < rope.lineCount; line++) {
        const offset = rope.lineToOffset(line);
        const { line: gotLine, col } = rope.offsetToLineCol(offset);
        expect(gotLine).toBe(line);
        expect(col).toBe(0);
      }
    });

    it("round-trip with various offsets", () => {
      const text = "abc\ndef\nghi";
      const rope = Rope.from(text);

      for (let i = 0; i <= text.length; i++) {
        const { line, col } = rope.offsetToLineCol(i);
        const lineStart = rope.lineToOffset(line);
        expect(lineStart + col).toBe(i);
      }
    });

    it("lineToOffset beyond last line returns length", () => {
      const rope = Rope.from("abc\ndef");
      expect(rope.lineToOffset(100)).toBe(7);
    });

    it("offsetToLineCol clamps to valid range", () => {
      const rope = Rope.from("abc");
      expect(rope.offsetToLineCol(100)).toEqual({ line: 0, col: 3 });
      expect(rope.offsetToLineCol(-5)).toEqual({ line: 0, col: 0 });
    });

    it("empty lines", () => {
      const rope = Rope.from("\n\n\n");
      expect(rope.lineCount).toBe(4);
      expect(rope.lineToOffset(0)).toBe(0);
      expect(rope.lineToOffset(1)).toBe(1);
      expect(rope.lineToOffset(2)).toBe(2);
      expect(rope.lineToOffset(3)).toBe(3);
    });
  });

  describe("CRLF normalization", () => {
    it("normalizes CRLF to LF", () => {
      const rope = Rope.from("hello\r\nworld");
      expect(rope.getText()).toBe("hello\nworld");
      expect(rope.lineCount).toBe(2);
    });

    it("normalizes lone CR to LF", () => {
      const rope = Rope.from("hello\rworld");
      expect(rope.getText()).toBe("hello\nworld");
      expect(rope.lineCount).toBe(2);
    });

    it("normalizes mixed line endings", () => {
      const rope = Rope.from("a\r\nb\rc\nd");
      expect(rope.getText()).toBe("a\nb\nc\nd");
      expect(rope.lineCount).toBe(4);
    });

    it("normalizes CRLF in insert", () => {
      const rope = Rope.from("abc").insert(1, "\r\n");
      expect(rope.getText()).toBe("a\nbc");
    });
  });

  describe("surrogate pair safety", () => {
    it("handles emoji (surrogate pairs)", () => {
      const emoji = "\u{1F600}"; // Grinning face - 2 UTF-16 code units
      const rope = Rope.from(emoji);
      expect(rope.getText()).toBe(emoji);
      expect(rope.length).toBe(2); // 2 UTF-16 code units
    });

    it("handles multiple emoji", () => {
      const text = "\u{1F600}\u{1F601}\u{1F602}";
      const rope = Rope.from(text);
      expect(rope.getText()).toBe(text);
      expect(rope.length).toBe(6); // 3 emoji * 2 code units each
    });

    it("handles CJK characters", () => {
      const text = "\u4F60\u597D\u4E16\u754C"; // 你好世界
      const rope = Rope.from(text);
      expect(rope.getText()).toBe(text);
      expect(rope.length).toBe(4);
    });

    it("handles emoji in multi-line text", () => {
      const text = "hello \u{1F600}\nworld \u{1F601}";
      const rope = Rope.from(text);
      expect(rope.getText()).toBe(text);
      expect(rope.lineCount).toBe(2);
      expect(rope.getLine(0)).toBe("hello \u{1F600}");
      expect(rope.getLine(1)).toBe("world \u{1F601}");
    });

    it("insert after emoji preserves surrogate pairs", () => {
      const rope = Rope.from("\u{1F600}").insert(2, "abc");
      expect(rope.getText()).toBe("\u{1F600}abc");
    });

    it("handles supplementary plane chars in large text", () => {
      // Create text with emoji that will span chunk boundaries
      const segment = `${"\u{1F600}".repeat(100)}\n`;
      const text = segment.repeat(10);
      const rope = Rope.from(text);
      expect(rope.getText()).toBe(text);
    });
  });

  describe("getText and getLine", () => {
    it("getText with range", () => {
      const rope = Rope.from("hello world");
      expect(rope.getText(0, 5)).toBe("hello");
      expect(rope.getText(6, 11)).toBe("world");
      expect(rope.getText(3, 8)).toBe("lo wo");
    });

    it("getLine returns line without trailing newline", () => {
      const rope = Rope.from("line1\nline2\nline3");
      expect(rope.getLine(0)).toBe("line1");
      expect(rope.getLine(1)).toBe("line2");
      expect(rope.getLine(2)).toBe("line3");
    });

    it("getLine with trailing newline", () => {
      const rope = Rope.from("line1\nline2\n");
      expect(rope.getLine(0)).toBe("line1");
      expect(rope.getLine(1)).toBe("line2");
      expect(rope.getLine(2)).toBe("");
    });

    it("getLine out of bounds", () => {
      const rope = Rope.from("abc");
      expect(rope.getLine(-1)).toBe("");
      expect(rope.getLine(1)).toBe("");
    });
  });

  describe("very long lines", () => {
    it("handles a single very long line", () => {
      const longLine = "x".repeat(10000);
      const rope = Rope.from(longLine);
      expect(rope.length).toBe(10000);
      expect(rope.lineCount).toBe(1);
      expect(rope.getLine(0)).toBe(longLine);
    });

    it("handles long line followed by short lines", () => {
      const longLine = "y".repeat(5000);
      const text = `${longLine}\na\nb\nc`;
      const rope = Rope.from(text);
      expect(rope.lineCount).toBe(4);
      expect(rope.getLine(0)).toBe(longLine);
      expect(rope.getLine(1)).toBe("a");
      expect(rope.getLine(3)).toBe("c");
    });
  });

  describe("document ending with/without newline", () => {
    it("document without trailing newline", () => {
      const rope = Rope.from("abc");
      expect(rope.lineCount).toBe(1);
      expect(rope.getLine(0)).toBe("abc");
    });

    it("document with trailing newline", () => {
      const rope = Rope.from("abc\n");
      expect(rope.lineCount).toBe(2);
      expect(rope.getLine(0)).toBe("abc");
      expect(rope.getLine(1)).toBe("");
    });

    it("only newlines", () => {
      const rope = Rope.from("\n\n");
      expect(rope.lineCount).toBe(3);
      expect(rope.getLine(0)).toBe("");
      expect(rope.getLine(1)).toBe("");
      expect(rope.getLine(2)).toBe("");
    });
  });

  describe("lastLineLen monoid correctness", () => {
    it("single chunk lastLineLen", () => {
      const summary = computeTextSummary("abc\ndef");
      expect(summary.lastLineLen).toBe(3); // "def".length
      expect(summary.lines).toBe(1);
    });

    it("combine two summaries with newline in left only", () => {
      const left = computeTextSummary("abc\n");
      const right = computeTextSummary("def");
      const combined = textSummaryOps.combine(left, right);

      expect(combined.lines).toBe(1);
      // right has 0 lines, so lastLineLen = left.lastLineLen + right.lastLineLen
      // left.lastLineLen = 0 (empty after newline), right.lastLineLen = 3
      expect(combined.lastLineLen).toBe(3);
    });

    it("combine two summaries with newline in right", () => {
      const left = computeTextSummary("abc");
      const right = computeTextSummary("def\nghi");
      const combined = textSummaryOps.combine(left, right);

      expect(combined.lines).toBe(1);
      // right has 1 line, so lastLineLen = right.lastLineLen
      expect(combined.lastLineLen).toBe(3); // "ghi".length
    });

    it("combine two summaries with no newlines", () => {
      const left = computeTextSummary("abc");
      const right = computeTextSummary("def");
      const combined = textSummaryOps.combine(left, right);

      expect(combined.lines).toBe(0);
      expect(combined.lastLineLen).toBe(6); // left.3 + right.3
    });

    it("identity combine", () => {
      const summary = computeTextSummary("hello\nworld");
      const identity = textSummaryOps.identity();
      const combined = textSummaryOps.combine(identity, summary);
      expect(combined).toEqual(summary);
    });

    it("combine with identity on right", () => {
      const summary = computeTextSummary("hello\nworld");
      const identity = textSummaryOps.identity();
      const combined = textSummaryOps.combine(summary, identity);
      expect(combined).toEqual(summary);
    });

    it("three-way combine matches different groupings (associativity)", () => {
      const a = computeTextSummary("abc\n");
      const b = computeTextSummary("def");
      const c = computeTextSummary("\nghi");

      const leftFirst = textSummaryOps.combine(textSummaryOps.combine(a, b), c);
      const rightFirst = textSummaryOps.combine(a, textSummaryOps.combine(b, c));

      expect(leftFirst).toEqual(rightFirst);
    });
  });

  describe("line iterator", () => {
    it("iterates all lines forward", () => {
      const rope = Rope.from("a\nb\nc");
      const result = [...rope.lines()];
      expect(result).toEqual(["a", "b", "c"]);
    });

    it("iterates range of lines", () => {
      const rope = Rope.from("a\nb\nc\nd");
      const result = [...rope.lines(1, 3)];
      expect(result).toEqual(["b", "c"]);
    });

    it("iterates lines with trailing newline", () => {
      const rope = Rope.from("a\nb\n");
      const result = [...rope.lines()];
      expect(result).toEqual(["a", "b", ""]);
    });

    it("iterates empty rope", () => {
      const rope = Rope.empty();
      const result = [...rope.lines()];
      expect(result).toEqual([""]);
    });

    it("iterates single line without newline", () => {
      const rope = Rope.from("hello");
      const result = [...rope.lines()];
      expect(result).toEqual(["hello"]);
    });
  });

  describe("chunk iterator", () => {
    it("iterates all chunks", () => {
      const rope = Rope.from("hello world");
      const result = [...rope.chunks()].join("");
      expect(result).toBe("hello world");
    });

    it("iterates chunk range", () => {
      const rope = Rope.from("hello world");
      const result = [...rope.chunks(2, 7)].join("");
      expect(result).toBe("llo w");
    });

    it("iterates empty range", () => {
      const rope = Rope.from("hello");
      const result = [...rope.chunks(2, 2)].join("");
      expect(result).toBe("");
    });
  });

  describe("large document", () => {
    it("handles 10K+ lines", () => {
      const lines: string[] = [];
      for (let i = 0; i < 10000; i++) {
        lines.push(`line ${i}: ${"x".repeat(40)}`);
      }
      const text = lines.join("\n");
      const rope = Rope.from(text);

      expect(rope.lineCount).toBe(10000);
      expect(rope.getLine(0)).toBe(lines[0] ?? "");
      expect(rope.getLine(5000)).toBe(lines[5000] ?? "");
      expect(rope.getLine(9999)).toBe(lines[9999] ?? "");
    });

    it("lineToOffset / offsetToLineCol are consistent for large docs", () => {
      const lines: string[] = [];
      for (let i = 0; i < 1000; i++) {
        lines.push(`line-${i}`);
      }
      const text = lines.join("\n");
      const rope = Rope.from(text);

      // Check a sampling of lines
      for (let line = 0; line < 1000; line += 100) {
        const offset = rope.lineToOffset(line);
        const result = rope.offsetToLineCol(offset);
        expect(result.line).toBe(line);
        expect(result.col).toBe(0);
      }
    });

    it("insert into middle of large document", () => {
      const lines: string[] = [];
      for (let i = 0; i < 1000; i++) {
        lines.push(`line ${i}`);
      }
      const text = lines.join("\n");
      const rope = Rope.from(text);

      // Insert in the middle
      const midOffset = rope.lineToOffset(500);
      const modified = rope.insert(midOffset, "INSERTED\n");

      expect(modified.lineCount).toBe(1001);
      expect(modified.getLine(500)).toBe("INSERTED");
    });

    it("delete from large document", () => {
      const lines: string[] = [];
      for (let i = 0; i < 1000; i++) {
        lines.push(`line ${i}`);
      }
      const text = lines.join("\n");
      const rope = Rope.from(text);

      // Delete a line
      const startOffset = rope.lineToOffset(500);
      const endOffset = rope.lineToOffset(501);
      const modified = rope.delete(startOffset, endOffset);

      expect(modified.lineCount).toBe(999);
    });
  });

  describe("property: lineCount === getText().split('\\n').length", () => {
    const testCases = [
      "",
      "hello",
      "hello\n",
      "hello\nworld",
      "\n",
      "\n\n",
      "\n\n\n",
      "a\nb\nc\n",
      "no newline",
    ];

    for (const text of testCases) {
      it(`holds for ${JSON.stringify(text)}`, () => {
        const rope = Rope.from(text);
        const expected = text.split("\n").length;
        expect(rope.lineCount).toBe(expected);
      });
    }
  });

  describe("property: length === getText().length", () => {
    const testCases = [
      "",
      "a",
      "hello",
      "hello\nworld",
      "\u{1F600}",
      "\u{1F600}\u{1F601}",
      "abc\u{1F600}def",
    ];

    for (const text of testCases) {
      it(`holds for ${JSON.stringify(text)}`, () => {
        const rope = Rope.from(text);
        expect(rope.length).toBe(rope.getText().length);
      });
    }
  });

  describe("immutability", () => {
    it("insert returns new rope, original unchanged", () => {
      const original = Rope.from("hello");
      const modified = original.insert(5, " world");
      expect(original.getText()).toBe("hello");
      expect(modified.getText()).toBe("hello world");
    });

    it("delete returns new rope, original unchanged", () => {
      const original = Rope.from("hello world");
      const modified = original.delete(5, 11);
      expect(original.getText()).toBe("hello world");
      expect(modified.getText()).toBe("hello");
    });
  });

  describe("TextChunk and summary", () => {
    it("createTextChunk computes correct summary", () => {
      const chunk = createTextChunk("hello\nworld");
      const summary = chunk.summary();
      expect(summary.lines).toBe(1);
      expect(summary.utf16Len).toBe(11);
      expect(summary.lastLineLen).toBe(5);
    });

    it("createTextChunk for text without newline", () => {
      const chunk = createTextChunk("hello");
      const summary = chunk.summary();
      expect(summary.lines).toBe(0);
      expect(summary.utf16Len).toBe(5);
      expect(summary.lastLineLen).toBe(5);
    });

    it("createTextChunk for empty string", () => {
      const chunk = createTextChunk("");
      const summary = chunk.summary();
      expect(summary.lines).toBe(0);
      expect(summary.utf16Len).toBe(0);
      expect(summary.lastLineLen).toBe(0);
    });
  });

  describe("edge cases", () => {
    it("insert empty string is no-op", () => {
      const rope = Rope.from("hello");
      const same = rope.insert(2, "");
      expect(same.getText()).toBe("hello");
    });

    it("from and getText are inverse", () => {
      const text = "line 1\nline 2\nline 3\n";
      const rope = Rope.from(text);
      expect(rope.getText()).toBe(text);
    });

    it("chunking respects CHUNK_TARGET", () => {
      // A text larger than CHUNK_TARGET should be split into multiple chunks
      const text = "a".repeat(CHUNK_TARGET * 3);
      const rope = Rope.from(text);
      expect(rope.length).toBe(CHUNK_TARGET * 3);
      expect(rope.getText()).toBe(text);

      // Should have multiple chunks
      const chunks = [...rope.chunks()];
      expect(chunks.length).toBeGreaterThan(1);
    });

    it("handles unicode text across chunk boundaries", () => {
      // Build text that will split across chunk boundaries with multi-byte chars
      const segment = "\u4F60\u597D".repeat(200); // 你好 repeated
      const text = `${segment}\n${segment}\n${segment}`;
      const rope = Rope.from(text);
      expect(rope.getText()).toBe(text);
      expect(rope.lineCount).toBe(3);
    });
  });
});
