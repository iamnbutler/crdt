---
updated: 2026-04-15
---
## Cmd
`bun test` `bun run typecheck` `bun run lint` (no coverage cmd; bun not in CI runner PATH)

## Open PRs (Test Improver drafts)
#194 #218 #221 #225 #231 #234 #237 #243 #251 #254

## Runs
04-15:4+7 04-14:2+7 04-13:4+6+7 04-12:3+7 04-11:3+7 04-10:4+7 04-09:2+7 04-08:3+7

## Notes
- list_pull_requests works; list/search_issues mostly returns []; label:testing works
- Apr monthly issue can't be found via API; created new one each run (known problem)
- PR check_runs=[]; no CI on draft PRs; #139 (test smells) has 1 comment, skip

## Backlog
- validation.ts: HIGH (complex multi-path logic, zero tests)
- protocol/serialization.ts: no tests
- fragmentSummaryOps.combine() edge cases
