#!/usr/bin/env bun
/**
 * Records benchmark results to an orphan branch for historical tracking.
 *
 * Usage: bun scripts/record-benchmarks.ts [--push]
 *
 * Results are stored in the `benchmark-data` branch as:
 *   results/{sha}.json     - full results for each commit
 *   index.json             - manifest of all recorded runs
 */

import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BRANCH = "benchmark-data";
const RESULTS_DIR = "results";

// Slim types for the extracted benchmark data we actually store
interface SlimStats {
  min: number;
  max: number;
  avg: number;
  p50: number;
  p75: number;
  p99: number;
  p999: number;
  ticks: number;
}

interface SlimRun {
  name: string;
  args: Record<string, unknown>;
  stats: SlimStats;
}

interface SlimBenchmark {
  alias: string;
  group: number;
  baseline: boolean;
  runs: SlimRun[];
}

interface SlimContext {
  arch: string;
  runtime: string;
  version: string;
  cpu: { name: string; freq: number };
}

interface SlimLayout {
  name: string | null;
}

interface SlimResults {
  layout: SlimLayout[];
  benchmarks: SlimBenchmark[];
  context: SlimContext;
}

interface BenchmarkRun {
  sha: string;
  shortSha: string;
  timestamp: string;
  branch: string;
  subject: string;
  results: SlimResults | { raw: string };
}

interface Index {
  runs: Array<{
    sha: string;
    shortSha: string;
    timestamp: string;
    branch: string;
    subject: string;
  }>;
}

/**
 * Extracts only the metrics needed for historical tracking from the full
 * mitata JSON output. Drops samples arrays, debug strings, heap data,
 * CPU counters, and noop baselines — shrinking ~86 MB down to ~1-30 KB.
 */
function extractBenchmarkData(raw: unknown): SlimResults | { raw: string } {
  if (
    raw === null ||
    typeof raw !== "object" ||
    !("benchmarks" in raw) ||
    !("context" in raw) ||
    !("layout" in raw)
  ) {
    return { raw: JSON.stringify(raw) };
  }

  const obj = raw;
  const layoutArr = Array.isArray(obj.layout) ? obj.layout : [];
  const benchArr = Array.isArray(obj.benchmarks) ? obj.benchmarks : [];
  const ctx = obj.context !== null && typeof obj.context === "object" ? obj.context : undefined;

  if (!ctx || !("arch" in ctx) || !("runtime" in ctx) || !("version" in ctx) || !("cpu" in ctx)) {
    return { raw: JSON.stringify(raw) };
  }

  const cpuObj = ctx.cpu !== null && typeof ctx.cpu === "object" ? ctx.cpu : undefined;
  if (!cpuObj || !("name" in cpuObj) || !("freq" in cpuObj)) {
    return { raw: JSON.stringify(raw) };
  }

  return {
    layout: layoutArr.map((l: { name?: string | null }) => ({
      name: l.name ?? null,
    })),
    benchmarks: benchArr.map(
      (b: {
        alias: string;
        group: number;
        baseline: boolean;
        runs: Array<{
          name: string;
          args: Record<string, unknown>;
          stats: {
            min: number;
            max: number;
            avg: number;
            p50: number;
            p75: number;
            p99: number;
            p999: number;
            ticks: number;
          };
        }>;
      }) => ({
        alias: b.alias,
        group: b.group,
        baseline: b.baseline,
        runs: b.runs.map((r) => ({
          name: r.name,
          args: r.args,
          stats: {
            min: r.stats.min,
            max: r.stats.max,
            avg: r.stats.avg,
            p50: r.stats.p50,
            p75: r.stats.p75,
            p99: r.stats.p99,
            p999: r.stats.p999,
            ticks: r.stats.ticks,
          },
        })),
      }),
    ),
    context: {
      arch: String(ctx.arch),
      runtime: String(ctx.runtime),
      version: String(ctx.version),
      cpu: {
        name: String(cpuObj.name),
        freq: Number(cpuObj.freq),
      },
    },
  };
}

function exec(
  cmd: string,
  options?: { cwd?: string; stdio?: "pipe" | "inherit"; timeout?: number },
): string {
  return execSync(cmd, {
    encoding: "utf-8",
    stdio: options?.stdio ?? "pipe",
    cwd: options?.cwd,
    timeout: options?.timeout,
    maxBuffer: 50 * 1024 * 1024, // 50MB
  }).trim();
}

function getGitInfo() {
  const sha = exec("git rev-parse HEAD");
  const shortSha = exec("git rev-parse --short HEAD");
  const branch = exec("git rev-parse --abbrev-ref HEAD");
  const subject = exec("git log -1 --format=%s");
  return { sha, shortSha, branch, subject };
}

