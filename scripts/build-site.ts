import { cp, mkdir } from "node:fs/promises";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const destination = join(root, "site/dist");
await mkdir(destination, { recursive: true });
for (const name of ["index.html", "style.css", "app.js"]) {
  await cp(join(root, "site", name), join(destination, name));
}
await cp(join(root, "site/public"), destination, { recursive: true });
const result = await Bun.build({
  entrypoints: [join(root, "site/playground.ts")],
  outdir: destination,
  target: "browser",
  minify: true,
  sourcemap: "external",
});
if (!result.success) throw new Error(result.logs.join("\n"));
console.log(`Site built at ${destination}`);
