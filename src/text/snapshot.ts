/**
 * TextBufferSnapshot: Immutable view of a TextBuffer at a point in time.
 *
 * Implements the DocumentSnapshot interface from the anchor module so that
 * CRDT anchors can be created and resolved against buffer state.
 */

import type { DocumentSnapshot, FragmentVisitor, SeekResult } from "../anchor/snapshot.js";
import type {
  Anchor,
  OperationId as AnchorOperationId,
  Bias,
  InsertionFragment,
  Position,
} from "../anchor/types.js";
import { Rope } from "../rope/rope.js";
import type { Fragment, VersionVector } from "./types.js";

/**
 * An immutable snapshot of the TextBuffer.
 */
export class TextBufferSnapshot implements DocumentSnapshot {
  private readonly fragments: ReadonlyArray<Fragment>;
  private readonly _version: VersionVector;
  private _text: string | null;
  private _rope: Rope | null;
  private released: boolean;

  constructor(fragments: ReadonlyArray<Fragment>, version: VersionVector) {
    this.fragments = fragments;
    this._version = version;
    this._text = null;
    this._rope = null;
    this.released = false;
  }

  /** Version vector at the time of this snapshot. */
  get version(): VersionVector {
    return this._version;
  }

  /** Total UTF-16 length of visible text. */
  get length(): number {
    let len = 0;
    for (const frag of this.fragments) {
      if (frag.visible) {
        len += frag.length;
      }
    }
    return len;
  }

  /** Number of lines in the document. */
  get lineCount(): number {
    const rope = this.getRope();
    return rope.lineCount;
  }

  /**
   * Get the visible text content, or a slice of it.
   */
  getText(start?: number, end?: number): string {
    const text = this.getFullText();
    if (start !== undefined || end !== undefined) {
      const s = start ?? 0;
      const e = end ?? text.length;
      return text.slice(s, e);
    }
    return text;
  }

  /**
   * Get a single line by 0-based line number.
   */
  getLine(line: number): string {
    return this.getRope().getLine(line);
  }

  /**
   * Convert a line number (0-based) to the UTF-16 offset of the start of that line.
   */
  lineToOffset(line: number): number {
    return this.getRope().lineToOffset(line);
  }

  /**
   * Convert a UTF-16 offset to {line, col} (both 0-based).
   */
  offsetToLineCol(offset: number): { line: number; col: number } {
    return this.getRope().offsetToLineCol(offset);
  }

  // ---------------------------------------------------------------------------
  // DocumentSnapshot interface for anchor resolution
  // ---------------------------------------------------------------------------

  /**
   * Seek to a fragment by insertion ID and offset.
   * Used for O(log n) anchor resolution (linear scan in this implementation).
   */
  seekToInsertion(insertionId: AnchorOperationId, offset: number): SeekResult {
    let utf16Offset = 0;

    for (const frag of this.fragments) {
      // Check if this fragment matches the insertion ID
      // Note: anchor module uses `localSeq`, our fragments use `counter`
      if (
        frag.insertionId.replicaId === insertionId.replicaId &&
        frag.insertionId.counter === insertionId.localSeq
      ) {
        // Check if the offset falls within this fragment's insertion range
        const fragStart = frag.insertionOffset;
        const fragEnd = frag.insertionOffset + frag.length;

        if (offset >= fragStart && offset < fragEnd) {
          const localOffset = offset - fragStart;
          const position = frag.visible ? utf16Offset + localOffset : utf16Offset;

          return {
            found: true,
            fragment: this.toInsertionFragment(frag),
            position: { utf16Offset: position },
          };
        }

        if (offset === fragEnd) {
          const position = frag.visible ? utf16Offset + frag.length : utf16Offset;
          return {
            found: true,
            fragment: this.toInsertionFragment(frag),
            position: { utf16Offset: position },
          };
        }
      }

      if (frag.visible) {
        utf16Offset += frag.length;
      }
    }

    return {
      found: false,
      fragment: null,
      position: { utf16Offset: 0 },
    };
  }

