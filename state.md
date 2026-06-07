u:26-06-07|rid:27084099278|run:29|monthly-canonical:#316(June,NOT bumped-cleanup priority)|maint-silent~70d
HOLD:no-new-PRs/comments.18 TI-PRs stale,NONE merged.bun NOT installed(26-06-07)→cant run tests→no Task3.node24 present but project Bun-only.
ROOT-CAUSE:MCP search/list_issues EMPTY this env→workflow never finds existing monthly→creates dup each run.use curl public reads:api.github.com/repos/iamnbutler/crdt/issues?state=open&per_page=100&page=N(~117 open).
STRATEGY:update_issue=max1/run.Use it to CLOSE 1 dup-monthly/run til cleared,NOT bump #316(bumping ignored issue=more noise;closing=removes noise).
CLEANUP:closed #129(r27053826792),#163(r27084099278).34 dups left(keep#316),close lowest-num first.NEXT:#170.
DUPS-LEFT(34,TI-monthly only):Mar:219,215,195,170|Apr:296,293,290,288,285,283,280,278,275,273,271,266,261,259,257,255,252,248,246,244,240,238,232,228,226,222|May:313,309,306,303
NOT-MINE(dont touch):Perf-Improver monthlies(#339/338..),aw/CI-Doctor(340,334,164).
TIprs18:162,194,218,221,225,231,234,237,243,251,254,264,268,302,308,312,315,320
TI-non-monthly(LEAVE,real value):#265(bug:NonSequentialCounter dead-code),#214(infra:test:coverage scripts).
main:9ffb0f3|test:3965p/1f@26-05-25(stale,bun absent).
update_issue(safeoutputs):title must start"[Test Improver] ",status:closed+operation:append works.push_repo_memory errors on .git overhead(~33KB) but auto-push still works.
