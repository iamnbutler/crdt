---
last_updated: 2026-04-11
---
## Commands
Test:`bun test` TC:`bun run typecheck` Lint:`bun run lint` Bench:`bun run bench`
## PRs (open:9, paused)
#194 #218 #221 #225 #231 #234 #237 #243 +new(awareness-edge-cases/04-11)
## Activity
Apr issue: 04-10 created one, 04-11 created another (API broken, couldn't find existing)
04-11:3+7; 04-10:4+7; 04-09:2+7(failed); 04-08:3+7; 04-07:4+7; 04-06:3+7; 04-05:3; 04-04:3+4+7
## Notes
APIs broken: issue_read returns [] for ALL numbers; search_issues has delay (pre-April only)
check_runs/pr_read also broken
Backlog: AwarenessBroadcaster timers; happenedBefore edge cases (equal/empty vecs)
#139 addressed by #194+#243 (test smells)
04-11 PR: AwarenessManager expireStale/clear/remove/getAllStates/callbacks+deserialization errors
