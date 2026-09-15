const byId = (id) => document.getElementById(id);
const integer = new Intl.NumberFormat("en-US");
const fixed = (value) => value.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const format = (value, unit = "ms") => {
  if (value === null || value === undefined) return "—";
  if (unit === "bytes") return value < 1024 ? `${integer.format(value)} B` : `${fixed(value / 1024)} KiB`;
  if (value < 1) return `${fixed(value * 1000)} µs`;
  if (value >= 1000) return `${(value / 1000).toFixed(2)} s`;
  return `${fixed(value)} ms`;
};
const element = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};
const link = (text, href, className) => {
  const node = element("a", className, text);
  node.href = href;
  return node;
};
const libraryName = (library) => library.id === "run" ? "@iamnbutler/crdt" : library.name;
const measurement = (library, id) => library?.measurements.find((value) => value.id === id);
const valid = (value) => value?.status === "ok" && Number.isFinite(value.median);
const shortNames = { append: "insert at end", prepend: "insert at start", random: "random edits", live: "live trace", "encode-changed": "encode after edit", encode: "encode unchanged", decode: "load state", size: "state size", merge: "merge peers", trace: "trace replay" };
const order = ["append", "prepend", "random", "live", "encode-changed", "encode", "decode", "size", "merge", "trace"];
const cache = new Map();
let history = [];
let current;
let generation = 0;

function cases(run) {
  const result = new Map(run.libraries.flatMap((library) => library.measurements.map((value) => [value.id, value])));
  return [...result.values()].sort((a, b) => {
    const left = order.indexOf(a.id);
    const right = order.indexOf(b.id);
    return (left < 0 ? order.length : left) - (right < 0 ? order.length : right);
  });
}

function renderOverview(run) {
  const workloads = cases(run);
  const table = byId("overview-table");
  const headings = element("tr");
  const label = element("th", "", "Library");
  label.scope = "col";
  headings.append(label);
  for (const workload of workloads) {
    const cell = element("th");
    cell.scope = "col";
    cell.append(link(shortNames[workload.id] ?? workload.label, `#case-${workload.id}`));
    headings.append(cell);
  }
  table.querySelector("thead").replaceChildren(headings);
  const body = table.querySelector("tbody");
  body.replaceChildren();
  for (const library of run.libraries) {
    const row = element("tr");
    const name = element("th", "", library.id === "run" ? "crdt" : libraryName(library));
    name.scope = "row";
    name.title = `${libraryName(library)} ${library.version}`;
    row.append(name);
    for (const workload of workloads) {
      const value = measurement(library, workload.id);
      const best = Math.min(...run.libraries.map((peer) => measurement(peer, workload.id)).filter(valid).map((value) => value.median));
      const cell = element("td");
      if (valid(value)) {
        cell.textContent = format(value.median, value.unit);
        if (value.median === best) cell.className = "best";
        cell.title = `${value.median === best ? "Lowest verified median. " : ""}Range: ${format(value.min, value.unit)}–${format(value.max, value.unit)}`;
      } else {
        cell.textContent = value?.status === "incorrect" ? "incorrect" : "—";
        cell.className = value?.status === "incorrect" ? "invalid" : "unavailable";
        cell.title = value?.detail ?? "Not measured";
      }
      row.append(cell);
    }
    body.append(row);
  }
}

function comparable(a, b) {
  return a.environment.hardware === b.environment.hardware &&
    a.environment.runtime === b.environment.runtime &&
    a.environment.os === b.environment.os &&
    a.fixture.sha256 === b.fixture.sha256 &&
    a.quick === b.quick &&
    JSON.stringify(a.methodology) === JSON.stringify(b.methodology);
}

