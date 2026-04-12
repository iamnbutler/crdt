---
last_updated: 2026-04-12
---
## Commands
`bun test` `bun run typecheck` `bun run lint`
Install: `curl -fsSL https://bun.sh/install | bash`

## PRs
#194 #218 #221 #225 #231 #234 #237 #243 #251 #252(04-12)

## Activity
Apr monthly issue: created 3x (API broken, dupes exist)
04-12:3+7 04-11:3+7 04-10:4+7 04-09:2+7 04-08:3+7 04-07:4+7 04-06:3+7 04-05:3 04-04:3+4+7

## Notes
APIs broken: issue_read/search_issues/pr_read all return []
list_pull_requests works (python3 parse); CI skips bot PRs
Backlog: broadcaster timers (fake setInterval); SumTree #158
#252: AwarenessBroadcaster+happenedBefore edge cases (12 tests)
#251: AwarenessManager lifecycle+serialization (expiry/clear/remove)
