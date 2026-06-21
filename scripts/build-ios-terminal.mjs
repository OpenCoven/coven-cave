// Bundles the native iOS app's terminal emulator into a single self-contained
// HTML file (apps/ios/CovenCave/CovenCave/Resources/terminal.html) that the
// SwiftUI XtermWebView loads. Uses the SAME xterm.js stack as the desktop
// terminal, so it's a real VT emulator (colours, cursor addressing, TUIs).
//
// Run: node scripts/build-ios-terminal.mjs   (terminal.html is gitignored)

import { build } from "esbuild";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const srcDir = resolve(root, "apps/ios/terminal");
const outHtml = resolve(root, "apps/ios/CovenCave/CovenCave/Resources/terminal.html");

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

// xterm ships its own stylesheet (viewport/cursor/selection layout); inline it
// before our overrides so the emulator renders correctly offline.
const xtermCss = readFileSync(resolve(root, "node_modules/@xterm/xterm/css/xterm.css"), "utf8");
const css = readFileSync(resolve(srcDir, "terminal.css"), "utf8");

const html = `<!doctype html>
<html><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<style>${xtermCss}\n${css}</style>
</head><body><div id="root"></div>
<script>${js}</script>
</body></html>`;

mkdirSync(dirname(outHtml), { recursive: true });
writeFileSync(outHtml, html);
console.log(`wrote ${outHtml} (${(html.length / 1024).toFixed(0)} KB)`);
