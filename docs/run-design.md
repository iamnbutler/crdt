# Text engine design

## Identity and ordering

An insertion names its predecessor character by `(actor, sequence)`. Its characters form a chain; each character also has an increasing Lamport time. Siblings sort by descending time, then descending actor ID. Text order is the preorder traversal of that conceptual RGA tree. Deletion is an observed set of character-ID intervals. Concurrent insertions inside a deleted range survive because their IDs were not observed by the deletion.

This uses the RGA ordering described in [Joseph Gentle's implementation discussion](https://josephg.com/blog/crdts-go-brrr/). It does not claim the maximal non-interleaving guarantees of [FugueMax](https://arxiv.org/abs/2305.00583).

## Physical representation

A `Run` compresses consecutive characters from one actor with consecutive IDs and times. The run records the origin of its first character; all subsequent origins are implicit. Runs split at edit/reference boundaries. Only unbranched chains can coalesce. This restriction keeps the explicit sibling index independent of storage compression. Deleting text changes visibility, not identity or ancestry.

Each physical run participates in three intrusive indexes:

| Index | Key / summary | Purpose |
| --- | --- | --- |
| Positional splay tree | Visible length; minimum RGA depth | Find a UTF-16 offset and jump over a sibling's entire subtree |
| Per-actor treap | Sequence interval | Resolve remote references and anchors without scanning text |
| Per-origin sibling treap | Lamport time and actor | Insert a concurrent sibling even when delivery order is reversed |

A doubly linked list supports sequential text materialization. Intrusive nodes avoid wrapper allocation. The positional tree splays each edit's run to the root, making consecutive typing cheap. Sequential extension changes an existing string/run; it does not create an ID map entry per character. Runs normally cap coalescing at 4,096 code units to bound string-copy work. A single paste may be larger.

Splitting transfers the old last character's child index to the suffix and makes the suffix a child of the prefix's last character. Coalescing is its inverse. Remote integration first resolves the origin, finds the preceding sibling by key, and uses the positional tree's minimum-depth summary to locate the end of that sibling's subtree. This avoids a quadratic scan for reverse-delivered root insertions.

Local positional lookup is amortized logarithmic in physical runs; identity and sibling lookups use expected logarithmic treap operations. Deleting a span additionally visits its affected runs. Text materialization is linear in visible text and runs, then cached until the next edit. Splay operations do not offer a worst-case per-edit logarithmic bound.

## Delivery and synchronization

Insertions with missing predecessors wait in a map keyed by that predecessor ID. Inserting a range releases its dependents into an iterative queue, so long reversed chains do not overflow the stack. Duplicate/partially overlapping updates skip the known prefix. Deletions are retained even before the corresponding insertion arrives.

Each actor's state-vector entry acknowledges only a contiguous prefix of insertion IDs. Out-of-order independent inserts do not advance past a gap. A delta includes missing insertion runs and the full observed deletion set; insert-only version vectors cannot describe newer deletions. Pending operations are also persisted and forwarded.

Deletion intervals currently use a sorted array with binary search and coalescing. Large, adversarially scattered deletion sets can still require linear array movement. Replacing that representation is a documented next investigation, not a hidden worst-case guarantee.

## Binary format

Frames begin with `RTX` and version `2`, flags, and the uncompressed payload length. The payload contains an actor table, six run metadata columns, one text column, and three deletion-span columns. Integer columns use run-length encoding and unsigned varints. Sequential IDs and times equal to IDs use compact zero markers; same-actor predecessor references use sequence distances. Text encodes UTF-16 code units as varints, preserving lone surrogates. A pure TypeScript [LZ4 block codec](https://github.com/lz4/lz4/blob/dev/doc/lz4_Block_format.md) compresses the payload when it reduces the byte count. Small or incompressible payloads are stored directly. There are no runtime dependencies or WebAssembly.

Deleted runs retain their lengths, IDs, Lamport times, and predecessor references, but omit their text. Restored tombstones use invisible placeholder strings. Deletion is permanent in this model, so later insertions can still name a deleted predecessor and anchors still resolve; this format cannot provide undo or reconstruct deleted content. The observed deletion set is retained, including deletions whose insertions have not arrived. This reduces saved text without reclaiming identity history.

Full snapshots without missing dependencies mark themselves complete and store runs in per-actor sequence order. Loading validates them into a separate replica before adoption, builds each identity treap in a linear pass, links sibling indexes, and traverses the RGA to build a balanced positional tree and materialize visible text. All indexes are ready before loading returns. Incomplete snapshots and deltas use normal operation integration.

The parser validates frame structure, counts, integer ranges, character units, and trailing bytes before exposing operations. Complete snapshots additionally validate sorted nonoverlapping IDs, origins, Lamport order, connectivity, and visibility. Frames are limited to a 64 MiB uncompressed payload, 64 Mi UTF-16 code units including tombstones, and one million runs or deletion spans. The format assumes authenticated, uniquely owned actor identities and is experimental; version 1 is not supported.

Full encoded state is cached until a local or remote mutation. Each `encode()` result is a defensive byte copy, so callers cannot mutate the cache. Encoding a delta remains uncached. Loading also retains a private copy of the original full snapshot.

## Validation and benchmark boundaries

The test oracle stores individual characters and sorts their child arrays; it shares neither compression nor indexing with RunText. Tests mix asynchronous delivery with local edits, reload replicas while dependencies are in flight, and compare against that model. Separate tests compare local operations to ordinary string splices and verify the complete public trace. LZ4 block tests cover literal runs, overlapping matches, arbitrary bytes, and malformed blocks; the codec has also been checked in both directions against the reference C implementation.

The benchmark compares common plain-text APIs, without observers or undo managers. Full trace replay is batched consistently across libraries; interactive workloads commit every edit. Loading includes text extraction, and merge timing includes both peers' imports and materialized text. Encoding after an edit and repeated encoding of unchanged state are separate cases, making cache effects visible. The former loads a fresh replica and appends then deletes one character before timing its first save; setup and verification are excluded. State size uses each library's native saved format, with no additional transport compression. Library startup and fixture/oracle generation occur outside timers. Each library runs alone in its own process. This measures the exposed text core, not every feature or end-to-end editor latency.
