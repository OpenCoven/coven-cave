// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const styles = readFileSync(new URL("../styles/library.css", import.meta.url), "utf8");

assert.match(
  styles,
  /@media \(max-width: 767px\) \{[\s\S]*\.library-shell\s*\{[\s\S]*flex-direction\s*:\s*column/,
  "Library should switch from a desktop split pane to a stacked phone layout",
);

assert.match(
  styles,
  /@media \(max-width: 767px\) \{[\s\S]*\.library-rail\s*\{[\s\S]*overflow-x\s*:\s*auto/,
  "Library collection rail should become a horizontal mobile filter strip",
);

assert.match(
  styles,
  /@media \(max-width: 767px\) \{[\s\S]*\.library-preview\s*\{[\s\S]*display\s*:\s*none/,
  "Library preview pane should not squeeze the list on phones",
);

assert.match(
  styles,
  /@media \(max-width: 767px\) \{[\s\S]*\.library-list-panel(?:--open|)?\s*\{[\s\S]*width\s*:\s*100%/,
  "Library list panel should claim the full phone width",
);

assert.match(
  styles,
  /@media \(max-width: 767px\) \{[\s\S]*\.library-list-toggle\s*\{[\s\S]*display\s*:\s*none/,
  "Library desktop list pin toggle should be hidden on phones",
);

assert.match(
  styles,
  /@media \(max-width: 767px\) \{[\s\S]*\.library-list-content\s*\{[\s\S]*opacity\s*:\s*1[\s\S]*pointer-events\s*:\s*auto/,
  "Library list content should stay visible regardless of desktop pin state on phones",
);

assert.match(
  styles,
  /@media \(max-width: 767px\) \{[\s\S]*\.library-doclist-items\s*\{[\s\S]*padding-bottom\s*:\s*calc\(72px \+ var\(--sai-bottom\)\)/,
  "Library lists should reserve space above the mobile bottom tabs",
);

assert.match(
  styles,
  /@media \(max-width: 767px\) \{[\s\S]*\.library-rail-item\s*\{[\s\S]*min-height\s*:\s*var\(--touch-target\)/,
  "Library rail filter chips should meet the 44px mobile touch target",
);

assert.match(
  styles,
  /@media \(max-width: 767px\) \{[\s\S]*\.library-timeline-header \.ui-search-input,[\s\S]*\.library-timeline-select,[\s\S]*\.library-timeline-filter-button,[\s\S]*\.library-timeline-group-toggle\s*\{[\s\S]*min-height\s*:\s*var\(--touch-target\)/,
  "Library timeline search, filters, and segmented controls should meet the 44px mobile touch target",
);

assert.match(
  styles,
  /@media \(max-width: 767px\) \{[\s\S]*\.library-timeline-group-toggle\s*\{[\s\S]*height\s*:\s*calc\(var\(--touch-target\) \+ 8px\)/,
  "Library timeline segmented control should leave enough room for 44px inner options on phones",
);

assert.match(
  styles,
  /@media \(max-width: 767px\) \{[\s\S]*\.library-timeline-group-toggle-option\s*\{[\s\S]*min-height\s*:\s*var\(--touch-target\)/,
  "Library timeline segmented control options should each meet the 44px mobile touch target",
);

console.log("library-mobile-command-center.test.ts: ok");
