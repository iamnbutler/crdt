u:26-06-23|rid:28004595194|run:45|monthly-canonical:#316(June)|maint-silent~86d
RUN45:REFRESH #316 done(recorded BOTH run44 close#313 AND run45). Verified live: #313 confirmed closed 2026-06-22T06:10:34Z(run44). May duplicates now FULLY CLEARED(0). Open monthlies=27(26 April dups + #316). Updated #316: intro 28->27, removed stale May bulk-close line, prepended run44+run45 history entries, day-count ~84->86d. Spent the 1/run HARD update_issue on this refresh. HEAD 9ffb0f3 unchanged(suite NOT re-run; prior 3966/0 validation holds). HOLD active.
ROTATION:run44=close#313(done),run45=refresh #316(done),run46=close-dup #222(lowest April; comment superseded->#316 then close),run47=refresh #316(record run46 close),then alternate close-dup(April lowest# first)/refresh due to 1/run update_issue HARD cap.
DUPS-OPEN(26)April-only:222,226,228,232,238,240,244,246,248,252,255,257,259,261,266,271,273,275,278,280,283,285,288,290,293,296. Close lowest# first:222,226,228...
CLOSED-by-me:#313(run44),#309(run42),#306(run40),#303(run38),#219(run36),#215(run33),#129,#163,#170,#195.
HOLD:no-new-PRs/comments.18 TI-PRs stale,NONE merged,maint disengaged~86d(last~03-29).Dup-cleanup 1/run via the single update_issue.Task3 new tests deferred til maint engages.
READ:MCP list/search/issue_read return [] MOST runs BUT public single-issue API via curl works(run43,44,45 confirmed). Use curl public api(/repos/.../issues/N single-issue=CORE; /search/issues?q=...+is:open+in:title when search remaining>0). run45 start: core 59, SEARCH 0(exhausted->used single-issue endpoint only). Check /rate_limit first(60/hr/shared-IP unauth).
TESTS:3966 pass/0 fail @9ffb0f3(validated run32 x3,run34 x3). bun NOT preinstalled->curl -fsSL https://bun.sh/install|bash;~/.bun/bin. Prior "1 fail"(05-25)=flaky perf wall-clock assert src/text/perf.test.ts,NOT logic bug.
TI-PRs18:162,194,218,221,225,231,234,237,243,251,254,264,268,302,308,312,315,320. No human engagement(#315 lone comment=mine).
NOT-MINE:Perf-Improver monthlies/PRs+aw/CI-Doctor(341,339,334,164...).LEAVE all.
TI-non-monthly(LEAVE,real value,in #316 actions):#265(bug NonSequentialCounter dead-code),#214(infra test:coverage scripts).
TOOLS:update_issue title must start"[Test Improver] ",MAX 1/run HARD(close OR refresh,not both).add_comment separate(max 10).push_repo_memory over-counts .git churn(errs ~35KB)but auto-push works;ignore if content file<10KB.
