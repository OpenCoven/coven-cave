import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const citation = readFileSync(new URL("./ui/citation.tsx", import.meta.url), "utf8");
const bubble = readFileSync(new URL("./message-bubble.tsx", import.meta.url), "utf8");
const research = readFileSync(new URL("./role-surfaces/research-mission-detail.tsx", import.meta.url), "utf8");

test("the Citation UI uses the shared Popover and Cave's accent hue", () => {
  assert.match(citation, /export function CitationMarker/, "exports the inline marker");
  assert.match(citation, /export function CitationSources/, "exports the sources list");
  assert.match(citation, /import \{ Popover, PopoverBody \} from "@\/components\/ui\/popover"/, "the marker opens the shared Popover");
  assert.match(
    citation,
    /createCitationPreviewCoordinator/,
    "source previews coordinate hover and focus across the row and portaled card",
  );
  assert.match(citation, /var\(--accent-presence\)/, "citations use the accent-presence hue");
  assert.match(citation, /showHoverPreview = false/, "sources can opt into hover preview cards");
  assert.match(
    citation,
    /onMouseEnter=\{showHoverPreview \? \(\) => preview\.enter\("row-hover"\) : undefined\}/,
    "rows without previews do not wire hidden hover-open state",
  );
  assert.match(
    citation,
    /onMouseLeave=\{showHoverPreview \? \(\) => preview\.leave\("row-hover"\) : undefined\}/,
    "rows without previews do not wire hidden hover-close state",
  );
  assert.match(
    citation,
    /onFocusCapture=\{showHoverPreview \? \(\) => preview\.enter\("row-focus"\) : undefined\}/,
    "rows without previews do not wire hidden focus-open state",
  );
  assert.match(
    citation,
    /onBlurCapture=\{showHoverPreview \? leaveRowFocus : undefined\}/,
    "rows without previews do not wire hidden focus-close state",
  );
  assert.match(citation, /preview\.enter\("row-hover"\)/, "row hover opens a source preview");
  assert.match(citation, /preview\.leave\("row-hover"\)/, "row hover departure participates in coordinated closing");
  assert.match(citation, /preview\.enter\("row-focus"\)/, "row focus opens a source preview");
  assert.match(citation, /preview\.leave\("row-focus"\)/, "row focus departure participates in coordinated closing");
  assert.match(citation, /preview\.enter\("preview-hover"\)/, "the portaled card can retain the preview across its gap");
  assert.match(citation, /preview\.leave\("preview-hover"\)/, "the portaled card releases hover ownership");
  assert.match(citation, /preview\.enter\("preview-focus"\)/, "focus within the portaled card retains the preview");
  assert.match(citation, /preview\.leave\("preview-focus"\)/, "the portaled card releases focus ownership");
  assert.match(
    citation,
    /const previewTitleIsButton = showHoverPreview && !citation\.url/,
    "URL-less preview rows get a conditional keyboard target",
  );
  assert.match(
    citation,
    /previewTitleIsButton \? \(\s*<button[\s\S]*?type="button"[\s\S]*?aria-haspopup="dialog"/,
    "the URL-less title is a semantic preview button without changing linked rows",
  );
  assert.doesNotMatch(
    citation,
    /<li[\s\S]*?ref=\{anchorRef\}/,
    "the preview anchor is never the non-focusable source row",
  );
  assert.match(
    citation,
    /citation\.url \? \(\s*<a[\s\S]*?ref=\{setAnchorRef\}/,
    "linked previews anchor to the source link so Popover can return focus",
  );
  assert.match(
    citation,
    /previewTitleIsButton \? \(\s*<button[\s\S]*?ref=\{setAnchorRef\}/,
    "URL-less previews anchor to their keyboard target so Popover can return focus",
  );
  assert.match(
    citation,
    /onClick=\{\(\) => \(open \? preview\.dismiss\(\) : preview\.enter\("row-focus"\)\)\}/,
    "the URL-less preview control toggles its aria-expanded dialog",
  );
  assert.match(citation, /ariaLabel=\{`Source \$\{citation\.n\} preview`\}/, "hover previews are announced accessibly");
  // The sources list rows are anchor targets so inline markers can jump to them.
  assert.match(citation, /id=\{citation\.id\}/, "each source row is an anchor target");
  assert.match(citation, /aria-label=\{`Source \$\{citation\.n\}: \$\{citation\.title\}`\}/, "markers are named for screen readers");
  assert.match(citation, /rel="noreferrer"/, "external source links are safe");
});

test("chat renders citations as a footer below the message, not inside the sanitized HTML", () => {
  assert.match(bubble, /import \{ renderCitedBody \} from "@\/lib\/citations"/, "the bubble lifts footnote citations from the body");
  assert.match(bubble, /import \{ CitationSources \} from "@\/components\/ui\/citation"/, "renders the shared sources footer");
  assert.match(bubble, /const cited = useMemo\(\(\) => renderCitedBody\(content\), \[content\]\)/, "citations are parsed once per body");
  // The parsed body (defs stripped, refs rewritten to anchors) feeds the renderer…
  assert.match(bubble, /<MarkdownContent text=\{cited\.body\}/, "the def-stripped body feeds the markdown renderer");
  // …and the sources render as a sibling footer, never inside the HTML string.
  assert.match(
    bubble,
    /cited\.citations\.length > 0 \? <CitationSources citations=\{cited\.citations\} showHoverPreview \/>/,
    "chat opts into hover-preview citation sources",
  );
});

test("research cites the mission's used sources under the synthesis", () => {
  assert.match(research, /import \{ CitationSources \} from "@\/components\/ui\/citation"/, "reuses the shared component");
  assert.match(research, /import \{ sourcesToCitations \} from "@\/lib\/citations"/, "adapts research source rows to citations");
  assert.match(
    research,
    /sourcesToCitations\(mission\.sources\.filter\(\(source\) => source\.status === "used"\)\)/,
    "only the sources the mission actually used are cited",
  );
});
