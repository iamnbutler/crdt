u:26-06-04|rid:26933457111|restraint:26|monthly:#316(June,updated OK via update_issue)|maint-silent:26-03-29(~67d)
HOLD:no-new-PRs/comments,monthly-only(18-TI-PRs-stale,none-merged)
CLEANUP-progress:maintainer closed 14 more dups since last run(#240-278 batch).Open TI-monthly-dups now 21(was 25).
CORRECTION:prior memory was WRONG-232,228,226,222 + ALL March dups(219,215,195,170,163,129)are still OPEN(memory had claimed closed).Reconciled #316 against live API this run.
DUPS-TO-CLOSE(21,TI-only,keep#316):may4:313,309,306,303|apr11:296,293,290,288,285,283,280,232,228,226,222|mar6:219,215,195,170,163,129
NOTE:Perf-Improver monthlies(many open)+aw/CI-Doctor issues(340,334,164)are OTHER workflows-NOT mine,do not close.
main:9ffb0f3(unchanged)|test:3965p/1f@last-val26-05-25(bun NOT installed,tree unchanged→status holds;skip-count10x)
TIprs18(confirmed via /pulls):162,194,218,221,225,231,234,237,243,251,254,264,268,302,308,312,315,320
bug-issue:#265(NonSequentialCounter dead-code validation)still OPEN-in suggested actions
i139item3-pend(perf69→103→118ms)|1-failing-test-uninvestigated(observation only,no bug-issue under HOLD)
mcp:search_issues/list_issues=empty CONFIRMED;use curl(works,unauth public reads):curl api.github.com/repos/iamnbutler/crdt/issues?state=open&per_page=100&page=N + /pulls?state=open
push_repo_memory=FALSE-POS(~31KB regardless;auto-push works)
update_issue(safeoutputs)WORKS:target must start"[Test Improver] ",max1/run,operation:replace→used on #316 each run(Task7 mandatory,so cant also close a dup same run)
