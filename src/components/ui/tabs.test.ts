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

test("tabs support optional icon and count badge", () => {
  assert.match(src, /t\.icon \?/, "optional leading icon");
  assert.match(src, /t\.count/, "optional count badge");
});

console.log("ui/tabs.test.ts OK");
