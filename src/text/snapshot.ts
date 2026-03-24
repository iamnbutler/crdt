/**
 * TextBufferSnapshot: O(1) immutable view of a TextBuffer at a point in time.
 *
 * Implements the DocumentSnapshot interface from the anchor module so that
 * CRDT anchors can be created and resolved against buffer state.
 *
 * This implementation uses structural sharing via NodeId capture rather than
 * copying the entire fragment array. Snapshot creation is O(1) with O(replicas)
 * for cloning the VersionVector.
 */

import type { DocumentSnapshot, FragmentVisitor, SeekResult } from "../anchor/snapshot.js";
import type {
  Anchor,
  OperationId as AnchorOperationId,
  Bias,
  InsertionFragment,
  Position,
} from "../anchor/types.js";
import type { Arena, NodeId, SnapshotRegistration } from "../arena/index.js";
import { Rope } from "../rope/rope.js";
import type { Summary } from "../sum-tree/index.js";
import type { Fragment, FragmentSummary, VersionVector } from "./types.js";

/**
 * Default max age for snapshots in milliseconds (30 seconds).
 */
export const DEFAULT_MAX_SNAPSHOT_AGE_MS = 30_000;

/**
 * Warning message logged when a snapshot is garbage collected without being released.
 */
const LEAK_WARNING =
  "TextBufferSnapshot was garbage collected without calling release(). " +
  "This may indicate a memory leak. Always call snapshot.release() when done.";

/**
 * Interface for the internal tree view needed by snapshot.
 */
interface TreeView {
  readonly arena: Arena<LeafData>;
  readonly summaries: ReadonlyMap<NodeId, FragmentSummary>;
  readonly summaryOps: Summary<FragmentSummary>;
  readonly rootId: NodeId;
}

interface LeafData {
  items: Fragment[];
}

/**
 * FinalizationRegistry for detecting leaked snapshots.
 * Only created once and shared across all snapshots.
 */
let leakDetector: FinalizationRegistry<string> | null = null;

function getLeakDetector(): FinalizationRegistry<string> {
  if (leakDetector === null) {
    leakDetector = new FinalizationRegistry<string>((snapshotId) => {
      console.warn(`${LEAK_WARNING} (snapshot: ${snapshotId})`);
    });
  }
  return leakDetector;
}

/**
 * Options for creating a TextBufferSnapshot.
 */
export interface SnapshotOptions {
  /**
   * Max age in milliseconds before auto-release. Set to 0 to disable.
   * Default: 30000 (30 seconds)
   */
  maxAgeMs?: number;

  /**
   * Whether to enable leak detection via FinalizationRegistry.
   * Default: true in development, false in production (based on NODE_ENV).
   */
  enableLeakDetection?: boolean;
}

/**
 * An immutable snapshot of the TextBuffer using O(1) creation via NodeId capture.
 */
export class TextBufferSnapshot implements DocumentSnapshot {
  private readonly treeView: TreeView;
  private readonly _version: VersionVector;
  private readonly registration: SnapshotRegistration;
  private readonly maxAgeMs: number;
  private readonly maxAgeTimeout: ReturnType<typeof setTimeout> | null;

  private _text: string | null;
  private _rope: Rope | null;
  private _fragments: ReadonlyArray<Fragment> | null;
  private _released: boolean;
  private readonly snapshotId: string;

  constructor(
    treeView: TreeView,
    version: VersionVector,
    registration: SnapshotRegistration,
    options: SnapshotOptions = {},
  ) {
    this.treeView = treeView;
    this._version = version;
    this.registration = registration;
    this._text = null;
    this._rope = null;
    this._fragments = null;
    this._released = false;
    this.snapshotId = `${registration.id}@${registration.epoch}`;

    // Set up max age auto-release
    this.maxAgeMs = options.maxAgeMs ?? DEFAULT_MAX_SNAPSHOT_AGE_MS;
    if (this.maxAgeMs > 0) {
      this.maxAgeTimeout = setTimeout(() => {
        if (!this._released) {
          console.warn(
            `TextBufferSnapshot ${this.snapshotId} exceeded max age (${this.maxAgeMs}ms), auto-releasing`,
          );
          this.release();
        }
      }, this.maxAgeMs);
    } else {
      this.maxAgeTimeout = null;
    }

    // Set up leak detection
    const enableLeakDetection =
      options.enableLeakDetection ??
      (typeof process !== "undefined" && process.env?.NODE_ENV !== "production");
    if (enableLeakDetection) {
      getLeakDetector().register(this, this.snapshotId, this);
    }
  }

