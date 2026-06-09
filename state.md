u:26-06-09|rid:27186096963|run:31|monthly-canonical:#316(June)|maint-silent~72d
HOLD:no-new-PRs/comments.18 TI-PRs stale,NONE merged.bun STILL NOT installed(26-06-09)→cant run `bun test`(Bun-only repo;node24 present but useless for bun)→no Task3.
ROOT-CAUSE:MCP search/list_issues return EMPTY this env→workflow never finds existing monthly→creates dup each run.curl public reads WORK:api.github.com/repos/iamnbutler/crdt/issues?state=open&per_page=100&page=N(~117 open).
STRATEGY:update_issue=max1/run.Use it to CLOSE 1 dup-monthly/run til cleared(keep#316).NOT bump#316(bumping ignored issue=noise;closing dup=removes noise).
CLEANUP-done:#129,#163,#170,#195.32 dups left.close lowest-num first.NEXT:#215.
DUPS-LEFT(32,TI-monthly only;keep#316):Mar:219,215|May:313,309,306,303|Apr:296,293,290,288,285,283,280,278,275,273,271,266,261,259,257,255,252,248,246,244,240,238,232,228,226,222
NOT-MINE(dont touch):Perf-Improver monthlies(#339,338,337,336,335,332,331,330,328,326,325,321,319,318,317,314,311,307,305,301,300..)+perf PRs+aw/CI-Doctor(340,334,164).
TIprs18:162,194,218,221,225,231,234,237,243,251,254,264,268,302,308,312,315,320
TI-non-monthly(LEAVE,real value):#265(bug:NonSequentialCounter dead-code),#214(infra:test:coverage scripts),#315/#312(OperationQueue),#308(Arena),#302(clock/replica-id),#320(computeTextSummary).
main:9ffb0f3|test:3965p/1f@26-05-25(stale,bun absent).
update_issue(safeoutputs):title must start"[Test Improver] ",status:closed+operation:append works,max1/run.push_repo_memory errors on .git overhead but auto-push works.
Task7-note:cant update#316 same run as closing dup(update_issue cap=1).Cleanup>bump while maint disengaged.