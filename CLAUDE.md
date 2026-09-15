# CRDT Lab

An independent performance experiment derived from `iamnbutler/crdt`. The active engine is `RunText` in `src/run/`. Preserve the original implementation in `src/text/` as a reproducible baseline.

## Implementation

- Pure TypeScript with no runtime dependencies or WebAssembly. The engine runs in browsers; development and measurements use Bun.
- Strict types: no `any`, type assertions, or non-null assertions in new code.
- Use Bun's test runner and Biome's formatting and lint rules.
- Keep identity, convergence, UTF-16 preservation, and out-of-order delivery correct before optimizing.
- Read `docs/run-design.md` before changing the sequence or identity indexes.

## Commands

```sh
bun install --frozen-lockfile
bun run fixtures:download
bun test src
bun run typecheck
bun run site:check
bun run lint
bun run build
bun run bench:lab:quick
bun run bench:lab
bun run site:build
bun run site:dev
```

The local site defaults to port 4173; `CRDT_LAB_PORT` overrides it. Rebuild the site after changing its source or recorded data.

## Measurement integrity

Full measurements require committed engine and harness sources and a passing test suite. Each library runs sequentially in a separate process, with one complete warmup and five samples. Include final text materialization and verify exact output. Incorrect results stay visible but do not receive a timing rank.

Quick measurements write to ignored `.lab-quick/`; do not publish them as full measurements. Record actual dependency versions, source and fixture hashes, sample values, and machine/runtime metadata. Compare like environments and disclose the scope of each workload. Do not claim universal performance superiority from a finite suite.

GitHub Actions publishes the report to Pages and stores raw history on `benchmark-data`. Tests and measurements gate publication; there is no fixed percentage regression gate on noisy hosted runners.

## Benchmark site

Keep the site a compact technical report, following the original `nate.rip/crdt/` report. Put the complete comparison matrix first, then per-workload timings, environment details, and history. Use dense monospace tables and highlight the lowest valid result. Keep the replica demo secondary. Do not add marketing headlines, promotional copy, hero sections, or score cards.

## Layout

- `src/run/`: current engine, binary protocol, and correctness tests
- `benchmarks/lab/`: rival adapters, workloads, and isolated worker
- `scripts/measure.ts`: correctness gate, provenance, and recorded results
- `site/`: benchmark tables and the two-replica browser demo
- `src/text/`, `src/sum-tree/`, `src/anchor/`: original implementation
- `docs/`: design, baseline failure reproduction, and historical notes

The new engine is experimental plain text. Rich text, undo, history reclamation, and editor/network integrations are outside its current scope. Keep these limitations visible alongside performance wins.
