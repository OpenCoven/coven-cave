// @ts-nocheck
// Command-palette polish contracts (cave-4gg0): dead scope tabs hidden,
// affordance labels on the active row only, one mono keycap idiom, touch
// ergonomics, and a glass contrast floor over scene backdrops.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./command-palette.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

// ── Zero-count scope tabs hide (except "all" and the active scope) ──────────
assert.match(
  source,
  /PALETTE_CATEGORIES\.filter\(\s*\n[\s\S]{0,300}?option === "all" \|\| option === category \|\| counts\[option\] > 0,?\s*\n\s*\)\.map/,
  "Zero-count scope tabs are hidden; 'all' and the active scope always stay",
);

// ── Right-edge affordance labels render on the active row only ──────────────
for (const label of ["switch", "card", "memory", "file", "open", "run", "create", "ask"]) {
  assert.match(
    source,
    new RegExp(`\\{active \\? <span className="text-\\[10px\\] text-\\[var\\(--text-muted\\)\\]">${label}</span> : null\\}`),
    `'${label}' affordance label renders only on the active row (Raycast idiom)`,
  );
}
// Data-bearing right edges (session age, match counts) must NOT be gated.
assert.match(
  source,
  /<span className="shrink-0 text-\[10px\] text-\[var\(--text-muted\)\]">\{sessionAgo \|\| "open"\}<\/span>/,
  "Session recency stays visible on every row — it's data, not affordance",
);

// ── One mono keycap idiom ────────────────────────────────────────────────────
assert.match(
  source,
  /<kbd className="palette-kbd touch-hidden">\{platformizeHint\(row\.shortcut, keys\)\}<\/kbd>/,
  "Shortcut rows use the shared keycap chip (hidden on touch)",
);
assert.match(
  source,
  /<kbd className="palette-kbd">\{keys\.up\}\{keys\.down\}<\/kbd> navigate/,
  "Footer nav hints use keycap chips",
);
assert.match(
  source,
  /<kbd className="palette-kbd">\{keys\.mod\}K<\/kbd>/,
  "Footer ⌘K hint uses a keycap chip",
);
assert.match(
  css,
  /\.palette-kbd \{[\s\S]{0,400}?font-family: var\(--font-mono\), ui-monospace, monospace;/,
  "Keycap chip is mono via the shared token",
);

// ── Touch ergonomics: desktop keyboard vocabulary hides on coarse pointers ──
assert.match(
  source,
  /<span className="touch-hidden flex items-center gap-1">\s*\n\s*<kbd className="palette-kbd">\{keys\.up\}/,
  "The footer's keyboard-hint cluster is touch-hidden",
);
assert.match(
  css,
  /@media \(hover: none\) and \(pointer: coarse\) \{\s*\n\s*\.touch-hidden \{\s*\n\s*display: none !important;/,
  ".touch-hidden hides under the same coarse-pointer guard as .touch-always-visible",
);

// ── Glass contrast floor over scenes ─────────────────────────────────────────
assert.match(
  css,
  /html\[data-backdrop-on\] \.glass-overlay \{\s*\n\s*background: color-mix\(in oklch, var\(--bg-elevated\) 88%, transparent\);/,
  "While a scene backdrop is frontmost the palette glass gets an 88% contrast floor",
);

console.log("command-palette-polish.test.ts: ok");
