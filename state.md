u:26-06-17|rid:27668819662|run:39|monthly-canonical:#316(June)|maint-silent~80d
RUN39:REFRESH run. Verified HEAD 9ffb0f3 unchanged,ratelimit core 50 fresh. Confirmed #303 CLOSED 06-16(run38 close held). Live search:30 open TI monthly(#316+29 dups:May3=313,309,306|April26). 18 TI PRs unchanged,none merged. #265+#214 open. Spent 1/run HARD update_issue REFRESHING #316:logged run38 close+run39 verify,May line 4->3(rm #303),intro 31->30,footer rid->27668819662. No comments/PRs(HOLD active).
ROTATION:run38=close-dup(#303),run39=refresh(done),run40=CLOSE-DUP #306(last May),run41=refresh,run42=close-dup #222(April lowest). Pattern: alternate close-dup/refresh due to 1/run update_issue HARD cap.
DUPS-OPEN(29):April(26):222,226,228,232,238,240,244,246,248,252,255,257,259,261,266,271,273,275,278,280,283,285,288,290,293,296|May(3):306,309,313. Close lowest# first:May(306,309,313)then April(222,226,228...).
CLOSED-by-me:#303(run38),#219(run36),#215(run33),#129,#163,#170,#195.
HOLD:no-new-PRs/comments.18 TI-PRs stale,NONE merged,maint disengaged~80d(last~03-29).Dup-cleanup 1/run via the single update_issue.Task3 new tests deferred til maint engages.
READ:MCP list/search/issue_read ALWAYS [] this env. Use curl public api(/search/issues?q=...+is:open+in:title for monthlies/PRs,1 call;/repos/.../issues/N for single). Check /rate_limit core>0 first(60/hr/shared-IP unauth;403 if spent). Verified core:50 remaining run39.
TESTS:3966 pass/0 fail @9ffb0f3(validated run32 x3,run34 x3). bun NOT preinstalled->curl -fsSL https://bun.sh/install|bash;~/.bun/bin. Prior "1 fail"(05-25)=flaky perf wall-clock assert src/text/perf.test.ts,NOT logic bug.
TI-PRs18:162,194,218,221,225,231,234,237,243,251,254,264,268,302,308,312,315,320. No human engagement(#315 lone comment=mine).
NOT-MINE:Perf-Improver monthlies/PRs+aw/CI-Doctor(341,339,334,164...).LEAVE all.
TI-non-monthly(LEAVE,real value,in #316 actions):#265(bug NonSequentialCounter dead-code),#214(infra test:coverage scripts).
TOOLS:update_issue title must start"[Test Improver] ",MAX 1/run HARD(close OR refresh,not both).push_repo_memory over-counts .git churn(errs ~35KB)but auto-push works;ignore if content file<10KB.
