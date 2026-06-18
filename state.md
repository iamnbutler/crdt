u:26-06-18|rid:27739566232|run:40|monthly-canonical:#316(June)|maint-silent~81d
RUN40:CLOSE-DUP run. Verified HEAD 9ffb0f3 unchanged,ratelimit core 60 fresh. Live search:30 open TI monthly pre-close(#316+29 dups). Recently-updated top8 ALL github-actions[bot](no maint engagement;#164 aw No-Op,#339 Perf-Improver=NOT mine). #316:0 comments,updated 06-17(run39). HOLD active. Spent 1/run HARD update_issue CLOSING dup #306(May,2026-05) w/append note. Now 29 open monthlies. Did NOT refresh #316 this run(cap spent;refreshed run39,nothing changed).
ROTATION:run38=close-dup(#303),run39=refresh,run40=close-dup #306(done),run41=REFRESH #316,run42=close-dup #309,run43=refresh,run44=close-dup #313(last May). Alternate close-dup/refresh due to 1/run update_issue HARD cap.
DUPS-OPEN(28):May(2):309,313|April(26):222,226,228,232,238,240,244,246,248,252,255,257,259,261,266,271,273,275,278,280,283,285,288,290,293,296. Close lowest# first:May(309,313)then April(222,226...).
CLOSED-by-me:#306(run40),#303(run38),#219(run36),#215(run33),#129,#163,#170,#195.
HOLD:no-new-PRs/comments.18 TI-PRs stale,NONE merged,maint disengaged~81d(last~03-29).Dup-cleanup 1/run via the single update_issue.Task3 new tests deferred til maint engages.
READ:MCP list/search/issue_read ALWAYS [] this env(reconfirmed run40). Use curl public api(/search/issues?q=...+is:open+in:title for monthlies/PRs,1 call;/repos/.../issues/N for single;/issues?sort=updated for recent activity). Check /rate_limit core>0 first(60/hr/shared-IP unauth;403 if spent). Verified core:60 fresh run40.
TESTS:3966 pass/0 fail @9ffb0f3(validated run32 x3,run34 x3). bun NOT preinstalled->curl -fsSL https://bun.sh/install|bash;~/.bun/bin. Prior "1 fail"(05-25)=flaky perf wall-clock assert src/text/perf.test.ts,NOT logic bug.
TI-PRs18:162,194,218,221,225,231,234,237,243,251,254,264,268,302,308,312,315,320. No human engagement(#315 lone comment=mine).
NOT-MINE:Perf-Improver monthlies/PRs+aw/CI-Doctor(341,339,334,164...).LEAVE all.
TI-non-monthly(LEAVE,real value,in #316 actions):#265(bug NonSequentialCounter dead-code),#214(infra test:coverage scripts).
TOOLS:update_issue title must start"[Test Improver] ",MAX 1/run HARD(close OR refresh,not both).push_repo_memory over-counts .git churn(errs ~35KB)but auto-push works;ignore if content file<10KB.
