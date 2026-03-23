import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const BASELINE_PATH = join(import.meta.dir, "..", ".benchmark-baseline.json");
const REGRESSION_THRESHOLD = 0.1; // 10% regression threshold

interface BenchmarkResult {
  name: string;
  ops: number;
  margin: number;
}

interface BenchmarkBaseline {
  timestamp: string;
  results: Record<string, BenchmarkResult>;
}

export async function loadBaseline(): Promise<BenchmarkBaseline | null> {
  if (!existsSync(BASELINE_PATH)) {
    return null;
  }
  const content = await readFile(BASELINE_PATH, "utf-8");
  return JSON.parse(content) as BenchmarkBaseline;
}

export async function saveBaseline(results: BenchmarkResult[]): Promise<void> {
  const baseline: BenchmarkBaseline = {
    timestamp: new Date().toISOString(),
    results: Object.fromEntries(results.map((r) => [r.name, r])),
  };
  await writeFile(BASELINE_PATH, JSON.stringify(baseline, null, 2));
}

export interface RegressionResult {
  name: string;
  baseline: number;
  current: number;
  change: number;
  isRegression: boolean;
}

export function detectRegressions(
  baseline: BenchmarkBaseline,
  current: BenchmarkResult[],
): RegressionResult[] {
  const results: RegressionResult[] = [];

  for (const result of current) {
    const baselineResult = baseline.results[result.name];
    if (baselineResult === undefined) {
      continue;
    }

    const change = (baselineResult.ops - result.ops) / baselineResult.ops;
    const isRegression = change > REGRESSION_THRESHOLD;

    results.push({
      name: result.name,
      baseline: baselineResult.ops,
      current: result.ops,
      change,
      isRegression,
    });
  }

  return results;
}

export function formatRegressionReport(results: RegressionResult[]): string {
  const regressions = results.filter((r) => r.isRegression);

  if (regressions.length === 0) {
    return "No performance regressions detected.";
  }

  const lines = [
    `Performance regressions detected (threshold: ${REGRESSION_THRESHOLD * 100}%):`,
    "",
  ];

  for (const r of regressions) {
    const changePercent = (r.change * 100).toFixed(1);
    lines.push(
      `  - ${r.name}: ${r.baseline.toFixed(0)} -> ${r.current.toFixed(0)} ops/s (-${changePercent}%)`,
    );
  }

  return lines.join("\n");
}

export function hasRegressions(results: RegressionResult[]): boolean {
  return results.some((r) => r.isRegression);
}

// CLI entry point
if (import.meta.main) {
  const args = process.argv.slice(2);
  const command = args[0];

  if (command === "save") {
    // Read benchmark results from stdin (JSON format from mitata --json)
    const input = await Bun.stdin.text();
    const benchResults = JSON.parse(input) as BenchmarkResult[];
    await saveBaseline(benchResults);
    console.log("Baseline saved to", BASELINE_PATH);
  } else if (command === "check") {
    const baseline = await loadBaseline();
    if (baseline === null) {
      console.log("No baseline found. Run with 'save' first.");
      process.exit(0);
    }

    const input = await Bun.stdin.text();
    const current = JSON.parse(input) as BenchmarkResult[];
    const results = detectRegressions(baseline, current);
    console.log(formatRegressionReport(results));

    if (hasRegressions(results)) {
      process.exit(1);
    }
  } else {
    console.log("Usage: bun run benchmarks/regression.ts [save|check]");
    console.log("  save  - Save current benchmark results as baseline");
    console.log("  check - Check current results against baseline");
  }
}
