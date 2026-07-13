u:26-07-13|rid:29226021485|run:65|monthly-canonical:#342(July,open,0 comments,no maint engagement)|maint-silent~108d(last human commit 9ffb0f3 Nate Butler 2026-03-27)

RUN65:REFRESH#342(single update_issue cap consumed;operation=replace).Verified LIVE via curl+search API(core 56 remaining start):#342 open 0 comments canonical;16 open April dups=255,257,259,261,266,271,273,275,278,280,283,285,288,290,293,296(#248 r62,#252 r64 now CONFIRMED closed via search);18 open TI-PRs=162,194,218,221,225,231,234,237,243,251,254,264,268,302,308,312,315,320(matches memory exactly).MCP issue_read/list/search STILL return [] -> curl works. Prepended run65+run64+existing to Run History;set dup count 18->16 in body.

ROTATION:run66=CLOSE#255(lowest April dup;+transparency comment aw_->points #342;drop dup 16->15;next-close#257).Then run67=REFRESH#342(prepend run66[close#255]+run67;update dup count to 15).Alternate close-dup/refresh forced by 1/run update_issue HARD cap.Close dups LOWEST#first.
DUPS-OPEN(16)April-only:255,257,259,261,266,271,273,275,278,280,283,285,288,290,293,296.
CLOSED-by-me:#252(r64),#248(r62),#246(r60),#244(r58),#240(r56),#238(r54),#316(r53 month-rollover),#232(r52),#228(r50),#226(r48),#222(r46),#313(r44),#309(r42),#306(r40),#303(r38),#219(r36),#215(r33),#129,#163,#170,#195.

HOLD:no-new-PRs/comments(except dup-close transparency + monthly rollover/refresh).18 TI-PRs stale,NONE merged,maint disengaged~108d.Dup-cleanup 1/run via single close+comment OR single refresh(alternate).Task3 new tests DEFERRED til maint engages(adding 19th stale PR=spam).
TI-PRs OPEN=18(unchanged):162,194,218,221,225,231,234,237,243,251,254,264,268,302,308,312,315,320.

READ:MCP list/search/issue_read return [] OR WASM-crash MOST runs BUT public single-issue(GET /repos/.../issues/N) + search(GET /search/issues?q=repo:...+is:open...) via curl WORK(run43-65). Check /rate_limit first(60/hr shared-IP unauth;~56 at run65 start;search limit=10/hr SEPARATE). NOTE:fuzzy title search matches BOTH Perf+Test Improver monthlies;MUST filter title.startswith("[Test Improver]").
TESTS:3966 pass/0 fail @9ffb0f3(validated run32 x3,run34 x3;HEAD unchanged thru run65;NOT re-run run65-bun not preinstalled+HEAD unchanged). bun NOT preinstalled->curl -fsSL https://bun.sh/install|bash;~/.bun/bin. Prior "1 fail"(05-25)=flaky perf wall-clock src/text/perf.test.ts,NOT logic bug.
NOT-MINE:Perf-Improver monthlies/PRs(e.g.#224,253,297,301,343,341,338,337,336,335,334,332)+aw/CI-Doctor/Code-Simplifier(#164 No-Op Runs meta,active bot chatter).LEAVE all.
TI-non-monthly(LEAVE,list in July #342 actions):#265(bug NonSequentialCounter dead-code),#214(infra test:coverage scripts),#139(test smells,c:2).
TOOLS:update_issue title must start"[Test Improver] ",MAX1/run HARD(close OR refresh,not both).create_issue auto-prefixes+auto-labels automation,testing(pass title WITHOUT prefix).add_comment SEPARATE from update_issue cap(max10).push_repo_memory over-counts .git churn;ignore if content<10KB.
