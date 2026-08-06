u:26-08-06|run:87|rid:31078109043|HEAD 9ffb0f3

**!! PATCH-SIZE RULE — READ FIRST !!**
Real gate = **patch** <=10240 B, and a full rewrite costs ~(old+new) — so ~7KB is spent just deleting old text. r86's 6.9KB file => ~14KB patch => **PUSH FAILED (#356)**, state lost => r87 read 08-04 memory and **shipped a duplicate** (2nd identical lint PR + repeat comment). KEEP FILE <2.5KB; prefer small edits to rewrites; verify with `cd memdir && git add -A && git diff --cached|wc -c`.
`push_repo_memory` ALWAYS errors "~40 KB" — it sums the dir incl. .git (pack=37KB, payload only 2.7KB). It can never pass; it is NOT the signal. Check the patch bytes and proceed.

**DURABLE STORE = issue #347 body** (backlog, priorities, commands, matrices). Keep detail THERE, pointers here.

**RULE: before building ANYTHING, curl open PRs + recent comments.** Runs are ~2/day; memory can lag a full run. r87 skipped this and shipped a duplicate.

**MAINTAINER ACTIVE since 2026-08-04** (was silent ~128d). Reviews #351/#352, opened #351/#352/#353. HOLD on new PRs is OVER, but *volume still unwelcome* (closed 18 TI PRs unmerged). Small//verified/asked-for only.

STATE (verified r87): open issues 24 — TI-owned: #347 (monthly), #349 (guard bug, reopened). #354 no-op tracker, #356 wf-failure. Rest are maint's own perf/moonshot (#31,32,39,112-122,139,158,187-189,209-212) — LEAVE.
Open PRs 4: #351+#353 (guard fix, identical snapshot.ts blob 751467e), #352 (bench), #355 (**lint fix — mine, r?**). r87 opened a DUP of #355 (=#357) and asked maint to close it.

**#346 lint red on main** (gates Test => 0 tests in CI since 9ffb0f3). Fix = `lint:fix` **PLUS 1 manual edit**: :333 noUnusedTemplateLiteral is an *unsafe* fix so lint:fix exits 1. Both in #355.

FINDINGS (detail in #347 backlog):
- **J snapshot guard**: full 4-variant x 3-pattern matrix verified r87. in-generator catches captured-iterator; call-time-only (what maint asked) REGRESSES it; need **both**. Posted #353 + #349.
- **F perf.test.ts:14**: NEW — passes in isolation (2/2 x3), fails only in FULL suite (106-119ms vs <100ms) incl. pristine main. Not PR-induced. Will go red once #355 lands.
- **I fragment.ts splitFragment(f,0)** dup locators, 0/3966 call-site hits (latent). **G operation-queue.ts** deferred ops undeduped.
- CLEAN, don't re-probe: awareness, replica-id, undo-map. NEXT PROBE: state-sync.ts / serialization.ts.

ENV: install bun via bun.sh; PATH=$HOME/.bun/bin:$PATH; bun install (1.3.14). Coverage no setup: 88.40%f/90.05%L.
TRICKS: probe = temp src/<m>/__tmp_probe.ts -> `bun run` -> rm (breaks typecheck, del first). Instrument = cp bak, console.error, `bun test|grep -c`, restore.
MCP list/search/issue_read return [] EVERY run — use curl (60/hr)+python3 json. Shallow clone: git log can't date/attribute.
TOOLS: update_issue MAX1/run, needs "[Test Improver] " title. create_issue returns no number. add_comment cap 10.
