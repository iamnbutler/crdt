import type { BenchInfo, PairedRun, Results, RunMeta } from "./types";
import { esc, fmt } from "./utils";

const LIBS = ["@iamnbutler/crdt", "Loro", "Yjs", "Automerge"];

export function groupBenchmarks(res: Results): Map<string | null, BenchInfo[]> {
  const groups = new Map<string | null, BenchInfo[]>();
  for (const b of res.benchmarks) {
    for (const r of b.runs) {
      const groupName = res.layout[b.group]?.name || null;
      if (!groups.has(groupName)) groups.set(groupName, []);
      groups.get(groupName)!.push({ name: r.name, stats: r.stats, group: b.group });
    }
  }
  return groups;
}

export function findBench(res: Results, name: string): BenchInfo | null {
  for (const b of res.benchmarks) {
    for (const r of b.runs) {
      if (r.name === name) return { name: r.name, stats: r.stats, group: b.group };
    }
  }
  return null;
}

export function renderOverview(latest: PairedRun): string {
  const res = latest.data.results;
  const groups = groupBenchmarks(res);

  const tests: string[] = [];
  const data = new Map<string, number>();

  for (const [groupName, benches] of groups) {
    if (!groupName) continue;
    tests.push(groupName);
    for (const b of benches) {
      const libName = LIBS.find((l) => b.name.includes(l)) || b.name;
      data.set(`${libName}|${groupName}`, b.stats.avg);
    }
  }

  let html = `<table class="overview-table"><tr><th></th>`;
  for (const t of tests) {
    const shortName = t.replace(/-/g, " ").replace("editing trace replay", "trace replay");
    html += `<th>${shortName}</th>`;
  }
  html += `</tr>`;

  for (const lib of LIBS) {
    html += `<tr><td style="text-align:left"><b>${lib.replace("@iamnbutler/", "")}</b></td>`;
    for (const t of tests) {
      const val = data.get(`${lib}|${t}`);
      const testVals = LIBS.map((l) => data.get(`${l}|${t}`)).filter((v): v is number => v != null);
      const best = Math.min(...testVals);
      const isBest = val === best;
      html += `<td class="${isBest ? "best" : ""}">${val ? fmt(val) : "—"}</td>`;
    }
    html += `</tr>`;
  }
  return html + `</table>`;
}

export function renderLatestComparison(latest: PairedRun, paired: PairedRun[]): string {
  const res = latest.data.results;
  const groups = groupBenchmarks(res);
  let html = "";

  for (const [groupName, benches] of groups) {
    if (!groupName) continue;
    html += `<h3>${groupName}<span class="hint">smaller is better</span></h3>`;
    html += `<table><tr><th>Benchmark</th><th>avg</th><th>p50</th><th>p99</th><th class="bar-cell">comparison</th><th>vs prev</th></tr>`;

    const maxAvg = Math.max(...benches.map((b) => b.stats.avg));

    for (const b of benches) {
      const s = b.stats;
      const barPct = ((s.avg / maxAvg) * 100).toFixed(1);
      const isYours = b.name.includes("@iamnbutler");

      let delta = "";
      if (paired.length >= 2) {
        const prev = paired[paired.length - 2];
        const prevBench = findBench(prev.data.results, b.name);
        if (prevBench) {
          const pct = ((s.avg - prevBench.stats.avg) / prevBench.stats.avg) * 100;
          const cls = pct > 5 ? "neg" : pct < -5 ? "pos" : "";
          delta = `<span class="${cls}">${pct > 0 ? "+" : ""}${pct.toFixed(1)}%</span>`;
        }
      }

      html += `<tr>
        <td>${esc(b.name)}</td>
        <td><b>${fmt(s.avg)}</b></td>
        <td>${fmt(s.p50)}</td>
        <td>${fmt(s.p99)}</td>
        <td class="bar-cell"><div class="bar-wrap"><div class="bar ${isYours ? "bar-you" : "bar-other"}" style="width:${barPct}%"></div></div><span class="bar-label">${fmt(s.avg)}</span></td>
        <td>${delta}</td>
      </tr>`;
    }
    html += `</table>`;
  }
  return html;
}

export function renderSparkline(data: (number | null)[], w: number, h: number): string {
  const valid = data.map((v, i) => (v !== null ? { i, v } : null)).filter((p): p is { i: number; v: number } => p !== null);
  if (valid.length < 2) return "—";

  const min = Math.min(...valid.map((p) => p.v));
  const max = Math.max(...valid.map((p) => p.v));
  const range = max - min || 1;

  const points = valid.map((p) => {
    const x = (p.i / (data.length - 1)) * w;
    const y = h - ((p.v - min) / range) * (h - 4) - 2;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  const last = valid[valid.length - 1];
  const lastX = (last.i / (data.length - 1)) * w;
  const lastY = h - ((last.v - min) / range) * (h - 4) - 2;

  return `<svg class="sparkline" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
    <polyline class="spark-line" points="${points.join(" ")}"/>
    <circle class="spark-dot" cx="${lastX.toFixed(1)}" cy="${lastY.toFixed(1)}" r="2"/>
  </svg>`;
}

export function renderHistory(paired: PairedRun[]): string {
  if (paired.length < 2) return "<p>Need more runs for history.</p>";

  const latest = paired[paired.length - 1].data.results;
  const groups = groupBenchmarks(latest);
  let html = "";

  for (const [groupName, benches] of groups) {
    if (!groupName) continue;
    html += `<h3>${groupName}<span class="hint">smaller is better</span></h3>`;
    html += `<table><tr><th>Benchmark</th><th>trend</th><th>min</th><th>max</th><th>current</th></tr>`;

    for (const b of benches) {
      const history: (number | null)[] = [];
      for (const p of paired) {
        const found = findBench(p.data.results, b.name);
        history.push(found ? found.stats.avg : null);
      }

      const valid = history.filter((v): v is number => v !== null);
      if (valid.length === 0) continue;

      const min = Math.min(...valid);
      const max = Math.max(...valid);
      const current = history[history.length - 1];

      html += `<tr>
        <td>${esc(b.name)}</td>
        <td>${renderSparkline(history, 120, 20)}</td>
        <td>${fmt(min)}</td>
        <td>${fmt(max)}</td>
        <td><b>${fmt(current)}</b></td>
      </tr>`;
    }
    html += `</table>`;
  }
  return html;
}

export function renderRunTable(paired: PairedRun[]): string {
  let html = `<table><tr><th>#</th><th>SHA</th><th>Date</th><th>Branch</th><th>Subject</th></tr>`;
  for (let i = paired.length - 1; i >= 0; i--) {
    const m = paired[i].meta;
    const subj = m.subject.length > 50 ? m.subject.slice(0, 47) + "..." : m.subject;
    html += `<tr class="run-row"><td>${paired.length - i}</td><td>${m.shortSha}</td><td>${m.timestamp.slice(0, 10)}</td><td>${esc(m.branch)}</td><td style="text-align:left">${esc(subj)}</td></tr>`;
  }
  return html + `</table>`;
}

export function renderMethodology(ctx: { cpu: { name: string }; runtime: string; version: string }): string {
  return `<div class="notes">
    <p><strong>Methodology:</strong> Each benchmark runs multiple iterations until stable. Times shown are averages.</p>
    <p><strong>Libraries:</strong> @iamnbutler/crdt (this project), Loro, Yjs, Automerge — all latest versions at time of run.</p>
    <p><strong>Environment:</strong> ${ctx.cpu.name}, ${ctx.runtime} ${ctx.version}</p>
  </div>`;
}