  /**
   * Find the anchor at a given UTF-16 offset.
   */
  anchorAtOffset(utf16Offset: number, bias: Bias): Anchor {
    let currentOffset = 0;
    let lastVisibleFrag: Fragment | undefined;

    for (const frag of this.fragments) {
      if (!frag.visible) continue;

      lastVisibleFrag = frag;
      const fragEnd = currentOffset + frag.length;

      if (utf16Offset < fragEnd) {
        // Strictly inside this fragment
        const localOffset = utf16Offset - currentOffset;
        return {
          insertionId: {
            replicaId: frag.insertionId.replicaId,
            localSeq: frag.insertionId.counter,
          },
          offset: frag.insertionOffset + localOffset,
          bias,
        };
      }

      if (utf16Offset === fragEnd) {
        // At exact boundary — with Left bias stay here, with Right bias go to next
        if (bias === 0) {
          // Left bias
          return {
            insertionId: {
              replicaId: frag.insertionId.replicaId,
              localSeq: frag.insertionId.counter,
            },
            offset: frag.insertionOffset + frag.length,
            bias,
          };
        }
        // Right bias: continue to next fragment
      }

      currentOffset = fragEnd;
    }

    // Past end of document
    if (lastVisibleFrag !== undefined) {
      return {
        insertionId: {
          replicaId: lastVisibleFrag.insertionId.replicaId,
          localSeq: lastVisibleFrag.insertionId.counter,
        },
        offset: lastVisibleFrag.insertionOffset + lastVisibleFrag.length,
        bias,
      };
    }

    // Empty document
    return {
      insertionId: { replicaId: 0, localSeq: 0 },
      offset: 0,
      bias,
    };
  }

  /**
   * Iterate over all fragments in document order.
   */
  visitFragments(visitor: FragmentVisitor): void {
    let utf16Offset = 0;

    for (const frag of this.fragments) {
      const insFrag = this.toInsertionFragment(frag);
      const position: Position = { utf16Offset };
      const shouldContinue = visitor(insFrag, position);
      if (!shouldContinue) break;

      if (frag.visible) {
        utf16Offset += frag.length;
      }
    }
  }

  /**
   * Resolve an Anchor to a UTF-16 offset in this snapshot.
   */
  resolveAnchor(anchor: Anchor): number {
    const result = this.seekToInsertion(anchor.insertionId, anchor.offset);
    if (result.found) {
      return result.position.utf16Offset;
    }
    // Sentinel anchors
    if (anchor.insertionId.replicaId === 0 && anchor.insertionId.localSeq === 0) {
      return 0;
    }
    return this.length;
  }

  /**
   * Create an anchor at the given offset.
   */
  createAnchor(offset: number, bias = 0): Anchor {
    return this.anchorAtOffset(offset, bias as Bias);
  }

  /**
   * Release this snapshot. After calling release(), the snapshot should not be used.
   */
  release(): void {
    this.released = true;
    this._text = null;
    this._rope = null;
  }

  // ---------------------------------------------------------------------------
  // Iterators
  // ---------------------------------------------------------------------------

  /**
   * Iterate over lines in the document.
   *
   * @param startLine - Starting line number (0-based, inclusive). Defaults to 0.
   * @param endLine - Ending line number (0-based, exclusive). Defaults to lineCount.
   *
   * @example
   * ```ts
   * for (const line of snapshot.lines()) {
   *   console.log(line);
   * }
   *
   * // Iterate lines 5-10
   * for (const line of snapshot.lines(5, 10)) {
   *   console.log(line);
   * }
   * ```
   */
  *lines(startLine?: number, endLine?: number): IterableIterator<string> {
    yield* this.getRope().lines(startLine, endLine);
  }

  /**
   * Iterate over raw text chunks in the document.
   *
   * Chunks are the internal storage units. This provides efficient
   * access to the underlying data without constructing the full string.
   *
   * @param start - Starting UTF-16 offset (inclusive). Defaults to 0.
   * @param end - Ending UTF-16 offset (exclusive). Defaults to length.
   *
   * @example
   * ```ts
   * for (const chunk of snapshot.chunks()) {
   *   process(chunk);
   * }
   * ```
   */
  *chunks(start?: number, end?: number): IterableIterator<string> {
    yield* this.getRope().chunks(start, end);
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  private getFullText(): string {
    if (this._text !== null) return this._text;
    const parts: string[] = [];
    for (const frag of this.fragments) {
      if (frag.visible) {
        parts.push(frag.text);
      }
    }
    this._text = parts.join("");
    return this._text;
  }

  private getRope(): Rope {
    if (this._rope !== null) return this._rope;
    this._rope = Rope.from(this.getFullText());
    return this._rope;
  }

  private toInsertionFragment(frag: Fragment): InsertionFragment {
    return {
      insertionId: {
        replicaId: frag.insertionId.replicaId,
        localSeq: frag.insertionId.counter,
      },
      startOffset: frag.insertionOffset,
      endOffset: frag.insertionOffset + frag.length,
      isDeleted: !frag.visible,
      utf16Len: frag.visible ? frag.length : 0,
    };
  }
}
