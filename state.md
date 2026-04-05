---
last_updated: 2026-04-05
---
## Commands
- Install: `export HOME=/home/runner && curl -fsSL https://bun.sh/install | bash`
- Test: `PATH="$HOME/.bun/bin:$PATH" bun test`; Lint: `node_modules/.bin/biome check --write <file>`
## Backlog
1. replica-id.ts: exportState/fromState, releaseByClientId, generateSecureReplicaId
## Open Test Improver PRs
- #194 #218 #221 #225 #231 (prior); 04-05: state-sync +29 (test-assist/state-sync-coverage)
## Monthly: Apr 2026 issue exists (created 04-04; number unknown, MCP reads broken 04-05)
## Tasks: 04-05:3; 04-04:3+4+7; 04-03:4+7; 04-02:3+7; 04-01:3+7; 03-31:3+7; 03-30:4+6+7
## Notes: 3995 tests after 04-05; MAX_DEPTH=16 locatorBetween; /* no-op */ for empty biome blocks
