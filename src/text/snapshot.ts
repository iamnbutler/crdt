/**
 * TextBufferSnapshot: Immutable view of a TextBuffer at a point in time.
 *
 * O(1) snapshot creation via root NodeId capture and arena sharing.
 * Implements the DocumentSnapshot interface from the anchor module so that
 * CRDT anchors can be created and resolved against buffer state.
 *
 * Lifecycle:
 * - Create via TextBuffer.snapshot()
 * - Call release() when done to enable epoch-based reclamation
 * - FinalizationRegistry warns if GC'd without release()
 * - Auto-release after maxAge (default 30s) prevents memory leaks
 */

import type { DocumentSnapshot, FragmentVisitor, SeekResult } from "../anchor/snapshot.js";
import type {
  Anchor,
  OperationId as AnchorOperationId,
  Bias,
  InsertionFragment,
  Position,
} from "../anchor/types.js";
import type { Epoch } from "../arena/index.js";
import { Rope } from "../rope/rope.js";
import type { SumTree } from "../sum-tree/index.js";
import type { Fragment, FragmentSummary, VersionVector } from "./types.js";

/** Default max age for snapshots before auto-release (30 seconds). */
const DEFAULT_MAX_AGE_MS = 30_000;

/** Callback for when a snapshot is released. */
export type SnapshotReleaseCallback = (epoch: Epoch, wasAutoRelease: boolean) => void;

/** Options for snapshot creation. */
export interface SnapshotOptions {
  /** Maximum age in milliseconds before auto-release. Set to 0 to disable. */
  maxAgeMs?: number;
  /** Callback when snapshot is released. */
  onRelease?: SnapshotReleaseCallback;
}

/** Held value type for FinalizationRegistry. */
interface SnapshotRegistryHeld {
  epoch: Epoch;
  createdAt: number;
  onRelease: SnapshotReleaseCallback | null;
}

// FinalizationRegistry for leak detection
const snapshotRegistry = new FinalizationRegistry<SnapshotRegistryHeld>((held) => {
  // Snapshot was GC'd without explicit release() - log warning
  const age = Date.now() - held.createdAt;
  console.warn(
    `[TextBufferSnapshot] Leaked snapshot from epoch ${held.epoch} ` +
      `was GC'd after ${age}ms without release(). ` +
      `Call snapshot.release() when done to enable memory reclamation.`,
  );
  // Still call the release callback so the epoch can be freed
  if (held.onRelease !== null) {
    held.onRelease(held.epoch, true);
  }
});

/**
 * An immutable O(1) snapshot of the TextBuffer.
 *
 * Captures:
 * - Root NodeId of the fragment SumTree (O(1))
 * - Cloned VersionVector (O(replicas))
 * - Reference to the shared arena
 *
 * All read operations traverse the tree on-demand, seeing the frozen state.
 */
export class TextBufferSnapshot implements DocumentSnapshot {
  private readonly tree: SumTree<Fragment, FragmentSummary>;
  private readonly _version: VersionVector;
  private readonly _epoch: Epoch;
  private readonly createdAt: number;
  private readonly maxAgeMs: number;
  private readonly onRelease: SnapshotReleaseCallback | null;
  private autoReleaseTimer: ReturnType<typeof setTimeout> | null;

  private _text: string | null;
  private _rope: Rope | null;
  private _released: boolean;

  constructor(
    tree: SumTree<Fragment, FragmentSummary>,
    version: VersionVector,
    epoch: Epoch,
    options: SnapshotOptions = {},
  ) {
    this.tree = tree;
    this._version = version;
    this._epoch = epoch;
    this.createdAt = Date.now();
    this.maxAgeMs = options.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
    this.onRelease = options.onRelease ?? null;
    this.autoReleaseTimer = null;

    this._text = null;
    this._rope = null;
    this._released = false;

    // Register for leak detection
    const registryHeld: SnapshotRegistryHeld = {
      epoch,
      createdAt: this.createdAt,
      onRelease: this.onRelease,
    };
    snapshotRegistry.register(this, registryHeld, this);

    // Set up auto-release timer if maxAge > 0
    if (this.maxAgeMs > 0) {
      this.autoReleaseTimer = setTimeout(() => {
        if (!this._released) {
          console.warn(
            `[TextBufferSnapshot] Auto-releasing snapshot from epoch ${epoch} ` +
              `after ${this.maxAgeMs}ms. Consider calling release() explicitly.`,
          );
          this.release(true);
        }
      }, this.maxAgeMs);
    }
  }

