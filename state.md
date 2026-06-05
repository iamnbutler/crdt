u:26-06-05|rid:26997801834|restraint:27|monthly:#316(June,updated OK via update_issue,replace)|maint-silent:26-03-29(~68d)
HOLD:no-new-PRs/comments,monthly-only(18-TI-PRs-stale,NONE-merged ever)
CORRECTION(26-06-05 full paginated audit):prior memory's "cleanup-progress/14-closed/down-to-21" was WRONG.NO maintainer cleanup happened.Live=37 open TI-monthly(36 dups + keep#316).Count went UP not down.
DUPS-TO-CLOSE(36,TI-monthly only,keep#316):May(4):313,309,306,303|Apr(26):296,293,290,288,285,283,280,278,275,273,271,266,261,259,257,255,252,248,246,244,240,238,232,228,226,222|Mar(6):219,215,195,170,163,129
NOTE:Perf-Improver monthlies(many open)+aw/CI-Doctor(340,334)are OTHER workflows-NOT mine,do not close/count.
main:9ffb0f3(unchanged)|test:3965p/1f@last-val26-05-25(bun NOT installed→cant run/validate;tree unchanged→status holds)
TIprs18(unchanged,confirmed /pulls):162,194,218,221,225,231,234,237,243,251,254,264,268,302,308,312,315,320
open-TI-non-monthly issues:#265(bug:NonSequentialCounter dead-code validation,OPEN)|#214(infra:add test:coverage scripts,OPEN)-both now in #316 suggested-actions
i139item3-pend(perf69→103→118ms)|1-failing-test-uninvestigated(observation only,no bug-issue under HOLD)
mcp:issue_read/search_issues/list_issues=EMPTY in this env(root cause of dup explosion);use curl public reads:curl api.github.com/repos/iamnbutler/crdt/issues?state=open&per_page=100&page=N (paginate! 117 open issues, need pages 1-2) + /pulls?state=open
push_repo_memory=FALSE-POS(~31KB regardless;auto-push works)
update_issue(safeoutputs)WORKS:target must start"[Test Improver] ",max1/run,operation:replace→used on #316 each run(Task7 mandatory,so cant also close a dup same run)
