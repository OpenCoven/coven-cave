import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(
  new URL("./research-reader.tsx", import.meta.url),
  "utf8",
);

assert.match(
  source,
  /import \{[\s\S]*?DocumentReader[\s\S]*?\} from "@\/components\/document-reader"/,
  "Research Reader must compose the shared document core",
);
assert.match(
  source,
  /<DocumentReader[\s\S]*?document=\{doc\}/,
  "the source-aware findings model must flow through DocumentReader",
);
assert.match(
  source,
  /renderBlock=\{renderBlock\}/,
  "Research-specific block and citation rendering stays in its adapter",
);
assert.match(
  source,
  /deriveResearchFindingsIntegrity/,
  "Research Reader derives evidence integrity from the findings and ledger",
);
assert.match(
  source,
  /<ResearchProvenanceEdge/,
  "claim-aligned evidence controls use the shared provenance edge",
);
assert.match(
  source,
  /<ResearchEvidenceInspector/,
  "all source cards render through the shared evidence inspector",
);
assert.match(
  source,
  /block\.kind === "code"[\s\S]*?<MarkdownBlock/,
  "fenced blocks use the shared Markdown renderer so Mermaid diagrams render",
);
assert.match(
  source,
  /block\.code\.match\(\/`\+\/g\)[\s\S]*?Math\.max\(3, longestBacktickRun \+ 1\)/,
  "fenced blocks use a delimiter longer than any backtick run in their content",
);
assert.match(
  source,
  /const \[tocOn, setTocOn\] = useState\(false\)/,
  "Contents is hidden by default",
);
assert.match(
  source,
  /const \[inspectorOn, setInspectorOn\] = useState\(false\)/,
  "the evidence inspector is hidden by default",
);
assert.match(
  source,
  /const \[selectedSourceId, setSelectedSourceId\] = useState<string \| null>\(null\)/,
  "no evidence source is selected by default",
);
assert.match(
  source,
  /const \[activeSection, setActiveSection\] = useState<\{ id: string; heading: string \} \| null>\(null\)/,
  "the compact chrome waits for the shared reader's active section",
);
assert.match(
  source,
  /navigation=\{tocOn \? "rail" : "compact"\}/,
  "Research opts into the shared contents rail independently",
);
assert.match(
  source,
  /context=\{[\s\S]*?<p title=\{mission\.intent\}>\{mission\.intent\}<\/p>[\s\S]*?\}/,
  "mission intent is passed through as authored context with its full title",
);
assert.match(
  source,
  /collapsibleSections=\{false\}/,
  "Research sections retain heading semantics instead of becoming disclosures",
);
assert.match(source, /<aside className="rr-col rr-rail"/);
assert.match(source, /onRefClick/);
assert.match(source, /onPublish/);
assert.match(source, /<OverflowMenu/, "secondary Research actions live in the shared overflow menu");
assert.match(
  source,
  /data-document-target=\{block\.id\}[\s\S]*?renderEdge\(block\.refIds\)/,
  "simple findings blocks expose stable claim targets beside provenance controls",
);
assert.match(
  source,
  /className="rr-list-row"[\s\S]*?data-document-target=\{item\.id\}[\s\S]*?renderEdge\(item\.refIds\)/,
  "each list item owns its focus target and provenance edge",
);
assert.match(
  source,
  /<th[^>]*scope="col"[^>]*>Evidence<\/th>/,
  "tables reserve an Evidence column for row provenance",
);
assert.match(
  source,
  /data-document-target=\{targetable \? row\.id : undefined\}[\s\S]*?renderEdge\(row\.refIds\)/,
  "table rows are focusable evidence targets with their own provenance edge",
);
assert.match(
  source,
  /className=\{`rr-sref rr-inline-ref/,
  "inline references retain their compact representation hook",
);
assert.doesNotMatch(
  source,
  /const \[expanded, setExpanded\]/,
  "the old expanded reader mode is removed",
);

// ── "More sources" scrolls with the rail, never sideways (cave-l2hkx) ───────
// The strip used to be `display:flex` in row direction with `overflow-x:auto`
// and 152px fixed-width cards, which put a second, competing scroll axis inside
// a rail that already scrolls vertically (.rr-col is overflow:auto). Reported
// from the running app: s01 visible, s02 clipped mid-word at the rail edge, and
// 12 of 14 sources off-screen.
//
// Measured before/after against this stylesheet with a real browser: row
// direction overflowed the 268px rail by 1964px with cards clipped; column
// direction overflows by 0 and every card renders at the full 268px.
const css = await readFile(new URL("../../styles/research-reader.css", import.meta.url), "utf8");
for (const duplicatedBaseSelector of [
  ".rr-doc h1",
  ".rr-doc h2",
  ".rr-doc p",
  ".rr-doc ul",
  ".rr-doc li",
  ".rr-lede",
]) {
  assert.ok(
    !css.includes(duplicatedBaseSelector),
    `${duplicatedBaseSelector} must come from the shared reader`,
  );
}
assert.match(
  css,
  /@container research-reader \(max-width: 62rem\)[\s\S]*?\.rr-rail/,
  "the evidence dock overlays instead of squeezing medium readers",
);
assert.match(
  css,
  /@container research-reader \(max-width: 42rem\)[\s\S]*?\.rr-rail/,
  "the evidence dock becomes a full-width sheet in narrow readers",
);
const strip = css.match(/^\.rr-srcscroll \{([^}]*)\}/m);
assert.ok(strip, "the .rr-srcscroll rule still exists");
assert.match(strip[1], /flex-direction:\s*column/, "the sources strip stacks vertically");
assert.doesNotMatch(
  strip[1],
  /overflow-x\s*:\s*(auto|scroll)/,
  "the sources strip must not introduce its own horizontal scroll — the rail owns scrolling",
);
const mini = css.match(/^\.rr-srcmini \{([^}]*)\}/m);
assert.ok(mini, "the .rr-srcmini rule still exists");
assert.doesNotMatch(
  mini[1],
  /width:\s*\d+px/,
  "source cards fill the rail rather than sitting at a fixed pixel width that overflows it",
);
// The hand-rolled horizontal scrollbar went with the axis it scrolled; leaving
// it would render a drag-thumb wired to a container that no longer scrolls.
for (const dead of ["rr-srctrack", "rr-srcthumb"]) {
  assert.ok(!css.includes(dead), `${dead} is gone with the horizontal strip`);
  assert.ok(!source.includes(dead), `${dead} has no leftover markup or handler`);
}

console.log("research-reader-shared: all assertions passed");
