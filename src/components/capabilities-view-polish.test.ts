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
  /text-\[18px\] font-semibold text-\[var\(--text-primary\)\][\s\S]{0,160}Runtime capabilities/,
  "hero headline uses text-[18px]",
);
assert.doesNotMatch(
  source,
  /text-\[20px\] font-semibold text-\[var\(--text-primary\)\][\s\S]{0,160}Runtime capabilities/,
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

// Marketplace Capabilities should answer the operator's first decision before
// the dense map: what scope is visible, what needs attention, when it was
// scanned, and what the next useful action is.
assert.match(
  source,
  /function capabilityDecisionSummary\(/,
  "Capabilities should derive a compact operator decision summary",
);
assert.match(
  source,
  /<CapabilityDecisionSummary items=\{decisionItems\} \/>/,
  "Capabilities should render the decision summary before filters and the map",
);
assert.match(
  source,
  /aria-label="Capability decision summary"/,
  "Capabilities decision summary should have a stable accessible label",
);
assert.match(
  source,
  /Visible scope[\s\S]*Needs attention[\s\S]*Last scan[\s\S]*Next action/,
  "Capabilities decision summary should expose scope, attention, scan, and next-action cards",
);
assert.match(
  globals,
  /\.capabilities-decision\s*\{[\s\S]*grid-template-columns:\s*repeat\(4, minmax\(0, 1fr\)\)/,
  "Capabilities decision summary should use a four-card responsive grid",
);
assert.match(
  globals,
  /\.capabilities-decision__card\s*\{[\s\S]*border-radius:\s*8px;/,
  "Capabilities decision cards should use the marketplace 8px card radius",
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

// Full-size skill/instructions preview: inspector exposes an Expand control that
// opens a reader-scale modal rendering the same markdown body.
assert.match(
  source,
  /function CapabilityPreviewModal\(/,
  "inspector should ship a full-size preview modal",
);
assert.match(
  source,
  /aria-label="Open full-size preview"/,
  "skill preview should expose an Expand control with an accessible name",
);
assert.match(
  source,
  /ph:arrows-out-simple/,
  "Expand control should use the expand affordance icon",
);
assert.match(
  source,
  /role="dialog"[\s\S]{0,120}aria-modal="true"/,
  "full-size preview should be a modal dialog",
);
assert.match(
  source,
  /useFocusTrap\(true, dialogRef, \{ onEscape: onClose \}\)/,
  "full-size preview traps focus and closes on Escape via the shared useFocusTrap hook",
);
assert.match(
  source,
  /useEffect\(\(\) => \{\s*setCopiedKey\(null\);\s*\}, \[selectionId\]\)/,
  "the 'Copied' feedback resets when switching capabilities (not field-keyed across items)",
);
assert.match(
  source,
  /<MarkdownBlock text=\{body\} className="cave-md--expanded"/,
  "full-size preview should render markdown at reader scale",
);

assert.match(source, /capabilities-view/, "Capabilities surface should expose a mobile hit-area root hook");
assert.match(
  globals,
  /@media \(max-width: 767px\) \{[\s\S]*\.capabilities-view button,[\s\S]*\.capabilities-view \[aria-haspopup="menu"\],[\s\S]*\.capabilities-view label:has\(input\)[\s\S]*min-height:\s*var\(--touch-target\)/,
  "Capabilities mobile controls should meet the shared touch target",
);

// Inspector chip row: the type/status/harness chips must sit in a flex row that
// centers (not stretches) its items, so the blanket mobile touch-target height
// can't inflate the badges into circular blobs next to the taller harness chip.
assert.match(
  source,
  /className="capability-chips flex flex-wrap items-center gap-1\.5"/,
  "inspector chip row should be a center-aligned wrapping flex row hooked as .capability-chips",
);
assert.match(
  globals,
  /\.capability-meta-row\s*\{[\s\S]*grid-template-columns:\s*repeat\(auto-fit, minmax\(min\(100%, 12rem\), 1fr\)\);[\s\S]*border-top:\s*1px solid var\(--border-hairline\)/,
  "inspector metadata should auto-fit into one compact row when width allows",
);
assert.match(
  globals,
  /\.capability-meta-value\s*\{[\s\S]*text-overflow:\s*ellipsis;[\s\S]*white-space:\s*nowrap;/,
  "inspector metadata values should stay collapsed instead of expanding row height",
);
// Both static badges and the interactive harness chip render as centered pills.
assert.match(
  source,
  /inline-flex items-center rounded-full px-2 py-0\.5 text-\[10px\] \$\{badgeClass\(tone\)\}/,
  "Badge should be a centered rounded pill (inline-flex items-center)",
);
assert.match(
  source,
  /inline-flex items-center rounded-full border border-border px-2 py-0\.5 text-\[10px\]/,
  "harness chip should match the badge pill shape (centered, rounded, py-0.5)",
);
// Mobile: the chip row's interactive button opts out of the 44px blanket so it
// stays a compact pill instead of a rounded-full circle.
assert.match(
  globals,
  /@media \(max-width: 767px\) \{[\s\S]*\.capabilities-view \.capability-chips button \{[\s\S]*min-height:\s*0/,
  "mobile chip-row buttons should reset the blanket min-height to stay compact pills",
);

// Preview fallback prose still has a clamped reader, while inline inspector
// metadata stays collapsed into compact one-line fields.
assert.match(source, /function ClampedValue/, "inspector should have a ClampedValue component");
assert.match(source, /line-clamp-3/, "clamped value collapses to 3 lines via line-clamp-3");
assert.match(source, /expanded \? "block" : "line-clamp-3"/, "display must toggle (block when expanded) so the clamp actually applies");
assert.match(source, /Show more|Show less/, "clamp exposes a Show more/Show less toggle");
assert.match(source, /<InspectorMetaItem label="Detail" value=\{item\.description\}/, "the Detail metadata field is collapsed into the inline meta row");
assert.match(source, /<InspectorMetaItem label="Warning" value=\{item\.warningMessage\} tone="warning"/, "Warning metadata stays collapsed but keeps warning tone");

// ── Announcements (cave-vmj8) ────────────────────────────────────────────────
// Refresh and copy were visual-only — spinner, "Scanned N ago", and the
// copied-check flash said nothing to screen readers.
assert.match(source, /const \{ announce \} = useAnnouncer\(\)/, "the surface uses the shared announcer");
assert.match(source, /if \(refresh\) announce\("Refreshing capabilities…"\)/, "user-triggered refresh announces start (mount load stays quiet)");
assert.match(source, /announce\(`Capabilities refreshed — \$\{harness\.length \+ skills\.length\} items\.`\)/, "refresh success announces the item count");
assert.match(source, /announce\(`Capabilities refresh failed: \$\{msg\}`, "assertive"\)/, "refresh failures announce assertively");
assert.match(source, /announce\(`Copied \$\{key\}\.`\)/, "copy success is announced");

console.log("capabilities-view-polish.test.ts OK");
