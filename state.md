---
last_updated: 2026-04-03
---
## Commands
- Bun install: `export HOME=/home/runner && curl -fsSL https://bun.sh/install | bash`
- Test: `PATH="$HOME/.bun/bin:$PATH" bun test`; Lint: `node_modules/.bin/biome check --write <file>`
## Backlog
1. serialization.ts round-trip with concurrent edits
2. anchor/snapshot.ts visitFragments early-return (untested; AnchorSet relies on it)
3. protocol OperationQueue dequeue-under-gap (may be addressed by #218)
## PRs (open, draft)
- #194 test smells; #218 protocol +30; #221 splitFragment+UndoMap +7; #225 locatorBetween +17
## Monthly: April 2026 issue exists
## Tasks: 04-03:4+7; 04-02:3+7; 04-01:3+7; 03-31:3+7; 03-30:4+6+7; 03-29:3+5+7; 03-28:4+7
## Notes: baseline 3966 tests (2026-04-02); MAX_DEPTH=16 in locatorBetween
