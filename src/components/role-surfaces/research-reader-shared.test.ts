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
const codeBranch = source.slice(
  source.indexOf('if (block.kind === "code")'),
  source.indexOf('if (block.kind === "table")'),
);
assert.match(
  codeBranch,
  /<MarkdownBlock/,
  "code blocks render through the shared Markdown renderer",
);
assert.doesNotMatch(
  codeBranch,
  /data-document-target|rr-block-row|tabIndex|renderEdge|ResearchProvenanceEdge/,
  "code blocks stay opaque instead of becoming provenance or focus targets",
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
  /new ResizeObserver\(/,
  "responsive inspector behavior measures the reader container",
);
assert.match(
  source,
  /const INSPECTOR_OVERLAY_MAX_REM = 80/,
  "the overlay threshold follows the root rem size used by the container query",
);
assert.match(
  source,
  /getComputedStyle\(document\.documentElement\)\.fontSize[\s\S]*?INSPECTOR_OVERLAY_MAX_REM \* rootFontSize/,
  "the overlay threshold converts rem against the live root font size",
);
assert.match(
  source,
  /measureInspector\(reader\.clientWidth\)[\s\S]*?contentRect\.width[\s\S]*?reader\.clientWidth/,
  "inspector JS measures the same content box used by its container query",
);
assert.match(
  source,
  /measureContents\(documentPane\.clientWidth\)[\s\S]*?contentRect\.width[\s\S]*?documentPane\.clientWidth/,
  "Contents JS follows the DocumentReader container instead of assuming the outer width",
);
assert.match(
  source,
  /documentPane\.inert = inspectorOn && inspectorOverlaysDocument/,
  "the covered document and contents become inert only in overlay mode",
);
assert.match(
  source,
  /documentScroll\.inert = tocOn && contentsOverlaysDocument/,
  "the covered report becomes inert while the responsive Contents sheet is open",
);
assert.match(
  source,
  /document-reader__toc-link\[data-active="true"\][\s\S]*?contents\?\.focus\(\)/,
  "opening the responsive Contents sheet moves focus into its real navigation",
);
assert.match(
  source,
  /inspectorFocusReturnRef\.current = invoker/,
  "the inspector remembers the exact control that invoked it",
);
assert.match(
  source,
  /selectedSourceId[\s\S]*?research-evidence-card__toggle[\s\S]*?research-evidence-inspector__close[\s\S]*?focus\(\)/,
  "opening an overlay inspector moves focus to its selected card or close control",
);
assert.match(
  source,
  /const closeInspector = useCallback\([\s\S]*?\{ restoreFocus = true \}[\s\S]*?inspectorFocusReturnRef\.current[\s\S]*?invoker\?\.focus\(\)/,
  "ordinary inspector dismissal restores focus to its invoker",
);
assert.match(
  source,
  /const \[selectedSourceId, setSelectedSourceId\] = useState<string \| null>\(null\)/,
  "no evidence source is selected by default",
);
const onRefClickBranch = source.slice(
  source.indexOf("const onRefClick"),
  source.indexOf("const clearPreview"),
);
assert.match(
  onRefClickBranch,
  /const source = sourceById\.get\(id\)/,
  "evidence selection verifies that the ledger contains a real source row",
);
const missingRecordGuard = onRefClickBranch.match(
  /if \(!source\) \{([\s\S]*?)\n\s*\}/,
);
assert.ok(
  missingRecordGuard,
  "missing source rows have an explicit selection guard",
);
assert.ok(
  onRefClickBranch.indexOf("if (!source)") <
    onRefClickBranch.indexOf("setSelectedSourceId(id)"),
  "the missing-record guard runs before any inspector selection mutation",
);
assert.match(
  missingRecordGuard[1],
  /announce\(\s*`\$\{CONFLICT_ID_RE\.test\(id\) \? "Conflict" : "Evidence"\} \$\{id\} has no source record\.`,?\s*\)/,
  "missing conflict and evidence references announce that no source record exists",
);
assert.match(
  missingRecordGuard[1],
  /return;/,
  "missing source rows stop before any inspector selection state changes",
);
assert.doesNotMatch(
  missingRecordGuard[1],
  /setSelectedSourceId|setInspectorOn|setOpenIds/,
  "missing source rows never select, open, or synthesize an inspector card",
);
assert.match(
  onRefClickBranch,
  /setSelectedSourceId\(id\)[\s\S]*?setInspectorOn\(true\)[\s\S]*?setOpenIds\([\s\S]*?Opened conflict" : "Opened evidence"/,
  "real source selections retain the existing selected, open, and announced behavior",
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
  /aria-controls="research-reader-contents"/,
  "the dedicated chrome toggle identifies the Contents panel it controls",
);
assert.match(
  source,
  /contentsId="research-reader-contents"/,
  "the real Contents navigation receives the dedicated toggle's controlled id",
);
assert.match(
  source,
  /<OverflowMenu[\s\S]*?ariaLabel="More research reader actions"[\s\S]*?size="md"/,
  "the overflow trigger uses the same Cave chrome size as adjacent controls",
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
assert.match(
  source,
  /<aside[\s\S]*?ref=\{inspectorRef\}[\s\S]*?className="rr-col rr-rail"/,
);
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
assert.match(
  source,
  /onSupport=\{\(target\) => \{\s*closeInspector\(\{ restoreFocus: false \}\);\s*requestAnimationFrame\(\(\) =>\s*documentReaderApiRef\.current\?\.scrollToTarget\(target\.id, true\)\s*\);\s*\}\}/,
  "Supports closes the responsive inspector before focusing the cited content",
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
  /@container research-reader \(max-width: 80rem\)[\s\S]*?\.rr-rail/,
  "the evidence dock overlays instead of squeezing medium readers",
);
assert.match(
  css,
  /@container document-reader \(max-width: 52rem\)[\s\S]*?document-reader__toc[\s\S]*?position:\s*absolute[\s\S]*?display:\s*block/,
  "the dedicated Contents toggle reveals the real navigation as a compact sheet",
);
assert.match(
  css,
  /\.research-reader \.document-reader__compact-nav\s*\{\s*display:\s*none/,
  "Research hides the shared redundant compact Contents trigger",
);
assert.match(
  css,
  /@media \(hover: none\) and \(pointer: coarse\)[\s\S]*?rr-head__actions > \.ui-icon-btn[\s\S]*?min-height:\s*var\(--touch-target\)/,
  "the overflow trigger reaches the touch target on coarse pointers",
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
