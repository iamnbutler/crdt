<script lang="ts">
  import { formatTime, groupByLayout, findRun, calculateChange } from "../utils";
  import type { BenchmarkResults, RunData } from "../types";
  import Bar from "./Bar.svelte";
  import Change from "./Change.svelte";

  interface Props {
    results: BenchmarkResults;
    previousRun?: RunData | null;
  }

  let { results, previousRun = null }: Props = $props();

  const groups = $derived(groupByLayout(results));
  const namedGroups = $derived(
    [...groups.entries()].filter((entry): entry is [string, typeof entry[1]] => entry[0] !== null)
  );

  function getChange(name: string): number | null {
    if (!previousRun?.data?.results) return null;
    const prev = findRun(previousRun.data.results, name);
    const current = findRun(results, name);
    if (!prev || !current) return null;
    return calculateChange(current.stats.avg, prev.stats.avg);
  }
</script>

{#each namedGroups as [groupName, runs]}
  {@const maxAvg = Math.max(...runs.map((r) => r.stats.avg))}
  <h3>
    {groupName}
    <span class="hint">smaller is better</span>
  </h3>
  <table>
    <thead>
      <tr>
        <th>Benchmark</th>
        <th>avg</th>
        <th>p50</th>
        <th>p99</th>
        <th class="bar-header">comparison</th>
        <th>vs prev</th>
      </tr>
    </thead>
    <tbody>
      {#each runs as run}
        {@const isOurs = run.name.includes("@iamnbutler")}
        <tr>
          <td>{run.name}</td>
          <td><b>{formatTime(run.stats.avg)}</b></td>
          <td>{formatTime(run.stats.p50)}</td>
          <td>{formatTime(run.stats.p99)}</td>
          <td><Bar value={run.stats.avg} max={maxAvg} isHighlighted={isOurs} /></td>
          <td><Change change={getChange(run.name)} /></td>
        </tr>
      {/each}
    </tbody>
  </table>
{/each}

<style>
  h3 {
    font-size: 12px;
    font-weight: bold;
    margin: 16px 0 6px;
    color: var(--subtext1);
  }
  .hint {
    color: var(--subtext0);
    font-size: 10px;
    font-weight: normal;
    margin-left: 8px;
  }
  table {
    border-collapse: collapse;
    width: 100%;
    margin: 8px 0;
    font-size: 11px;
  }
  th,
  td {
    border: 1px solid var(--surface0);
    padding: 4px 8px;
    text-align: right;
  }
  th {
    background: var(--mantle);
    font-weight: 600;
    color: var(--subtext1);
  }
  td:first-child,
  th:first-child {
    text-align: left;
  }
  .bar-header {
    width: 200px;
  }
</style>
