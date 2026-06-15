// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL("./capabilities-view.tsx", import.meta.url),
  "utf8",
);
const globals = readFileSync(
  new URL("../app/globals.css", import.meta.url),
  "utf8",
);

// Inner "Capabilities · read-only" header bar removed — duplicated the workspace breadcrumb.
assert.doesNotMatch(
  source,
  /<header className="shrink-0 border-b border-border/,
  "inner header bar removed (was duplicating the workspace breadcrumb)",
);
assert.doesNotMatch(
  source,
  /<h1 className="truncate text-\[13px\][\s\S]{0,80}Capabilities<\/h1>/,
  "inner Capabilities <h1> removed",
);

// Hero <h2> slimmed from 20px to 18px.
assert.match(
  source,
  /text-\[18px\] font-semibold text-\[var\(--text-primary\)\][\s\S]{0,160}Harness capabilities/,
  "hero headline uses text-[18px]",
);
assert.doesNotMatch(
  source,
  /text-\[20px\] font-semibold text-\[var\(--text-primary\)\][\s\S]{0,160}Harness capabilities/,
  "hero headline no longer uses text-[20px]",
);

// Refresh + Scanned moved into the hero row (button still wired to load(true)).
assert.match(
  source,
  /title="Refresh \(⌘R\)"/,
  "Refresh button carries a tooltip with the shortcut",
);

// Keyboard hint footer.
assert.match(
  source,
  /⌘R refresh · search narrows the operator map · read-only/,
  "renders the keyboard hint footer below the scrolling content",
);

// ⌘R keydown handler wired to load(true).
assert.match(
  source,
  /e\.metaKey \|\| e\.ctrlKey/,
  "keydown handler checks meta or ctrl modifier",
);
assert.match(
  source,
  /e\.key !== "r" && e\.key !== "R"/,
  "keydown handler gates on the R key",
);
assert.match(
  source,
  /void load\(true\)/,
  "keydown handler triggers a refresh load",
);
assert.match(
  source,
  /tag === "INPUT" \|\| tag === "TEXTAREA"/,
  "keydown handler skips when an input/textarea is focused",
);

assert.match(source, /capabilities-view/, "Capabilities surface should expose a mobile hit-area root hook");
assert.match(
  globals,
  /@media \(max-width: 767px\) \{[\s\S]*\.capabilities-view button,[\s\S]*\.capabilities-view select,[\s\S]*\.capabilities-view label:has\(input\)[\s\S]*min-height:\s*var\(--touch-target\)/,
  "Capabilities mobile controls should meet the shared touch target",
);

console.log("capabilities-view-polish.test.ts OK");
