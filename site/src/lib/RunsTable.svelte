<script lang="ts">
  import type { RunData } from "../types";

  interface Props {
    runs: RunData[];
  }

  let { runs }: Props = $props();

  const reversedRuns = $derived([...runs].reverse());

  function truncate(text: string, maxLen: number): string {
    return text.length > maxLen ? text.slice(0, maxLen - 3) + "..." : text;
  }
</script>

<table>
  <thead>
    <tr>
      <th>#</th>
      <th>SHA</th>
      <th>Date</th>
      <th>Branch</th>
      <th>Subject</th>
    </tr>
  </thead>
  <tbody>
    {#each reversedRuns as run, i}
      <tr class="run-row">
        <td>{runs.length - i}</td>
        <td>{run.meta.shortSha}</td>
        <td>{run.meta.timestamp.slice(0, 10)}</td>
        <td>{run.meta.branch}</td>
        <td class="subject">{truncate(run.meta.subject, 50)}</td>
      </tr>
    {/each}
  </tbody>
</table>

<style>
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
  .run-row:hover {
    background: var(--mantle);
  }
  .subject {
    text-align: left;
  }
</style>
