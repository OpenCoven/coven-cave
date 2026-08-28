// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const css = readFileSync(
  new URL("../styles/globals/desktop-chrome.css", import.meta.url),
  "utf8",
);
// One compact top-chrome glyph size, var(--icon-sm) (14px) — shared by the
// menu-bar action/status icons, the notification bell, the search glyph, and
// the sidepanel toggle.
//
// The bell joined this list deliberately: it sits in the same status cluster
// but was omitted, so its glyph fell through to Icon's 1em default and was the
// one control in the bar sized by accident rather than by this rule.
assert.match(
  css,
  /\.menu-bar__task > svg,\s*\n\.menu-bar__status > svg,\s*\n\.menu-bar__group--status \.notification-bell__trigger > svg \{[^}]*width:\s*var\(--icon-sm\)[^}]*height:\s*var\(--icon-sm\)[^}]*\}/,
  "task, status and bell icons are var(--icon-sm)",
);
assert.match(css, /\.menu-bar__search-icon\s*\{[^}]*width:\s*var\(--icon-sm\)[^}]*height:\s*var\(--icon-sm\)[^}]*\}/, "search icon is var(--icon-sm)");
// Action buttons + search input use the design-token body size, not ad-hoc px.
assert.match(
  css,
  /\.menu-bar__new,\s*\n\.menu-bar__task,\s*\n\.menu-bar__status,\s*\n\.menu-bar__group--status \.notification-bell__trigger \{[^}]*font-size:\s*var\(--text-base\)[^}]*\}/,
  "menu-bar buttons use var(--text-base)",
);
assert.match(css, /\.menu-bar__search-input\s*\{[^}]*font-size:\s*var\(--text-base\)[^}]*\}/, "search input uses var(--text-base)");
// The sidepanel/nav toggle glyph stays unified with the action icons.
const iconLib = readFileSync(new URL("../lib/icon.tsx", import.meta.url), "utf8");
assert.match(iconLib, /shellToggle:\s*"var\(--icon-sm\)"/, "sidepanel toggle glyph is var(--icon-sm)");
// The avatar strip is retired (familiar selection is dropdown-only, hosted in
// the chat sidebar header) — no menu-bar avatar tile rules remain.
assert.doesNotMatch(css, /\.menu-bar \.familiar-quickswitch__btn/, "no menu-bar avatar tile rules remain (strip retired)");
// ── Seamless ultra-minimal title bar (cave-r1f5) ─────────────────────────────
// The top strip shares the app canvas — no band color, no border seam — and
// its controls are quiet monochrome: ghost search, borderless icon chips.
assert.match(css, /\.shell-top \{[\s\S]*?background:\s*var\(--bg-base\)[\s\S]*?border-bottom:\s*0/, "shell-top is seamless (canvas background, no border seam)");
assert.match(css, /\.top-bar \{[\s\S]*?background:\s*var\(--bg-base\)[\s\S]*?border-bottom:\s*0/, "mobile top-bar matches the seamless treatment");
// Search is centered in the bar with its pill border always visible (user
// override of the earlier ghost-at-rest treatment) — Codex-style landmark.
assert.match(css, /\.menu-bar__search \{[\s\S]*?position:\s*absolute[\s\S]*?left:\s*50%[\s\S]*?translateX\(-50%\)/, "search is absolutely centered in the title bar");
assert.match(
  css,
  // Phase-D command bar: 557px max, with the side reserves widened for the
  // right status cluster (running pill + bell) joining the action group.
  /\.menu-bar__search \{[\s\S]*?width:\s*min\(557px, 42vw, calc\(100% - 560px\)\)/,
  "centered search reserves symmetric room for the normal desktop action group",
);
assert.match(
  css,
  /\.menu-bar:has\(\.menu-bar__task-label--live\) \.menu-bar__search \{[^}]*width:\s*min\(557px, 42vw, calc\(100% - 692px\)\)/,
  "centered search contracts further while live enrichment progress widens the desktop actions",
);
assert.match(css, /\.menu-bar__search \{[\s\S]*?border:\s*1px solid var\(--border-hairline\)/, "search border is always visible at rest");
assert.match(css, /\.shell-top-history \{/, "history Back/Forward pair has its grouping styles");
assert.match(css, /\.menu-bar__task-label \{\s*\n\s*display:\s*none/, "task labels are CSS-demoted — the bar shows icons only");
assert.match(css, /\.menu-bar__task-label--live \{\s*\n\s*display:\s*inline/, "…except live enrich progress, which is information, not chrome");
// The strip was a hard-coded 30px until the desktop chrome refresh (#4791)
// grew it to 34px so it lines up with the functional toolbar it now shares a
// row with, and moved the number into --shell-native-titlebar-height so the
// rail offsets, panel padding and .shell-top height all derive from one value
// instead of repeating a literal. Pinning "30px" pinned the literal, not the
// promise; the promise is that native macOS still reserves a dedicated strip of
// fixed height, sized from that token.
const nativeTitleStripRule = css.match(
  /^:root\[data-tauri-titlebar\] \.shell-window-titlebar \{[^}]*\}/m,
)?.[0];
assert.ok(nativeTitleStripRule, "native macOS has a dedicated window title strip rule");
assert.match(
  nativeTitleStripRule,
  /flex: 0 0 var\(--shell-native-titlebar-height\);/,
  "the native window title strip is a fixed band sized from --shell-native-titlebar-height",
);
assert.match(
  nativeTitleStripRule,
  /min-height: var\(--shell-native-titlebar-height\);/,
  "…and cannot be squeezed below that height",
);
assert.match(
  css,
  /^:root\[data-tauri-titlebar\] \{[^}]*--shell-native-titlebar-height:\s*\d+px;/m,
  "--shell-native-titlebar-height resolves to a concrete height under the native titlebar",
);
// The toolbar row shares its row with the macOS traffic lights, which are
// inset from the window's TOP edge as well as its leading edge. Only the
// leading inset was accounted for, so the row sat proud of the lights.
//
// Three things have to hold together or the nudge is silently undone:
// the band grows by it, the row pads by it, and min-height tracks the band —
// a leftover `min-height: 34px` floor under border-box would eat the padding
// and leave the row exactly where it started.
const toolbarRule = css.match(/^:root\[data-tauri-titlebar\] \.shell-top \{[^}]*\}/m)?.[0];
assert.ok(toolbarRule, "the native toolbar row has its own rule");
assert.match(
  toolbarRule,
  /padding-top: var\(--titlebar-content-top-nudge, 0px\);/,
  "the toolbar row is nudged onto the traffic-light baseline",
);
assert.match(
  toolbarRule,
  /min-height: var\(--shell-native-titlebar-height\);/,
  "…and its floor tracks the band, so border-box cannot eat the nudge",
);
assert.match(
  css,
  /^:root\[data-tauri-titlebar\] \{[^}]*--titlebar-content-top-nudge:\s*\d+px;/m,
  "the nudge is a concrete pixel value",
);

// Scope. The nudge exists to match a native control that only macOS draws, and
// [data-tauri-titlebar] is set on <html> by the macOS shell alone. Windows,
// Linux and the browser must keep a row centred in its own band — so every
// reference to the token has to sit under that attribute, and the fallback
// keeps it at 0 anywhere the variable is not defined.
for (const [index, line] of css.split("\n").entries()) {
  if (!line.includes("--titlebar-content-top-nudge")) continue;
  if (line.includes("--titlebar-content-top-nudge:")) continue;
  assert.match(
    line,
    /var\(--titlebar-content-top-nudge, 0px\)/,
    `line ${index + 1} reads the nudge without a 0px fallback`,
  );
}
const nudgeDeclaringSelectors = [...css.matchAll(/([^{}]*)\{[^}]*--titlebar-content-top-nudge:/g)]
  .map((match) => match[1].trim().split("\n").pop()?.trim() ?? "");
assert.deepEqual(
  nudgeDeclaringSelectors,
  [":root[data-tauri-titlebar]"],
  "only the macOS shell defines the nudge, so no other platform inherits it",
);
assert.match(
  css,
  /\.menu-bar__new,\s*\n\.menu-bar__task,\s*\n\.menu-bar__status,\s*\n\.menu-bar__group--status \.notification-bell__trigger \{[^}]*width:\s*28px;[^}]*height:\s*28px;/,
  "every desktop titlebar action uses the same 28px square hit target",
);
console.log("menu-bar-icon-size.test.ts passed");
