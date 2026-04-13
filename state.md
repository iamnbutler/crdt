---
updated: 2026-04-13
---
## Cmd
`bun test` `bun run typecheck` `bun run lint` `bun run test:coverage:ci`
Install: `curl -fsSL https://bun.sh/install | bash`

## Open PRs
#194 #218 #221 #225 #231 #234 #237 #243 #251 #254

## Runs
04-13:4+6+7 04-12:3+7 04-11:3+7 04-10:4+7 04-09:2+7 04-08:3+7 04-07:4+7 04-06:3+7 04-05:3 04-04:3+4+7

## Notes
- APIs broken: issue_read/search_issues/pr_read all return []
- list_pull_requests works; CI skips bot PRs
- Apr monthly issue created 4x (dupes, can't find existing)
- All 13 test-assist branches: 0 conflicts (04-13)
- test:coverage:ci in package.json but not ci.yml

## Backlog
- Coverage in ci.yml (test:coverage:ci exists)
- fragmentSummaryOps.combine() edge cases
- SumTree #158
