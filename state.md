u:26-06-27|rid:28279929267|run:49|monthly-canonical:#316(June)|maint-silent~90d(last~03-29)
RUN49:REFRESH#316 done. Reconciled run48 close of #226: prepended run49+run48 entries, removed #226 from bulk-close list. April dups 25->24, total open TI monthlies 26->25. 1/run update_issue HARD cap spent on refresh -> NO dup-close this run. Verified live@run49 start: #316 open 0-comments updated 06-25(run47); #226 closed 06-26. Recent-updated ALL bot(github-actions);NO maintainer(iamnbutler)->HOLD valid. 18 TI-PRs unchanged[162,194,218,221,225,231,234,237,243,251,254,264,268,302,308,312,315,320]. #265,#214 open. HEAD 9ffb0f3 unchanged(suite NOT re-run;3966/0 holds).
RUN48:CLOSE#226 done (April dup). 1/run cap spent on close->#316 refresh deferred to run49.
ROTATION:run49=refresh#316(DONE),run50=close#228(lowest April dup),run51=refresh#316,then alternate close-dup/refresh due to 1/run update_issue HARD cap.
DUPS-OPEN(24)April-only:228,232,238,240,244,246,248,252,255,257,259,261,266,271,273,275,278,280,283,285,288,290,293,296. Close lowest# first:228,232,238...
Open-monthlies now=25(24 April dups + #316 canonical). May FULLY CLEARED(0).
CLOSED-by-me:#226(run48),#222(run46),#313(run44),#309(run42),#306(run40),#303(run38),#219(run36),#215(run33),#129,#163,#170,#195.
HOLD:no-new-PRs/comments.18 TI-PRs stale,NONE merged,maint disengaged~90d.Dup-cleanup 1/run via the single update_issue.Task3 new tests deferred til maint engages.
READ:MCP list/search/issue_read return [] MOST runs(confirmed again run49) BUT public single-issue + list(?state=all&sort=updated / ?state=open&per_page=100&labels=testing) via curl works(run43-49). Use curl public api. Check /rate_limit first(60/hr/shared-IP unauth). run49 start: core 59/60.
TESTS:3966 pass/0 fail @9ffb0f3(validated run32 x3,run34 x3). bun NOT preinstalled->curl -fsSL https://bun.sh/install|bash;~/.bun/bin. Prior "1 fail"(05-25)=flaky perf wall-clock assert src/text/perf.test.ts,NOT logic bug.
TI-PRs18:162,194,218,221,225,231,234,237,243,251,254,264,268,302,308,312,315,320. No human engagement(#315 lone comment=mine).
NOT-MINE:Perf-Improver monthlies/PRs+aw/CI-Doctor(341,339,334,164...).LEAVE all.
TI-non-monthly(LEAVE,real value,in #316 actions):#265(bug NonSequentialCounter dead-code),#214(infra test:coverage scripts).
TOOLS:update_issue title must start"[Test Improver] ",MAX 1/run HARD(close OR refresh,not both).add_comment separate(max 10).push_repo_memory over-counts .git churn but auto-push works;ignore if content file<10KB.