  /** Whether this snapshot has been released. */
  get released(): boolean {
    return this._released;
  }

  /** The snapshot registration info. */
  get info(): SnapshotRegistration {
    return this.registration;
  }

  /** Version vector at the time of this snapshot. */
  get version(): VersionVector {
    this.checkReleased();
    return this._version;
  }

  /** Total UTF-16 length of visible text. */
  get length(): number {
    this.checkReleased();
    const summary = this.treeView.summaries.get(this.treeView.rootId);
    return summary?.visibleLen ?? 0;
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
    this.checkReleased();
    const fragments = this.getFragments();
    let utf16Offset = 0;

    for (const frag of fragments) {
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
    this.checkReleased();
    const fragments = this.getFragments();
    let currentOffset = 0;
    let lastVisibleFrag: Fragment | undefined;

    for (const frag of fragments) {
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
    const fragments = this.getFragments();
    let utf16Offset = 0;

    for (const frag of fragments) {
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
   * This allows the arena to reclaim nodes from old epochs.
   * Returns the number of nodes that were reclaimed (may be 0 if other snapshots exist).
   */
  release(): number {
    if (this._released) {
      return 0;
    }

    this._released = true;

    // Clear timeout
    if (this.maxAgeTimeout !== null) {
      clearTimeout(this.maxAgeTimeout);
    }

    // Clear cached data
    this._text = null;
    this._rope = null;
    this._fragments = null;

    // Unregister from leak detector
    try {
      getLeakDetector().unregister(this);
    } catch {
      // Ignore errors if not registered
    }

    // Release from arena and trigger reclamation
    return this.treeView.arena.releaseSnapshot(this.registration);
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  private checkReleased(): void {
    if (this._released) {
      throw new Error("Cannot access released snapshot");
    }
  }

  private getFragments(): ReadonlyArray<Fragment> {
    this.checkReleased();
    if (this._fragments !== null) return this._fragments;

    // Collect fragments by traversing the tree
    const result: Fragment[] = [];
    this.collectItems(this.treeView.rootId, result);
    this._fragments = result;
    return result;
  }

  private collectItems(nodeId: NodeId, result: Fragment[]): void {
    const arena = this.treeView.arena;

    if (arena.isLeaf(nodeId)) {
      const data = arena.getItem(nodeId) as LeafData | undefined;
      if (data) {
        for (const item of data.items) {
          result.push(item);
        }
      }
      return;
    }

    const children = arena.getChildren(nodeId);
    for (const childId of children) {
      this.collectItems(childId, result);
    }
  }

  private getFullText(): string {
    this.checkReleased();
    if (this._text !== null) return this._text;

    const fragments = this.getFragments();
    const parts: string[] = [];
    for (const frag of fragments) {
      if (frag.visible) {
        parts.push(frag.text);
      }
    }
    this._text = parts.join("");
    return this._text;
  }

  private getRope(): Rope {
    this.checkReleased();
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

/**
 * Create a TextBufferSnapshot from a SumTree's internal state.
 * This is the O(1) factory function that should be used by TextBuffer.
 */
export function createSnapshot(
  rootId: NodeId,
  arena: Arena<LeafData>,
  summaries: ReadonlyMap<NodeId, FragmentSummary>,
  summaryOps: Summary<FragmentSummary>,
  version: VersionVector,
  options?: SnapshotOptions,
): TextBufferSnapshot {
  // Register with arena for epoch tracking
  const registration = arena.registerSnapshot([rootId]);

  // Advance epoch so future allocations are in a new epoch
  arena.advanceEpoch();

  const treeView: TreeView = {
    arena,
    summaries,
    summaryOps,
    rootId,
  };

  return new TextBufferSnapshot(treeView, version, registration, options);
}
