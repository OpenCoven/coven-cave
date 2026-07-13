import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// cave-t7uz: PR #2970 promoted the Inspector sections to the chat right
// panel's top strip as plain <button>s, dropping the WAI-ARIA tabs contract
// the shared Tabs component used to provide. These pins hold the restored
// semantics: tablist/tab roles, aria-selected, roving arrow-key focus, and
// tabpanel labelling on the pane body.

const here = dirname(fileURLToPath(import.meta.url));
const chatSurface = readFileSync(resolve(here, "./chat-surface.tsx"), "utf8");
const globals = readFileSync(resolve(here, "../app/globals.css"), "utf8");

test("right-panel section strip is a labelled tablist", () => {
  assert.match(
    chatSurface,
    /<div[^>]*role="tablist"[^>]*aria-label="Inspector sections"[^>]*className="right-panel-tablist"/,
    "section buttons are grouped in a labelled tablist container",
  );
  // Debug/close are controls beside the tabs, not co-equal sections — they
  // must stay OUTSIDE the tablist (the icon toggle keeps aria-pressed).
  assert.match(
    chatSurface,
    /right-panel-tab--icon[\s\S]{0,200}aria-pressed=\{primaryPanel === "debug"\}/,
    "debug stays an aria-pressed toggle, not a tab",
  );
});

test("each section button carries the tab role + selection wiring", () => {
  assert.match(
    chatSurface,
    /role="tab"\s+id=\{`right-panel-tab-\$\{sec\.id\}`\}\s+aria-selected=\{active\}\s+aria-controls="right-panel-section-panel"/,
    "tab role, stable id, aria-selected, and aria-controls are wired per section",
  );
  // Selection tracks the inspector being the visible primary panel, so all
  // tabs read unselected while the debug toggle is active.
  assert.match(
    chatSurface,
    /const active = primaryPanel === "inspector" && section === sec\.id;/,
    "aria-selected is false for every tab when debug owns the panel",
  );
});

test("tablist has arrow-key roving focus (WAI-ARIA APG)", () => {
  assert.match(
    chatSurface,
    /useRovingTabIndex\(\{\s*containerRef: tablistRef,\s*itemSelector: '\[role="tab"\]',\s*orientation: "horizontal"/,
    "roving tabindex is installed on the tablist",
  );
  assert.match(
    chatSurface,
    /INSPECTOR_SECTIONS\.findIndex\(\(sec\) => sec\.id === section\);\s*if \(idx >= 0\) setActiveIndex\(idx\)/,
    "the tab stop follows the controlled section",
  );
});

test("pane body is the labelled tabpanel while the inspector is shown", () => {
  assert.match(
    chatSurface,
    /id="right-panel-section-panel"\s+role=\{primaryPanel === "inspector" \? "tabpanel" : undefined\}\s+aria-labelledby=\{primaryPanel === "inspector" \? `right-panel-tab-\$\{section\}` : undefined\}/,
    "tabpanel role + aria-labelledby point at the active section tab (and drop for the debug pane)",
  );
});

test("tablist wrapper keeps the strip shrinkable in narrow sidebars", () => {
  assert.match(
    globals,
    /\.right-panel-tablist\s*\{[^}]*min-width:\s*0[^}]*\}/,
    ".right-panel-tablist allows shrinking so tabs still truncate",
  );
  assert.match(
    globals,
    /\.right-panel-tablist\s*\{[^}]*height:\s*100%[^}]*\}/,
    ".right-panel-tablist preserves the full-height tab hit area",
  );
});
