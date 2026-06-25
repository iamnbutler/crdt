u:26-06-25|rid:28149175174|run:47|monthly-canonical:#316(June)|maint-silent~88d(last~03-29)
RUN47:REFRESH#316 done. Reconciled run46 close of #222: April dups 26->25, total open TI monthlies 27->26. Removed #222 from bulk-close line. Prepended run47+run46 entries (run45=06-23 already in body). 1/run update_issue HARD cap spent on the #316 refresh -> NO dup closed this run. Verified live@run47: #316 open 0-comments updated 06-23(run45). 18 TI-PRs unchanged. 25 April dups open(226...296). Recent-updated ALL bot(github-actions);NO maintainer(iamnbutler)->HOLD valid. HEAD 9ffb0f3 unchanged(suite NOT re-run;3966/0 holds).
ROTATION:run47=refresh#316(DONE),run48=close#226(lowest April# first),run49=refresh,then alternate close-dup/refresh due to 1/run update_issue HARD cap.
DUPS-OPEN(25)April-only:226,228,232,238,240,244,246,248,252,255,257,259,261,266,271,273,275,278,280,283,285,288,290,293,296. Close lowest# first:226,228,232...
Open-monthlies now=26(25 April dups + #316 canonical). May FULLY CLEARED(0).
CLOSED-by-me:#222(run46),#313(run44),#309(run42),#306(run40),#303(run38),#219(run36),#215(run33),#129,#163,#170,#195.
HOLD:no-new-PRs/comments.18 TI-PRs stale,NONE merged,maint disengaged~88d.Dup-cleanup 1/run via the single update_issue.Task3 new tests deferred til maint engages.
READ:MCP list/search/issue_read return [] MOST runs(confirmed again run47) BUT public single-issue + list(?state=all&sort=updated / ?state=open&per_page=100&labels=testing) via curl works(run43-47). Use curl public api. Check /rate_limit first(60/hr/shared-IP unauth). run47 start: core 59/60.
TESTS:3966 pass/0 fail @9ffb0f3(validated run32 x3,run34 x3). bun NOT preinstalled->curl -fsSL https://bun.sh/install|bash;~/.bun/bin. Prior "1 fail"(05-25)=flaky perf wall-clock assert src/text/perf.test.ts,NOT logic bug.
TI-PRs18:162,194,218,221,225,231,234,237,243,251,254,264,268,302,308,312,315,320. No human engagement(#315 lone comment=mine).
NOT-MINE:Perf-Improver monthlies/PRs+aw/CI-Doctor(341,339,334,164...).LEAVE all.
TI-non-monthly(LEAVE,real value,in #316 actions):#265(bug NonSequentialCounter dead-code),#214(infra test:coverage scripts).
TOOLS:update_issue title must start"[Test Improver] ",MAX 1/run HARD(close OR refresh,not both).add_comment separate(max 10).push_repo_memory over-counts .git churn but auto-push works;ignore if content file<10KB.
