---
last_updated: 2026-03-26
---

## Commands

- **Test**: `export PATH="$HOME/.bun/bin:$PATH" && bun test`
- **CI pattern**: `--test-name-pattern "^(?!.*(CRDT Property|multiple snapshots|10K sequential inserts))"`
- **Typecheck**: `bun run typecheck` | **Lint**: `bun run lint`

## Notes

- Bun not in PATH by default; install via `curl -fsSL https://bun.sh/install | bash`
- 1 failing perf test: remote ops >100ms (known issue, not a test bug)
- No AGENTS.md file in repo

## Backlog

- Investigate 11 pre-existing undo/redo failures (mentioned in PR #108)
- computeTextSummary CRLF/empty-line edge cases (low priority)

## Task History

- 2026-03-26: Task 1+3+7 (commands discovered, protocol tests added)
