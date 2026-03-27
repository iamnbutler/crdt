<script lang="ts">
  import { formatTime, groupByLayout, findRun } from "../utils";
  import type { RunData } from "../types";
  import Sparkline from "./Sparkline.svelte";

  interface Props {
    runs: RunData[];
  }

  let { runs }: Props = $props();

  const latestResults = $derived(runs[runs.length - 1]?.data?.results);
  const groups = $derived(latestResults ? groupByLayout(latestResults) : new Map());
  const namedGroups = $derived(
    [...groups.entries()].filter((entry): entry is [string, typeof entry[1]] => entry[0] !== null)
  );

  function getHistoryValues(benchmarkName: string): (number | null)[] {
    return runs.map((run) => {
      if (!run.data?.results) return null;
      const found = findRun(run.data.results, benchmarkName);
      return found?.stats.avg ?? null;
    });
  }
</script>

{#if runs.length < 2}
  <p class="empty">Need more runs for history.</p>
{:else}
  {#each namedGroups as [groupName, benchmarks]}
    <h3>
      {groupName}
      <span class="hint">smaller is better</span>
    </h3>
    <table>
      <thead>
        <tr>
          <th>Benchmark</th>
          <th>trend</th>
          <th>min</th>
          <th>max</th>
          <th>current</th>
        </tr>
      </thead>
      <tbody>
        {#each benchmarks as benchmark}
          {@const history = getHistoryValues(benchmark.name)}
          {@const validValues = history.filter((v): v is number => v !== null)}
          {@const min = validValues.length > 0 ? Math.min(...validValues) : null}
          {@const max = validValues.length > 0 ? Math.max(...validValues) : null}
          {@const current = history[history.length - 1]}
          <tr>
            <td>{benchmark.name}</td>
            <td><Sparkline values={history} /></td>
            <td>{formatTime(min)}</td>
            <td>{formatTime(max)}</td>
            <td><b>{formatTime(current)}</b></td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/each}
{/if}

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
  .empty {
    color: var(--subtext0);
    font-style: italic;
  }
</style>
