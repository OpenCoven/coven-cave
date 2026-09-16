// Bundles the native iOS app's markdown renderer into a single self-contained
// HTML file and a lazy local diagram script in CovenCave/Resources. Uses the
// SAME @create-markdown + mermaid packages as desktop, without making ordinary
// messages load and parse the diagram engine.
//
// Run: node scripts/build-ios-markdown.mjs (generated resources are gitignored)

import { build } from "esbuild";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const srcDir = resolve(root, "apps/ios/markdown");
const outHtml = resolve(root, "apps/ios/CovenCave/CovenCave/Resources/markdown.html");
// The CSS is also emitted standalone so the native full-screen zoom view
// (ContentZoom.swift) can restyle a lifted table/diagram to match the chat.
const outCss = resolve(root, "apps/ios/CovenCave/CovenCave/Resources/markdown.css");
const outMermaid = resolve(dirname(outHtml), "markdown-mermaid.js");

const result = await build({
  entryPoints: [resolve(srcDir, "entry.mjs")],
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "safari16",
  minify: true,
  write: false,
  legalComments: "none",
});
const js = result.outputFiles[0].text;
const diagramResult = await build({
  entryPoints: [resolve(srcDir, "mermaid.mjs")],
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "safari16",
  minify: true,
  write: false,
  legalComments: "none",
});
const css = readFileSync(resolve(srcDir, "markdown.css"), "utf8");

const html = `<!doctype html>
<html><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
<style>${css}</style>
</head><body><div id="root"></div>
<script>${js}</script>
</body></html>`;

mkdirSync(dirname(outHtml), { recursive: true });
writeFileSync(outHtml, html);
console.log(`wrote ${outHtml} (${(html.length / 1024).toFixed(0)} KB)`);
writeFileSync(outCss, css);
console.log(`wrote ${outCss} (${(css.length / 1024).toFixed(0)} KB)`);
writeFileSync(outMermaid, diagramResult.outputFiles[0].contents);
console.log(`wrote ${outMermaid} (${(diagramResult.outputFiles[0].contents.byteLength / 1024).toFixed(0)} KB, lazy)`);
