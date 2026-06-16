u:26-06-16|rid:27597628849|run:38|monthly-canonical:#316(June)|maint-silent~79d
RUN38:CLOSE-DUP run. Verified HEAD 9ffb0f3 unchanged,ratelimit core 54 fresh. Confirmed #316 sole June TI monthly(canonical). Closed #303(May dup,prev-month) via update_issue+append note->#316. Spent 1/run HARD update_issue on the close;DEFERRED #316 refresh to run39 per rotation(it logs run38). No comments/PRs(HOLD active).
ROTATION:run37=refresh,run38=close-dup(#303),run39=REFRESH #316(log run38 close),run40=close-dup #306. Pattern: alternate close-dup/refresh due to 1/run update_issue HARD cap.
DUPS-OPEN(29):Apr(26):222,226,228,232,238,240,244,246,248,252,255,257,259,261,266,271,273,275,278,280,283,285,288,290,293,296|May(3):306,309,313. Close lowest# first:May(306,309,313)then April(222,226,228...).
CLOSED-by-me:#303(run38),#219(run36),#215(run33),#129,#163,#170,#195.
HOLD:no-new-PRs/comments.18 TI-PRs stale,NONE merged,maint disengaged~79d(last~03-29).Dup-cleanup 1/run via the single update_issue.Task3 new tests deferred til maint engages.
READ:MCP list/search/issue_read ALWAYS [] this env. Use curl public api(/search/issues?q=...+is:open+in:title for monthlies/PRs,1 call;/repos/.../issues/N for single). Check /rate_limit core>0 first(60/hr/shared-IP unauth;403 if spent). Verified core:54 remaining run38.
TESTS:3966 pass/0 fail @9ffb0f3(validated run32 x3,run34 x3). bun NOT preinstalled->curl -fsSL https://bun.sh/install|bash;~/.bun/bin. Prior "1 fail"(05-25)=flaky perf wall-clock assert src/text/perf.test.ts,NOT logic bug.
TI-PRs18:162,194,218,221,225,231,234,237,243,251,254,264,268,302,308,312,315,320. No human engagement(#315 lone comment=mine).
NOT-MINE:Perf-Improver monthlies/PRs+aw/CI-Doctor(341,339,334,164...).LEAVE all.
TI-non-monthly(LEAVE,real value,in #316 actions):#265(bug NonSequentialCounter dead-code),#214(infra test:coverage scripts).
TOOLS:update_issue title must start"[Test Improver] ",MAX 1/run HARD(close OR refresh,not both).push_repo_memory over-counts .git churn(errs ~35KB)but auto-push works;ignore if content file<10KB.
