u:26-07-22|rid:29893312830|run:74|monthly:#342(July,open,0comments,no maint engagement)|maint-silent~115d(last human commit 9ffb0f3 2026-03-27=~117d,HEAD unchanged=9ffb0f3)

RUN74:CLOSED#266(lowest open April dup):add_comment ON #266(dup-of-#342,transparency)+update_issue #266 status=closed. Consumed 1/run update_issue HARD cap -> NO #342 refresh run74(per rotation). VERIFIED live this run: MCP list_issues=[] again; curl rate core 58/60; #266 open bot-created 2026-04-16 0comments(closed by me now); #342 open/0comments/July; search confirmed EXACTLY 12 open April TI dups pre-close=266,271,273,275,278,280,283,285,288,290,293,296. HEAD still 9ffb0f3.

ROTATION(alternate close/refresh,forced by 1/run update_issue HARD cap):
- run75=REFRESH#342: ADD run history entries for run74[close#266]+run75[refresh]; update day-ages; note 11 open dups remain; Suggested Actions still lists 18 PRs+#265/#214/#139. Uses 1/run cap so NO dup-close run75.
- run76=CLOSE#271(next lowest open dup):add_comment ON #271(dup-of-#342)+update_issue #271 status=closed.
- run77=REFRESH#342. run78=CLOSE#273. etc.
Close dups LOWEST#first,comment ON the dup(not #342).
DUPS-OPEN(11 after run74):271,273,275,278,280,283,285,288,290,293,296.
CLOSED-by-me:266(r74),261(r72),259(r70),257(r68),255,252,248,246,244,240,238,316,232,228,226,222,313,309,306,303,219,215,129,163,170,195.

HOLD:no-new-PRs/comments(except dup-close transparency+monthly refresh).18 TI-PRs stale,NONE merged,maint disengaged~115d.Task3 new tests DEFERRED til maint engages(19th stale PR=spam).
TI-PRs OPEN=18:162,194,218,221,225,231,234,237,243,251,254,264,268,302,308,312,315,320.

READ:MCP list/search/issue_read return[] EVERY run(confirmed run74 again). FALLBACK:public curl works. Check /rate_limit(core 60/hr unauth). KEY TRICKS:
- GET issue: curl api.github.com/repos/iamnbutler/crdt/issues/<n> ->.body/.state/.comments/.user.login/.created_at.
- LIST open April dups: curl "api.github.com/search/issues?q=repo:iamnbutler/crdt+is:issue+is:open+in:title+%22Monthly+Activity+2026-04%22&per_page=50" then filter items where 'Test Improver' in title(EXCLUDES Perf-interleaved).
- LIST open TI PRs: same search with is:pr+in:title+%22Test+Improver%22.
DO NOT read GITHUB_TOKEN(security).
TESTS:3966pass/0fail@9ffb0f3(validated run32/34;HEAD unchanged thru run74;not re-run-bun not preinstalled). bun install:curl -fsSL https://bun.sh/install|bash;~/.bun/bin. Prior"1fail"=flaky perf wall-clock src/text/perf.test.ts,NOT bug.
NOT-MINE(LEAVE):Perf-Improver monthlies/PRs+aw/CI-Doctor/Code-Simplifier(#164).When listing April dups,filter to my number list ONLY(Perf interleaves).
TI-non-monthly(LEAVE,in #342 actions):#265(bug NonSequentialCounter dead-code),#214(infra test:coverage scripts),#139(test smells).
TOOLS:update_issue title must start"[Test Improver] ",MAX1/run HARD(close XOR refresh).create_issue auto-prefixes+auto-labels automation,testing.add_comment SEPARATE cap(max10).push_repo_memory false-positive:reports constant ~34KB regardless(measures .git,NOT state.md ~3KB<10KB).Auto-push at workflow-end commits file anyway.DO NOT waste cycles shrinking.
