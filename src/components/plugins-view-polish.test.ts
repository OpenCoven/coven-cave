// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL("./plugins-view.tsx", import.meta.url),
  "utf8",
);
const globals = readFileSync(
  new URL("../app/globals.css", import.meta.url),
  "utf8",
);

// Keyboard hint footer (matches the terminal/inbox/calendar/library/home/browser pattern).
assert.match(
  source,
  /\/ focus search · click a role to manage · toggle the eye to activate/,
  "renders the keyboard hint footer below the scrolling content",
);

// Hero headline slimmed from 22px to 18px.
assert.match(
  source,
  /text-\[18px\] font-semibold text-\[var\(--text-primary\)\][\s\S]{0,160}HERO_HEADLINE\[tab\]/,
  "hero headline uses text-[18px]",
);
assert.doesNotMatch(
  source,
  /text-\[22px\] font-semibold text-\[var\(--text-primary\)\][\s\S]{0,160}HERO_HEADLINE\[tab\]/,
  "hero headline no longer uses text-[22px]",
);

// Section header no longer duplicates the count.
assert.doesNotMatch(
  source,
  /\{roles\.length\} installed[\s\S]{0,50}<\/span>/,
  "section header no longer renders the duplicate roles-count span",
);
assert.doesNotMatch(
  source,
  /\{skills\.length\} installed[\s\S]{0,50}<\/span>/,
  "section header no longer renders the duplicate skills-count span",
);
assert.doesNotMatch(
  source,
  /\{marketplacePlugins\.length\} available[\s\S]{0,50}<\/span>/,
  "section header no longer renders the duplicate plugins-count span",
);

// `/` keydown handler is wired and focuses the search input.
assert.match(
  source,
  /searchRef\s*=\s*useRef<HTMLInputElement/,
  "search input ref is declared",
);
assert.match(
  source,
  /e\.key !== "\/"/,
  "keydown handler gates on the `/` key",
);
assert.match(
  source,
  /searchRef\.current\?\.focus\(\)/,
  "keydown handler focuses the search input",
);
assert.match(
  source,
  /tag === "INPUT" \|\| tag === "TEXTAREA"/,
  "keydown handler skips when an input/textarea is already focused",
);

// The search input picks up the ref.
assert.match(
  source,
  /ref=\{searchRef\}[\s\S]{0,160}type="search"/,
  "search input wires ref={searchRef}",
);

assert.match(source, /plugins-view/, "Plugins/Roles surface should expose a mobile hit-area root hook");
assert.match(source, /plugins-role-card/, "Role cards should expose a mobile hit-area hook");
assert.match(source, /plugins-role-toggle/, "Role activation toggles should expose a mobile hit-area hook");
assert.match(
  globals,
  /@media \(max-width: 767px\) \{[\s\S]*\.plugins-view button,[\s\S]*\.plugins-view \[role="button"\][\s\S]*min-height:\s*var\(--touch-target\)/,
  "Plugins/Roles mobile controls should meet the shared touch target",
);
assert.match(
  globals,
  /@media \(max-width: 767px\) \{[\s\S]*\.plugins-role-toggle\s*\{[\s\S]*width:\s*var\(--touch-target\)[\s\S]*min-width:\s*var\(--touch-target\)/,
  "Role activation toggles should be square-enough touch targets on mobile",
);

console.log("plugins-view-polish.test.ts OK");
