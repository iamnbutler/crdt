u:26-08-13|run:94|rid:31671412930|HEAD 9ffb0f3

**!! PATCH-SIZE RULE — READ FIRST !!**
Real gate = **patch** <=10240 B; patch = old + new bytes, so touching a long line is costly and a rewrite is fatal (r86: **PUSH FAILED #356**, state lost, r87 then shipped a dup PR). **Edit surgically; touch as FEW lines as possible.** Verify: `cd memdir && git add -A && git diff --cached|wc -c`. r94 trimmed the fat bullets (7.8KB->6.6KB) yet STILL hit 10166/10240 — 6 edited lines is the max per run.
`push_repo_memory` ALWAYS errors "~40 KB" — it sums the dir incl. .git (pack=37KB, payload only 2.7KB). It can never pass; it is NOT the signal. Check the patch bytes and proceed.

**DURABLE STORE = issue #347 body** (backlog, priorities, commands, matrices). Keep detail THERE, pointers here.

**RULE: before building ANYTHING, curl open PRs + recent comments.** Runs are ~2/day; memory can lag a full run. r87 skipped this and shipped a duplicate.

**MAINTAINER ACTIVE since 2026-08-04** (was silent ~128d). Reviews #351/#352, opened #351/#352/#353. HOLD on new PRs is OVER, but *volume still unwelcome* (closed 18 TI PRs unmerged). Small//verified/asked-for only.

STATE (verified r94 via curl): TI issues: #347 monthly, #349 guard (reopened), #358 validation, #359 insert-placement (tracking), #360 cursor.prev, #361 cursor.next, **#362 locator slots (CONFIRMED r94)**. #354 no-op tracker, #356 wf-fail. Rest maint's own perf/moonshot — LEAVE.
Open PRs **5**: #351+#353 (guard, identical snapshot.ts blob 751467e), #352 (bench), #355 + #357 (**dup lint pair, both still open**). All mergeable=true, state=unstable (the #346 lint gate).
**MAINT SILENT since 08-04 17:31** — re-verified r94: zero human comments thru **08-13**, zero commits since 08-05, zero checkboxes ticked. Filed: r89 #358, r90 #359, r91 #360, r92 #361, r93 #362. **r94 = first deliberate QUIET run: probed (clean), no issue/comment/PR, Task 7 only — the 3-issues-in-3-runs cap held.** Keep it that way while silence lasts. Still NO PRs: 2 dups + red main = a 6th PR is noise.

**#346 lint red on main** (gates Test => 0 tests in CI since 9ffb0f3). Fix = `lint:fix` **PLUS 1 manual edit**: :333 noUnusedTemplateLiteral is an *unsafe* fix so lint:fix exits 1. Both in #355.

FINDINGS (detail in #347 backlog):
- **J snapshot guard**: 4-variant x 3-pattern matrix verified r87 — need guard in BOTH method+generator; call-time-only (what maint asked) REGRESSES captured-iterator. [#347 backlog 1]
- perf.test.ts:14 load-sensitive (r90: 99ms PASS then 105.6ms FAIL, same commit b2b) — goes red once #355 lands. Also: splitFragment(f,0) dup locators (latent); op-queue deferred undeduped. [#347 backlog 6-8]
- state-sync.ts (r88): snapshotsEqual skips baseLocatorLevels; createSnapshot/applySnapshot 0% cov (root exports); discards wire `length`. Round-trip CORRECT. =1 small PR when queue clears. [#347 bk 3-5]
- validation.ts (r89): NonSequentialCounter unreachable [#358, #347 bk 2]. Lesson: **func-cov trap** — 100% FUNC cov w/ dead branch; trust LINE cov.
- **CURSOR CONVENTION SPLIT (#360 prev, #361 next, peekPrev same) — 1 root cause, FULL detail + verified patches live in those issues. Do NOT re-derive.** 1-line mech: findChildForTarget sets parent.childIndex=i+1 ("next to scan"), the walkers read it as "child we're in"; fix = on ascend `parent.childIndex = popped.indexInParent`. Impact: tryDeleteFast walks w/ next() => delete() silently UNDER-deletes, replicas converge on wrong doc. Ladder 500 seeds: pristine 275 bad -> +prev 46 -> +next 14. NO PR: core nav, 2 valid fixes = maintainer's design call.
- **LOCATOR SLOT EXHAUSTION = #362 (filed r93, number CONFIRMED r94). Full detail + law + failed fix are IN THE ISSUE — do NOT re-derive.** 1-line mech: under prefix [X] each offset k owns only slots 2k/2k-1 => room for ONE insert; the Nth insert at a frag END boundary makes locatorBetween walk down into lower offsets' slots, and a later split@j swaps 2 chars. Misordered iff N > 2(k-j). Single-leaf 6-op repro, independent of #360/#361. No fix recommended (tried nesting: worse + changes wire encoding).
- CLEAN, don't re-probe: awareness, replica-id, undo-map, state-sync round-trip, clock.ts, ALL of src/protocol/, **and (r94) seekForward bias="left" + suffix()** — 6 bf x 16 sizes x 2 bias x 4 walk depths, 0 mismatches vs oracle; the childIndex split does NOT reach them. **#359 HUNT IS DONE (3/3 filed: #360/#361/#362). The probing phase is OVER — stop looking for bug #4.** NEXT r95 options: (a) if maint replies on #359-#362 => act on it; (b) if the PR queue clears (5 open, main red), send the **model-oracle harness as a tests-only PR** = the asked-for deliverable, found all 3 bugs; (c) else stay QUIET (noop + Task 7 only). Filing more issues into silence is noise.
- **r94 LESSON: a clean property-test result is worthless until you prove the harness is live** — plant a 2nd oracle encoding a KNOWN bug beside the new one (r94: it fired 9936x while the real oracle sat at 0 => the 0 is trustworthy).
- **TRICK (r90/r91, PAYS OFF TWICE): model-based oracle + greedy shrinker.** Property-test generator on 1 buffer + plain-string model, diff after EACH op; then delta-debug (drop steps / cut texts / pos->0 / delete ranges->1) with CLAMPING in replay so any subsequence stays valid. 45 ops -> 12 in ~2min. Needs 20-50 ops & interior edits. **buf.getText() NOT toString()** (no override => "[object Object]" => bogus 500/500).
- **r91 GENERAL LESSON: when a symptom is in module A, check A's *dependencies* before deep-diving A.** 2 runs were spent inside text/ (locator, findInsertPosition) for a bug that was 3 lines in sum-tree. Cheap test: does a pure repro exist one layer down?

ENV: install bun via bun.sh; PATH=$HOME/.bun/bin:$PATH; bun install (1.3.14). Coverage no setup: 88.40%f/90.05%L.
TRICKS: probe = temp src/<m>/__tmp_probe.ts -> `bun run` -> rm (breaks typecheck, del first). **SWEEP (r92, beat the shrinker): N interior 1-char inserts then EVERY delete range vs model. Shrinker stalled at 23 ops; sweep gave a 1-op repro + the tree size where it starts (29 frags). Bisect N for the shape threshold, THEN drop to a pure sum-tree probe.** Instrument = cp bak, console.error, `bun test|grep -c`, restore.
MCP list/search/issue_read return [] EVERY run — use curl (60/hr)+python3 json. Shallow clone: git log can't date/attribute.
TOOLS: update_issue MAX1/run, needs "[Test Improver] " title. create_issue returns no number. add_comment cap 10.
