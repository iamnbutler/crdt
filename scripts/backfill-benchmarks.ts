#!/usr/bin/env bun
/**
 * Backfills benchmark history by triggering CI runs for historical commits.
 *
 * Usage:
 *   bun scripts/backfill-benchmarks.ts [options]
 *
 * Options:
 *   --count=N        Number of commits to backfill (default: 10)
 *   --sha=SHA        Specific commit SHA to benchmark
 *   --from=SHA       Start from this commit (oldest)
 *   --to=SHA         End at this commit (newest, default: HEAD)
 *   --dry-run        Show what would be triggered without running
 *
 * Examples:
 *   bun scripts/backfill-benchmarks.ts --count=20
 *   bun scripts/backfill-benchmarks.ts --sha=abc123
 *   bun scripts/backfill-benchmarks.ts --from=v1.0.0 --to=v2.0.0
 */

import { execSync } from "node:child_process";

interface Options {
  count: number;
  sha?: string;
  from?: string;
  to: string;
  dryRun: boolean;
}

function parseArgs(): Options {
  const args = process.argv.slice(2);
  const options: Options = {
    count: 10,
    to: "HEAD",
    dryRun: false,
  };

  for (const arg of args) {
    if (arg.startsWith("--count=")) {
      options.count = parseInt(arg.slice(8), 10);
    } else if (arg.startsWith("--sha=")) {
      options.sha = arg.slice(6);
    } else if (arg.startsWith("--from=")) {
      options.from = arg.slice(7);
    } else if (arg.startsWith("--to=")) {
      options.to = arg.slice(5);
    } else if (arg === "--dry-run") {
      options.dryRun = true;
    }
  }

  return options;
}

function exec(cmd: string): string {
  return execSync(cmd, { encoding: "utf-8" }).trim();
}

function getCommitsToBackfill(options: Options): string[] {
  if (options.sha) {
    // Single SHA mode
    return [exec(`git rev-parse ${options.sha}`)];
  }

  // Range mode
  let range: string;
  if (options.from) {
    range = `${options.from}..${options.to}`;
  } else {
    range = `-${options.count} ${options.to}`;
  }

  const commits = exec(`git rev-list --reverse ${range}`).split("\n").filter(Boolean);
  return commits;
}

function getRecordedShas(): Set<string> {
  try {
    exec("git fetch origin benchmark-data 2>/dev/null");
    const index = exec("git show origin/benchmark-data:index.json 2>/dev/null");
    const parsed = JSON.parse(index) as { runs: Array<{ sha: string }> };
    return new Set(parsed.runs.map((r) => r.sha));
  } catch {
    return new Set();
  }
}

function getCommitInfo(sha: string): { short: string; subject: string } {
  const short = exec(`git rev-parse --short ${sha}`);
  const subject = exec(`git log -1 --format=%s ${sha}`);
  return { short, subject };
}

function triggerWorkflow(sha: string): string {
  // Trigger and get the run ID
  exec(`gh workflow run benchmarks.yml -f sha=${sha}`);

  // Wait a moment for the run to be created
  execSync("sleep 2");

  // Get the most recent run ID
  const runId = exec(
    `gh run list --workflow=benchmarks.yml --limit=1 --json databaseId --jq '.[0].databaseId'`
  );
  return runId;
}

function waitForRun(runId: string): boolean {
  console.log(`  Waiting for run ${runId}...`);
  try {
    exec(`gh run watch ${runId} --exit-status`);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const options = parseArgs();

  console.log("Fetching commits to backfill...\n");
  const commits = getCommitsToBackfill(options);
  const recorded = getRecordedShas();

  // Filter out already-recorded commits
  const toBackfill = commits.filter((sha) => !recorded.has(sha));

  if (toBackfill.length === 0) {
    console.log("All commits already have benchmark data recorded.");
    return;
  }

  console.log(`Found ${commits.length} commits, ${toBackfill.length} need benchmarking:\n`);

  for (const sha of toBackfill) {
    const info = getCommitInfo(sha);
    console.log(`  ${info.short} ${info.subject}`);
  }

  if (options.dryRun) {
    console.log("\n--dry-run: No workflows triggered.");
    return;
  }

  console.log("\nTriggering benchmark runs...\n");

  let succeeded = 0;
  let failed = 0;

  for (let i = 0; i < toBackfill.length; i++) {
    const sha = toBackfill[i];
    const info = getCommitInfo(sha);
    console.log(`[${i + 1}/${toBackfill.length}] ${info.short} ${info.subject}`);

    const runId = triggerWorkflow(sha);
    const success = waitForRun(runId);

    if (success) {
      console.log(`  Done\n`);
      succeeded++;
    } else {
      console.log(`  Failed\n`);
      failed++;
    }
  }

  console.log(`\nBackfill complete: ${succeeded} succeeded, ${failed} failed`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
