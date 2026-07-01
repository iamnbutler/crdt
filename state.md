u:26-07-01|rid:28496363680|run:53|monthly-canonical:NEW-July(created this run,# unknown-verify next run)|maint-silent~90d(last~03-29)
RUN53:MONTH-ROLLOVER. Closed #316(June canonical,prev month) + transparency comment + created "[Test Improver] Monthly Activity 2026-07"(fresh Run History,carried forward pending actions). 1/run update_issue spent on closing #316. create_issue separate. Verified live:18 TI-PRs unchanged,22 April dups open,#265 #214 open,rate60/60,recent-activity ALL bots(no human). HEAD 9ffb0f3 unchanged(3966/0,not re-run).
RUN52:CLOSE#232(lowest April dup)+comment. RUN51:REFRESH#316. RUN50:CLOSE#228.
ROTATION:run54=NEXT ACTION=(a)verify July monthly # via curl(search open testing monthlies for 2026-07),then (b)close #238(lowest April dup)+refresh July summary alternate. run54=close#238,run55=refresh July(include run53+54+55),then alternate close-dup/refresh(1/run update_issue HARD cap).
DUPS-OPEN(22)April-only:238,240,244,246,248,252,255,257,259,261,266,271,273,275,278,280,283,285,288,290,293,296. Close lowest# first:238,240,244...
CLOSED-by-me:#316(r53 month-rollover),#232(r52),#228(r50),#226(r48),#222(r46),#313(r44),#309(r42),#306(r40),#303(r38),#219(r36),#215(r33),#129,#163,#170,#195.
HOLD:no-new-PRs/comments(except dup-close transparency + monthly rollover).18 TI-PRs stale,NONE merged,maint disengaged~90d.Dup-cleanup 1/run via single update_issue.Task3 new tests deferred til maint engages.
READ:MCP list/search/issue_read return [] MOST runs BUT public single-issue + list(?state=open&labels=testing / ?state=all&sort=updated) via curl works(run43-53). Check /rate_limit first(60/hr shared-IP unauth).
TESTS:3966 pass/0 fail @9ffb0f3(validated run32 x3,run34 x3). bun NOT preinstalled->curl -fsSL https://bun.sh/install|bash;~/.bun/bin. Prior "1 fail"(05-25)=flaky perf wall-clock src/text/perf.test.ts,NOT logic bug.
TI-PRs18:162,194,218,221,225,231,234,237,243,251,254,264,268,302,308,312,315,320. No human engagement.
NOT-MINE:Perf-Improver monthlies/PRs+aw/CI-Doctor(341,339,338,334,164,+many perf PRs 160-329).LEAVE all.
TI-non-monthly(LEAVE,in July actions):#265(bug NonSequentialCounter dead-code),#214(infra test:coverage scripts),#139(test smells,c:2).
TOOLS:update_issue title must start"[Test Improver] ",MAX1/run HARD(close OR refresh).create_issue auto-prefixes"[Test Improver] "+auto-labels automation,testing(pass title WITHOUT prefix).add_comment separate(max10).push_repo_memory over-counts .git churn;ignore if content<10KB.
