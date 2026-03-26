#!/usr/bin/env bun
/**
 * Build script for benchmark dashboard.
 * Bundles TypeScript source into a single index.html file.
 *
 * Usage: bun docs/bench/build.ts
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const ROOT = dirname(new URL(import.meta.url).pathname);
const SRC = join(ROOT, "src");
const OUT = join(ROOT, "index.html");

// Read CSS
const css = readFileSync(join(SRC, "styles.css"), "utf-8");

// Bundle TypeScript with Bun
const result = await Bun.build({
  entrypoints: [join(SRC, "main.ts")],
  minify: true,
  target: "browser",
});

if (!result.success) {
  console.error("Build failed:");
  for (const log of result.logs) {
    console.error(log);
  }
  process.exit(1);
}

const js = await result.outputs[0].text();

// Generate HTML
const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>@iamnbutler/crdt — Benchmarks</title>
<style>
${css}
</style>
</head>
<body>
<h1>@iamnbutler/crdt — Benchmark History</h1>
<div id="loading">Loading...</div>
<div id="root" style="display:none"></div>
<script>
${js}
</script>
</body>
</html>
`;

writeFileSync(OUT, html);
console.log(`Built ${OUT}`);
