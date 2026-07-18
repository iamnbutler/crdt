u:26-07-18|rid:29631668719|run:70|monthly:#342(July,open,0comments,no maint engagement)|maint-silent~113d(last human commit 9ffb0f3 2026-03-27,HEAD unchanged=9ffb0f3)

RUN70:CLOSE#259(April dup). add_comment ON #259(dup-of-#342,transparency)+update_issue #259 status=closed(consumed 1/run update_issue HARD cap, so NO #342 refresh this run - #342 was refreshed run69 2026-07-17, content still current: HEAD same,no new PRs). Verified via core curl(56/60 avail this run,unusual): #342 open/0comments/updated 2026-07-17; #259 title="[TI] Monthly Activity 2026-04" open->closed.

ROTATION(alternate close/refresh,forced by 1/run update_issue HARD cap):
- run71=REFRESH#342(drop#259->13 dups;prepend run70[close#259]+run71[refresh] to Run History).
- run72=CLOSE#261(next lowest open dup): add_comment ON #261+update_issue #261 closed.
Close dups LOWEST#first,comment ON the dup(not #342).
DUPS-OPEN(13)April:261,266,271,273,275,278,280,283,285,288,290,293,296.
CLOSED-by-me:259(r70),257(r68),255,252,248,246,244,240,238,316,232,228,226,222,313,309,306,303,219,215,129,163,170,195.

HOLD:no-new-PRs/comments(except dup-close transparency+monthly refresh).18 TI-PRs stale,NONE merged,maint disengaged~113d.Task3 new tests DEFERRED til maint engages(19th stale PR=spam).
TI-PRs OPEN=18:162,194,218,221,225,231,234,237,243,251,254,264,268,302,308,312,315,320.

READ:MCP list/search/issue_read return[] most runs. FALLBACK:public curl. Check /rate_limit(core 60/hr unauth;search 10/hr SEPARATE). KEY TRICK:when core GET 0/60,use search/issues API-returns FULL body+comments! Query:search/issues?q=repo:iamnbutler/crdt+is:issue+is:open+in:title+"Test Improver"+"Monthly Activity 2026-07" -> items[].body. LIST:...+"Monthly Activity"(~15;filter title.startswith("[Test Improver]")-fuzzy matches Perf too). PRs:is:pr+"Test Improver". DO NOT read GITHUB_TOKEN(security).
TESTS:3966pass/0fail@9ffb0f3(validated run32/34;HEAD unchanged thru run70;not re-run-bun not preinstalled). bun install:curl -fsSL https://bun.sh/install|bash;~/.bun/bin. Prior"1fail"=flaky perf wall-clock src/text/perf.test.ts,NOT bug.
NOT-MINE(LEAVE):Perf-Improver monthlies/PRs(#343,341,338,337,336,335,332,331,330,297,301,253,224..)+aw/CI-Doctor/Code-Simplifier(#164).
TI-non-monthly(LEAVE,in #342 actions):#265(bug NonSequentialCounter dead-code),#214(infra test:coverage scripts),#139(test smells).
TOOLS:update_issue title must start"[Test Improver] ",MAX1/run HARD(close XOR refresh).create_issue auto-prefixes+auto-labels automation,testing.add_comment SEPARATE cap(max10).push_repo_memory CONFIRMED false-positive:reports constant 34KB regardless of edits(measures .git loose-objects/logs from 70 runs=172KB .git,NOT state.md which is only 2.6KB<10KB limit). Auto-push at workflow-end commits working-dir file anyway(state persisted 70 runs). DO NOT waste cycles shrinking state.md-count is .git history,not content. Keep file small anyway for hygiene.
