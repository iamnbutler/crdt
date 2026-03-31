---
last_updated: 2026-03-31
---
## Commands
- Test: `PATH="$HOME/.bun/bin:$PATH" bun test`
- CI filter: `--test-name-pattern "^(?!.*(CRDT Property|multiple snapshots|10K sequential inserts))"`
- Lint: `node_modules/.bin/biome check .` (run `bun install` first)
- Bun: `export HOME=/home/runner && curl -fsSL https://bun.sh/install | bash`
## Gaps
- text/fragment.ts 68% (mergeFragments), snapshot.ts 85%, undo-map.ts 90%
## Backlog
1. text/fragment.ts mergeFragments edge cases
2. Tests for #191 #193 #186 post-merge
## PRs
- #162 locatorBetween regression (open)
- #194 fix test smells (open)
- #217 protocol +30 tests (draft, 2026-03-31)
## Monthly: March 2026 issue created 2026-03-31
## Tasks: 03-26:1+3+7; 03-27:2+3+7 PR#162; 03-28:4+7; 03-29:3+5+7 PR#194; 03-30:4+6+7; 03-31:3+7 PR#217
