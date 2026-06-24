u:26-06-24|rid:28077478090|run:46|monthly-canonical:#316(June)|maint-silent~87d(last~03-29)
RUN46:CLOSE-DUP done. Closed #222(April dup monthly) with superseded->#316 comment. Used the 1/run HARD update_issue on the close. #316 NOT refreshed this run(cap exhausted)->record run45+run46 in run47 refresh. Verified live@run46 start: #316 open 0-comments updated 06-23(run45). #222 was open 0-comments last-touched 04-01. Recent-updated issues ALL bot(github-actions);NO maintainer(iamnbutler) activity->HOLD still valid. HEAD 9ffb0f3 unchanged(suite NOT re-run;3966/0 holds).
ROTATION:run46=close#222(DONE),run47=refresh#316(record run45+run46 close#222),run48=close#226,then alternate close-dup(April lowest# first)/refresh due to 1/run update_issue HARD cap.
DUPS-OPEN(25)April-only:226,228,232,238,240,244,246,248,252,255,257,259,261,266,271,273,275,278,280,283,285,288,290,293,296. Close lowest# first:226,228,232...
Open-monthlies now=26(25 April dups + #316 canonical).
CLOSED-by-me:#222(run46),#313(run44),#309(run42),#306(run40),#303(run38),#219(run36),#215(run33),#129,#163,#170,#195.
HOLD:no-new-PRs/comments.18 TI-PRs stale,NONE merged,maint disengaged~87d.Dup-cleanup 1/run via the single update_issue.Task3 new tests deferred til maint engages.
READ:MCP list/search/issue_read return [] MOST runs BUT public single-issue + list(?state=all&sort=updated) via curl works(run43-46 confirmed). Use curl public api. Check /rate_limit first(60/hr/shared-IP unauth). run46 start: core 59/60, search 10/10.
TESTS:3966 pass/0 fail @9ffb0f3(validated run32 x3,run34 x3). bun NOT preinstalled->curl -fsSL https://bun.sh/install|bash;~/.bun/bin. Prior "1 fail"(05-25)=flaky perf wall-clock assert src/text/perf.test.ts,NOT logic bug.
TI-PRs18:162,194,218,221,225,231,234,237,243,251,254,264,268,302,308,312,315,320. No human engagement(#315 lone comment=mine).
NOT-MINE:Perf-Improver monthlies/PRs+aw/CI-Doctor(341,339,334,164...).LEAVE all.
TI-non-monthly(LEAVE,real value,in #316 actions):#265(bug NonSequentialCounter dead-code),#214(infra test:coverage scripts).
TOOLS:update_issue title must start"[Test Improver] ",MAX 1/run HARD(close OR refresh,not both).add_comment separate(max 10).push_repo_memory over-counts .git churn but auto-push works;ignore if content file<10KB.
