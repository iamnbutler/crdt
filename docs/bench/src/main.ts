import type { Index, PairedRun, RunData } from "./types";
import {
  renderHistory,
  renderLatestComparison,
  renderMethodology,
  renderOverview,
  renderRunTable,
} from "./components";

async function main(): Promise<void> {
  const loading = document.getElementById("loading")!;
  const root = document.getElementById("root")!;

  let index: Index;
  try {
    const r = await fetch("./index.json");
    if (!r.ok) throw new Error(String(r.status));
    index = await r.json();
  } catch {
    loading.innerHTML = '<span class="err">Failed to load index.json</span>';
    return;
  }

  if (!index.runs?.length) {
    loading.textContent = "No runs yet.";
    return;
  }

  const results = await Promise.all(
    index.runs.slice(0, 30).map(async (run) => {
      try {
        const r = await fetch(`./results/${run.sha}.json`);
        return r.ok ? ((await r.json()) as RunData) : null;
      } catch {
        return null;
      }
    })
  );

  const paired: PairedRun[] = index.runs
    .slice(0, 30)
    .map((run, i) => ({ meta: run, data: results[i]! }))
    .filter((p): p is PairedRun => p.data?.results != null && !p.data.results.raw)
    .reverse();

  if (!paired.length) {
    loading.textContent = "No parseable results.";
    return;
  }

  loading.style.display = "none";
  root.style.display = "block";

  const latest = paired[paired.length - 1];
  const ctx = latest.data.results.context;

  let html = `<div class="meta">${paired.length} runs · ${ctx.runtime} ${ctx.version} · ${ctx.arch} · ${ctx.cpu.name}</div>`;

  html += `<h2>Overview<span class="hint">smaller is better</span></h2>`;
  html += renderOverview(latest);
  html += renderMethodology(ctx);

  html += `<h2>Latest Run (${latest.meta.shortSha})</h2>`;
  html += renderLatestComparison(latest, paired);

  html += `<h2>History</h2>`;
  html += renderHistory(paired);

  html += `<h2>Runs</h2>`;
  html += renderRunTable(paired);

  root.innerHTML = html;
}

main();
