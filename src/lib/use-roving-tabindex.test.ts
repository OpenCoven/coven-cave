// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL("./use-roving-tabindex.ts", import.meta.url),
  "utf8",
);

// Exports the hook and an Orientation type.
assert.match(
  source,
  /export function useRovingTabIndex\s*\(/,
  "hook exports useRovingTabIndex(...)",
);
assert.match(
  source,
  /"horizontal"\s*\|\s*"vertical"\s*\|\s*"both"/,
  "Orientation supports horizontal, vertical, both",
);

// Handles all four arrows + Home + End.
for (const key of ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End"]) {
  assert.match(
    source,
    new RegExp(`"${key}"`),
    `hook handles ${key}`,
  );
}

// Manages tabindex: 0 on active, -1 on rest.
assert.match(
  source,
  /tabIndex\s*=\s*-1|setAttribute\(\s*"tabindex"/,
  "hook sets tabindex on items",
);

// Loop is opt-in (default false to match WAI-ARIA APG composite-widget guidance).
assert.match(
  source,
  /loop\s*[:=]\s*(false|boolean)/,
  "hook exposes loop option, default false",
);

// Filters disabled items so the tab stop never lands on one.
assert.match(
  source,
  /hasAttribute\(\s*"disabled"\s*\)|:not\(\[disabled\]\)/,
  "filters disabled items out of the rove set",
);

// Filters hidden items (offsetParent === null) so the tab stop is visible.
assert.match(
  source,
  /offsetParent/,
  "filters hidden items out of the rove set",
);

// Clamps activeIndex when the item list shrinks.
assert.match(
  source,
  /activeRef\.current\s*>=\s*items\.length|Math\.min\(\s*items\.length\s*-\s*1/,
  "clamps activeIndex when the item list shrinks",
);

// Ignores keystrokes originating in an editable field, so arrow/Home/End move
// the text caret (e.g. an inline rename input) instead of roving focus.
assert.match(
  source,
  /isContentEditable\s*\|\|\s*\/\^\(INPUT\|TEXTAREA\|SELECT\)\$\/\.test\(\s*t\.tagName\s*\)/,
  "does not rove while typing in an input/textarea/select/contentEditable",
);

console.log("use-roving-tabindex.test.ts OK");
