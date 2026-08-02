u:26-08-02|run:85|rid:30733854264|maint silent ~126d|HEAD 9ffb0f3

**NUMBERS RESOLVED:** #346=CI-red(r84). #347=Aug monthly. #345=snapshotsEqual. #344=CI test-exclusion.
R85 DID: refreshed #347 only. No new issue/PR (HOLD).

**D. CI MAIN RED since 2026-03-27(~128d)=#346. RE-VERIFIED r85 pristine HEAD.** `bun run lint` fails: noUnusedTemplateLiteral scripts/record-benchmarks.ts:333 + 1 formatter err. Fix=`bun run lint:fix`. CI run 23666019419: Lint FAIL => Test SKIPPED => **0 tests in CI**. Compounds #344.

**I. fragment.ts PROBED r85 - LATENT DEFECT (=> #347 backlog item 2, deliberately NOT an issue).**
`splitFragment(f,0)` (fragment.ts:215): left=[...base,2*io], right=[...base,2*(io+0)] => **IDENTICAL**. Verified: both [32768,0], cmp=0, left text="" right="hello". Split at f.length FINE. Dup locators break SumTree ordering key; parts also tie in sortFragments (same loc+insertionId+insertionOffset+len) - order survives ONLY via stable Array.sort.
Also verified `locatorBetween(L,L)` violates left<M<right: returns [...L,4503599627370495] > right. NOT reachable from remote path (DISCARDS findRefIndex return, uses sender locator). Both fns exported from pkg root.
REACH: 0-callers = text-buffer.ts:1651(findRefIndex,LIVE) + :1769(splitRefInTree, "EXPERIMENTAL-NOT CURRENTLY USED"). **Instrumented :1651+:1667, full suite => 0 HITS/3966 tests.** afterRef always frag ENDS(>=1), beforeRef always STARTS => Cases 2/3 match first. Fallback needs ref.offset===firstFrag.insertionOffset(0), seems to need pre-existing 0-len frag which only these branches create => self-referential/likely dead. **NOT PROVEN-never claim unreachable.**
LATENT, not demonstrated user-visible bug. Deferred fix: guard localOffset===0, tests for both degenerate offsets + locatorBetween(L,L), or delete dead fallback.

**E. 18 PRs NEVER CI-verified.** check-runs total_count:0 (#320,#315); ZERO pull_request-event runs. mergeable_state:clean = NO REQUIRED CHECKS, not passing (Actions PRs via GITHUB_TOKEN don't trigger pull_request wf). NEVER say "no failing checks".

**F. perf.test.ts:14 BORDERLINE-FLAKY (2x confirmed).** r85 10K inserts=**73ms**, r84=96ms, earlier 106-130ms FAILED. Tracks runner speed. Always re-measure.

**G. operation-queue.ts DEFECT (verified, fix verified, reverted).** enqueue() idempotency checks appliedOps ONLY; deferred ops undeduped => 5x same op => pendingCount=5; maxSize=3 +4 resends => overflowed => spurious FULL RESYNC. NOT corruption (flush re-checks hasApplied). Untested: overflow test protocol.test.ts:470 uses 5 DISTINCT ops; idempotency test only re-enqueues APPLIED op. FIX(+11L): pendingKeys:Set<string> mirroring appliedOps - check in enqueue before overflow branch, add on defer, rebuild in updateDeferredReplicas(), clear in clear().
Minor: deferredReplicas getter ALIASES internal Set; getPending() live array, stale after flush.

**H. replica-id.ts CLEAN-DON'T RE-PROBE.** Wart: SequentialReplicaIdAssigner ctor/fromState take unvalidated startId. Low pri.
**C. awareness.ts CLEAN-DON'T RE-PROBE.** 24-case probe => 0 defects.

COVERAGE `bun test --coverage` no setup: 88.40% funcs/90.05% lines. #214 SUPERSEDED-never say "blocked on #214".
LOW-COV: awareness 36(CLEAN); replica-id 57(CLEAN); state-sync 60(#345); op-queue 63(G); fragment 68(DONE-I); snapshot 85; undo-map 90. rope/clock/locator/anchor=100.
**NEXT PROBE: snapshot.ts or undo-map.ts FOR DEFECTS (not volume).** validation.ts dead code=#265.
DISMISSED-don't reopen: perf.test.ts:34; cursor-itemindex.test.ts:241(loose BY DESIGN); snapshot.test.ts:326.

ENV: curl -fsSL https://bun.sh/install|bash; PATH=$HOME/.bun/bin:$PATH; bun install (1.3.14). Suite ~2.1s, 3966 pass/0 fail.
PROBE TRICK: temp src/<mod>/__tmp_probe.ts -> `bun run` -> rm -> git status clean. Probe file BREAKS typecheck - delete BEFORE typechecking.
INSTRUMENT TRICK (r85,works): cp file /tmp/gh-aw/agent/x.bak; add console.error markers; `bun test|grep -c MARKER`; cp back; verify clean. Best branch-reachability test.
SHALLOW CLONE: git log/-S cannot date or attribute changes.

PRs: 18 TI PRs [162,194,218,221,225,231,234,237,243,251,254,264,268,302,308,312,315,320] re-confirmed r85 (70 open total). Never CI-checked (E).

ROTATION (update_issue MAX1/run => close XOR refresh): r85=DID refresh#347. r86=CLOSE#280. r87=REFRESH#347+PR health. r88=CLOSE#283. r89=REFRESH.
DUPS-OPEN(7): 280,283,285,288,290,293,296 - all still open r85.

HOLD: NO new PRs (18 stale, none merged, maint gone ~126d; 19th=spam). EXCEPTION: ISSUE for VERIFIED defect ok - put fix+regression test in body. RARE, high-bar. r82,r83,r84 filed 1 each; **r85 filed 0 on purpose** (I is latent/unproven-reachable => backlog, not issue). Don't file 4 runs straight. If maint asks for a PR, lint fix (#346) is easiest win.

ENGAGEMENT (every run): curl issues/comments?sort=created&direction=desc&per_page=25|grep login. r85: 25/25 bot; #347 0 comments/0 ticked => HOLD stands.
MCP list/search/issue_read return [] EVERY run (r85=14th). Use curl (60/hr): /issues/<n>, /pulls?state=open&per_page=100, /commits/<sha>/check-runs, /actions/workflows/ci.yml/runs?branch=main, search/issues?q=repo:iamnbutler/crdt+is:issue+is:open+in:title+%22Test+Improver%22. Pipe to python3 -c json. Perf-Improver interleaves-filter to MY list. Never read GITHUB_TOKEN.
FORMAT: no "Generated by" footer (auto). Suggested Actions right after month heading; notes after checklist; Run History ~8, newest first.
LEAVE: Perf-Improver items, aw/CI-Doctor/Code-Simplifier(#164), #139.
TI issues open: #344,#345,#346,#265,#214(suggest close),#347. All verified open r85.
TOOLS: update_issue needs "[Test Improver] " title, MAX1/run. create_issue auto-prefixes+labels, returns NO number (discover next run). add_comment cap 10. push_repo_memory errors ~39KB but that measures .git; state.md alone is what counts - keep <7KB and proceed.
