<script lang="ts">
  interface Props {
    values: (number | null)[];
    width?: number;
    height?: number;
  }

  let { values, width = 120, height = 20 }: Props = $props();

  const points = $derived.by(() => {
    const valid = values
      .map((v, i) => (v !== null ? { i, v } : null))
      .filter((p): p is { i: number; v: number } => p !== null);

    if (valid.length < 2) return null;

    const minVal = Math.min(...valid.map((p) => p.v));
    const maxVal = Math.max(...valid.map((p) => p.v));
    const range = maxVal - minVal || 1;

    return valid.map((p) => ({
      x: (p.i / (values.length - 1)) * width,
      y: height - ((p.v - minVal) / range) * (height - 4) - 2,
    }));
  });

  const lastPoint = $derived(points ? points[points.length - 1] : null);
  const polylinePoints = $derived(points?.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ") ?? "");
</script>

{#if points && lastPoint}
  <svg class="sparkline" {width} {height} viewBox="0 0 {width} {height}">
    <polyline class="spark-line" points={polylinePoints} />
    <circle class="spark-dot" cx={lastPoint.x.toFixed(1)} cy={lastPoint.y.toFixed(1)} r="2" />
  </svg>
{:else}
  <span class="no-data">-</span>
{/if}

<style>
  .sparkline {
    display: block;
  }
  .spark-line {
    fill: none;
    stroke: var(--mauve);
    stroke-width: 1.5;
  }
  .spark-dot {
    fill: var(--mauve);
  }
  .no-data {
    color: var(--subtext0);
  }
</style>
