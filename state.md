u:26-07-03|rid:28640552099|run:55|monthly-canonical:#342(July,verified live run55,0 comments no maint engagement)|maint-silent~90d(last~03-29)
RUN55:REFRESH#342. Prepended run54(closed#238)+run55 entries to Run History;bulk-close action now 21 April dups(#240-296,removed#238);note 22->21. Verified live via REST:#238 closed,21 April dups open[240,244,246,248,252,255,257,259,261,266,271,273,275,278,280,283,285,288,290,293,296],18 TI-PRs unchanged,#139/#214/#265 open,#342=0 comments. HEAD 9ffb0f3. Spent 1/run update_issue on refresh. rate_limit 55 remaining start.
RUN54:CLOSE#238(lowest April dup)+transparency comment(aw_0Yktb0sr). Verified live:#342 July monthly=0 comments,no checkbox changes,HEAD unchanged. Did NOT refresh #342(alternating cadence;run55 refreshes).
RUN53:MONTH-ROLLOVER. Closed #316(June canonical)+comment+created #342 "[Test Improver] Monthly Activity 2026-07". Verified 18 TI-PRs unchanged,22 April dups. HEAD 9ffb0f3.
RUN52:CLOSE#232+comment. RUN51:REFRESH#316. RUN50:CLOSE#228.
ROTATION:run56=CLOSE#240(lowest April dup;+transparency comment),then run57=REFRESH#342(prepend run56+run57).Alternate close-dup/refresh(1/run update_issue HARD cap).close dups lowest#first:240,244,246,248,252,255,257,259,261,266,271,273,275,278,280,283,285,288,290,293,296.
DUPS-OPEN(21)April-only:240,244,246,248,252,255,257,259,261,266,271,273,275,278,280,283,285,288,290,293,296.
CLOSED-by-me:#238(r54),#316(r53 month-rollover),#232(r52),#228(r50),#226(r48),#222(r46),#313(r44),#309(r42),#306(r40),#303(r38),#219(r36),#215(r33),#129,#163,#170,#195.
HOLD:no-new-PRs/comments(except dup-close transparency + monthly rollover/refresh).18 TI-PRs stale,NONE merged,maint disengaged~90d.Dup-cleanup 1/run via single update_issue.Task3 new tests deferred til maint engages.
READ:MCP list/search/issue_read return [] OR WASM-crash MOST runs BUT public single-issue + list(?state=open&labels=testing / ?state=open&per_page=100 pulls) via curl works(run43-55). Check /rate_limit first(60/hr shared-IP unauth).
TESTS:3966 pass/0 fail @9ffb0f3(validated run32 x3,run34 x3). bun NOT preinstalled->curl -fsSL https://bun.sh/install|bash;~/.bun/bin. Prior "1 fail"(05-25)=flaky perf wall-clock src/text/perf.test.ts,NOT logic bug.
TI-PRs18:162,194,218,221,225,231,234,237,243,251,254,264,268,302,308,312,315,320. No human engagement.
NOT-MINE:Perf-Improver monthlies/PRs+aw/CI-Doctor(341,339,338,334,164,+many perf PRs 160-329).LEAVE all.
TI-non-monthly(LEAVE,in July actions):#265(bug NonSequentialCounter dead-code),#214(infra test:coverage scripts),#139(test smells,c:2).
TOOLS:update_issue title must start"[Test Improver] ",MAX1/run HARD(close OR refresh).create_issue auto-prefixes"[Test Improver] "+auto-labels automation,testing(pass title WITHOUT prefix).add_comment separate(max10).push_repo_memory over-counts .git churn;ignore if content<10KB.
