import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// The native chat markdown should colour inline code / links / list markers off
// the *selected* desktop theme's accent, not a fixed lavender. The accent flows:
//   ChromePalette.accentHex (from --accent-presence)
//     → MessageBubble passes it to MarkdownWebView
//     → MarkdownWebView hands it to caveRender/caveStyle as `accent`
//     → entry.mjs applyAccent() overrides the CSS --accent
//     → markdown.css inline code is color-mixed off var(--accent), so it follows.
// This test locks each link of that chain (source-text) so a refactor can't
// silently drop it. The runtime colour behaviour is covered by a headless render.

const read = (p) => readFile(new URL(`../${p}`, import.meta.url), "utf8");

const base = "apps/ios/CovenCave/CovenCave";
const theme = await read(`${base}/Theme/Theme.swift`);
const bubble = await read(`${base}/Views/MessageBubble.swift`);
const webview = await read(`${base}/Views/MarkdownWebView.swift`);
const entry = await read("apps/ios/markdown/entry.mjs");
const css = await read("apps/ios/markdown/markdown.css");

// --- ChromePalette exposes the published accent as a hex --------------------
assert.match(
  theme,
  /var accentHex: String\?/,
  "ChromePalette should expose the accent as a hex string for the WebView",
);
assert.match(
  theme,
  /Color\(hex: t\["--accent-presence"\]\)\s*\{[^}]*accentHex = t\["--accent-presence"\]/,
  "ChromePalette.init(snapshot:) should capture the --accent-presence hex into accentHex",
);

// --- MessageBubble threads the chrome accent into the renderer --------------
assert.match(
  bubble,
  /@Environment\(\\\.chrome\) private var chrome/,
  "MessageBubble should read the chrome palette from the environment",
);
assert.match(
  bubble,
  /accentHex: chrome\.accentHex/,
  "MessageBubble should pass chrome.accentHex to MarkdownWebView",
);

// --- MarkdownWebView carries accentHex into the JS options ------------------
assert.match(
  webview,
  /var accentHex: String\? = nil/,
  "MarkdownWebView should accept an optional accentHex",
);
assert.match(
  webview,
  /"accent": o\.accentHex \?\? ""/,
  "MarkdownWebView should pass the accent into the caveRender opts",
);
assert.match(
  webview,
  /accent:\\\(accent\)/,
  "MarkdownWebView should pass the accent into the style-only caveStyle call",
);
// A style-only accent change must re-style without a full re-render.
assert.match(
  webview,
  /let styleKey = .*accentHex \?\? ""/,
  "An accent change should be part of the style key (re-styles in place)",
);

// --- entry.mjs overrides --accent from the published accent -----------------
assert.match(
  entry,
  /function applyAccent\(accent\)/,
  "entry.mjs should define applyAccent to override --accent",
);
assert.match(
  entry,
  /setProperty\("--accent",/,
  "applyAccent should set the CSS --accent custom property",
);
// Validates the hex so junk/empty cleanly falls back to the per-theme accent.
assert.match(
  entry,
  /\[0-9a-fA-F\]\{6\}/,
  "applyAccent should validate the accent is a hex before applying it",
);
assert.match(
  entry,
  /applyStyle[\s\S]*applyAccent\(accent\)/,
  "applyStyle should call applyAccent so renders and style-only updates both apply it",
);

// --- markdown.css derives inline code off --accent --------------------------
assert.match(
  css,
  /--code-inline-bg: color-mix\(in srgb, var\(--accent\)/,
  "inline code background should be color-mixed off var(--accent)",
);
assert.match(
  css,
  /--code-inline-fg: color-mix\(in srgb, var\(--accent\)/,
  "inline code text should be color-mixed off var(--accent)",
);

console.log("ios-markdown-accent: OK");
