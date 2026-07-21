u:26-07-21|rid:29803525200|run:73|monthly:#342(July,open,0comments,no maint engagement)|maint-silent~114d(last human commit 9ffb0f3 2026-03-27=~116d,HEAD unchanged=9ffb0f3)

RUN73:REFRESHED#342(dropped closed#261->12 open April dups;prepended run72[close#261 05:26]+run73[refresh] to Run History;updated day-ages 114/116;trimmed old entries). update_issue used on #342 ONLY(1/run HARD cap consumed). VERIFIED live REST+search this run: #261 closed 2026-07-20T05:26(run72); exactly 12 open TI April dups=266,271,273,275,278,280,283,285,288,290,293,296(no extras/missing); 18 open TI PRs unchanged=162,194,218,221,225,231,234,237,243,251,254,264,268,302,308,312,315,320; #342 open/0comments; HEAD still 9ffb0f3. rate:core48/60,search10/10 at start.

ROTATION(alternate close/refresh,forced by 1/run update_issue HARD cap):
- run74=CLOSE#266(next lowest open dup):add_comment ON #266(dup-of-#342,transparency)+update_issue #266 status=closed. Consumes 1/run cap so NO #342 refresh run74.
- run75=REFRESH#342(drop#266->11 dups;prepend run74[close#266]+run75[refresh];update day-ages).
Close dups LOWEST#first,comment ON the dup(not #342).
DUPS-OPEN(12)April:266,271,273,275,278,280,283,285,288,290,293,296.
CLOSED-by-me:261(r72),259(r70),257(r68),255,252,248,246,244,240,238,316,232,228,226,222,313,309,306,303,219,215,129,163,170,195.

HOLD:no-new-PRs/comments(except dup-close transparency+monthly refresh).18 TI-PRs stale,NONE merged,maint disengaged~114d.Task3 new tests DEFERRED til maint engages(19th stale PR=spam).
TI-PRs OPEN=18:162,194,218,221,225,231,234,237,243,251,254,264,268,302,308,312,315,320.

READ:MCP list/search/issue_read return[] EVERY run(confirmed run73 again). FALLBACK:public curl works. Check /rate_limit(core 60/hr unauth;search 10/hr SEPARATE). KEY TRICKS:
- GET issue body: curl api.github.com/repos/iamnbutler/crdt/issues/<n> ->.body/.state/.comments.
- LIST open April dups: curl "api.github.com/search/issues?q=repo:iamnbutler/crdt+is:issue+is:open+in:title+%22Monthly+Activity+2026-04%22&per_page=50" then filter items where 'Test Improver' in title(EXCLUDES Perf-interleaved).
- LIST open TI PRs: same search with is:pr+in:title+%22Test+Improver%22.
DO NOT read GITHUB_TOKEN(security).
TESTS:3966pass/0fail@9ffb0f3(validated run32/34;HEAD unchanged thru run73;not re-run-bun not preinstalled). bun install:curl -fsSL https://bun.sh/install|bash;~/.bun/bin. Prior"1fail"=flaky perf wall-clock src/text/perf.test.ts,NOT bug.
NOT-MINE(LEAVE):Perf-Improver monthlies/PRs+aw/CI-Doctor/Code-Simplifier(#164).When listing April dups,filter to my number list ONLY(Perf interleaves).
TI-non-monthly(LEAVE,in #342 actions):#265(bug NonSequentialCounter dead-code),#214(infra test:coverage scripts),#139(test smells).
TOOLS:update_issue title must start"[Test Improver] ",MAX1/run HARD(close XOR refresh).create_issue auto-prefixes+auto-labels automation,testing.add_comment SEPARATE cap(max10).push_repo_memory false-positive:reports constant ~34KB regardless(measures .git loose-objects/logs,NOT state.md ~3KB<10KB). Auto-push at workflow-end commits file anyway. DO NOT waste cycles shrinking.
