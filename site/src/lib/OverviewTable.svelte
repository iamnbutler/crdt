<script lang="ts">
  import { formatTime, groupByLayout, getLibraryForRun } from "../utils";
  import type { BenchmarkResults } from "../types";
  import { LIBRARIES } from "../types";

  interface Props {
    results: BenchmarkResults;
  }

  let { results }: Props = $props();

  const groups = $derived(groupByLayout(results));
  const groupNames = $derived([...groups.keys()].filter((name): name is string => name !== null));

  const data = $derived.by(() => {
    const timings = new Map<string, number>();

    for (const [groupName, runs] of groups) {
      if (!groupName) continue;
      for (const run of runs) {
        const lib = getLibraryForRun(run.name, LIBRARIES);
        timings.set(`${lib}|${groupName}`, run.stats.avg);
      }
    }

    return LIBRARIES.map((lib) => ({
      library: lib,
      results: groupNames.map((groupName) => {
        const time = timings.get(`${lib}|${groupName}`);
        const allTimes = LIBRARIES.map((l) => timings.get(`${l}|${groupName}`)).filter(
          (t): t is number => t != null
        );
        const best = Math.min(...allTimes);
        return { time, isBest: time === best };
      }),
    }));
  });

  function formatGroupName(name: string): string {
    return name.replace(/-/g, " ").replace("editing trace replay", "trace replay");
  }
</script>

<table class="overview-table">
  <thead>
    <tr>
      <th></th>
      {#each groupNames as name}
        <th>{formatGroupName(name)}</th>
      {/each}
    </tr>
  </thead>
  <tbody>
    {#each data as row}
      <tr>
        <td class="lib-name"><b>{row.library.replace("@iamnbutler/", "")}</b></td>
        {#each row.results as result}
          <td class:best={result.isBest}>{result.time ? formatTime(result.time) : "-"}</td>
        {/each}
      </tr>
    {/each}
  </tbody>
</table>

<style>
  .overview-table {
    width: 100%;
    border-collapse: collapse;
    margin: 8px 0;
  }
  .overview-table th,
  .overview-table td {
    border: 1px solid var(--surface0);
    padding: 4px 8px;
    text-align: center;
    font-size: 10px;
  }
  .overview-table th {
    background: var(--mantle);
    font-weight: 600;
    color: var(--subtext1);
  }
  .lib-name {
    text-align: left !important;
  }
  .best {
    background: var(--green);
    color: white;
    font-weight: bold;
    border-radius: 2px;
  }
</style>