  /** The epoch at which this snapshot was created. */
  get epoch(): Epoch {
    return this._epoch;
  }

  /** Version vector at the time of this snapshot. */
  get version(): VersionVector {
    return this._version;
  }

  /** Whether this snapshot has been released. */
  get released(): boolean {
    return this._released;
  }

  /** Age of this snapshot in milliseconds. */
  get age(): number {
    return Date.now() - this.createdAt;
  }

  /** Total UTF-16 length of visible text. O(1) via summary. */
  get length(): number {
    this.checkReleased();
    return this.tree.summary().visibleLen;
  }

  /** Number of lines in the document. */
  get lineCount(): number {
    this.checkReleased();
    const rope = this.getRope();
    return rope.lineCount;
  }

  /**
   * Get the visible text content, or a slice of it.
   */
  getText(start?: number, end?: number): string {
    this.checkReleased();
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
    this.checkReleased();
    return this.getRope().getLine(line);
  }

  /**
   * Convert a line number (0-based) to the UTF-16 offset of the start of that line.
   */
  lineToOffset(line: number): number {
    this.checkReleased();
    return this.getRope().lineToOffset(line);
  }

  /**
   * Convert a UTF-16 offset to {line, col} (both 0-based).
   */
  offsetToLineCol(offset: number): { line: number; col: number } {
    this.checkReleased();
    return this.getRope().offsetToLineCol(offset);
  }

  // ---------------------------------------------------------------------------
  // DocumentSnapshot interface for anchor resolution
  // ---------------------------------------------------------------------------

  /**
   * Seek to a fragment by insertion ID and offset.
   * O(n) scan through fragments (could be optimized with secondary index).
   */
  seekToInsertion(insertionId: AnchorOperationId, offset: number): SeekResult {
    this.checkReleased();
    let utf16Offset = 0;

    for (const frag of this.fragments()) {
      // Check if this fragment matches the insertion ID
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
    this.checkReleased();
    let currentOffset = 0;
    let lastVisibleFrag: Fragment | undefined;

    for (const frag of this.fragments()) {
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
    this.checkReleased();
    let utf16Offset = 0;

    for (const frag of this.fragments()) {
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
    this.checkReleased();
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
    this.checkReleased();
    return this.anchorAtOffset(offset, bias as Bias);
  }

  /**
   * Release this snapshot. After calling release(), the snapshot should not be used.
   * This enables epoch-based memory reclamation.
   */
  release(isAutoRelease = false): void {
    if (this._released) return;

    this._released = true;
    this._text = null;
    this._rope = null;

    // Cancel auto-release timer
    if (this.autoReleaseTimer !== null) {
      clearTimeout(this.autoReleaseTimer);
      this.autoReleaseTimer = null;
    }

    // Unregister from FinalizationRegistry
    snapshotRegistry.unregister(this);

    // Notify the buffer to release the epoch
    if (this.onRelease !== null) {
      this.onRelease(this._epoch, isAutoRelease);
    }
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  /**
   * Iterate over fragments from the tree. This is O(n) traversal.
   */
  private *fragments(): Generator<Fragment> {
    for (const frag of this.tree.toArray()) {
      yield frag;
    }
  }

  private checkReleased(): void {
    if (this._released) {
      throw new Error("Cannot use released snapshot");
    }
  }

  private getFullText(): string {
    if (this._text !== null) return this._text;
    const parts: string[] = [];
    for (const frag of this.fragments()) {
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
