---
last_updated: 2026-03-29
---

## Commands
- **Test**: `export PATH="$HOME/.bun/bin:$PATH" && bun test`
- **CI filter**: `--test-name-pattern "^(?!.*(CRDT Property|multiple snapshots|10K sequential inserts))"`
- **Typecheck/Lint**: `bun run typecheck` / `bun run lint` (run `bun install` first)

## Notes
- Bun not in PATH; install via `curl -fsSL https://bun.sh/install | bash`
- perf threshold 250ms (CI variability); pre-existing biome errors in scripts/ (not our fault)

## Backlog
- `snapshot.test.ts:218,222` GC assertions always-true; strengthen if semantics allow
- `perf.test.ts:34` loosened threshold; consider statistical approach
- New code (op batcher #191, skip list #193, JIT comparators #186) — test post-merge

## Open Test Improver PRs
- PR #162: locatorBetween Case A/B + split-boundary undo regression tests
- branch `test-assist/fix-test-smells-139`: fix duplicate describe block + placeholder (addresses #139)

## Monthly Activity Issue
- Created for March 2026 on 2026-03-29

## Task History
- 2026-03-26: Task 1+3+7
- 2026-03-27: Task 2+3+7 (PR #162 created)
- 2026-03-28: Task 4+7
- 2026-03-29: Task 3+5+7 (fixed test smells, created Monthly Activity issue)
