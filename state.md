u:26-08-08|run:89|rid:31240958845|HEAD 9ffb0f3

**!! PATCH-SIZE RULE — READ FIRST !!**
Real gate = **patch** <=10240 B; a full rewrite costs ~(old+new). r86: 6.9KB file => ~14KB patch => **PUSH FAILED (#356)**, state lost => r87 shipped a duplicate PR. KEEP FILE <4KB and **edit surgically, never rewrite**; verify `cd memdir && git add -A && git diff --cached|wc -c` (r88 edits = 3.9KB, ok).
`push_repo_memory` ALWAYS errors "~40 KB" — it sums the dir incl. .git (pack=37KB, payload only 2.7KB). It can never pass; it is NOT the signal. Check the patch bytes and proceed.

**DURABLE STORE = issue #347 body** (backlog, priorities, commands, matrices). Keep detail THERE, pointers here.

**RULE: before building ANYTHING, curl open PRs + recent comments.** Runs are ~2/day; memory can lag a full run. r87 skipped this and shipped a duplicate.

**MAINTAINER ACTIVE since 2026-08-04** (was silent ~128d). Reviews #351/#352, opened #351/#352/#353. HOLD on new PRs is OVER, but *volume still unwelcome* (closed 18 TI PRs unmerged). Small//verified/asked-for only.

STATE (verified r88): TI-owned issues: #347 (monthly), #349 (guard, reopened). #354 no-op tracker, #356 wf-fail. Rest maint's own perf/moonshot — LEAVE.
Open PRs **5**: #351+#353 (guard, identical snapshot.ts blob 751467e), #352 (bench), #355 + #357 (**dup lint pair, both still open**). All mergeable=true, state=unstable (the #346 lint gate).
**MAINT SILENT since 08-04 17:31** — zero new human comments thru 08-08, zero checkboxes ticked. r88 opened NOTHING; r89 filed 1 ISSUE only (validation bug, below) + updated #347. Still NO PRs: 2 dups + red main = a 6th PR is noise. Issues≠PR-volume, ok to file when VERIFIED.

**#346 lint red on main** (gates Test => 0 tests in CI since 9ffb0f3). Fix = `lint:fix` **PLUS 1 manual edit**: :333 noUnusedTemplateLiteral is an *unsafe* fix so lint:fix exits 1. Both in #355.

FINDINGS (detail in #347 backlog):
- **J snapshot guard**: full 4-variant x 3-pattern matrix verified r87. in-generator catches captured-iterator; call-time-only (what maint asked) REGRESSES it; need **both**. Posted #353 + #349.
- perf.test.ts:14 load-sensitive (isolation ok, full-suite 106-119ms vs <100ms budget, incl. pristine main) — goes red once #355 lands. fragment.ts splitFragment(f,0) dup locators (0/3966 hits, latent). operation-queue.ts deferred ops undeduped. [detail: #347 backlog 5-7]
- **state-sync.ts (r88, probed)**: (a) `snapshotsEqual` skips `baseLocatorLevels` (only 1 of 8 fields uncompared; ~6-line fix) (b) createSnapshot/applySnapshot 0% cov, root exports (c) applySnapshot discards wire `length`, latent. Round-trip itself VERIFIED CORRECT. (a)+(b)=one small PR when queue clears. [full detail: #347 backlog 3-5]
- **validation.ts (r89, VERIFIED BUG, filed as issue)**: `NonSequentialCounter` is UNREACHABLE. :70 needs `c<=last` before :73 tests `c>last+1` — mutually exclusive => dead `return invalid`; gap of 1e6 => valid=true. Strict misses too (isCausallyReady `continue`s past own replica = the gapped one). Missed because all 12 test ctxs pass `replicaCounters: new Map()` => block never runs, yet 100% FUNC cov (**func-cov trap; trust line cov: 88.6%, uncov 70,73-79 = the dead branch**). Fix=collapse to `last!==undefined && c>last+1`: typecheck clean, 3965p/1f (=pre-existing perf.test:14, same on unpatched main). NOT a PR: public-API semantic change, 2 readings (activate vs delete branch+enum member) — **need maint intent**. NOTE: OperationQueue never calls validateOperation (own isReady); these are root-export-only => no internal corruption.
- CLEAN, don't re-probe: awareness, replica-id, undo-map (entries() allocs fresh), state-sync round-trip. **ALL of src/protocol/ now probed.** NEXT PROBE: none queued — consider src/text/ (locator.ts, clock.ts, undo-map) or sum-tree.

ENV: install bun via bun.sh; PATH=$HOME/.bun/bin:$PATH; bun install (1.3.14). Coverage no setup: 88.40%f/90.05%L.
TRICKS: probe = temp src/<m>/__tmp_probe.ts -> `bun run` -> rm (breaks typecheck, del first). Instrument = cp bak, console.error, `bun test|grep -c`, restore.
MCP list/search/issue_read return [] EVERY run — use curl (60/hr)+python3 json. Shallow clone: git log can't date/attribute.
TOOLS: update_issue MAX1/run, needs "[Test Improver] " title. create_issue returns no number. add_comment cap 10.
