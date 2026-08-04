u:26-08-04|run:86|rid:30880129198|maint silent ~128d|HEAD 9ffb0f3 (unchanged since r85)

**NUMBERS RESOLVED:** #346=CI-red(r84). #347=Aug monthly. #345=snapshotsEqual. #344=CI test-exclusion. #280=Apr monthly (CLOSED r86).
R86 DID: probed snapshot.ts => finding J. Closed #280 (update_issue budget spent). Commented run summary + J on #347. No new issue/PR (HOLD).

**D. CI MAIN RED since 2026-03-27(~129d)=#346. RE-VERIFIED r86 pristine HEAD.** `bun run lint` fails: noUnusedTemplateLiteral scripts/record-benchmarks.ts:333 + 1 formatter err. Fix=`bun run lint:fix`. CI run 23666019419: Lint FAIL => Test SKIPPED => **0 tests in CI**. Compounds #344. typecheck exit=0 (clean).

**J. snapshot.ts RELEASED-GUARD GAP (VERIFIED r86 => #347 backlog item 3, deliberately NOT an issue).**
11 public reads call checkReleased(); `*lines()`(:408) + `*chunks()`(:428) DO NOT. Contract is deliberate: snapshot.test.ts:113-115 asserts throw for getText/length/lineCount. PROBED: after release() lines()=>["hello","world","foo"], chunks() likewise, no throw.
SEVERITY LOW today: arena.releaseEpoch(index.ts:116) only refcounts+updateMinLiveEpoch, frees NOTHING; SumTree persistent => released reads are STALE-BUT-CONSISTENT (probed: 200 inserts+50 deletes post-release, snapshot still exact orig 3 lines). Becomes use-after-free IF real reclamation lands.
FIX SUBTLETY (probed, matters): generator body doesn't run till first next() => `checkReleased()` at top of `*lines()` does NOT throw eagerly. Correct fix = non-generator wrapper checks then delegates to private generator. Also `const it=snap.lines(); snap.release(); [...it]` succeeds today.

**I. fragment.ts LATENT DEFECT (r85, => #347 backlog item 2, NOT an issue).**
`splitFragment(f,0)`(:215): left=[...base,2*io], right=[...base,2*(io+0)] => **IDENTICAL** (both [32768,0], cmp=0, left text="" right="hello"). Split at f.length FINE. Dup locators break SumTree ordering; parts also tie in sortFragments - order survives ONLY via stable Array.sort.
`locatorBetween(L,L)` violates left<M<right: returns [...L,4503599627370495] > right. NOT reachable from remote path (DISCARDS findRefIndex return, uses sender locator). Both fns exported from pkg root.
REACH: 0-callers = text-buffer.ts:1651(findRefIndex,LIVE) + :1769(splitRefInTree,"EXPERIMENTAL-NOT USED"). Instrumented :1651+:1667 => 0 HITS/3966. **NOT PROVEN-never claim unreachable.** Fix: guard localOffset===0 + tests, or delete dead fallback.

**E. 18 PRs NEVER CI-verified.** check-runs total_count:0 (#320,#315); ZERO pull_request-event runs. mergeable_state:clean = NO REQUIRED CHECKS, not passing (Actions PRs via GITHUB_TOKEN don't trigger pull_request wf). NEVER say "no failing checks".

**F. perf.test.ts:14 BORDERLINE-FLAKY (2x confirmed).** r86 10K inserts=**77ms**, r85=73, r84=96, earlier 106-130 FAILED. Tracks runner speed. Always re-measure.

**G. operation-queue.ts DEFECT (verified, fix verified, reverted).** enqueue() idempotency checks appliedOps ONLY; deferred ops undeduped => 5x same op => pendingCount=5; maxSize=3 +4 resends => spurious FULL RESYNC. NOT corruption (flush re-checks hasApplied). Untested: overflow test protocol.test.ts:470 uses 5 DISTINCT ops; idempotency test only re-enqueues APPLIED op. FIX(+11L): pendingKeys:Set<string> mirroring appliedOps - check in enqueue before overflow branch, add on defer, rebuild in updateDeferredReplicas(), clear in clear(). Minor: deferredReplicas getter ALIASES internal Set; getPending() stale after flush.

**H. replica-id.ts CLEAN-DON'T RE-PROBE.** Wart: SequentialReplicaIdAssigner ctor/fromState take unvalidated startId. Low pri.
**C. awareness.ts CLEAN-DON'T RE-PROBE.** 24-case probe => 0 defects.
**undo-map.ts REVIEWED r86, NO DEFECT - DON'T RE-PROBE.** 131L, max-wins sound; increment() bypasses max-wins but is monotonic (current+1) so safe. Uncovered 119-128=getCountsFor (trivial filter count>0; 0 is the default => skipping correct).

COVERAGE `bun test --coverage` no setup: 88.40% funcs/90.05% lines. #214 SUPERSEDED-never say "blocked on #214".
LOW-COV: awareness 36(CLEAN); replica-id 57(CLEAN); state-sync 60(#345); op-queue 63(G); fragment 68(I); snapshot.ts 85f/78L uncov 50-58,113-119,383-428(J); undo-map 90(CLEAN). rope/clock/locator/anchor/anchor-snapshot=100.
**NEXT PROBE: state-sync.ts or serialization.ts FOR DEFECTS (not volume).** validation.ts dead code=#265.
DISMISSED-don't reopen: perf.test.ts:34; cursor-itemindex.test.ts:241(loose BY DESIGN); snapshot.test.ts:326.

ENV: curl -fsSL https://bun.sh/install|bash; PATH=$HOME/.bun/bin:$PATH; bun install (1.3.14). Suite ~2.2s, 3966 pass/0 fail.
PROBE TRICK: temp src/<mod>/__tmp_probe.ts -> `bun run` -> rm -> git status clean. Probe file BREAKS typecheck - delete BEFORE typechecking.
INSTRUMENT TRICK (works): cp file /tmp/gh-aw/agent/x.bak; add console.error markers; `bun test|grep -c MARKER`; cp back; verify clean. Best branch-reachability test.
SHALLOW CLONE: git log/-S cannot date or attribute changes.

PRs: 18 TI PRs [162,194,218,221,225,231,234,237,243,251,254,264,268,302,308,312,315,320] re-confirmed r86 (70 open total). Never CI-checked (E).

ROTATION (update_issue MAX1/run => close XOR refresh): r85=refresh#347. r86=DID close#280. **r87=REFRESH#347 body (FOLD IN backlog item 3=J; r86 only commented it)+PR health.** r88=CLOSE#283. r89=REFRESH.
DUPS-OPEN(6 after r86): 283,285,288,290,293,296.

HOLD: NO new PRs (18 stale, none merged, maint gone ~128d; 19th=spam). EXCEPTION: ISSUE for VERIFIED defect ok - put fix+regression test in body. RARE, high-bar. r82,r83,r84 filed 1 each; r85+r86 filed 0 on purpose (I and J are latent/low-sev => backlog, not issue). Don't file 4 runs straight. If maint asks for a PR, lint fix (#346) is easiest win.

ENGAGEMENT (every run): curl issues/comments?sort=created&direction=desc&per_page=25|grep login. r86: 25/25 bot; #347 0 comments/0 ticked => HOLD stands.
MCP list/search/issue_read return [] EVERY run (r86=15th). Use curl (60/hr): /issues/<n>, /pulls?state=open&per_page=100, /commits/<sha>/check-runs, /actions/workflows/ci.yml/runs?branch=main, search/issues?q=repo:iamnbutler/crdt+is:issue+is:open+in:title+%22Test+Improver%22. Pipe to python3 -c json. Perf-Improver interleaves-filter to MY list. Never read GITHUB_TOKEN.
FORMAT: no "Generated by" footer (auto). Suggested Actions right after month heading; notes after checklist; Run History ~8, newest first.
LEAVE: Perf-Improver items, aw/CI-Doctor/Code-Simplifier(#164), #139.
TI issues open: #344,#345,#346,#265,#214(suggest close),#347. All verified open r86.
TOOLS: update_issue needs "[Test Improver] " title, MAX1/run. create_issue auto-prefixes+labels, returns NO number (discover next run). add_comment cap 10 (use it to log a run when update_issue budget goes to closing a dup). push_repo_memory errors ~39KB but that measures .git; state.md alone is what counts - keep <7KB and proceed.
