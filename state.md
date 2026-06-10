u:26-06-10|rid:27255927907|run:32|monthly-canonical:#316(June)|maint-silent~73d
NEW-26-06-10:bun NOW installable via curl(`curl -fsSL https://bun.sh/install|bash`;~/.bun/bin)→ran FULL suite x3:3966 pass/0 fail consistently@9ffb0f3.Prior "1 fail"(26-05-25)=flaky perf-timing assert(src/text/perf.test.ts wall-clock thresholds:10K inserts<100ms,1K remote ops<250ms),NOT logic bug.Removed that observation from #316.
HOLD STILL ON:no-new-PRs/comments.18 TI-PRs stale,NONE merged,maint disengaged~73d.bun-works does NOT lift HOLD(18 unreviewed PRs already=adding more is spam).Task3 deferred til maint engages.
This-run(32):used update_issue on #316(Task7 full-replace):corrected test-status to 3966/0,fixed March-dup line(only #219,#215 still open;#195/#170/#163/#129 already closed),count 37->33(32 dups+#316),silence 68->73d,prepended 26-06-10 run entry.Chose Task7(#316 accuracy)over dup-close THIS run bc body had factual errors.
ROOT-CAUSE(unchanged):MCP search/list_issues EMPTY this env->cant find existing monthly->dup risk.curl public reads WORK:api.github.com/repos/iamnbutler/crdt/issues?state=open&per_page=100&page=N.
update_issue cap=1/run->cant close dup AND update #316 same run.NEXT RUN:resume dup-close,close #215(lowest open),update_issue status:closed+append superseded-by-#316.Then #219,then April batch,then May.
DUPS-OPEN(32,keep#316):Mar:215,219|May:303,306,309,313|Apr:222,226,228,232,238,240,244,246,248,252,255,257,259,261,266,271,273,275,278,280,283,285,288,290,293,296
CLEANUP-done(closed):#129,#163,#170,#195.
NOT-MINE(dont touch):Perf-Improver monthlies+perf PRs+aw/CI-Doctor(340,334,164).
TI-PRs18-open:162,194,218,221,225,231,234,237,243,251,254,264,268,302,308,312,315,320
TI-non-monthly-issues(LEAVE,real value):#265(bug:NonSequentialCounter dead-code),#214(infra:test:coverage scripts).
update_issue(safeoutputs):title must start"[Test Improver] ",status open/closed,operation replace/append works,max1/run.add_comment separate cap(max10).push_repo_memory errs on .git overhead but auto-push works.
