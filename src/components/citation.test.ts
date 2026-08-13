import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const citation = readFileSync(new URL("./ui/citation.tsx", import.meta.url), "utf8");
const bubble = readFileSync(new URL("./message-bubble.tsx", import.meta.url), "utf8");
const domWiring = readFileSync(new URL("./message-dom-wiring.ts", import.meta.url), "utf8");
const research = readFileSync(new URL("./role-surfaces/research-mission-detail.tsx", import.meta.url), "utf8");
const markdownInteractions = readFileSync(new URL("../styles/cave-md/interactions.css", import.meta.url), "utf8");

test("the Citation UI exposes inline provider previews through the shared Popover", () => {
  assert.match(citation, /export function InlineCitationPreviews/, "exports inline citation previews");
  assert.match(citation, /export function CitationSources/, "keeps the research sources list");
  assert.match(
    citation,
    /import \{ Popover, PopoverBody \} from "@\/components\/ui\/popover"/,
    "source previews use the shared Popover",
  );
  assert.match(
    citation,
    /createCitationPreviewCoordinator/,
    "previews coordinate hover and focus across the inline chip and portaled card",
  );
  assert.match(citation, /citationSourcePresentation/, "preview content derives from the shared source classifier");
  assert.match(citation, /var\(--accent-presence\)/, "citations use the accent-presence hue");
  assert.match(
    citation,
    /data-source-kind=\{presentation\.kind\}/,
    "preview cards expose provider kind for distinct treatments",
  );
  assert.match(
    citation,
    /text-\[length:var\(--text-md\)\][\s\S]{0,900}?line-clamp-2 min-w-0/,
    "long source titles stay compact",
  );
  assert.match(
    citation,
    /line-clamp-3[^"]*leading-normal/,
    "source summaries preserve context without dominating the preview",
  );
  assert.match(citation, /presentation\.context/, "provider-specific context is visible in the preview");
  assert.match(
    citation,
    /querySelectorAll<HTMLAnchorElement>\('a\[href\^="#cite-"\]'\)/,
    "only citation anchors in rendered markdown are enhanced",
  );
  assert.match(
    citation,
    /useLayoutEffect\(\(\) => \{[\s\S]{0,1800}?querySelectorAll<HTMLAnchorElement>\('a\[href\^="#cite-"\]'\)[\s\S]{0,500}?classList\.add\("cave-citation-chip"\)/,
    "citation anchors receive their chip behavior in the commit before paint",
  );
  assert.match(
    citation,
    /const wiredLinks = new Map<HTMLAnchorElement, \(\) => void>\(\)[\s\S]{0,1800}?if \(wiredLinks\.has\(link\)\) continue/,
    "citation reconciliation keeps exactly one listener set per anchor",
  );
  assert.match(
    citation,
    /new MutationObserver\(reconcileCitationLinks\)[\s\S]{0,160}?observer\.observe\(container, \{ childList: true, subtree: true \}\)/,
    "late or replaced markdown anchors are enhanced as soon as they enter the document",
  );
  assert.match(
    citation,
    /observer\.disconnect\(\)[\s\S]{0,100}?for \(const cleanup of wiredLinks\.values\(\)\) cleanup\(\)[\s\S]{0,50}?wiredLinks\.clear\(\)/,
    "citation observation and listeners are removed together",
  );
  assert.match(
    citation,
    /renderedHtml: string[\s\S]*?\[activate, citationsById, containerRef, onOpenUrl, preview, renderedHtml\]/,
    "preview wiring reruns when the markdown renderer replaces its injected DOM",
  );
  assert.match(
    citation,
    /classList\.add\("cave-citation-chip"\)/,
    "inline source anchors receive the evidence-chip treatment",
  );
  assert.match(
    citation,
    /dataset\.sourceKind = presentation\.kind/,
    "inline chips expose their provider type",
  );
  assert.match(
    citation,
    /matchMedia\("\(hover: none\)"\)/,
    "touch-only devices tap to preview rather than losing the hover content",
  );
  assert.match(
    citation,
    /event\.stopImmediatePropagation\(\)/,
    "citation clicks do not leak into generic markdown link routing",
  );
  assert.match(citation, /activate\(link, citation, "row-hover"\)/, "chip hover opens a source preview");
  assert.match(citation, /preview\.leave\("row-hover"\)/, "chip hover departure participates in coordinated closing");
  assert.match(citation, /activate\(link, citation, "row-focus"\)/, "chip focus opens a source preview");
  assert.match(citation, /preview\.leave\("row-focus"\)/, "chip focus departure participates in coordinated closing");
  assert.match(citation, /preview\.enter\("preview-hover"\)/, "the portaled card can retain the preview across its gap");
  assert.match(citation, /preview\.leave\("preview-hover"\)/, "the portaled card releases hover ownership");
  assert.match(citation, /preview\.enter\("preview-focus"\)/, "focus within the portaled card retains the preview");
  assert.match(citation, /preview\.leave\("preview-focus"\)/, "the portaled card releases focus ownership");
  assert.match(citation, /onOpenUrl\(citation\.url\)/, "link activation can route through the existing chat URL handler");
  assert.match(citation, /target="_blank"/, "source cards retain a browser fallback without a URL handler");
  assert.match(
    citation,
    /ariaLabel=\{`\$\{presentation\.provider\} source preview`\}/,
    "hover previews are announced accessibly",
  );
  assert.match(citation, /Open source:/, "inline source chips are named for screen readers");
  assert.match(citation, /rel="noreferrer"/, "external source links are safe");
  assert.match(
    markdownInteractions,
    /\.cave-md a\.cave-citation-chip \{[\s\S]*?border-radius: var\(--radius-pill\);/,
    "inline sources use the shared pill shape",
  );
  assert.match(
    markdownInteractions,
    /\.cave-md a\.cave-citation-chip:focus-visible \{[\s\S]*?var\(--ring-focus\)/,
    "inline sources retain the shared keyboard focus treatment",
  );
  assert.match(
    domWiring,
    /link\.getAttribute\("href"\)\?\.startsWith\("#"\)/,
    "generic markdown link wiring leaves native fragment links untouched",
  );
});

test("chat renders inline source previews without a numbered Sources footer", () => {
  assert.match(bubble, /renderCitedBody,[\s\S]*?from "@\/lib\/citations"/, "the bubble lifts footnote citations from the body");
  assert.match(bubble, /import \{ InlineCitationPreviews \} from "@\/components\/ui\/citation"/, "renders inline source previews");
  assert.match(bubble, /const cited = useMemo\(\(\) => renderCitedBody\(content\), \[content\]\)/, "citations are parsed once per body");
  assert.match(
    bubble,
    /<MarkdownContent[\s\S]{0,120}?text=\{cited\.body\}/,
    "the definition-free body feeds the markdown renderer",
  );
  assert.match(
    bubble,
    /<InlineCitationPreviews[\s\S]*citations=\{citations\}[\s\S]*containerRef=\{containerRef\}[\s\S]*renderedHtml=\{html\}/,
    "the rendered markdown container is enhanced with inline previews",
  );
  assert.doesNotMatch(bubble, /<CitationSources citations=\{cited\.citations\}/, "chat no longer renders a Sources footer");
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

test("a worktree citation renders the repo source card, not a web card (SourceCard.dc.html)", () => {
  const card = citation;
  assert.match(card, /function RepoCitationCard/, "the repo variant is its own card");
  assert.match(
    card,
    /if \(citation\.file\) return <RepoCitationCard citation=\{citation\} \/>;/,
    "a citation carrying a file ref takes the repo variant",
  );
  // The three things that identify a worktree source: path, range, lines.
  assert.match(card, /title=\{file\.path\}/, "the full path is available on hover when it truncates");
  assert.match(card, /const range = lineRangeLabel\(file\)/, "the line range comes from the shared helper");
  assert.match(card, /\{firstLine \+ index\}/, "peek lines are numbered from the range start");
  // The peek must be the citation's own snippet — never read off disk here, or
  // the card could show a preview the citation never carried.
  assert.match(
    card,
    /const peek = \(citation\.snippet \?\? ""\)[\s\S]{0,40}\.slice\(0, 4\)/,
    "the peek is the citation's own quoted text, capped at four lines",
  );
  assert.match(card, /Open in Code/, "the repo card offers the code destination, not an external link");
  assert.doesNotMatch(
    card.slice(card.indexOf("function RepoCitationCard"), card.indexOf("function CitationCard")),
    /target="_blank"/,
    "a worktree path is never opened in a browser tab",
  );
});

test("the web source card carries its marker number", () => {
  const card = citation;
  assert.match(
    card,
    /\{citation\.n\}\s*\n\s*<\/span>/,
    "the card shows the same number as the inline chip that opened it",
  );
});
