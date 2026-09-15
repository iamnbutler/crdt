import { rm } from "node:fs/promises";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const outdir = join(root, "dist");
await rm(outdir, { recursive: true, force: true });
const result = await Bun.build({
  entrypoints: [join(root, "src/index.ts")],
  outdir,
  target: "browser",
  sourcemap: "external",
});
if (!result.success) throw new Error(result.logs.join("\n"));
console.log(`Built RunText at ${outdir}`);
