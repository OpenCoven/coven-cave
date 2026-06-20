// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const styles = readFileSync(new URL("../styles/library.css", import.meta.url), "utf8");
const view = readFileSync(new URL("./library-view.tsx", import.meta.url), "utf8");
const preview = readFileSync(new URL("./library-doc-preview.tsx", import.meta.url), "utf8");
const mobileStyles = styles.slice(styles.lastIndexOf("@media (max-width: 767px)"));

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
  mobileStyles,
  /\.library-rail-header--actions\s*\{[\s\S]*?display\s*:\s*flex[\s\S]*?position\s*:\s*sticky[\s\S]*?left\s*:\s*0/,
  "Library mobile rail should keep Search, Back, and Refresh visible as a sticky action cluster",
);

assert.match(
  mobileStyles,
  /\.library-rail-header-actions\s*\{[\s\S]*?display\s*:\s*flex/,
  "Library mobile rail action group should stay visible instead of inheriting the hidden header rule",
);

assert.match(
  mobileStyles,
  /\.library-rail-action\s*\{[\s\S]*?min-width\s*:\s*var\(--touch-target\)[\s\S]*?height\s*:\s*var\(--touch-target\)/,
  "Library mobile rail icon actions should meet the 44px touch target",
);

const mobileLibraryPreviewRule = mobileStyles.match(/\.library-preview\s*\{([\s\S]*?)\n  \}/)?.[1] ?? "";
const mobileRailItemRule = mobileStyles.match(/\.library-rail-item\s*\{([\s\S]*?)\n  \}/)?.[1] ?? "";
const mobileSkillToggleRule = mobileStyles.match(/\.library-rail-header--skills \.library-rail-section-toggle\s*\{([\s\S]*?)\n  \}/)?.[1] ?? "";
assert.doesNotMatch(
  mobileLibraryPreviewRule,
  /display\s*:\s*none/,
  "Library mobile preview should not be blanket-hidden after a row is selected",
);

assert.match(
  mobileLibraryPreviewRule,
  /display\s*:\s*flex[\s\S]*width\s*:\s*100%[\s\S]*flex\s*:\s*1 1 auto/,
  "Library selected-item preview should claim the full phone canvas when mounted",
);

assert.match(
  view,
  /const showDetailCanvas = selectedItem !== null && activeSection !== "skills" && activeSection !== "projects"/,
  "Selected Library items should own the center canvas instead of sharing width with the side list",
);

assert.match(
  view,
  /const handleBackToList = useCallback\(\(\) => \{[\s\S]{0,160}setSelectedItem\(null\)[\s\S]{0,120}setTimelineSelectedId\(null\)/,
  "Library back-to-list should use a stable callback instead of an inline preview prop",
);

assert.match(
  view,
  /onBackToList=\{showDetailCanvas \? handleBackToList : undefined\}/,
  "Library back-to-list should only appear when a selected library item replaced a list, not in Skills or Projects",
);

assert.match(
  preview,
  /className="library-preview-return"[\s\S]{0,240}aria-label="Back to library list"/,
  "Library selected-item preview should render a mobile back-to-list affordance",
);

assert.match(
  mobileStyles,
  /\.library-preview-return\s*\{[\s\S]*?display\s*:\s*flex[\s\S]*?min-height\s*:\s*var\(--touch-target\)/,
  "Library mobile selected-item previews should show a 44px back-to-list row above detail content",
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
  mobileRailItemRule,
  /min-height\s*:\s*var\(--touch-target\)/,
  "Library rail filter chips should meet the 44px mobile touch target",
);

assert.match(
  mobileSkillToggleRule,
  /min-height\s*:\s*var\(--touch-target\)/,
  "Library mobile Skills toggle should meet the 44px touch target like the other rail chips",
);

assert.match(
  styles,
  /@media \(max-width: 767px\) \{[\s\S]*\.library-timeline-header \.ui-search-input,[\s\S]*\.library-timeline-select,[\s\S]*\.library-timeline-filter-button,[\s\S]*\.library-timeline-group-toggle\s*\{[\s\S]*min-height\s*:\s*var\(--touch-target\)/,
  "Library timeline search, filters, and segmented controls should meet the 44px mobile touch target",
);

assert.match(
  styles,
  /@media \(max-width: 767px\) \{[\s\S]*\.library-timeline-group-toggle\s*\{[\s\S]*height\s*:\s*var\(--touch-target\)/,
  "Library timeline segmented control should fit the compact mobile filter row",
);

assert.match(
  styles,
  /@media \(max-width: 767px\) \{[\s\S]*\.library-timeline-group-toggle-option\s*\{[\s\S]*min-height\s*:\s*calc\(var\(--touch-target\) - 4px\)/,
  "Library timeline segmented control options should stay compact inside the 44px control",
);

console.log("library-mobile-command-center.test.ts: ok");
