<script lang="ts">
  interface Props {
    change: number | null;
  }

  let { change }: Props = $props();

  const isPositive = $derived(change !== null && change > 5);
  const isNegative = $derived(change !== null && change < -5);
  const formatted = $derived(change !== null ? `${change > 0 ? "+" : ""}${change.toFixed(1)}%` : "");
</script>

{#if change !== null}
  <span class:pos={isNegative} class:neg={isPositive}>{formatted}</span>
{/if}

<style>
  .pos {
    color: var(--green);
  }
  .neg {
    color: var(--red);
  }
</style>
