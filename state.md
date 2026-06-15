u:26-06-15|rid:27527195048|run:37|monthly-canonical:#316(June)|maint-silent~78d
RUN37:reads OK via curl public api(check ratelimit core>0 first;MCP list/search/issue_read ALWAYS [] this env). REFRESHED #316(Task7,1 update_issue used=HARD cap). Verified #219 closed 06-14(run36 held). Reconciled via SEARCH api: open TI monthlies=31(30dups+#316),March CLEAN;open TI PRs=18;#265+#214 open. Fixed #316: removed stale March line,intro count 32->31,prepended run37 history. HEAD 9ffb0f3 unchanged->no re-run.
ROTATION:run36=close-dup,run37=refresh,run38=CLOSE-DUP. Next run38: close May batch first #303(lowest# in May),then April lowest# first(222,226,228...). Refresh #316 after to log the close.
DUPS-OPEN(30):Apr(26):222,226,228,232,238,240,244,246,248,252,255,257,259,261,266,271,273,275,278,280,283,285,288,290,293,296|May(4):303,306,309,313
CLOSED-by-me:#219(run36),#215(run33),#129,#163,#170,#195.
HOLD:no-new-PRs/comments.18 TI-PRs stale,NONE merged,maint disengaged~78d(last~03-29).Dup-cleanup OK 1/run.Task3 new tests deferred til maint engages.
READ:SEARCH api(/search/issues?q=...is:open+in:title) clean way to count monthlies+PRs,1 call each. issues endpoint mixes PRs+issues,created-desc,100/page->paginate if listing. curl reads only work while unauth ratelimit(60/hr/shared-IP)not spent;else 403. Verified ratelimit core:60 fresh run37.
TESTS:3966 pass/0 fail @9ffb0f3(validated run32 x3,run34 x3). bun NOT preinstalled->curl -fsSL https://bun.sh/install|bash;~/.bun/bin. Prior "1 fail"(05-25)=flaky perf wall-clock assert src/text/perf.test.ts,NOT logic bug.
TI-PRs18:162,194,218,221,225,231,234,237,243,251,254,264,268,302,308,312,315,320. No human engagement(#315 lone comment=mine).
NOT-MINE:Perf-Improver monthlies/PRs+aw/CI-Doctor(341,339,334,164...).
TI-non-monthly(LEAVE,real value,in #316 actions):#265(bug NonSequentialCounter dead-code),#214(infra test:coverage scripts).
TOOLS:update_issue title must start"[Test Improver] ",MAX 1/run HARD.push_repo_memory over-counts .git churn(errs ~35KB)but auto-push works;ignore if content file<10KB.
