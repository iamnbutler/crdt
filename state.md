---
last_updated: 2026-04-04
---
## Commands
- Bun install: `export HOME=/home/runner && curl -fsSL https://bun.sh/install | bash`
- Test: `PATH="$HOME/.bun/bin:$PATH" bun test`; Lint: `node_modules/.bin/biome check --write <file>`
## Backlog
1. serialization.ts round-trip (partially addressed in 04-04 PR)
2. anchor/snapshot.ts visitFragments early-return (addressed in 04-04 PR)
3. protocol OperationQueue dequeue-under-gap (addressed in 04-04 PR)
## PRs (open, draft)
- #194 test smells; #218 protocol +30; #221 splitFragment+UndoMap +7; #225 locatorBetween +17
- 04-04: OperationQueue flush/chain/clear + visitFragments early-return (+9, branch test-assist/operation-queue-flush-and-chain)
## Monthly: April 2026 issue created 04-04
## Tasks: 04-04:3+4+7; 04-03:4+7; 04-02:3+7; 04-01:3+7; 03-31:3+7; 03-30:4+6+7; 03-29:3+5+7
## Notes: baseline 3975 tests (2026-04-04); MAX_DEPTH=16 in locatorBetween; empty blocks need /* no-op */ for biome