function renderDetails(run, previous) {
  const parent = byId("workload-results");
  parent.replaceChildren();
  for (const workload of cases(run)) {
    const section = element("article", "workload");
    section.id = `case-${workload.id}`;
    const heading = element("div", "workload-heading");
    const title = element("h3", "", workload.id);
    title.append(element("span", "", "smaller is better"));
    heading.append(title);
    section.append(heading);
    const sample = run.libraries.map((library) => measurement(library, workload.id)).find(valid);
    section.append(element("p", "workload-detail", `${sample?.label ?? workload.label}. ${sample?.detail ?? workload.detail}`));
    const scroll = element("div", "table-scroll");
    scroll.tabIndex = 0;
    scroll.setAttribute("role", "region");
    scroll.setAttribute("aria-label", `${workload.label} results`);
    const table = element("table", "detail-table");
    const thead = element("thead");
    const headings = element("tr");
    for (const name of ["Benchmark", "mean", "p50", "min–max", "comparison (p50)", "vs prev"]) {
      const cell = element("th", "", name);
      cell.scope = "col";
      headings.append(cell);
    }
    thead.append(headings);
    const tbody = element("tbody");
    const max = Math.max(...run.libraries.map((library) => measurement(library, workload.id)).filter(valid).map((value) => value.median));
    for (const library of run.libraries) {
      const value = measurement(library, workload.id);
      const row = element("tr");
      const name = element("th", "", libraryName(library));
      name.scope = "row";
      name.title = library.version;
      row.append(name);
      if (!valid(value)) {
        const failure = element("td", `failure-detail ${value?.status === "incorrect" ? "invalid" : "unavailable"}`, value?.detail ?? "Not measured.");
        failure.colSpan = 5;
        row.append(failure);
        tbody.append(row);
        continue;
      }
      const mean = value.samples.reduce((sum, sample) => sum + sample, 0) / value.samples.length;
      row.append(element("td", "", format(mean, value.unit)), element("td", "median", format(value.median, value.unit)), element("td", "", `${format(value.min, value.unit)}–${format(value.max, value.unit)}`));
      const cell = element("td", "comparison-cell");
      const comparison = element("div", "comparison");
      const track = element("div", "bar-track");
      track.setAttribute("aria-hidden", "true");
      const bar = element("div", `bar${library.id === "run" ? " own" : ""}`);
      bar.style.setProperty("--width", `${max > 0 ? value.median / max * 100 : 0}%`);
      track.append(bar);
      comparison.append(track, element("span", "muted", format(value.median, value.unit)));
      cell.append(comparison);
      row.append(cell);
      const delta = element("td", "muted", "—");
      const oldLibrary = previous?.libraries.find((candidate) => candidate.id === library.id);
      const old = measurement(oldLibrary, workload.id);
      if (valid(old) && old.median > 0 && old.unit === value.unit && old.operations === value.operations && old.detail === value.detail && (library.id === "run" || oldLibrary.version === library.version)) {
        const percent = (value.median / old.median - 1) * 100;
        delta.textContent = `${percent > 0 ? "+" : ""}${fixed(percent)}%`;
        delta.className = percent < 0 ? "change-faster" : percent > 0 ? "change-slower" : "muted";
        delta.title = `Previous median ${format(old.median, value.unit)} at ${previous.revision.slice(0, 7)}. Negative is better.`;
      }
      row.append(delta);
      tbody.append(row);
    }
    table.append(thead, tbody);
    scroll.append(table);
    section.append(scroll);
    parent.append(section);
  }
}

function renderHistory() {
  const body = byId("history-table").querySelector("tbody");
  body.replaceChildren();
  for (const entry of history) {
    const row = element("tr", entry.id === current?.id ? "history-current" : "");
    const date = element("td");
    const button = element("button", "history-open", new Date(entry.timestamp).toISOString().replace("T", " ").slice(0, 19));
    button.type = "button";
    button.addEventListener("click", () => {
      byId("run-select").value = `${entry.id}.json`;
      selectRun(`${entry.id}.json`);
    });
    date.append(button);
    const source = element("td");
    source.append(link(entry.revision.slice(0, 7), `https://github.com/iamnbutler/crdt/commit/${entry.revision}`));
    const raw = element("td");
    raw.append(link("JSON", `./lab/${entry.id}.json`));
    row.append(date, source, element("td", "", entry.hardware), raw);
    body.append(row);
  }
}

