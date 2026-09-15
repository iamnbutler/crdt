# CRDT Lab

An independent performance experiment derived from [iamnbutler/crdt](https://github.com/iamnbutler/crdt). The new engine, **RunText**, is a plain-text CRDT written entirely in TypeScript, with no runtime dependencies or WebAssembly.

**[Benchmark report and replica demo](https://nate.rip/crdt-lab/)** · [Raw measurement history](https://github.com/iamnbutler/crdt-lab/tree/benchmark-data) · [Design](docs/run-design.md)

RunText is the sole implementation. It uses a run-compressed RGA, an edit-local splay tree, and independent indexes for character identities and concurrent siblings. Character identity survives physical run splitting and coalescing. This is a research repository: the API and binary format can change without compatibility layers. The previous engine is available in Git history.

## Use the engine

```ts
import { RunText } from "./src/index.ts";

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
alice.delete(0, 1); // offset, COUNT
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

Set `CRDT_LAB_PORT` to choose another local port, for example `CRDT_LAB_PORT=4183 bun run site:dev`.

`bun run bench:lab:quick` uses shorter workloads with RunText, Loro, and Yjs, and writes only to ignored `.lab-quick/`. Automerge remains in the full report. Full measurements require committed engine/benchmark sources, run the complete test suite, and write machine-readable results under `site/public/lab/`. To rerun selected libraries, use `bun run bench:lab --libraries=run,loro,yjs`; each result records the actual participants.

The dashboard ranks **verified outputs only**. Full-trace bulk replay, individual local edits, encoding after edits, encoding unchanged state, loading, state size, and two-peer merging are separate measurements. Every timing includes final text materialization where applicable. Runs use pinned versions of Yjs, Loro, and Automerge, sequential isolated processes, one complete warmup, and five samples. Replay and load samples use fresh replicas; unchanged-state encoding allows native caches. Native persistence formats are compared; RunText uses column encoding and TypeScript LZ4, and Yjs uses update V2. No extra transport compression is applied. Raw JSON includes source and fixture hashes, library versions, runtime, hardware, and all samples. Compare runs on the same hardware and runtime.

GitHub Actions checks every change, records the full matrix on `main` and weekly, persists results to `benchmark-data`, and publishes GitHub Pages. The repository's Pages source must be **GitHub Actions**. Old issue-generating workflows were removed from this independent copy.

## Correctness and scope

The tests cover string-splice equivalence, an independent character-level RGA oracle, interleaved local/remote delivery, duplicate and reversed messages, missing dependencies, observed deletes, overlapping updates, binary round trips, UTF-16 edge cases, cursor anchors, and the complete 259,778-edit Kleppmann trace. An adversarial test reverses 20,000 sibling inserts.

The previous engine failed the real trace at edit 493 despite passing its unit suite. Its recorded results remain in the report's history; it is no longer built or benchmarked. [Historical reproduction](docs/legacy-trace-failure.md).

This is an experimental **text** engine, not a replacement for the surrounding ecosystems of mature libraries. It has no rich text, undo manager, tombstone/history reclamation, or constant-time persistent snapshots. `fork()` currently serializes and reconstructs state. RGA has known backward-interleaving behavior; this is not FugueMax. Transport, authentication, persistence scheduling, and editor bindings remain application concerns.

Snapshots omit deleted text while retaining identities and deletion history; complete snapshots rebuild indexes directly instead of replaying insertions. Next investigations are further loading improvements, deletion-interval scaling, cross-runtime/browser measurements, and broader multi-user editing traces. The progress site should show losses as clearly as wins. A finite benchmark suite cannot establish superiority over every library or workload.

## Layout

| Path | Purpose |
| --- | --- |
| `src/` | RunText engine, binary protocol, and tests |
| `benchmarks/lab/` | Typed adapters, workloads, isolated measurement worker |
| `scripts/measure.ts` | Correctness gate, provenance, history recording |
| `site/` | Static dashboard and browser demo using the actual engine |

MIT licensed. This repository is independent of the original checkout and its unfinished experiments.
