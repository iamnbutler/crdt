u:26-08-09|run:90|rid:31296270701|HEAD 9ffb0f3

**!! PATCH-SIZE RULE — READ FIRST !!**
Real gate = **patch** <=10240 B; a full rewrite costs ~(old+new). r86: 6.9KB file => ~14KB patch => **PUSH FAILED (#356)**, state lost => r87 shipped a duplicate PR. **edit surgically, NEVER rewrite**; verify `cd memdir && git add -A && git diff--cached|wc -c` (r90 = 7.1KB patch, ok). ⚠️ file is now 5.1KB => a REWRITE would be ~10.3KB = OVER. Trim before adding big entries.
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
- **state-sync.ts (r88)**: (a) snapshotsEqual skips baseLocatorLevels (b) createSnapshot/applySnapshot 0% cov, root exports (c) discards wire `length`. Round-trip VERIFIED CORRECT. (a)+(b)=one small PR when queue clears. [#347 backlog 3-5]
- **validation.ts (r89)**: NonSequentialCounter unreachable. Full detail in #358 + #347 backlog 2. Lesson kept: **func-cov trap** — 100% FUNC cov w/ dead branch; trust LINE cov.
- **!! r90 BIGGEST FIND — TextBuffer.insert() PLACES TEXT AT WRONG OFFSET !!** 1 replica, no concurrency/txn/newline needed. **163/500** seeds diverge from plain-string model (property-test generator). Det. 20-op repro: after 19 matching ops, `insert(24,"f")` APPENDS at end. len stays right => misorder not loss. Mechanism partial: locatorBetween gets **INVERTED pairs (left>right), 134x, all text-buffer.ts:755**, no precondition guard => returns locator outside range. Disabling fast path = **WORSE (244/500)** => NOT fast-path-only, root cause NOT isolated (134 viol < 163 seeds). Also pure-fn postcond gap: `locatorBetween([0],[0,0,0])`=>[0,0,0,4.5e15] > right (only failing class in 115394 valid pairs; :90 only descends if right[i+1]>0 => falls to fallback :180); MAX_DEPTH=16 exhausts after 82 subdivisions, silent. **Why suite blind: property tests compare replica-vs-replica; locatorBetween deterministic => all replicas same WRONG locator => converge & pass. NO model-based oracle for local edits.** Convergence itself looks intact. Filed as issue r90. NO PR (don't encode expectations pre-maint-intent).
- CLEAN, don't re-probe: awareness, replica-id, undo-map (entries() allocs fresh), state-sync round-trip, **clock.ts (r90: happenedBefore/versionIncludes/observe all correct)**. ALL of src/protocol/ probed. **NEXT: finish isolating the r90 insert bug (the 29 seeds w/o locator viol) — instrument findInsertPosition/findTreeInsertIndex, NOT locator.ts (already characterized).** Then sum-tree.
- **r90 TRICK: model-based oracle finds what property tests can't.** Run the property-test generator on 1 buffer + plain-string model, diff after each op; shrink greedily. Needs 20-50 ops & interior edits — 12-op/short-text searches find NOTHING (20k attempts, 0 hits).

ENV: install bun via bun.sh; PATH=$HOME/.bun/bin:$PATH; bun install (1.3.14). Coverage no setup: 88.40%f/90.05%L.
TRICKS: probe = temp src/<m>/__tmp_probe.ts -> `bun run` -> rm (breaks typecheck, del first). Instrument = cp bak, console.error, `bun test|grep -c`, restore.
MCP list/search/issue_read return [] EVERY run — use curl (60/hr)+python3 json. Shallow clone: git log can't date/attribute.
TOOLS: update_issue MAX1/run, needs "[Test Improver] " title. create_issue returns no number. add_comment cap 10.
