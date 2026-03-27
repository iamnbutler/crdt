<script lang="ts">
  import { onMount } from "svelte";
  import type { RunData, IndexJson } from "./types";
  import { fetchIndex, fetchRunData } from "./utils";
  import OverviewTable from "./lib/OverviewTable.svelte";
  import ResultsTable from "./lib/ResultsTable.svelte";
  import HistoryTable from "./lib/HistoryTable.svelte";
  import RunsTable from "./lib/RunsTable.svelte";
  import Notes from "./lib/Notes.svelte";

  let loading = $state(true);
  let error = $state<string | null>(null);
  let runs = $state<RunData[]>([]);

  const latestRun = $derived(runs.length > 0 ? runs[runs.length - 1] : null);
  const previousRun = $derived(runs.length >= 2 ? runs[runs.length - 2] : null);
  const results = $derived(latestRun?.data?.results ?? null);
  const context = $derived(results?.context ?? null);

  onMount(async () => {
    // In production, data is at root. In dev, use the data path.
    const basePath = import.meta.env.DEV ? "/data" : ".";

    const index = await fetchIndex(basePath);
    if (!index?.runs?.length) {
      error = "No runs found in index.json";
      loading = false;
      return;
    }

    // Fetch up to 30 most recent runs
    const runMetas = index.runs.slice(0, 30);
    const runDataResults = await Promise.all(
      runMetas.map(async (meta) => {
        const data = await fetchRunData(basePath, meta.sha);
        return { meta, data };
      })
    );

    // Filter out runs without valid data and reverse to chronological order
    runs = runDataResults
      .filter((r): r is RunData => r.data?.results != null)
      .reverse();

    if (runs.length === 0) {
      error = "No parseable results found";
    }

    loading = false;
  });
</script>

<main>
  <h1>@iamnbutler/crdt - Benchmark History</h1>

  {#if loading}
    <p class="loading">Loading...</p>
  {:else if error}
    <p class="error">{error}</p>
  {:else if results && context}
    <div class="meta">
      {runs.length} runs - {context.runtime}
      {context.version} - {context.arch} - {context.cpu.name}
    </div>

    <h2>Overview <span class="hint">smaller is better</span></h2>
    <OverviewTable {results} />
    <Notes {context} />

    {#if latestRun}
      <h2>Latest Run ({latestRun.meta.shortSha})</h2>
      <ResultsTable {results} {previousRun} />
    {/if}

    <h2>History</h2>
    <HistoryTable {runs} />

    <h2>Runs</h2>
    <RunsTable {runs} />
  {/if}
</main>

<style>
  :root {
    --base: #eff1f5;
    --mantle: #e6e9ef;
    --surface0: #ccd0da;
    --surface1: #bcc0cc;
    --text: #4c4f69;
    --subtext0: #6c6f85;
    --subtext1: #5c5f77;
    --red: #d20f39;
    --green: #40a02b;
    --blue: #1e66f5;
    --lavender: #7287fd;
    --mauve: #8839ef;
    --teal: #179299;
  }

  :global(*) {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
  }

  :global(body) {
    font: 12px / 1.5 ui-monospace, "SF Mono", Menlo, monospace;
    color: var(--text);
    background: var(--base);
  }

  main {
    max-width: 1000px;
    margin: 0 auto;
    padding: 16px;
  }

  h1 {
    font-size: 14px;
    font-weight: bold;
    margin-bottom: 4px;
    color: var(--text);
  }

  h2 {
    font-size: 13px;
    font-weight: bold;
    margin: 24px 0 8px;
    border-bottom: 1px solid var(--surface0);
    padding-bottom: 4px;
    color: var(--text);
  }

  .meta {
    color: var(--subtext0);
    font-size: 11px;
    margin-bottom: 16px;
  }

  .hint {
    color: var(--subtext0);
    font-size: 10px;
    font-weight: normal;
    margin-left: 8px;
  }

  .loading {
    color: var(--subtext0);
  }

  .error {
    color: var(--red);
  }
</style>
