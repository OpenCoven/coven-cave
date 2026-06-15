// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const pane = await readFile(new URL("./browser-pane.tsx", import.meta.url), "utf8");
const globals = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

// ───────── Task 1: Keyboard hint footer + [ shortcut ─────────
assert.match(
  pane,
  /⌘K tabs · ⌘\[ back · ⌘\] forward · ⌘R reload · \[ pin rail/,
  "Footer hint string must list the keyboard shortcuts",
);
assert.match(
  pane,
  /if \(e\.key !== "\["\) return;/,
  "[ keyboard handler must filter on e.key === '['",
);
assert.match(
  pane,
  /setRailPinned\(\(v\) => !v\)/,
  "[ handler must call setRailPinned((v) => !v)",
);
assert.match(
  pane,
  /paneRef\.current\?\.contains\(e\.target as Node\)/,
  "[ handler must be scoped to focus inside the pane",
);

// ───────── Task 2: Tab label legibility ─────────
assert.match(
  pane,
  /\{railExpanded \? \(\s*<span className="w-\[44px\] truncate text-center text-\[10px\] leading-tight">\{title\}<\/span>\s*\) : null\}/,
  "Tab label gated on railExpanded + text-[10px]",
);
assert.doesNotMatch(
  pane,
  /<span className="w-\[44px\] truncate text-center text-\[9px\] leading-tight">/,
  "Old text-[9px] label must be removed",
);

// ───────── Task 3: Wider rail, no collapsed numeric badge ─────────
assert.match(pane, /w-3\.5 hover:w-12 focus-within:w-12/, "Collapsed rail width must be w-3.5");
assert.doesNotMatch(pane, /w-1\.5 hover:w-12 focus-within:w-12/, "Old w-1.5 width must be removed");
assert.match(pane, /minWidth: railExpanded \? 48 : 14/, "minWidth must be 14 when collapsed");
assert.doesNotMatch(
  pane,
  /!railExpanded \? \(\s*<span[\s\S]*?>\s*\{tabs\.length\}\s*<\/span>\s*\) : null/,
  "Collapsed browser rail must not render a numeric tab-count badge",
);
assert.doesNotMatch(
  pane,
  /w-\[2px\] rounded-r-full bg-\[var\(--fg-base\)\]\/20/,
  "Old 2px accent dot must be removed",
);

// ───────── Mobile browser chrome ─────────
assert.match(pane, /browser-toolbar/, "Browser toolbar should expose a stable mobile chrome hook");
assert.match(pane, /browser-toolbar-button/, "Browser toolbar buttons should expose a mobile hook");
assert.match(pane, /browser-address-form/, "Browser address form should expose a mobile hook");
assert.match(pane, /browser-address-input/, "Browser address input should expose a mobile hook");
assert.match(pane, /browser-toolbar-save/, "Browser save button should expose a mobile hook");
assert.match(
  globals,
  /@media \(max-width: 767px\) \{[\s\S]*\.browser-tab-rail\s*\{[\s\S]*display:\s*none/,
  "Mobile browser should hide the hover rail instead of exposing tiny offscreen controls",
);
assert.match(
  globals,
  /@media \(max-width: 767px\) \{[\s\S]*\.browser-toolbar\s*\{[\s\S]*transform:\s*none !important[\s\S]*pointer-events:\s*auto !important/,
  "Mobile browser toolbar should stay visible without relying on hover or keyboard shortcuts",
);
assert.match(
  globals,
  /@media \(max-width: 767px\) \{[\s\S]*\.browser-toolbar-button,[\s\S]*\.browser-toolbar-save\s*\{[\s\S]*width:\s*var\(--touch-target\)[\s\S]*height:\s*var\(--touch-target\)/,
  "Mobile browser toolbar buttons should meet the shared touch target",
);
assert.match(
  globals,
  /@media \(max-width: 767px\) \{[\s\S]*\.browser-address-input\s*\{[\s\S]*min-height:\s*var\(--touch-target\)/,
  "Mobile browser address input should meet the shared touch target",
);

// ───────── Task 4: Quick-open backdrop ─────────
const qo = await readFile(new URL("./browser-quick-open.tsx", import.meta.url), "utf8");
assert.match(qo, /bg-black\/40 backdrop-blur-sm/, "Backdrop must use bg-black/40 + backdrop-blur-sm");
assert.match(qo, /onClick=\{onClose\}/, "Outer container must handle onClick={onClose}");
assert.match(qo, /onClick=\{\(e\) => e\.stopPropagation\(\)\}/, "Inner card must stopPropagation on click");

console.log("browser-polish.test.ts: ok");
