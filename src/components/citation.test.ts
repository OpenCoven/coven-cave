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
  assert.match(citation, /var\(--accent-presence\)/, "citations use the accent-presence hue");
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
  assert.match(bubble, /cited\.citations\.length > 0 \? <CitationSources citations=\{cited\.citations\}/, "sources render as a footer");
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
