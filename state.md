u:26-08-10|run:91|rid:31359347688|HEAD 9ffb0f3

**!! PATCH-SIZE RULE — READ FIRST !!**
Real gate = **patch** <=10240 B; a full rewrite costs ~(old+new). r86: 6.9KB file => ~14KB patch => **PUSH FAILED (#356)**, state lost => r87 shipped a duplicate PR. **edit surgically, NEVER rewrite**; verify `cd memdir && git add -A && git diff--cached|wc -c` (r90 = 7.1KB patch, ok). ⚠️ file is now **6.5KB** => a REWRITE would be ~13KB = WAY OVER. r91 patch = 6.5KB (ok). Trim as you add.
`push_repo_memory` ALWAYS errors "~40 KB" — it sums the dir incl. .git (pack=37KB, payload only 2.7KB). It can never pass; it is NOT the signal. Check the patch bytes and proceed.

**DURABLE STORE = issue #347 body** (backlog, priorities, commands, matrices). Keep detail THERE, pointers here.

**RULE: before building ANYTHING, curl open PRs + recent comments.** Runs are ~2/day; memory can lag a full run. r87 skipped this and shipped a duplicate.

**MAINTAINER ACTIVE since 2026-08-04** (was silent ~128d). Reviews #351/#352, opened #351/#352/#353. HOLD on new PRs is OVER, but *volume still unwelcome* (closed 18 TI PRs unmerged). Small//verified/asked-for only.

STATE (verified r90): TI-owned issues: #347 (monthly), #349 (guard, reopened), #358 (validation, r89), +INSERT-PLACEMENT issue (r90, no number returned; ~#359). #354 no-op tracker, #356 wf-fail. Rest maint's own perf/moonshot — LEAVE.
Open PRs **5**: #351+#353 (guard, identical snapshot.ts blob 751467e), #352 (bench), #355 + #357 (**dup lint pair, both still open**). All mergeable=true, state=unstable (the #346 lint gate).
**MAINT SILENT since 08-04 17:31** — zero new human comments thru 08-09, zero checkboxes ticked. r88 opened NOTHING; r89 filed #358; r90 filed insert-placement issue + 1 comment on #357 (dup notice) + #347. Still NO PRs: 2 dups + red main = a 6th PR is noise. Issues≠PR-volume, ok to file when VERIFIED.

**#346 lint red on main** (gates Test => 0 tests in CI since 9ffb0f3). Fix = `lint:fix` **PLUS 1 manual edit**: :333 noUnusedTemplateLiteral is an *unsafe* fix so lint:fix exits 1. Both in #355.

FINDINGS (detail in #347 backlog):
- **J snapshot guard**: 4-variant x 3-pattern matrix verified r87 — need guard in BOTH method+generator; call-time-only (what maint asked) REGRESSES captured-iterator. [#347 backlog 1]
- perf.test.ts:14 load-sensitive (r90: 99ms PASS then 105.6ms FAIL, same commit b2b) — goes red once #355 lands. Also: splitFragment(f,0) dup locators (latent); op-queue deferred undeduped. [#347 backlog 6-8]
- state-sync.ts (r88): snapshotsEqual skips baseLocatorLevels; createSnapshot/applySnapshot 0% cov (root exports); discards wire `length`. Round-trip CORRECT. =1 small PR when queue clears. [#347 bk 3-5]
- validation.ts (r89): NonSequentialCounter unreachable [#358, #347 bk 2]. Lesson: **func-cov trap** — 100% FUNC cov w/ dead branch; trust LINE cov.
- **!! #359 TextBuffer.insert() WRONG OFFSET — ROOT CAUSE FOUND r91, in sum-tree NOT text !!** `Cursor.prev()` moves **FORWARD** after `seekForward()`; returns true + consistent position => silent. Pure repro no CRDT: 32-item tree, seek(9)=>item9 ok, prev()=>item **17**. Fires when seek lands on 1st item of a non-leading leaf (idx 9,18,27..; 21 bad across sizes 4-100). MECH: internal StackEntry.childIndex = "next child to scan" (findChildForTarget sets i+1) but prev() reads it as "child we're in" => childIndex-- returns to SAME child => descendToRightmost = that subtree's LAST item. `indexInParent` already unambiguous, unused. FIX (verified, reverted): on ascend `parent.childIndex = popped.indexInParent` (3 lines) => 21->0 bad, bun test unchanged, **divergence 182/500 -> 81/500**. Why suite blind: prev() only tested after reset+next walks (index.test.ts:478,550,587); advanceToNext leaves the OTHER convention so that path is correct. No seek-then-prev test. Impact: text-buffer.ts:1105 (tryFindInsertPositionFast localOffset===0) = only prod caller => gets LAST frag as left neighbor => inverted pair into locatorBetween. **peekPrev() broken same way; both public API on /sum-tree subpath.** Filed own issue r91 + comment on #359. NO PR (core nav, 5 PRs queued, main red).
- **#359 REMAINING ~45% = 2nd DISTINCT bug, NOT isolated.** After cursor fix 81/500 still diverge, diff signature: adjacent chars **TRANSPOSED** not relocated — insert(7,"j") into "yevpzlweoh\ng" => "yevpzlw**je**oh" want "yevpzlw**jo**eh". 12-step repro in #359 comment. Smells like locator collision/tie-break among inserts at neighbouring offsets. **r90 CORRECTION: "disabling fast path worse (244/500) => standard path shares cause" was WRONG** — disabling just routes through a different path w/ its own bugs; it does not isolate.
- CLEAN, don't re-probe: awareness, replica-id, undo-map (entries() allocs fresh), state-sync round-trip, **clock.ts (r90: happenedBefore/versionIncludes/observe all correct)**. ALL of src/protocol/ probed. **NEXT r92: isolate the 2nd #359 bug (transposition, 81/500). Apply the cursor fix locally FIRST, then shrink+instrument the tie-break/locator-collision path for adjacent-offset inserts. Do NOT re-probe cursor.prev (solved) or locator.ts (characterized).** Then rest of sum-tree cursor (seek+next, seekForward bias="left", suffix()) — same seek-vs-walk convention split likely lurks elsewhere.
- **TRICK (r90/r91, PAYS OFF TWICE): model-based oracle + greedy shrinker.** Property-test generator on 1 buffer + plain-string model, diff after EACH op; then delta-debug (drop steps / cut texts / pos->0 / delete ranges->1) with CLAMPING in replay so any subsequence stays valid. 45 ops -> 12 in ~2min. Needs 20-50 ops & interior edits. **buf.getText() NOT toString()** (no override => "[object Object]" => bogus 500/500).
- **r91 GENERAL LESSON: when a symptom is in module A, check A's *dependencies* before deep-diving A.** 2 runs were spent inside text/ (locator, findInsertPosition) for a bug that was 3 lines in sum-tree. Cheap test: does a pure repro exist one layer down?

ENV: install bun via bun.sh; PATH=$HOME/.bun/bin:$PATH; bun install (1.3.14). Coverage no setup: 88.40%f/90.05%L.
TRICKS: probe = temp src/<m>/__tmp_probe.ts -> `bun run` -> rm (breaks typecheck, del first). Instrument = cp bak, console.error, `bun test|grep -c`, restore.
MCP list/search/issue_read return [] EVERY run — use curl (60/hr)+python3 json. Shallow clone: git log can't date/attribute.
TOOLS: update_issue MAX1/run, needs "[Test Improver] " title. create_issue returns no number. add_comment cap 10.
