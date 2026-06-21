import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(resolve(here, "./tabs.tsx"), "utf8");

test("shared Tabs exposes WAI-ARIA tablist/tab roles + aria-selected", () => {
  assert.match(src, /role="tablist"/, "tablist role present");
  assert.match(src, /role="tab"/, "tab role present");
  assert.match(src, /aria-selected=\{isActive\}/, "aria-selected wired to active state");
});

test("horizontal tabs use the Vercel underline idiom, not pill backgrounds", () => {
  // 2px rounded underline bar flush on the divider.
  assert.match(src, /after:h-\[2px\]/, "2px underline pseudo-element");
  assert.match(src, /after:rounded-full/, "rounded underline");
  assert.match(src, /after:bg-\[var\(--cv-tab-accent,var\(--text-primary\)\)\]/, "active underline uses accent/text-primary");
  // No rounded-full pill container, no filled accent background on the tab body.
  assert.doesNotMatch(src, /rounded-full bg-\[/, "no filled pill background on tabs");
});

test("inactive tabs are muted and brighten on hover (Vercel behaviour)", () => {
  assert.match(src, /text-\[var\(--text-muted\)\]/, "inactive text is muted");
  assert.match(src, /hover:text-\[var\(--text-secondary\)\]/, "hover brightens text");
});

test("tablist draws the hairline divider unless the parent supplies it", () => {
  assert.match(src, /border-b border-\[var\(--border-hairline\)\]/, "default bordered tablist");
  assert.match(src, /bordered = true/, "bordered defaults true");
  assert.match(src, /bordered\?: boolean|bordered\?:\s*boolean/, "bordered is opt-out");
});

test("vertical variant uses an accent left-border indicator", () => {
  assert.match(src, /orientation === "vertical"/, "supports vertical orientation");
  assert.match(src, /border-l-2/, "vertical active uses a 2px left border");
  assert.match(src, /var\(--cv-tab-accent,var\(--accent-presence\)\)/, "vertical indicator defaults to the presence accent");
});

test("keyboard navigation via roving tabindex is built in", () => {
  assert.match(src, /useRovingTabIndex\(/, "uses the roving tabindex hook");
});

test("selected tab keeps the roving tabindex tab stop in sync", () => {
  assert.match(src, /import \{ useEffect, useRef, type ReactNode \} from "react"/, "imports useEffect");
  assert.match(src, /const \{ setActiveIndex \} = useRovingTabIndex\(/, "captures roving tabindex setter");
  assert.match(src, /useEffect\(\(\) => \{[\s\S]*findIndex\(\(item\) => item\.id === value\)/, "finds the selected enabled tab");
  assert.match(src, /setActiveIndex\(selectedIndex\)/, "moves the tab stop to the selected tab");
});

test("active tab accent is only set when callers provide an override", () => {
  assert.doesNotMatch(src, /t\.accent \?\? "var\(--text-primary\)"/, "does not force a default accent on every active tab");
  assert.match(src, /isActive && t\.accent/, "gates inline accent style on per-tab accent");
  assert.match(src, /\["--cv-tab-accent" as string\]: t\.accent/, "writes the caller-provided accent");
});

test("disabled tabs use native button disabled semantics", () => {
  assert.match(src, /aria-disabled=\{t\.disabled \? true : undefined\}/, "keeps aria-disabled for tab semantics");
  assert.match(src, /disabled=\{t\.disabled\}/, "also disables the native button");
});

test("tabs support optional icon and count badge", () => {
  assert.match(src, /t\.icon \?/, "optional leading icon");
  assert.match(src, /typeof t\.count === "number" \?/, "optional count badge renders when a count is provided");
  assert.doesNotMatch(src, /t\.count > 0/, "zero counts remain visible");
});

test("segment variant uses a rounded bordered container with raised active background", () => {
  assert.match(src, /variant\?: "underline" \| "segment"/, "exposes a segment variant prop");
  assert.match(src, /rounded-lg border border-\[var\(--border-hairline\)\]/, "segment tablist is a bordered rounded container");
  assert.match(src, /bg-\[var\(--cv-tab-accent,var\(--bg-raised\)\)\]/, "active segment tab fills with raised/accent background");
});

test("segment variant keeps tablist/tab roles (a11y not lost in the pill look)", () => {
  assert.match(src, /role="tablist"/, "tablist role still present");
  assert.match(src, /role="tab"/, "tab role still present");
});

console.log("ui/tabs.test.ts OK");
