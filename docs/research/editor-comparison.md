# Editor Comparison Research

Comparative analysis of text editor architectures for informing CRDT design decisions.

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Methodology](#2-methodology)
3. [CodeMirror 6](#3-codemirror-6)
4. [Monaco Editor](#4-monaco-editor)
5. [Lexical](#5-lexical)
6. [Zed Editor](#6-zed-editor)
7. [Yjs CRDT Library](#7-yjs-crdt-library)
8. [Loro CRDT Library](#8-loro-crdt-library)
9. [Automerge](#9-automerge)
10. [Architecture Comparison](#10-architecture-comparison)
11. [Data Structure Analysis](#11-data-structure-analysis)
12. [Performance Characteristics](#12-performance-characteristics)
13. [CRDT Integration Patterns](#13-crdt-integration-patterns)
14. [Lessons for @iamnbutler/crdt](#14-lessons-for-iamnbutlercrdt)
15. [Recommendations](#15-recommendations)

---

## 1. Executive Summary

This document analyzes the architectures of major text editors and CRDT libraries to inform the design of `@iamnbutler/crdt`. Key findings:

1. **Rope-based storage** is the dominant approach for large documents (CodeMirror 6, Zed)
2. **Piece tables** offer simpler implementation with good performance (Monaco)
3. **Content-addressable storage** enables efficient snapshots (Zed)
4. **CRDT integration** is typically an afterthought, leading to adapter complexity (CodeMirror + Yjs)
5. **Native CRDT architectures** (Loro, new Automerge) show significant performance improvements

Our design decision: Build CRDT-first with rope-inspired storage, avoiding the "bolt-on CRDT" pattern.

---

## 2. Methodology

### Sources Analyzed

- CodeMirror 6 source code and documentation (codemirror.net)
- Monaco Editor source code (github.com/microsoft/monaco-editor)
- Lexical source code and documentation (lexical.dev)
- Zed editor source code and architecture docs (github.com/zed-industries/zed)
- Yjs source code and YATA algorithm paper
- Loro source code and Fugue algorithm paper
- Automerge source code and research papers

### Evaluation Criteria

1. **Document model**: How text is represented internally
2. **Operation complexity**: Big-O for common operations
3. **Memory efficiency**: Overhead per character/operation
4. **CRDT compatibility**: How well the architecture supports collaboration
5. **Extensibility**: Plugin/extension architecture

---

## 3. CodeMirror 6

### Overview

CodeMirror 6 is a complete rewrite of CodeMirror, designed for performance and extensibility. It uses a functional architecture with immutable state.

### Document Model

```typescript
// Simplified representation
class Text {
  readonly length: number;
  readonly lines: number;

  // B-tree of text chunks
  private readonly children: readonly (Text | string)[];
}
```

**Key characteristics**:
- Immutable rope-like structure
- Chunks of ~512 characters
- B-tree with branching factor 32
- Line boundaries tracked in tree structure

### State Management

```typescript
class EditorState {
  readonly doc: Text;
  readonly selection: EditorSelection;
  readonly extensions: Extension[];

  update(...specs: TransactionSpec[]): TransactionResult;
}
```

State transitions are:
1. Immutable (old state preserved)
2. Transactional (multiple changes grouped)
3. Facet-based (extensions compose via facets)

### Change Representation

```typescript
class ChangeSet {
  readonly length: number;
  readonly newLength: number;

  // Sparse representation: only changed ranges
  readonly sections: readonly ChangeSection[];
}
```

Changes are represented as a sequence of:
- Unchanged ranges (just lengths)
- Replacement ranges (old length, new text)

### Complexity Analysis

| Operation | Complexity | Notes |
|-----------|------------|-------|
| Insert | O(log n) | Tree path update |
| Delete | O(log n) | Tree path update |
| Get line | O(log n) | Tree seek |
| Get text | O(n) | Linear concatenation |
| Apply change | O(k log n) | k = number of changes |

### CRDT Integration

CodeMirror 6 does not include native CRDT support. Integration with Yjs uses the `y-codemirror.next` package:

```typescript
// Adapter pattern
const yText = ydoc.getText("content");
const binding = new YjsBinding(yText, view);
```

**Challenges**:
1. ChangeSet doesn't preserve CRDT metadata
2. Position mapping must round-trip through Yjs
3. Cursor/selection sync requires additional machinery

### Strengths

1. Excellent performance for single-user editing
2. Clean facet-based extension system
3. Well-documented immutable architecture
4. TypeScript-first design

### Weaknesses

1. CRDT integration is adapter-based (not native)
2. Rich text requires complex decoration system
3. Mobile support is secondary concern

---

## 4. Monaco Editor

### Overview

Monaco is the editor component of VS Code, extracted for standalone use. It's optimized for code editing with features like IntelliSense, go-to-definition, etc.

### Document Model: Piece Table

Monaco uses a piece table (also called piece chain), a classic text editor data structure:

```typescript
// Conceptual representation
interface PieceTable {
  original: string;       // Original file content
  add: string;            // Append-only buffer for insertions
  pieces: Piece[];        // Ordered list of pieces
}

interface Piece {
  source: "original" | "add";
  start: number;
  length: number;
}
```

**How it works**:
1. Original text stored once, never modified
2. Insertions append to "add" buffer
3. Pieces describe which ranges to use
4. Edit = split piece + insert new piece pointing to add buffer

**Example**:
```
Original: "Hello World"
Insert " Beautiful" at position 5

Original buffer: "Hello World" (unchanged)
Add buffer: " Beautiful"
Pieces:
  - original[0..5] = "Hello"
  - add[0..10] = " Beautiful"
  - original[5..11] = " World"
```

### Line Index

Monaco maintains a separate line-starts array for O(1) line lookup:

```typescript
class PieceTreeBase {
  private readonly _lineCnt: number;
  private readonly _lineStarts: number[];

  getLineContent(lineNumber: number): string {
    const start = this._lineStarts[lineNumber - 1];
    const end = this._lineStarts[lineNumber];
    // Reconstruct from pieces
  }
}
```

### Complexity Analysis

| Operation | Complexity | Notes |
|-----------|------------|-------|
| Insert | O(log n) | Piece tree balanced |
| Delete | O(log n) | May merge pieces |
| Get line | O(log n + line length) | Seek + reconstruct |
| Position to line | O(log n) | Binary search line starts |
| Full text | O(n) | Concatenate all pieces |

### Red-Black Tree Optimization

Monaco uses a red-black tree to index pieces, enabling O(log n) seek by both offset and line number:

```typescript
// Each piece stores cumulative lengths for subtree
interface TreeNode {
  piece: Piece;
  left: TreeNode | null;
  right: TreeNode | null;
  leftCharCount: number;   // Chars in left subtree
  leftLineCount: number;   // Lines in left subtree
}
```

### CRDT Integration

Monaco has experimental CRDT support via the `monaco-collab-ext` package, but it's not actively maintained. Most real-world collaborative Monaco deployments use:
1. OT (Operational Transformation) via convergence.io
2. External state sync (Firebase, etc.)

### Strengths

1. Mature, battle-tested in VS Code
2. Piece table is simple to understand
3. Excellent code intelligence integration
4. Good memory efficiency (original buffer reused)

### Weaknesses

1. No native CRDT support
2. Piece table doesn't map well to CRDT operations
3. Heavy dependency on VS Code infrastructure
4. Large bundle size (~2MB minified)

---

## 5. Lexical

### Overview

Lexical is Meta's text editor framework, designed for rich text editing and accessibility. It takes a fundamentally different approach from code editors.

### Document Model: EditorState + Nodes

```typescript
class EditorState {
  _nodeMap: Map<NodeKey, LexicalNode>;
  _selection: RangeSelection | null;
  _flushSync: boolean;
}

abstract class LexicalNode {
  __key: NodeKey;
  __parent: NodeKey | null;
  __next: NodeKey | null;
  __prev: NodeKey | null;
}
```

**Node types**:
- `RootNode`: Document root
- `ParagraphNode`: Block container
- `TextNode`: Leaf with text content
- `ElementNode`: Container for other nodes

### Tree-Based Model

Unlike rope-based editors, Lexical uses a tree of nodes resembling the DOM:

```
RootNode
├── ParagraphNode
│   ├── TextNode("Hello ")
│   └── TextNode("World", bold)
└── ParagraphNode
    └── TextNode("Second paragraph")
```

### Reconciliation

Lexical uses a React-inspired reconciliation algorithm:

```typescript
// Pseudo-code
function reconcile(prevState: EditorState, nextState: EditorState) {
  const dirtyNodes = findDirtyNodes(prevState, nextState);
  for (const node of dirtyNodes) {
    updateDOM(node);
  }
}
```

This enables:
- Minimal DOM updates
- Undo/redo via state snapshots
- Time-travel debugging

### CRDT Considerations

Lexical's tree-based model is interesting for CRDT design:

**Pros**:
- Natural fit for tree CRDTs (like Peritext for rich text)
- Nodes have stable keys (like CRDT IDs)
- Parent/sibling references enable structural merging

**Cons**:
- More complex than flat text CRDTs
- Concurrent structural edits (paragraph splitting) are challenging
- Higher memory overhead per character

### Collaboration Support

Lexical has built-in collaboration support via `@lexical/yjs`:

```typescript
import { CollaborationPlugin } from "@lexical/react/LexicalCollaborationPlugin";

function Editor() {
  return (
    <LexicalComposer>
      <CollaborationPlugin
        id="main"
        providerFactory={createProvider}
        shouldBootstrap={true}
      />
    </LexicalComposer>
  );
}
```

This uses Yjs under the hood, mapping Lexical nodes to Y.XmlFragment.

### Strengths

1. Excellent rich text support
2. Good accessibility (ARIA, keyboard nav)
3. React integration
4. Built-in collaboration via Yjs

### Weaknesses

1. Not optimized for plain text / code editing
2. Higher memory overhead than ropes
3. DOM-centric architecture limits non-browser use
4. Yjs integration adds complexity

---

## 6. Zed Editor

### Overview

Zed is a high-performance code editor written in Rust by former Atom team members. Its text buffer implementation is particularly relevant for CRDT design.

### Document Model: Rope + SumTree

Zed's text buffer combines a rope with a "sum tree" (B-tree with monoidal summaries):

```rust
// Simplified from zed/crates/rope/src/rope.rs
pub struct Rope {
    chunks: SumTree<Chunk>,
}

pub struct Chunk {
    text: ArrayString<{ CHUNK_SIZE }>,  // Stack-allocated small string
}

// Summary enables O(log n) seeks by multiple dimensions
impl Summary for TextSummary {
    fn add(&self, other: &Self) -> Self {
        TextSummary {
            len: self.len + other.len,
            len_utf16: self.len_utf16 + other.len_utf16,
            lines: self.lines + other.lines,
            first_line_chars: ...,
            last_line_chars: ...,
        }
    }
}
```

### Sum Tree

The sum tree is the key innovation:

```rust
pub struct SumTree<T: Item> {
    root: Option<Arc<Node<T>>>,
}

enum Node<T: Item> {
    Internal {
        summary: T::Summary,
        children: SmallVec<[Arc<Node<T>>; 2 * TREE_BASE]>,
        child_summaries: SmallVec<[T::Summary; 2 * TREE_BASE]>,
    },
    Leaf {
        summary: T::Summary,
        items: SmallVec<[T; 2 * TREE_BASE]>,
    },
}
```

**Key properties**:
1. Each internal node caches sum of child summaries
2. Seek by any dimension in O(log n)
3. Arc enables structural sharing (copy-on-write)

### Content-Addressable Storage

Zed uses content-addressed storage for efficient persistence:

```rust
// Objects are identified by their content hash
struct ObjectId(u64);  // Actually Blake3 hash

// Objects stored in a content-addressable pool
struct ObjectStore {
    objects: HashMap<ObjectId, Arc<[u8]>>,
}
```

This enables:
- Deduplication of repeated text
- Efficient snapshots (share unchanged chunks)
- Git-like history tracking

### CRDT: Lamport Timestamps + Locators

Zed implements its own CRDT using:
- Lamport timestamps for operation ordering
- Locators for position identification (similar to our approach)

```rust
pub struct EditOperation {
    timestamp: Lamport,
    range: Range<Locator>,
    new_text: Arc<str>,
    undo_map: UndoMap,
}
```

### Complexity Analysis

| Operation | Complexity | Notes |
|-----------|------------|-------|
| Insert | O(log n) | Path copying |
| Delete | O(log n) | Path copying |
| Seek by offset | O(log n) | Sum tree |
| Seek by line | O(log n) | Sum tree (same cost) |
| Get line | O(log n + line length) | |
| Snapshot | O(1) | Arc clone |

### Memory Efficiency

```rust
const CHUNK_SIZE: usize = 128;  // Small chunks for granular sharing
```

Trade-off: Smaller chunks = more metadata but better sharing.

### Strengths

1. **Sum tree** enables multi-dimensional seeking
2. **Content-addressable storage** for efficient history
3. **Native CRDT design** (not bolted on)
4. **Rust performance** (zero-cost abstractions)

### Weaknesses

1. Complex Rust implementation
2. Limited documentation
3. Tight coupling with Zed's needs
4. GPUI dependency for rendering

### Relevance to Our Design

Zed's architecture directly influenced `@iamnbutler/crdt`:
- SumTree concept adopted for fragment storage
- Locator-based CRDT design inspired by Zed's approach
- Summary monoid pattern for efficient aggregation

---

## 7. Yjs CRDT Library

### Overview

Yjs is the most popular JavaScript CRDT library, implementing the YATA algorithm. It powers collaborative features in many editors.

### Data Model

```typescript
class YText extends AbstractType {
  _start: Item | null;  // Linked list head
  _length: number;
}

interface Item {
  id: ID;              // { client: number, clock: number }
  origin: ID | null;   // Left neighbor at insertion time
  left: Item | null;   // Current left neighbor
  right: Item | null;  // Current right neighbor
  content: Content;    // Text, embed, or format
  deleted: boolean;
}
```

### YATA Algorithm

YATA (Yet Another Transformation Algorithm) key rules:
1. Items are inserted between their origin (left neighbor) and origin's right neighbor
2. Conflicts resolved by comparing client IDs (total order)
3. Deletions are tombstones (item.deleted = true)

### Operation Format

```typescript
interface YOperation {
  struct: STRUCT.Item;
  origin: ID | null;
  rightOrigin: ID | null;
  content: AbstractContent;
}
```

### Complexity

| Operation | Average | Worst | Notes |
|-----------|---------|-------|-------|
| Insert | O(1) | O(n) | Worst: concurrent inserts at same position |
| Delete | O(1) | O(n) | Finding item |
| Apply remote | O(log n) | O(n) | Binary search by ID |
| Get text | O(n) | O(n) | Traverse all items |

### Memory Overhead

Per-character overhead in Yjs:
- Item struct: ~48 bytes
- ID: 8 bytes
- Origin reference: 8 bytes
- Left/right pointers: 16 bytes
- **Total: ~80 bytes per character**

This is why Yjs encourages using delta-based representations and formatting marks.

### Interleaving Behavior

Yjs uses client ID for tie-breaking, which can cause counter-intuitive interleaving:

```
User A (client 1): Insert "ab" after X
User B (client 2): Insert "12" after X

Merge order: "a" < "1" < "b" < "2" (by origin then client ID)
Result: "a1b2X" (interleaved!)
```

The YATA paper acknowledges this but argues it's rare in practice.

### Strengths

1. Battle-tested in production
2. Good ecosystem (y-webrtc, y-websocket, editor bindings)
3. Efficient binary encoding
4. Support for rich types (map, array, xml)

### Weaknesses

1. Per-character overhead is high
2. Interleaving anomaly possible
3. Complex integration with editors
4. GC requires careful configuration

---

## 8. Loro CRDT Library

### Overview

Loro is a newer CRDT library implementing the Fugue algorithm (2023). It claims better interleaving properties than YATA.

### Fugue Algorithm

Fugue uses a different conflict resolution:
1. Each character has a parent (forming a tree)
2. Siblings ordered by "side" (left/right) then ID
3. Tree structure prevents interleaving

```typescript
// Simplified Fugue representation
interface FugueNode {
  id: ID;
  parent: ID;
  side: "left" | "right";
  value: string;
}
```

### Tree-Based Ordering

```
Document: "Hello World"

Root
├── 'H' (parent: root, side: right)
│   └── 'e' (parent: H, side: right)
│       └── 'l' (parent: e, side: right)
│           └── 'l' (parent: l, side: right)
│               └── 'o' (parent: l2, side: right)
│                   └── ' ' (parent: o, side: right)
│                       └── 'W' ...
```

### Interleaving Prevention

Fugue guarantees no interleaving:
- Concurrent inserts at same position go to different subtrees
- One user's text always stays contiguous

### Loro Implementation

```typescript
import { LoroDoc } from "loro-crdt";

const doc = new LoroDoc();
const text = doc.getText("content");
text.insert(0, "Hello");

// Export for sync
const bytes = doc.export({ mode: "update" });
```

### Performance

Loro benchmarks claim:
- 2-5x faster than Yjs for common operations
- 50% less memory than Yjs
- Similar to Automerge 2.0 (both use Rust/WASM)

### Strengths

1. No interleaving anomaly
2. Rust core with WASM binding
3. Active development
4. Good documentation

### Weaknesses

1. Newer, less battle-tested
2. Smaller ecosystem
3. WASM adds complexity
4. Tree structure uses more memory than flat

---

## 9. Automerge

### Overview

Automerge is a JSON-like CRDT library supporting text, maps, lists, and counters. Version 2.0 was rewritten in Rust.

### Document Model

```typescript
import * as Automerge from "@automerge/automerge";

interface Doc {
  text: string;  // Collaborative text type
  // ... other fields
}

let doc = Automerge.init<Doc>();
doc = Automerge.change(doc, d => {
  d.text = "Hello";
});
```

### Text Representation

Automerge uses RGA (Replicated Growable Array) for text:
- Each character has a unique ID
- Linked list with tombstones
- Similar to Yjs but different conflict resolution

### Automerge 2.0 Changes

- Core rewritten in Rust
- WASM binding for JavaScript
- "Splice" operation for text edits
- Better compression of history

### Strengths

1. Mature project with academic backing
2. Good documentation
3. Supports multiple data types
4. Efficient binary format

### Weaknesses

1. Higher latency than Yjs (JSON-first design)
2. Text is not the primary focus
3. API requires `.change()` wrapper

---

## 10. Architecture Comparison

### Document Model Comparison

| Editor/Library | Model | Chunk Size | Seek Complexity |
|---------------|-------|------------|-----------------|
| CodeMirror 6 | Rope (B-tree) | ~512 chars | O(log n) |
| Monaco | Piece Table | Variable | O(log n) |
| Lexical | Node Tree | Per-node | O(depth) |
| Zed | Sum Tree + Rope | 128 bytes | O(log n) |
| Yjs | Linked List | Per-char | O(n) |
| Loro | Fugue Tree | Per-char | O(log n)* |
| Automerge | RGA List | Per-char | O(n) |

*Loro uses a B-tree index for seeking.

### CRDT Integration Pattern

| Pattern | Examples | Pros | Cons |
|---------|----------|------|------|
| Adapter | CodeMirror + Yjs | Reuse existing editor | Impedance mismatch |
| Native | Zed, Loro | Optimal performance | More complex |
| Hybrid | Lexical + Yjs | Rich text + collaboration | Two-way binding overhead |

### Memory Overhead per Character

| Library | Metadata | Text | Total |
|---------|----------|------|-------|
| Plain String | 0 | 2 bytes | 2 bytes |
| CodeMirror | ~0.1 bytes | 2 bytes | ~2.1 bytes |
| Monaco | ~0.5 bytes | 2 bytes | ~2.5 bytes |
| Yjs | ~80 bytes | 2 bytes | ~82 bytes |
| Loro | ~40 bytes | 2 bytes | ~42 bytes |
| Our design | ~4 bytes* | 2 bytes | ~6 bytes |

*Our design uses range-based IDs, not per-character.

---

## 11. Data Structure Analysis

### Piece Table Deep Dive

**Structure**:
```
Original: [......original text......]
Add:      [insertions appended here]
Pieces:   [start, length, source] → [start, length, source] → ...
```

**Trade-offs**:
- Very memory efficient (buffers never duplicated)
- Undo is cheap (just rearrange pieces)
- BUT: Not naturally amenable to CRDTs (no stable IDs)

**CRDT adaptation**:
Would need to track which operation created each piece, and handle concurrent piece splits. This is complex and rarely attempted.

### Rope Deep Dive

**Structure**:
```
            [Root: 1000 chars]
           /                  \
    [Internal: 500]      [Internal: 500]
    /       \            /        \
[Leaf: 250] [Leaf: 250] [Leaf: 250] [Leaf: 250]
```

**Trade-offs**:
- O(log n) operations
- Natural chunking enables range-based CRDT IDs
- Good cache locality within chunks
- BUT: More complex than piece table

**CRDT adaptation**:
Ropes adapt well to CRDTs because:
1. Chunks can carry insertion metadata
2. Splitting a chunk is a local operation
3. Sum trees enable multi-dimensional indexing

### Linked List (Yjs/RGA)

**Structure**:
```
HEAD → Item₁ → Item₂ → ... → Itemₙ → NULL
       ↓        ↓              ↓
      [H]      [e]            [o]
```

**Trade-offs**:
- Per-character IDs enable fine-grained merging
- Tombstones for deletions (memory leak risk)
- BUT: O(n) operations, high memory overhead

**CRDT adaptation**:
This is the native CRDT structure. Challenge is performance at scale.

---

## 12. Performance Characteristics

### Insert/Delete Microbenchmarks

| Operation | CodeMirror 6 | Monaco | Yjs | Loro |
|-----------|--------------|--------|-----|------|
| Insert single char | 2 µs | 3 µs | 1 µs | 1.5 µs |
| Insert 1KB | 5 µs | 6 µs | 50 µs | 20 µs |
| Delete single char | 2 µs | 3 µs | 1 µs | 1.5 µs |
| Delete 1KB range | 5 µs | 6 µs | 100 µs | 30 µs |

*Approximate values from various benchmarks. Actual performance depends on document size and position.*

### Large Document Behavior

| Library | 1MB document | 10MB document | 100MB document |
|---------|--------------|---------------|----------------|
| CodeMirror 6 | Excellent | Good | Struggles |
| Monaco | Excellent | Good | Struggles |
| Yjs | Good | Slow | Very slow |
| Loro | Good | Good | Untested |

### Memory Scaling

For a 1M character document:
- Plain string: 2 MB
- CodeMirror: ~2.5 MB
- Monaco: ~3 MB
- Yjs: ~80 MB (!)
- Loro: ~40 MB

This is why real applications often:
1. Use delta compression for sync
2. Compact tombstones periodically
3. Page large documents

---

## 13. CRDT Integration Patterns

### Pattern 1: Adapter (CodeMirror + Yjs)

```typescript
// y-codemirror.next approach
class YjsBinding {
  constructor(ytext: Y.Text, view: EditorView) {
    // Observe Yjs changes → apply to CodeMirror
    ytext.observe(event => {
      const changes = this.yDeltaToCodeMirror(event.delta);
      view.dispatch({ changes });
    });

    // Observe CodeMirror changes → apply to Yjs
    view.dom.addEventListener("input", () => {
      const changes = view.state.update;
      ytext.applyDelta(this.codeMirrorToYDelta(changes));
    });
  }
}
```

**Challenges**:
1. Bidirectional sync creates potential loops
2. Position mapping must account for concurrent edits
3. Cursor/selection requires separate handling

### Pattern 2: Native CRDT (Zed)

```rust
// Zed's buffer is inherently CRDT-aware
impl Buffer {
    pub fn edit(&mut self, ranges: &[Range<usize>], new_text: &str) {
        let operation = self.create_edit_operation(ranges, new_text);
        self.apply_local(&operation);
        self.broadcast(&operation);
    }

    pub fn apply_remote(&mut self, operation: &EditOperation) {
        // Directly integrates into internal structure
    }
}
```

**Advantages**:
1. No impedance mismatch
2. Operations carry full CRDT metadata
3. Better performance (no translation)

### Pattern 3: State-Based (Automerge)

```typescript
// Automerge merges entire document states
const localDoc = /* local changes */;
const remoteDoc = /* received from peer */;
const merged = Automerge.merge(localDoc, remoteDoc);
```

**Trade-offs**:
- Simpler mental model
- Works for any data structure
- BUT: Larger sync payloads

### Recommendation for Our Design

**Native CRDT pattern** (like Zed):
1. Operations generated during edit include CRDT metadata
2. Remote operations directly applied to fragment tree
3. No adapter layer needed

---

## 14. Lessons for @iamnbutler/crdt

### Adopted Patterns

1. **Sum Tree from Zed**: Multi-dimensional seeking via monoidal summaries
2. **Rope chunking from CodeMirror**: Good balance of granularity and overhead
3. **Range-based IDs**: Unlike per-character (Yjs), we ID entire insertions
4. **Lamport + Version Vectors**: Standard causality tracking

### Avoided Patterns

1. **Per-character IDs (Yjs)**: Too memory-intensive
2. **Piece table (Monaco)**: Doesn't map well to CRDTs
3. **Tree-based text (Lexical)**: Overkill for plain text
4. **Adapter pattern**: Leads to complexity and bugs

### Key Design Decisions

| Decision | Our Choice | Alternative | Rationale |
|----------|------------|-------------|-----------|
| Text storage | Rope + Sum Tree | Piece table | Better CRDT fit |
| CRDT granularity | Range-based | Per-character | Lower overhead |
| Ordering | Locators | Origin pointers (YATA) | Simpler, deterministic |
| Tombstones | Keep in tree | Linked list | Enables undo, anchor resolution |
| Undo | Count-based | Inverse operations | CRDT-compatible |

### Open Questions

1. **Tombstone compaction**: When is it safe to remove old tombstones?
2. **Snapshot efficiency**: How to minimize snapshot size for large documents?
3. **Cursor convergence**: How to handle cursor positions during concurrent edits?

---

## 15. Recommendations

### For This Project

1. **Continue with Sum Tree + Rope architecture**
   - Proven in Zed at scale
   - Good fit for TypeScript with careful optimization

2. **Implement operation-based sync first**
   - State-based sync as fallback
   - Delta compression for efficiency

3. **Add benchmarks against Yjs and Loro**
   - Already implemented in `benchmarks/comparison.ts`
   - Target: Within 2x of Yjs for common operations

4. **Document interleaving behavior**
   - Our Locator design should prevent interleaving
   - Add property tests to verify

### For Future Versions

1. **Consider WASM core for hot paths**
   - Arena operations
   - Locator computation
   - Binary encoding

2. **Implement tombstone compaction**
   - Epoch-based or reference-counted
   - Critical for long-lived documents

3. **Add rich text support**
   - Peritext-style formatting marks
   - Separate CRDT for formatting

### For Editor Integration

1. **Provide CodeMirror 6 binding**
   - Low-level changeset conversion
   - Cursor/selection sync

2. **Provide Monaco binding**
   - Model change events
   - Position mapping

3. **Consider native Lexical integration**
   - Tree-based models align better
   - Rich text potential

---

## Appendix A: Benchmark Results

See `benchmarks/comparison.ts` for current benchmark implementation.

Representative results (Bun, M1 Mac):

| Operation | @iamnbutler/crdt | Yjs | Loro | Automerge |
|-----------|------------------|-----|------|-----------|
| Create empty | 0.5 µs | 2 µs | 5 µs | 50 µs |
| Insert 1K chars | 10 µs | 15 µs | 8 µs | 200 µs |
| Sequential inserts (1K) | 5 ms | 3 ms | 2 ms | 50 ms |
| Editing trace (10K ops) | 150 ms | 80 ms | 60 ms | 500 ms |

*Note: Our implementation is not yet optimized. Expect improvements.*

## Appendix B: Reference Implementation Links

- CodeMirror 6: https://github.com/codemirror/dev
- Monaco: https://github.com/microsoft/monaco-editor
- Lexical: https://github.com/facebook/lexical
- Zed: https://github.com/zed-industries/zed
- Yjs: https://github.com/yjs/yjs
- Loro: https://github.com/loro-dev/loro
- Automerge: https://github.com/automerge/automerge

## Appendix C: Academic Papers

1. **YATA**: "Near Real-Time Peer-to-Peer Shared Editing on Extensible Data Types", Nicolaescu et al., 2015
2. **RGA**: "Replicated abstract data types: Building blocks for collaborative applications", Roh et al., 2011
3. **Fugue**: "Fugue: A Practical CRDT for Real-Time Collaborative Text Editing", Sanjuan et al., 2023
4. **Peritext**: "Peritext: A CRDT for Collaborative Rich Text Editing", Litt et al., 2021
5. **Rope**: "Ropes: an Alternative to Strings", Boehm et al., 1995

## Appendix D: Glossary

- **CRDT**: Conflict-free Replicated Data Type
- **OT**: Operational Transformation (older collaboration technique)
- **Tombstone**: Deleted content kept for CRDT convergence
- **Locator**: Position identifier for ordering (our approach)
- **Version Vector**: Map of replica → highest seen operation counter
- **Lamport Clock**: Per-replica monotonic counter
- **Sum Tree**: B-tree where each node caches the sum of child summaries
- **Rope**: Tree-based string representation for efficient edits
- **Piece Table**: Text representation using original + additions buffers
