/**
 * OperationBatcher: Coalesces sequential character insertions into batched
 * string inserts to dramatically reduce tree operations during typical typing.
 *
 * The observation: ~95% of real editing operations are sequential character
 * insertions at a cursor. Instead of processing 10,000 single-char inserts
 * (each requiring a tree traversal), we coalesce them into ~50 string inserts.
 *
 * CRDT correctness: Each batched insert is a single TextBuffer.insert() call
 * with a multi-character string. The TextBuffer already handles multi-char
 * inserts as single fragments with one Locator — this is correct because
 * local sequential typing at the same cursor position produces a contiguous
 * run that can be represented as one fragment. If a remote op arrives or
 * the cursor moves, the batch is flushed first.
 */

import type { TextBuffer } from "./text-buffer.js";
import type { Operation } from "./types.js";

/** A pending insert that may be extended with additional characters. */
interface PendingInsert {
  /** The document offset where the insert started. */
  startOffset: number;
  /** The accumulated text to insert. */
  text: string;
}

export interface OperationBatcherOptions {
  /**
   * Maximum number of characters to accumulate before auto-flushing.
   * Default: 100.
   */
  maxBatchSize?: number;

  /**
   * Auto-flush delay in milliseconds. After this period of no activity,
   * the pending batch is flushed. Set to 0 to disable timer-based flushing.
   * Default: 16 (one frame).
   */
  flushDelay?: number;

  /**
   * Callback invoked with each Operation produced by a flush.
   * Useful for broadcasting operations to remote peers.
   */
  onOperation?: (op: Operation) => void;
}

export class OperationBatcher {
  private buffer: TextBuffer;
  private pending: PendingInsert | null;
  private maxBatchSize: number;
  private flushDelay: number;
  private flushTimer: ReturnType<typeof setTimeout> | null;
  private onOperation: ((op: Operation) => void) | null;

  /** Count of inserts coalesced (for diagnostics). */
  private _coalesced: number;
  /** Count of flushes performed (for diagnostics). */
  private _flushCount: number;

  constructor(buffer: TextBuffer, options?: OperationBatcherOptions) {
    this.buffer = buffer;
    this.pending = null;
    this.maxBatchSize = options?.maxBatchSize ?? 100;
    this.flushDelay = options?.flushDelay ?? 16;
    this.flushTimer = null;
    this.onOperation = options?.onOperation ?? null;
    this._coalesced = 0;
    this._flushCount = 0;
  }

  /**
   * Insert a character (or short string) at the given document offset.
   * Sequential inserts at the cursor position are coalesced into a single
   * batched insert.
   */
  insert(offset: number, text: string): void {
    if (text.length === 0) return;

    if (this.pending !== null) {
      // Check if this insert is sequential (appending right after the pending text)
      const expectedOffset = this.pending.startOffset + this.pending.text.length;
      if (offset === expectedOffset) {
        // Coalesce: extend the pending insert
        this.pending.text += text;
        this._coalesced++;
        this.deferFlush();
        return;
      }

      // Non-sequential: flush the old batch, then start a new one
      this.flush();
    }

    // Start a new pending insert
    this.pending = { startOffset: offset, text };
    this.deferFlush();
  }

  /**
   * Delete text in the range [start, end).
   * Flushes any pending insert first to maintain ordering correctness.
   */
  delete(start: number, end: number): Operation {
    this.flush();
    const op = this.buffer.delete(start, end);
    if (this.onOperation !== null) {
      this.onOperation(op);
    }
    return op;
  }

  /**
   * Flush any pending inserts to the underlying TextBuffer.
   * Returns the operations produced (empty array if nothing was pending).
   */
  flush(): Operation[] {
    this.clearTimer();

    if (this.pending === null) {
      return [];
    }

    const { startOffset, text } = this.pending;
    this.pending = null;
    this._flushCount++;

    const op = this.buffer.insert(startOffset, text);
    if (this.onOperation !== null) {
      this.onOperation(op);
    }
    return [op];
  }

  /**
   * Apply a remote operation. Flushes pending local inserts first to
   * ensure correct ordering (remote ops must not interleave with a
   * partially-accumulated local batch).
   */
  applyRemote(operation: Operation): void {
    this.flush();
    this.buffer.applyRemote(operation);
  }

  /** Get the visible text. Flushes pending inserts first. */
  getText(): string {
    this.flush();
    return this.buffer.getText();
  }

  /** Get the visible text length. Flushes pending inserts first. */
  getLength(): number {
    if (this.pending !== null) {
      this.flush();
    }
    return this.buffer.length;
  }

  /** Access the underlying TextBuffer (flushes first). */
  getBuffer(): TextBuffer {
    this.flush();
    return this.buffer;
  }

  /** Access the underlying TextBuffer without flushing (for reads that don't need consistency). */
  get rawBuffer(): TextBuffer {
    return this.buffer;
  }

  /** Whether there are pending inserts that haven't been flushed. */
  get hasPending(): boolean {
    return this.pending !== null;
  }

  /** Number of characters currently pending. */
  get pendingLength(): number {
    return this.pending?.text.length ?? 0;
  }

  /** Total number of single-char inserts that were coalesced into existing batches. */
  get coalescedCount(): number {
    return this._coalesced;
  }

  /** Total number of flush operations performed. */
  get flushCount(): number {
    return this._flushCount;
  }

  /** Dispose the batcher, flushing any pending inserts and clearing timers. */
  dispose(): Operation[] {
    const ops = this.flush();
    this.clearTimer();
    return ops;
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  private deferFlush(): void {
    // Force-flush if batch is at capacity
    if (this.pending !== null && this.pending.text.length >= this.maxBatchSize) {
      this.flush();
      return;
    }

    // Schedule a timer-based flush (if enabled)
    if (this.flushDelay > 0 && this.flushTimer === null) {
      this.flushTimer = setTimeout(() => {
        this.flushTimer = null;
        this.flush();
      }, this.flushDelay);
    }
  }

  private clearTimer(): void {
    if (this.flushTimer !== null) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
  }
}
