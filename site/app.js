const colors = { run: "#39735a", loro: "#7f80b5", yjs: "#b69c49", automerge: "#ad7962", legacy: "#9aa394" };
const byId = (id) => document.getElementById(id);
const number = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
const format = (value, unit = "ms") => value === null ? "—" : unit === "bytes" ? `${number.format(value / 1024)} KiB` : `${number.format(value)} ms`;
const element = (tag, className, text) => { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; };
let current;
let request = 0;

function draw() {
  if (!current) return;
  const id = byId("workload").value;
  const libraries = [...current.libraries].sort((a, b) => (a.id === "run" ? -1 : b.id === "run" ? 1 : 0));
  const rows = libraries.map((library) => ({ library, value: library.measurements.find((m) => m.id === id) }));
  const valid = rows.filter(({ value }) => value?.status === "ok");
  const values = valid.flatMap(({ value }) => [value.min, value.max]).filter((v) => v > 0);
  const low = Math.floor(Math.log10(Math.min(...values)));
  const high = Math.max(low + 1, Math.ceil(Math.log10(Math.max(...values))));
  const position = (value) => `${Math.max(0, Math.min(100, 100 * (Math.log10(value) - low) / (high - low)))}%`;
  const best = Math.min(...valid.map(({ value }) => value.median));
  const chart = byId("chart");
  chart.replaceChildren();
  for (const { library, value } of rows) {
    const row = element("div", "chart-row");
    const label = element("div", "chart-name", library.name);
    label.append(element("div", "chart-version", library.version));
    row.append(label);
    if (value?.status === "ok") {
      const track = element("div", "track");
      track.style.setProperty("--color", colors[library.id] ?? "#718268");
      track.style.backgroundSize = `${100 / (high - low)}% 100%`;
      const whisker = element("span", "whisker");
      whisker.style.setProperty("--low", position(value.min));
      whisker.style.setProperty("--high", position(value.max));
      const dot = element("span", "dot");
      dot.style.setProperty("--position", position(value.median));
      dot.title = `Median ${format(value.median, value.unit)}; range ${format(value.min, value.unit)}–${format(value.max, value.unit)}`;
      track.setAttribute("aria-label", dot.title);
      track.append(whisker, dot);
      row.append(track, element("div", `chart-value${value.median === best ? " winner" : ""}`, format(value.median, value.unit)));
    } else {
      const failure = element("div", "chart-failure");
      failure.append(element("span", "badge", value?.status === "incorrect" ? "INCORRECT OUTPUT" : "NOT MEASURED"));
      failure.append(element("span", "", value?.detail ?? "A valid trace state is required."));
      row.append(failure);
    }
    chart.append(row);
  }
  if (values.length) {
    const axis = element("div", "chart-axis");
    const ticks = element("div", "axis-ticks");
    for (let exponent = low; exponent <= high; exponent++) {
      const value = 10 ** exponent;
      const tick = element("span", "", number.format(value));
      tick.style.setProperty("--position", position(value));
      ticks.append(tick);
    }
    axis.append(element("span"), ticks, element("span"));
    chart.append(axis);
  }
  const example = valid[0]?.value;
  byId("case-detail").textContent = `${example?.detail ?? "No valid measurements for this workload."}${example ? ` Axis: ${example.unit === "bytes" ? "bytes" : "milliseconds"}.` : ""}`;
}

function render(run, filename) {
  current = run;
  const own = run.libraries.find((library) => library.id === "run");
  const trace = own?.measurements.find((m) => m.id === "trace" && m.status === "ok");
  const peers = run.libraries.filter((l) => l.id !== "run").map((l) => ({ library: l, value: l.measurements.find((m) => m.id === "trace" && m.status === "ok") })).filter((r) => r.value).sort((a, b) => a.value.median - b.value.median);
  byId("headline-time").replaceChildren(document.createTextNode(trace ? number.format(trace.median) : "—"), element("small", "", trace ? "ms" : ""));
  if (trace && peers[0]) {
    const ratio = peers[0].value.median / trace.median;
    byId("headline-ratio").textContent = `${number.format(ratio >= 1 ? ratio : 1 / ratio)}×`;
    byId("headline-competitor").textContent = `${ratio >= 1 ? "Faster" : "Slower"} than ${peers[0].library.name} on this trace.`;
  }
  byId("headline-tests").textContent = run.validation ? number.format(run.validation.passed) : "—";
  byId("headline-count").textContent = `${number.format(trace?.operations ?? run.fixture.operations)} edits. Exact final text verified.`;
  byId("raw-link").href = `./lab/${filename}`;
  const oldWorkload = byId("workload").value;
  byId("workload").replaceChildren();
  const unique = new Map(run.libraries.flatMap((l) => l.measurements.map((m) => [m.id, m.label])));
  for (const [id, label] of unique) { const option = element("option", "", label); option.value = id; byId("workload").append(option); }
  if (unique.has(oldWorkload)) byId("workload").value = oldWorkload;
  const machine = byId("machine");
  machine.replaceChildren();
  for (const label of [run.environment.cpu, `${run.environment.runtime} · ${run.environment.platform}/${run.environment.arch}`, `${run.methodology.samples} samples + warmup`, new Date(run.timestamp).toLocaleString()]) machine.append(element("span", "", label));
  const source = element("a", "", `source ${run.revision.slice(0, 7)} ↗`);
  source.href = `https://github.com/iamnbutler/crdt-lab/commit/${run.revision}`;
  machine.append(source);
  const table = byId("result-table");
  const heading = element("tr");
  heading.append(element("th", "", "Workload"));
  for (const library of run.libraries) heading.append(element("th", "", library.name));
  table.querySelector("thead").replaceChildren(heading);
  table.querySelector("tbody").replaceChildren();
  for (const [id, label] of unique) {
    const row = element("tr"); row.append(element("th", "", label));
    const values = run.libraries.map((l) => l.measurements.find((m) => m.id === id));
    const min = Math.min(...values.filter((v) => v?.status === "ok").map((v) => v.median));
    for (const value of values) {
      const cell = element("td", value?.status === "ok" && value.median === min ? "best" : "", value?.status === "ok" ? format(value.median, value.unit) : value?.status === "incorrect" ? "Incorrect" : "—");
      if (value?.detail) cell.title = value.detail;
      row.append(cell);
    }
    table.querySelector("tbody").append(row);
  }
  draw();
}

async function load(filename) {
  const id = ++request;
  const response = await fetch(`./lab/${filename}`);
  if (!response.ok) throw new Error("Measurements are not available yet. Check the repository's Actions page.");
  const data = await response.json();
  if (id === request) render(data, filename);
}

byId("workload").addEventListener("change", draw);
byId("run-select").addEventListener("change", () => load(byId("run-select").value).catch((error) => { byId("case-detail").textContent = error.message; }));
try {
  await load("latest.json");
  const response = await fetch("./lab/index.json");
  if (response.ok) {
    const history = await response.json();
    const select = byId("run-select"); select.replaceChildren();
    for (const entry of history) {
      const option = element("option", "", `${new Date(entry.timestamp).toLocaleDateString()} · ${entry.revision.slice(0, 7)} · ${entry.hardware}`);
      option.value = `${entry.id}.json`; select.append(option);
    }
  }
} catch (error) {
  byId("chart").replaceChildren(element("p", "loading error", error.message));
  byId("machine").textContent = "No timings are shown until a verified run is available.";
}
