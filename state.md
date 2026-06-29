u:26-06-29|rid:28351389459|run:51|monthly-canonical:#316(June)|maint-silent~90d(last~03-29)
RUN51:REFRESH#316 done. Reconciled run50 close#228(closed06-28):April dups 24->23,total monthlies 25->24,removed#228 from list. Prepended run51+run50 entries. 1/run cap spent on refresh. Verified live:#316 open 0-comments;#228 closed06-28;rate60/60;HEAD9ffb0f3 unchanged(3966/0 holds,not re-run).
RUN50:CLOSE#228 done(April dup),cap spent,refresh deferred->run51.
ROTATION:run52=close#232(lowest April dup),run53=refresh#316,then alternate close-dup/refresh(1/run update_issue HARD cap).
DUPS-OPEN(23)April-only:232,238,240,244,246,248,252,255,257,259,261,266,271,273,275,278,280,283,285,288,290,293,296. Close lowest# first:232,238,240...
Open-monthlies now=24(23 April dups + #316 canonical). May FULLY CLEARED(0).
CLOSED-by-me:#228(r50),#226(r48),#222(r46),#313(r44),#309(r42),#306(r40),#303(r38),#219(r36),#215(r33),#129,#163,#170,#195.
HOLD:no-new-PRs/comments.18 TI-PRs stale,NONE merged,maint disengaged~90d.Dup-cleanup 1/run via single update_issue.Task3 new tests deferred til maint engages.
READ:MCP list/search/issue_read return [] MOST runs BUT public single-issue + list(?state=all&sort=updated / ?state=open&per_page=100&labels=testing) via curl works(run43-51). Check /rate_limit first(60/hr shared-IP unauth).
TESTS:3966 pass/0 fail @9ffb0f3(validated run32 x3,run34 x3). bun NOT preinstalled->curl -fsSL https://bun.sh/install|bash;~/.bun/bin. Prior "1 fail"(05-25)=flaky perf wall-clock src/text/perf.test.ts,NOT logic bug.
TI-PRs18:162,194,218,221,225,231,234,237,243,251,254,264,268,302,308,312,315,320. No human engagement(#315 lone comment=mine).
NOT-MINE:Perf-Improver monthlies/PRs+aw/CI-Doctor(341,339,334,164...).LEAVE all.
TI-non-monthly(LEAVE,in #316 actions):#265(bug NonSequentialCounter dead-code),#214(infra test:coverage scripts).
TOOLS:update_issue title must start"[Test Improver] ",MAX1/run HARD(close OR refresh).add_comment separate(max10).push_repo_memory over-counts .git churn;ignore if content<10KB.
