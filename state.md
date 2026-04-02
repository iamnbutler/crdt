---
last_updated: 2026-04-02
---
## Commands
- Bun install: `export HOME=/home/runner && curl -fsSL https://bun.sh/install | bash`
- Test: `PATH="$HOME/.bun/bin:$PATH" bun test`; Lint: `node_modules/.bin/biome check --write <file>`
## Backlog
1. serialization.ts round-trip with complex concurrent edits
2. anchor/snapshot.ts visitFragments early-return (false from FragmentVisitor)
3. protocol OperationQueue dequeue-under-gap scenarios
## PRs (open, draft)
- #194 test smells; #218 protocol +30; #221 splitFragment+UndoMap +7
- locator-between-cases: locatorBetween Case A/B +17 (2026-04-02, no # yet)
## Monthly: April 2026 issue created 2026-04-02
## Tasks: 03-28:4+7; 03-29:3+5+7; 03-30:4+6+7; 03-31:3+7; 04-01:3+7; 04-02:3+7
## Notes: locatorBetween MAX_DEPTH=16 limit; bun baseline 3966 tests (main, 2026-04-02)
