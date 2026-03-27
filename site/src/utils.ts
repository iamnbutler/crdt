import type { BenchmarkResults, BenchmarkRun, RunData, LIBRARIES } from "./types";

export function formatTime(ns: number | null | undefined): string {
  if (ns == null) return "-";
  if (ns < 1000) return `${ns.toFixed(1)} ns`;
  if (ns < 1e6) return `${(ns / 1000).toFixed(1)} us`;
  if (ns < 1e9) return `${(ns / 1e6).toFixed(1)} ms`;
  return `${(ns / 1e9).toFixed(2)} s`;
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

interface GroupedRun {
  name: string;
  stats: BenchmarkRun["stats"];
  group: string;
}

export function groupByLayout(results: BenchmarkResults): Map<string | null, GroupedRun[]> {
  const groups = new Map<string | null, GroupedRun[]>();

  for (const benchmark of results.benchmarks) {
    for (const run of benchmark.runs) {
      const groupName = results.layout[benchmark.group]?.name ?? null;
      if (!groups.has(groupName)) {
        groups.set(groupName, []);
      }
      groups.get(groupName)?.push({
        name: run.name,
        stats: run.stats,
        group: benchmark.group,
      });
    }
  }

  return groups;
}

export function findRun(results: BenchmarkResults, name: string): GroupedRun | null {
  for (const benchmark of results.benchmarks) {
    for (const run of benchmark.runs) {
      if (run.name === name) {
        return {
          name: run.name,
          stats: run.stats,
          group: benchmark.group,
        };
      }
    }
  }
  return null;
}

export function calculateChange(current: number, previous: number): number {
  return ((current - previous) / previous) * 100;
}

export function getLibraryForRun(name: string, libraries: readonly string[]): string {
  return libraries.find((lib) => name.includes(lib)) ?? name;
}

export async function fetchIndex(basePath: string): Promise<{ runs: Array<{ sha: string; shortSha: string; timestamp: string; branch: string; subject: string }> } | null> {
  try {
    const response = await fetch(`${basePath}/index.json`);
    if (!response.ok) return null;
    return response.json();
  } catch {
    return null;
  }
}

export async function fetchRunData(basePath: string, sha: string): Promise<RunData["data"]> {
  try {
    const response = await fetch(`${basePath}/results/${sha}.json`);
    if (!response.ok) return null;
    return response.json();
  } catch {
    return null;
  }
}
