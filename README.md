# CRDT Lab

An independent performance experiment derived from [iamnbutler/crdt](https://github.com/iamnbutler/crdt). The new engine, **RunText**, is a plain-text CRDT written entirely in TypeScript, with no runtime dependencies or WebAssembly.

**[Live measurements and collaboration demo](https://iamnbutler.github.io/crdt-lab/)** · [Raw measurement history](https://github.com/iamnbutler/crdt-lab/tree/benchmark-data) · [Design](docs/run-design.md)

RunText replaces variable-length position locators with a run-compressed RGA, an edit-local splay tree, and independent indexes for character identities and concurrent siblings. Character identity survives physical run splitting and coalescing. The original engine remains in `src/text` for comparison; its source history is preserved.

## Use the engine

```ts
import { RunText } from "./src/run/index.ts";

const alice = new RunText();
const bob = new RunText();

bob.apply(alice.insert(0, "hello"));

// Independent edits. Delivery can be duplicated or reordered.
const a = alice.insert(5, " Alice");
const b = bob.insert(5, " Bob");
alice.apply(b);
bob.apply(a);
console.assert(alice.getText() === bob.getText());

// Binary persistence and incremental synchronization.
const restored = RunText.decode(alice.encode());
alice.delete(0, 1); // offset, COUNT (unlike the original TextBuffer API)
restored.merge(alice.encode(restored.stateVector()));

const cursor = alice.anchorAt(2, "right");
alice.insert(0, "!");
console.log(alice.resolve(cursor));
```

Offsets are JavaScript UTF-16 code units. Text, including CRLF and lone surrogates, is preserved exactly. An actor ID belongs to one writer; default IDs use 53 random bits. `fork()` and `decode()` select a new writer ID by default. Operations are immutable values by contract. The wire protocol is new and does not interoperate with the original engine or other CRDT libraries.

## Reproduce the measurements

```sh
bun install --frozen-lockfile
bun run fixtures:download
bun test src
bun run typecheck
bun run lint
bun run bench:lab       # Full matrix; several minutes, mostly Automerge
bun run site:build
bun run site:dev        # http://127.0.0.1:4173
```

`bun run bench:lab:quick` uses shorter workloads and writes only to ignored `.lab-quick/`. Full measurements require committed engine/benchmark sources, run the complete test suite, and write machine-readable results under `site/public/lab/`. To rerun selected libraries, use `bun run bench:lab --libraries=run,loro,yjs`; each result records the actual participants.

The dashboard ranks **verified outputs only**. Full-trace bulk replay, individual local edits, encoding, loading, state size, and two-peer merging are separate measurements. Every timing includes final text materialization where applicable. Runs use pinned versions of Yjs, Loro, and Automerge, sequential isolated processes, one complete warmup, and five fresh samples. Native persistence formats are compared; Yjs uses update V2. No extra transport compression is applied. Raw JSON includes source and fixture hashes, library versions, runtime, hardware, and all samples. Compare runs on the same hardware and runtime.

GitHub Actions checks every change, records the full matrix on `main` and weekly, persists results to `benchmark-data`, and publishes GitHub Pages. The repository's Pages source must be **GitHub Actions**. Old issue-generating workflows were removed from this independent copy.

## Correctness and scope

The tests cover string-splice equivalence, an independent character-level RGA oracle, interleaved local/remote delivery, duplicate and reversed messages, missing dependencies, observed deletes, overlapping updates, binary round trips, UTF-16 edge cases, cursor anchors, and the complete 259,778-edit Kleppmann trace. An adversarial test reverses 20,000 sibling inserts.

The original engine fails the real trace at edit 493 despite passing its unit suite. Its incorrect results are visible and excluded from timing ranks. [Reproduction](docs/legacy-trace-failure.md).

This is an experimental **text** engine, not a replacement for the surrounding ecosystems of mature libraries. It has no rich text, undo manager, tombstone/history reclamation, or constant-time persistent snapshots. `fork()` currently serializes and reconstructs state. RGA has known backward-interleaving behavior; this is not FugueMax. Transport, authentication, persistence scheduling, and editor bindings remain application concerns.

Next investigations are compact deletion/state encoding, cheaper loading, deletion-interval scaling, cross-runtime/browser measurements, and broader multi-user editing traces. The progress site should show losses as clearly as wins. A finite benchmark suite cannot establish superiority over every library or workload.

## Layout

| Path | Purpose |
| --- | --- |
| `src/run/` | New zero-dependency engine and tests |
| `benchmarks/lab/` | Typed adapters, workloads, isolated measurement worker |
| `scripts/measure.ts` | Correctness gate, provenance, history recording |
| `site/` | Static dashboard and browser demo using the actual engine |
| `src/text/`, `src/sum-tree/`, `src/anchor/` | Original implementation retained for comparison |

MIT licensed. This repository is independent of the original checkout and its unfinished experiments.
