export interface BenchmarkStats {
  avg: number;
  p50: number;
  p75: number;
  p99: number;
  min: number;
  max: number;
}

export interface BenchmarkRun {
  name: string;
  stats: BenchmarkStats;
}

export interface BenchmarkGroup {
  group: string;
  runs: BenchmarkRun[];
}

export interface BenchmarkContext {
  runtime: string;
  version: string;
  arch: string;
  cpu: {
    name: string;
    cores: number;
  };
}

export interface BenchmarkLayout {
  [group: string]: {
    name: string;
  };
}

export interface BenchmarkResults {
  benchmarks: BenchmarkGroup[];
  context: BenchmarkContext;
  layout: BenchmarkLayout;
}

export interface RunMeta {
  sha: string;
  shortSha: string;
  timestamp: string;
  branch: string;
  subject: string;
}

export interface RunData {
  meta: RunMeta;
  data: {
    results: BenchmarkResults;
  } | null;
}

export interface IndexJson {
  runs: RunMeta[];
}

export const LIBRARIES = ["@iamnbutler/crdt", "Loro", "Yjs", "Automerge"] as const;
export type Library = (typeof LIBRARIES)[number];
