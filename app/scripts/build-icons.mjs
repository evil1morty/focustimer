// Rasterize the source SVG into a 1024x1024 PNG, then ask the Tauri CLI
// to generate the full per-platform icon set (.ico, .icns, multi-size PNGs).
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { Resvg } from "@resvg/resvg-js";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const srcSvg = resolve(root, "branding", "icon.svg");
const outDir = resolve(root, "branding");
const outPng = resolve(outDir, "icon.png");

if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

const svg = readFileSync(srcSvg);
const resvg = new Resvg(svg, { fitTo: { mode: "width", value: 1024 } });
const png = resvg.render().asPng();
writeFileSync(outPng, png);
console.log(`Rendered ${outPng} (${png.length} bytes)`);

console.log("Generating per-platform icons via tauri CLI…");
const result = spawnSync("npx", ["tauri", "icon", outPng], {
  cwd: root,
  stdio: "inherit",
  shell: true,
});
process.exit(result.status ?? 0);