function render(run, filename) {
  current = run;
  const count = history.length || 1;
  byId("environment").textContent = `${count} ${count === 1 ? "run" : "runs"} — ${run.environment.runtime.toLowerCase()} — ${run.environment.arch}-${run.environment.platform} — ${run.environment.cpu}`;
  byId("raw-link").href = `./lab/${filename}`;
  byId("method-summary").textContent = `${run.methodology.samples} samples after one full warmup; libraries run sequentially in separate processes. Green marks the lowest verified median per workload.`;
  byId("library-versions").textContent = run.libraries.map((library) => `${libraryName(library)} ${library.version}`).join(" · ");
  byId("machine-details").textContent = `${run.environment.cpu}, ${run.environment.runtime}, ${run.environment.platform} ${run.environment.os}, ${run.environment.arch}.`;
  byId("validation").textContent = `${integer.format(run.validation?.passed ?? 0)} tests passed before this run. Exact edit and decoded text checked; merged peers must converge.`;
  const title = byId("results-title");
  title.replaceChildren(document.createTextNode(`${history[0]?.id === run.id || history.length === 0 ? "Latest Run" : "Recorded Run"} (`), link(run.revision.slice(0, 7), `https://github.com/iamnbutler/crdt/commit/${run.revision}`, "source-link"), document.createTextNode(")"));
  byId("run-date").textContent = new Date(run.timestamp).toISOString().replace("T", " ").slice(0, 19) + " UTC";
  renderOverview(run);
  renderDetails(run);
  renderHistory();
  byId("comparison-note").textContent = "No previous comparable run. “vs prev” requires the same machine, runtime, OS, fixture, and measurement method.";
  byId("load-status").hidden = true;
  byId("report").hidden = false;
}

async function read(filename) {
  if (!cache.has(filename)) {
    const response = await fetch(`./lab/${filename}`);
    if (!response.ok) throw new Error(`Could not load ${filename} (HTTP ${response.status}).`);
    cache.set(filename, await response.json());
  }
  return cache.get(filename);
}

async function loadPrevious(run, token) {
  const candidates = history.filter((entry) => entry.timestamp < run.timestamp && entry.hardware === run.environment.hardware);
  for (const entry of candidates) {
    const previous = await read(`${entry.id}.json`);
    if (token !== generation) return;
    if (!comparable(run, previous)) continue;
    renderDetails(run, previous);
    byId("comparison-note").textContent = `vs prev: ${previous.revision.slice(0, 7)} · ${new Date(previous.timestamp).toISOString().slice(0, 19).replace("T", " ")} UTC. Median change; negative is better. Same environment and methodology; rival versions must match.`;
    return;
  }
}

async function selectRun(filename) {
  const token = ++generation;
  try {
    const run = await read(filename);
    if (token !== generation) return;
    render(run, filename);
    await loadPrevious(run, token);
  } catch (error) {
    if (token !== generation) return;
    byId("load-status").hidden = false;
    byId("load-status").textContent = error.message;
  }
}

byId("run-select").addEventListener("change", () => selectRun(byId("run-select").value));
function openLinkedSection() {
  const target = byId(location.hash.slice(1));
  if (target instanceof HTMLDetailsElement) target.open = true;
}
window.addEventListener("hashchange", openLinkedSection);
openLinkedSection();

try {
  history = await read("index.json");
  const select = byId("run-select");
  if (history.length) {
    select.replaceChildren();
    for (const entry of history) {
      const option = element("option", "", `${new Date(entry.timestamp).toISOString().slice(0, 16).replace("T", " ")} UTC · ${entry.revision.slice(0, 7)} · ${entry.hardware}`);
      option.value = `${entry.id}.json`;
      select.append(option);
    }
  }
  await selectRun(history.length ? `${history[0].id}.json` : "latest.json");
} catch (error) {
  byId("load-status").textContent = `No recorded benchmark data is available. ${error.message}`;
}
