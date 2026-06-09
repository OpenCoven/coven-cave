import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(resolve(here, "./inspector-pane.tsx"), "utf8");

test("outer tab nav is a WAI-ARIA tablist with rounded underline", () => {
  assert.match(src, /role="tablist"[^>]*aria-label="Inspector sections"/, "outer nav has tablist role + label");
  assert.match(src, /role="tab"/, "tabs have role=tab");
  assert.match(src, /aria-selected=\{isActive\}/, "aria-selected wired");
  assert.match(src, /after:h-\[2px\]/, "2px underline pseudo-element");
  assert.match(src, /after:rounded-full/, "rounded underline");
});

test("inbox badge is softened from danger to warning tone", () => {
  assert.doesNotMatch(
    src,
    /bg-\[var\(--color-danger\)\] px-1 text-\[9px\] font-bold text-white/,
    "old red danger pill removed",
  );
  assert.match(
    src,
    /bg-\[color-mix\(in_oklch,var\(--color-warning\)_28%,transparent\)\]/,
    "warning-tinted soft badge present",
  );
});

test("InspectorEmpty helper is defined and used for the three no-familiar/error states", () => {
  assert.match(src, /function InspectorEmpty\(/, "helper declared");
  const usages = src.match(/<InspectorEmpty\b/g) ?? [];
  assert.ok(usages.length >= 3, `expected >=3 usages, got ${usages.length}`);
  assert.match(src, /icon="ph:bell"\s+title="No familiar selected"/, "inbox empty state");
  assert.match(src, /icon="ph:sparkle"\s+title="No familiar selected"/, "familiar empty state");
  assert.match(src, /icon="ph:warning"\s+title="Memory unavailable"/, "memory error state");
});

test("memory inner mode toggle uses the same tablist + 2px underline idiom", () => {
  assert.match(src, /role="tablist"\s+aria-label="Memory mode"/, "memory mode tablist present");
  // Should no longer use the old pill background for active mode
  assert.doesNotMatch(
    src,
    /mode === m\s*\n[\s\S]*?bg-\[color-mix\(in_oklch,var\(--accent-presence\)_15%,transparent\)\]/,
    "old pill background removed",
  );
});

test("inbox card gets fired-state visual emphasis + hover affordance", () => {
  // Fired cards: warning-tinted border + bg
  assert.match(
    src,
    /border-\[color-mix\(in_oklch,var\(--color-warning\)_45%,var\(--border-hairline\)\)\]/,
    "fired card uses warning-tinted border",
  );
  // Default cards: hover state on bg-raised
  assert.match(src, /hover:bg-\[var\(--bg-raised\)\]\/70/, "default cards have hover state");
  // Cards have a stable class hook for tests/screenshot diffs
  assert.match(src, /inspector-inbox-card/, "stable class hook present");
});

test("inspector empty helper imports IconName for type-safe icon prop", () => {
  assert.match(src, /import \{ Icon, type IconName \} from "@\/lib\/icon"/, "IconName imported");
  assert.match(src, /icon: IconName;/, "InspectorEmpty.icon typed as IconName");
});
