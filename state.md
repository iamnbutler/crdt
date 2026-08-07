u:26-08-07|run:88|rid:31151745463|HEAD 9ffb0f3

**!! PATCH-SIZE RULE — READ FIRST !!**
Real gate = **patch** <=10240 B; a full rewrite costs ~(old+new). r86: 6.9KB file => ~14KB patch => **PUSH FAILED (#356)**, state lost => r87 shipped a duplicate PR. KEEP FILE <4KB and **edit surgically, never rewrite**; verify `cd memdir && git add -A && git diff --cached|wc -c` (r88 edits = 3.9KB, ok).
`push_repo_memory` ALWAYS errors "~40 KB" — it sums the dir incl. .git (pack=37KB, payload only 2.7KB). It can never pass; it is NOT the signal. Check the patch bytes and proceed.

**DURABLE STORE = issue #347 body** (backlog, priorities, commands, matrices). Keep detail THERE, pointers here.

**RULE: before building ANYTHING, curl open PRs + recent comments.** Runs are ~2/day; memory can lag a full run. r87 skipped this and shipped a duplicate.

**MAINTAINER ACTIVE since 2026-08-04** (was silent ~128d). Reviews #351/#352, opened #351/#352/#353. HOLD on new PRs is OVER, but *volume still unwelcome* (closed 18 TI PRs unmerged). Small//verified/asked-for only.

STATE (verified r88): TI-owned issues: #347 (monthly), #349 (guard, reopened). #354 no-op tracker, #356 wf-fail. Rest maint's own perf/moonshot — LEAVE.
Open PRs **5**: #351+#353 (guard, identical snapshot.ts blob 751467e), #352 (bench), #355 + #357 (**dup lint pair, both still open**). All mergeable=true, state=unstable (the #346 lint gate).
**MAINT SILENT since 08-04 17:31** — zero new human comments thru 08-07. r88 verified & opened NOTHING (2 dup PRs + red main = a 6th PR is noise). Keep holding until maint acts.

**#346 lint red on main** (gates Test => 0 tests in CI since 9ffb0f3). Fix = `lint:fix` **PLUS 1 manual edit**: :333 noUnusedTemplateLiteral is an *unsafe* fix so lint:fix exits 1. Both in #355.

FINDINGS (detail in #347 backlog):
- **J snapshot guard**: full 4-variant x 3-pattern matrix verified r87. in-generator catches captured-iterator; call-time-only (what maint asked) REGRESSES it; need **both**. Posted #353 + #349.
- perf.test.ts:14 load-sensitive (isolation ok, full-suite 106-119ms vs <100ms budget, incl. pristine main) — goes red once #355 lands. fragment.ts splitFragment(f,0) dup locators (0/3966 hits, latent). operation-queue.ts deferred ops undeduped. [detail: #347 backlog 5-7]
- **state-sync.ts (r88, probed)**: (a) `snapshotsEqual` skips `baseLocatorLevels` — only field of 8 not compared; base=[0.25]vs[999] still true. Matters: fragment.ts:211 "critical for order independence", parent of every split/inside-insert; NOT derivable from locator. ~6-line fix. (b) createSnapshot/applySnapshot **0% cov** (60%f/53%L file) yet root exports for initial-sync; existing tests hand-build literals. (c) applySnapshot parses wire `length` then discards it (createFragment recomputes text.length) — latent. **Round-trip itself VERIFIED CORRECT** (wire, idempotent, defensive-copy, empty, astral UTF-8). => (a)+(b) = one small PR when queue clears.
- CLEAN, don't re-probe: awareness, replica-id, undo-map (entries() allocs fresh), state-sync round-trip. NEXT PROBE: validation.ts (100%f/88.6%L).

ENV: install bun via bun.sh; PATH=$HOME/.bun/bin:$PATH; bun install (1.3.14). Coverage no setup: 88.40%f/90.05%L.
TRICKS: probe = temp src/<m>/__tmp_probe.ts -> `bun run` -> rm (breaks typecheck, del first). Instrument = cp bak, console.error, `bun test|grep -c`, restore.
MCP list/search/issue_read return [] EVERY run — use curl (60/hr)+python3 json. Shallow clone: git log can't date/attribute.
TOOLS: update_issue MAX1/run, needs "[Test Improver] " title. create_issue returns no number. add_comment cap 10.
