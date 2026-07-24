u:26-07-24|rid:30068992262|run:76|monthly:#342(July,open,0comments,no maint engagement)|maint-silent~119d(last human commit 9ffb0f3 2026-03-27,HEAD unchanged=9ffb0f3)

RUN76:CLOSED#271(per rotation): add_comment ON #271(dup-of-#342,superseded April summary)+update_issue #271 status=closed. Used 1/run update_issue HARD cap on the close -> NO monthly refresh run76 (alternates to run77). VERIFIED live this run: MCP list_issues=[] again; curl core 52/60; #342 open/0comments/July; #271 was open/0comments/github-actions[bot]; HEAD still 9ffb0f3; search confirmed EXACTLY 11 open April TI dups pre-close=271,273,275,278,280,283,285,288,290,293,296. After run76 -> 10 dups.

ROTATION(alternate close/refresh,forced by 1/run update_issue HARD cap):
- run77=REFRESH#342: prepend run76[close#271]+run77[refresh]; note dups 11->10; update day-ages(~119d+). update_issue on #342 only.
- run78=CLOSE#273(next lowest open dup):add_comment ON #273(dup-of-#342)+update_issue #273 status=closed. Then dups->9.
- run79=REFRESH#342. run80=CLOSE#275. run81=REFRESH. run82=CLOSE#278. etc.
Close dups LOWEST#first,comment ON the dup(not #342).
DUPS-OPEN(10 after run76):273,275,278,280,283,285,288,290,293,296.
CLOSED-by-me:271(r76),266(r74),261(r72),259(r70),257(r68),255,252,248,246,244,240,238,316,232,228,226,222,313,309,306,303,219,215,129,163,170,195.

HOLD:no-new-PRs/comments(except dup-close transparency+monthly refresh).18 TI-PRs stale,NONE merged,maint disengaged~119d.Task3 new tests DEFERRED til maint engages(19th stale PR=spam).
TI-PRs OPEN=18:162,194,218,221,225,231,234,237,243,251,254,264,268,302,308,312,315,320.

READ:MCP list/search/issue_read return[] EVERY run(confirmed run76 again). FALLBACK:public curl works. Check /rate_limit(core 60/hr unauth). KEY TRICKS:
- GET issue: curl api.github.com/repos/iamnbutler/crdt/issues/<n> ->.body/.state/.comments/.user.login/.created_at.
- LIST open April dups: curl "api.github.com/search/issues?q=repo:iamnbutler/crdt+is:issue+is:open+in:title+%22Monthly+Activity+2026-04%22&per_page=50" then filter items where 'Test Improver' in title(EXCLUDES Perf-interleaved).
- LIST open TI PRs: same search with is:pr+in:title+%22Test+Improver%22.
DO NOT read GITHUB_TOKEN(security).
TESTS:3966pass/0fail@9ffb0f3(validated run32/34;HEAD unchanged thru run76;not re-run-bun not preinstalled). bun install:curl -fsSL https://bun.sh/install|bash;~/.bun/bin. Prior"1fail"=flaky perf wall-clock src/text/perf.test.ts,NOT bug.
NOT-MINE(LEAVE):Perf-Improver monthlies/PRs+aw/CI-Doctor/Code-Simplifier(#164).When listing April dups,filter to my number list ONLY(Perf interleaves).
TI-non-monthly(LEAVE,in #342 actions):#265(bug NonSequentialCounter dead-code),#214(infra test:coverage scripts),#139(test smells).
TOOLS:update_issue title must start"[Test Improver] ",MAX1/run HARD(close XOR refresh).create_issue auto-prefixes+auto-labels automation,testing.add_comment SEPARATE cap(max10).push_repo_memory false-positive:reports constant ~34KB regardless(measures .git,NOT state.md ~3KB<10KB).Auto-push at workflow-end commits file anyway.DO NOT waste cycles shrinking.