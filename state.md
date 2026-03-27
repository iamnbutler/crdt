---
last_updated: 2026-03-27
---

## Commands

- **Test**: `export PATH="$HOME/.bun/bin:$PATH" && bun test`
- **CI pattern**: `--test-name-pattern "^(?!.*(CRDT Property|multiple snapshots|10K sequential inserts))"`
- **Typecheck**: `bun run typecheck` | **Lint**: `bun run lint`

## Notes

- Bun not in PATH by default; install via `curl -fsSL https://bun.sh/install | bash`
- 1K remote ops perf test threshold is 250ms (raised from 100ms for CI variability)
- No AGENTS.md file in repo
- 11 undo/redo property test failures from #137 were fixed in commit 82f89e2

## Backlog

- computeTextSummary CRLF/empty-line edge cases (low priority)
- SumTree redistribution: Perf Improver PR #160 adds regression test (pending review)

## Task History

- 2026-03-26: Task 1+3+7 (commands discovered, protocol tests added)
- 2026-03-27: Task 2+3+7 (analyzed locatorBetween coverage, added Case A/B + undo regression tests PR pending)