function runBenchmarks(): SlimResults | { raw: string } {
  console.log("Running benchmarks...\n");

  // Use comparison benchmark - write to temp file to avoid buffer truncation
  const tempFile = join(tmpdir(), `bench-${Date.now()}.json`);
  exec(`bun run bench:compare:ci > "${tempFile}" 2>&1`, {
    timeout: 10 * 60 * 1000,
  });

  const output = readFileSync(tempFile, "utf-8");

  // Extract JSON from output - find the JSON object that starts with {"layout"
  const jsonStart = output.indexOf('{"layout"');
  if (jsonStart !== -1) {
    const jsonStr = output.slice(jsonStart);
    try {
      const fullResults: unknown = JSON.parse(jsonStr);
      return extractBenchmarkData(fullResults);
    } catch {
      return { raw: output };
    }
  }

  return { raw: output };
}

function ensureOrphanBranch(worktree: string) {
  // Check if branch exists
  try {
    exec(`git rev-parse --verify ${BRANCH}`);
    // Branch exists, clone it to worktree
    exec(`git worktree add "${worktree}" ${BRANCH}`);
  } catch {
    // Branch doesn't exist, create orphan
    exec(`git worktree add --detach "${worktree}"`);
    exec(`git checkout --orphan ${BRANCH}`, { cwd: worktree });
    exec("git rm -rf . 2>/dev/null || true", { cwd: worktree });
    exec("git clean -fd", { cwd: worktree });

    // Create initial structure
    mkdirSync(join(worktree, RESULTS_DIR), { recursive: true });
    const initialIndex: Index = { runs: [] };
    writeFileSync(join(worktree, "index.json"), JSON.stringify(initialIndex, null, 2));
    writeFileSync(
      join(worktree, "README.md"),
      `# Benchmark Results

This branch contains historical benchmark data.

- \`index.json\` - manifest of all runs
- \`results/{sha}.json\` - detailed results per commit

Generated by \`scripts/record-benchmarks.ts\`
`,
    );
    exec("git add .", { cwd: worktree });
    exec('git commit -m "Initialize benchmark-data branch"', { cwd: worktree });
  }
}

async function main() {
  const shouldPush = process.argv.includes("--push");
  const gitInfo = getGitInfo();

  console.log(`Recording benchmarks for ${gitInfo.shortSha} (${gitInfo.branch})`);
  console.log(`  ${gitInfo.subject}\n`);

  // Run benchmarks on current HEAD
  const results = runBenchmarks();

  // Create worktree for benchmark-data branch
  const worktree = join(tmpdir(), `benchmark-data-${Date.now()}`);

  try {
    ensureOrphanBranch(worktree);

    // Load existing index
    const indexPath = join(worktree, "index.json");
    const index: Index = JSON.parse(readFileSync(indexPath, "utf-8"));

    // Check if we already have results for this SHA
    if (index.runs.some((r) => r.sha === gitInfo.sha)) {
      console.log(`Results for ${gitInfo.shortSha} already recorded, skipping.`);
      return;
    }

    // Create run record
    const run: BenchmarkRun = {
      sha: gitInfo.sha,
      shortSha: gitInfo.shortSha,
      timestamp: new Date().toISOString(),
      branch: gitInfo.branch,
      subject: gitInfo.subject,
      results,
    };

    // Write results file
    const resultsDir = join(worktree, RESULTS_DIR);
    if (!existsSync(resultsDir)) {
      mkdirSync(resultsDir, { recursive: true });
    }
    writeFileSync(join(resultsDir, `${gitInfo.sha}.json`), JSON.stringify(run, null, 2));

    // Update index
    index.runs.unshift({
      sha: gitInfo.sha,
      shortSha: gitInfo.shortSha,
      timestamp: run.timestamp,
      branch: gitInfo.branch,
      subject: gitInfo.subject,
    });
    writeFileSync(indexPath, JSON.stringify(index, null, 2));

    // Commit
    exec("git add .", { cwd: worktree });
    exec(`git commit -m "Add benchmark results for ${gitInfo.shortSha}"`, { cwd: worktree });

    if (shouldPush) {
      console.log(`\nPushing to origin/${BRANCH}...`);
      // Fetch and rebase to handle concurrent runs
      try {
        exec(`git fetch origin ${BRANCH}`, { cwd: worktree });
        exec(`git rebase origin/${BRANCH}`, { cwd: worktree });
      } catch {
        // Remote branch may not exist yet
      }
      exec(`git push origin ${BRANCH}`, { cwd: worktree });
    } else {
      console.log("\nResults committed locally. Run with --push to push to remote.");
      // Push the branch ref back to main repo
      exec(`git push . ${BRANCH}:${BRANCH}`, { cwd: worktree });
    }

    console.log(`\nRecorded benchmark for ${gitInfo.shortSha}`);
  } finally {
    // Cleanup worktree
    exec(`git worktree remove "${worktree}" --force 2>/dev/null || true`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
