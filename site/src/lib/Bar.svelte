<script lang="ts">
  import { formatTime } from "../utils";

  interface Props {
    value: number;
    max: number;
    isHighlighted?: boolean;
  }

  let { value, max, isHighlighted = false }: Props = $props();

  const percentage = $derived(((value / max) * 100).toFixed(1));
</script>

<div class="bar-cell">
  <div class="bar-wrap">
    <div class="bar" class:bar-you={isHighlighted} class:bar-other={!isHighlighted} style="width: {percentage}%"></div>
  </div>
  <span class="bar-label">{formatTime(value)}</span>
</div>

<style>
  .bar-cell {
    width: 200px;
    white-space: nowrap;
  }
  .bar-wrap {
    background: var(--surface0);
    height: 14px;
    display: inline-block;
    width: 120px;
    vertical-align: middle;
    border-radius: 2px;
  }
  .bar {
    height: 100%;
    border-radius: 2px;
  }
  .bar-you {
    background: var(--mauve);
  }
  .bar-other {
    background: var(--surface1);
  }
  .bar-label {
    display: inline-block;
    margin-left: 6px;
    font-size: 10px;
    color: var(--subtext0);
    vertical-align: middle;
  }
</style>
