---
last_updated: 2026-03-30
---
## Commands
- Test: `PATH="$HOME/.bun/bin:$PATH" bun test`
- CI: add `--test-name-pattern "^(?!.*(CRDT Property|multiple snapshots|10K sequential inserts))"`
- Coverage: `bun run test:coverage` / `bun run test:coverage:ci` (added 2026-03-30)
- Bun: `curl -fsSL https://bun.sh/install | bash`
## Coverage Gaps
- protocol/awareness.ts 36%, state-sync.ts 60%, replica-id.ts 57%, op-queue.ts 63%
- text/fragment.ts 68%, snapshot.ts 85% (lines 383-428), undo-map.ts 90%
## Backlog
1. Protocol tests (awareness,state-sync,replica-id,op-queue) HIGH VALUE
2. text/fragment.ts mergeFragments edge cases
3. New code #191 #193 #186 post-merge
## PRs
- #162 locatorBetween Case A/B regression (draft)
- #194 fix test smells (draft)
- 2026-03-30 branch test-assist/add-coverage-script: coverage scripts
## Monthly Activity
- March 2026 created 2026-03-30
## Tasks
- 2026-03-26: 1+3+7; 03-27: 2+3+7 PR#162; 03-28: 4+7; 03-29: 3+5+7 PR#194; 03-30: 4+6+7
