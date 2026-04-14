---
updated: 2026-04-14
---
## Cmd
`bun test` `bun run typecheck` `bun run lint`
No coverage command exists (test:coverage:ci was wrong)

## Open PRs
#194 #218 #221 #225 #231 #234 #237 #243 #251 #254

## Runs
04-14:2+7 04-13:4+6+7 04-12:3+7 04-11:3+7 04-10:4+7 04-09:2+7 04-08:3+7

## Notes
- APIs: issue_read/search_issues/list_issues all return []; list_pull_requests works
- Apr monthly issues created multiple times (can't find existing via API)
- 10 open PRs unreviewed; no new PRs this run

## Backlog
- validation.ts: HIGH — complex multi-path validation logic, zero tests
- protocol/serialization.ts: no tests
- fragmentSummaryOps.combine() edge cases
