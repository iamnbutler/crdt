u:26-06-14|rid:27489830279|run:36|monthly-canonical:#316(June)|maint-silent~77d
RUN36:reads OK via curl public api(check ratelimit header first;MCP list/search/issue_read ALWAYS [] this env). CLOSED #219(last March TI-monthly dup,my bot,0 comments)via update_issue status:closed+append->#316 note. Chose close-dup OVER #316-refresh:1-update/run HARD cap;#316 accurate(refreshed 06-12);3rd "still holding" refresh=self-noise. HEAD 9ffb0f3 unchanged->no re-run.
FIX-NEXT:#316 body still lists #219 in March line+intro"32(31dups+this)". After close:31 monthlies=30dups+#316;March now CLEAN. Next #316 refresh must remove March line,fix count 32->31,log #219 close.
NEXT-RUN37:check ratelimit;IF reads work REFRESH #316(Task7,rotation run36=close,run37=refresh). After:resume closing dups 1/run,April batch lowest# first(222,226,228,232...).
DUPS-OPEN-AFTER-219(30):Apr(26):222,226,228,232,238,240,244,246,248,252,255,257,259,261,266,271,273,275,278,280,283,285,288,290,293,296|May(4):303,306,309,313
CLOSED-by-me:#219(run36),#215(run33),#129,#163,#170,#195.
HOLD:no-new-PRs/comments.18 TI-PRs stale,NONE merged,maint disengaged~77d.Dup-cleanup OK 1/run.Task3 new tests deferred til maint engages.
READ-GOTCHA:issues endpoint mixes PRs+issues,created-desc,100/page->MUST paginate pages1-3 to see #219-#238(fall to page2);single-page read->false "already closed"(hit&corrected run36). curl reads only work while unauth ratelimit(60/hr/shared-IP)not spent;else 403.
TESTS:3966 pass/0 fail @9ffb0f3(validated run32 x3,run34 x3).bun NOT preinstalled->curl -fsSL https://bun.sh/install|bash;~/.bun/bin. Prior "1 fail"(05-25)=flaky perf wall-clock assert src/text/perf.test.ts,NOT logic bug.
TI-PRs18:162,194,218,221,225,231,234,237,243,251,254,264,268,302,308,312,315,320. No human engagement(#315 lone comment=mine).
NOT-MINE:Perf-Improver monthlies/PRs+aw/CI-Doctor(341,339,334,164...).
TI-non-monthly(LEAVE,real value,in #316 actions):#265(bug NonSequentialCounter dead-code),#214(infra test:coverage scripts).
TOOLS:update_issue title must start"[Test Improver] ",MAX 1/run HARD.push_repo_memory over-counts .git churn(errs ~35KB)but auto-push works;ignore if content file<10KB.
