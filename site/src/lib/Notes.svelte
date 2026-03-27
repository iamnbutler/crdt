<script lang="ts">
  import type { BenchmarkContext } from "../types";

  interface Props {
    context: BenchmarkContext;
  }

  let { context }: Props = $props();
</script>

<div class="notes">
  <p>
    <strong>Methodology:</strong> Each benchmark runs multiple iterations until stable. Times shown are
    averages.
  </p>
  <p>
    <strong>Libraries:</strong> @iamnbutler/crdt (this project), Loro, Yjs, Automerge - all latest versions
    at time of run.
  </p>
  <p>
    <strong>Environment:</strong>
    {context.cpu.name}, {context.runtime}
    {context.version}
  </p>
</div>

<style>
  .notes {
    background: var(--mantle);
    padding: 12px;
    margin: 12px 0;
    border-radius: 4px;
    font-size: 11px;
    color: var(--subtext0);
  }
  .notes p {
    margin: 4px 0;
  }
  .notes :global(strong) {
    color: var(--text);
  }
</style>
