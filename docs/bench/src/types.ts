export interface RunMeta {
  sha: string;
  shortSha: string;
  timestamp: string;
  branch: string;
  subject: string;
}

export interface BenchStats {
  avg: number;
  min: number;
  max: number;
  p50: number;
  p99: number;
}

export interface BenchRun {
  name: string;
  stats: BenchStats;
}

export interface Benchmark {
  group: number;
  runs: BenchRun[];
}

export interface LayoutItem {
  name: string | null;
}

export interface Context {
  runtime: string;
  version: string;
  arch: string;
  cpu: { name: string };
}

export interface Results {
  benchmarks: Benchmark[];
  layout: LayoutItem[];
  context: Context;
}

export interface RunData {
  results: Results & { raw?: unknown };
}

export interface Index {
  runs: RunMeta[];
}

export interface PairedRun {
  meta: RunMeta;
  data: RunData;
}

export interface BenchInfo {
  name: string;
  stats: BenchStats;
  group: number;
}
