import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(
  new URL("./research-reader.tsx", import.meta.url),
  "utf8",
);
const inspectorSource = await readFile(
  new URL("./research-evidence-inspector.tsx", import.meta.url),
  "utf8",
);
const documentReaderSource = await readFile(
  new URL("../document-reader.tsx", import.meta.url),
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
  /const CONTENTS_SHEET_MAX_REM = 65/,
  "the Contents sheet threshold includes the 13rem rail beside the intended 52rem document",
);
assert.match(
  source,
  /const RAIL_MIN_REM = 18/,
  "the resizable inspector minimum matches the CSS 18rem track minimum",
);
assert.match(
  source,
  /const RAIL_INITIAL_REM = 18\.75[\s\S]*?useState\(RAIL_INITIAL_REM\)/,
  "the rem-based rail preserves the previous 300px default at the canonical root size",
);
assert.match(
  source,
  /const COLLAPSE_AT_REM = 15/,
  "pointer collapse keeps a rem-scaled buffer below the inspector minimum",
);
assert.match(
  source,
  /widthPx \/ rootFontSize[\s\S]*?Math\.max\(RAIL_MIN_REM,[\s\S]*?Math\.min\(RAIL_MAX_REM, widthRem\)/,
  "pointer resizing clamps in live root-rem units",
);
assert.match(
  source,
  /setProperty\("--rail-w", `\$\{railWidth\}rem`\)/,
  "the rail handle and CSS track share the same rem-based width",
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
  "Contents JS measures the outer DocumentReader width against the rail-inclusive threshold",
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
  /const closeInspector = useCallback\([\s\S]*?\{ restoreFocus = true \}[\s\S]*?focusInspectorReturnTarget/,
  "ordinary inspector dismissal validates and restores a reachable focus target",
);
assert.match(
  source,
  /isValidFocusReturnTarget[\s\S]*?isConnected[\s\S]*?closest\("\[inert\]"\)[\s\S]*?getClientRects\(\)\.length[\s\S]*?tabIndex/,
  "focus restoration rejects detached, inert, hidden, and unfocusable invokers",
);
assert.match(
  source,
  /inspectorFocusReturnIdRef[\s\S]*?data-research-reference-id[\s\S]*?evidenceToggleRef/,
  "a hidden invoker falls back to the visible representation of the same reference, then the toolbar toggle",
);
assert.match(
  source,
  /useFocusTrap\(!focusTable, readerRef, \{ onEscape: closeFocusOrReader \}\)/,
  "the reader focus trap suspends while the portaled table dialog is open",
);
assert.match(
  source,
  /useFocusTrap\(Boolean\(focusTable\), focusedTableRef, \{[\s\S]*?onEscape: closeTable[\s\S]*?\}\)/,
  "the focused table owns a dedicated focus trap and Escape dismissal",
);
assert.match(
  source,
  /const panelOrderRef = useRef<ReaderPanel\[\]>\(\[\]\)/,
  "Contents and Evidence keep a synchronous opening-order stack",
);
assert.match(
  source,
  /const latestOpenPanel = useCallback\(\(\): ReaderPanel \| null =>[\s\S]*?panelOrderRef\.current[\s\S]*?panelOpenRef\.current\[panel\]/,
  "Escape resolves the latest still-open panel from current refs",
);
assert.match(
  source,
  /const closeFocusOrReader = \(\) => \{[\s\S]*?latestOpenPanel\(\)[\s\S]*?closeContents\(\)[\s\S]*?closeInspector\(\)[\s\S]*?onClose\(\)/,
  "Escape closes the latest panel before the remaining panel and reader",
);
assert.match(
  source,
  /const onRefClick[\s\S]*?openPanel\("evidence"\)/,
  "inline and margin evidence selection promote Evidence in panel opening order",
);
assert.match(
  source,
  /const openPanel = useCallback\([\s\S]*?inspectorOverlayRef\.current[\s\S]*?suspendPanel\(otherPanel\)[\s\S]*?panelOpenRef\.current\[panel\] = true/,
  "opening either panel in Evidence overlay mode synchronously suspends the inaccessible peer first",
);
assert.match(
  source,
  /const measureInspector[\s\S]*?inspectorOverlayRef\.current = overlays[\s\S]*?overlays &&[\s\S]*?panelOpenRef\.current\.contents[\s\S]*?panelOpenRef\.current\.evidence[\s\S]*?latestOpenPanel\(\)[\s\S]*?suspendPanel/,
  "the resize measurement synchronously preserves only the latest panel before overlay state renders",
);
assert.match(
  source,
  /onSupport=\{\(target\) => \{[\s\S]*?closeInspector\(\{ restoreFocus: false \}\)/,
  "Supports removes Evidence from the open-panel stack before focusing content",
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
  /clearPreview\(\)[\s\S]*?const source = sourceById\.get\(id\)/,
  "committed reference selection replaces any transient preview",
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
  /setSelectedSourceId\(id\)[\s\S]*?openPanel\("evidence"\)[\s\S]*?setOpenIds\([\s\S]*?Opened conflict" : "Opened evidence"/,
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
  /className="rr-btn rr-btn--accent focus-ring"[\s\S]*?title="Publish"[\s\S]*?onClick=\{onPublish\}/,
  "the narrow icon-only Publish control exposes a native tooltip matching its name",
);
assert.match(
  source,
  /className="rr-krfocus focus-ring"[\s\S]*?title="Focus table"[\s\S]*?aria-label="Focus table"/,
  "the table focus control exposes a native tooltip matching its accessible name",
);
assert.match(
  source,
  /title="Close focused table"[\s\S]*?aria-label="Close focused table"/,
  "the focused-table close control exposes a native tooltip matching its accessible name",
);
assert.match(
  inspectorSource,
  /title="Close evidence inspector"[\s\S]*?aria-label="Close evidence inspector"/,
  "the evidence inspector close control exposes a native tooltip matching its accessible name",
);
assert.match(
  inspectorSource,
  /candidate:\s*\{[\s\S]*?tone:\s*"muted"[\s\S]*?refTone:\s*"accent"/,
  "candidate evidence keeps its neutral status and accent reference tone",
);
assert.match(
  inspectorSource,
  /rejected:\s*\{[\s\S]*?tone:\s*"rejected"[\s\S]*?refTone:\s*"muted"/,
  "rejected evidence has a dedicated danger status without conflating candidate evidence",
);
assert.match(
  documentReaderSource,
  /title="Reading preferences"[\s\S]*?aria-label="Reading preferences"/,
  "the shared reading-preferences trigger has matching visible and accessible names",
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
  /<th[^>]*className="rr-table__evidence"[^>]*scope="col"[^>]*>[\s\S]*?rr-table__evidence-heading[\s\S]*?Evidence[\s\S]*?renderEdge\(table\.headerRefIds\)/,
  "table header references move into the visible Evidence heading cell on wide layouts",
);
assert.match(
  source,
  /data-document-target=\{targetable \? row\.id : undefined\}[\s\S]*?renderEdge\(row\.refIds\)/,
  "table rows are focusable evidence targets with their own provenance edge",
);
assert.match(
  source,
  /redundantRefColumnIndexes\.includes\(index\)[\s\S]*?rr-table__redundant-reference/,
  "parser-identified redundant reference columns receive a responsive rendering hook",
);
assert.match(
  source,
  /className=\{`rr-sref rr-inline-ref/,
  "inline references retain their compact representation hook",
);
assert.match(
  source,
  /span\.kind === "ref-gap"[\s\S]*?className="rr-inline-ref-gap"/,
  "parser-owned reference gaps render independently from prose and chips",
);
assert.match(
  source,
  /data-research-reference-id=\{span\.id\}[\s\S]*?data-research-reference-representation="inline"/,
  "inline references expose the same stable id as their margin representation",
);
assert.match(
  source,
  /span\.tone === "unresolved"[\s\S]*?" rr-sref--unresolved"/,
  "missing source spans map exhaustively to the unresolved compact style",
);
assert.match(
  source,
  /sourceById\.has\(span\.id\)[\s\S]*?"Open evidence"[\s\S]*?Missing source/,
  "inline missing-source controls expose truthful accessible names",
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
const readerOverlayRule = css.match(
  /^\.research-reader-overlay \{([^}]*)\}/m,
);
assert.ok(readerOverlayRule, "the Research Reader overlay rule exists");
assert.match(
  readerOverlayRule[1],
  /z-index:\s*350/,
  "Research Reader uses the shared modal layer above mobile navigation",
);
const tipRule = css.match(/^\.rr-tip \{([^}]*)\}/m);
const tableOverlayRule = css.match(/^\.rr-kroverlay \{([^}]*)\}/m);
assert.ok(tipRule, "the evidence tooltip layer exists");
assert.ok(tableOverlayRule, "the focused table overlay layer exists");
assert.match(
  tipRule[1],
  /z-index:\s*360/,
  "evidence previews stay above the reader and below portaled popovers",
);
assert.match(
  tableOverlayRule[1],
  /z-index:\s*360/,
  "focused tables stay above the reader and below portaled popovers",
);
assert.match(
  css,
  /--research-evidence-edge-reserve:\s*calc\(\s*var\(--space-10\) \+ var\(--space-3\)\s*\)/,
  "wide Research readers reserve the evidence edge outside the prose measure",
);
assert.match(
  css,
  /\.research-reader \.rr-doc__column[\s\S]*?var\(--document-reader-prose-measure\) \+[\s\S]*?var\(--research-evidence-edge-reserve\)/,
  "the paper adds the provenance reserve to the reading preference measure",
);
const codeBlockRule = css.match(
  /^\.research-reader \.rr-codeblock \{([^}]*)\}/m,
);
assert.ok(codeBlockRule, "Research code blocks have a surface-specific width");
assert.match(
  codeBlockRule[1],
  /width:\s*calc\(\s*100% - var\(--research-evidence-edge-reserve\)\s*\)/,
  "opaque code and Mermaid stop before the provenance reserve",
);
assert.match(
  codeBlockRule[1],
  /max-width:\s*calc\(\s*100% - var\(--research-evidence-edge-reserve\)\s*\)/,
  "opaque code and Mermaid remain contained within the prose/report lane",
);
assert.match(
  codeBlockRule[1],
  /margin-inline:\s*0/,
  "Research code blocks do not inherit shared wide-block centering",
);
assert.match(
  codeBlockRule[1],
  /transform:\s*none/,
  "Research code blocks do not translate under the provenance reserve",
);
assert.match(
  css,
  /\.rr-codeblock \.cave-md > \.cm-mermaid-diagram/,
  "Mermaid uses the same reserve-excluding opaque block wrapper",
);
assert.match(
  css,
  /@container document-reader \(max-width: 65rem\)[\s\S]*?--research-evidence-edge-reserve:\s*0/,
  "compact readers remove the hidden evidence-edge reserve",
);
for (const rejectedSelector of [
  ".research-provenance-edge__item--muted",
  ".rr-sref--muted",
  ".rr-src--rejected",
  ".rr-src--rejected.is-selected",
  ".rr-srcmini--rejected",
]) {
  const start = css.indexOf(rejectedSelector);
  assert.notEqual(start, -1, `${rejectedSelector} exists`);
  const rule = css.slice(start, css.indexOf("}", start) + 1);
  assert.match(
    rule,
    /var\(--color-danger\)/,
    `${rejectedSelector} derives its tint from the danger semantic`,
  );
}
const unresolvedAnchorInteraction = css.match(
  /\.research-provenance-edge__item--unresolved:hover[\s\S]*?\{([^}]*)\}/,
);
const unresolvedInlineRule = css.match(/^\.rr-sref--unresolved \{([^}]*)\}/m);
assert.ok(unresolvedInlineRule, "missing inline refs have a dedicated state");
assert.match(
  unresolvedInlineRule[1],
  /var\(--color-danger\)/,
  "missing inline refs derive their state from the danger semantic",
);
assert.ok(
  unresolvedAnchorInteraction,
  "unresolved anchors retain a dedicated hover/selected state",
);
assert.match(
  unresolvedAnchorInteraction[1],
  /var\(--color-danger\)/,
  "unresolved anchor interaction paint retains its semantic danger tint",
);
const mutedStatus = css.match(/^\.rr-srcstat--muted \{([^}]*)\}/m);
assert.ok(mutedStatus, "the candidate status tone still exists");
assert.doesNotMatch(
  mutedStatus[1],
  /--color-danger/,
  "candidate status text does not inherit the rejected danger semantic",
);
assert.match(
  css,
  /@media \(hover: none\) and \(pointer: coarse\)[\s\S]*?\.rr-inline-ref[\s\S]*?\.rr-krfocus[\s\S]*?document-reader__preferences-trigger[\s\S]*?min-height:\s*var\(--touch-target\)[\s\S]*?\.rr-inline-ref[\s\S]*?\.rr-krfocus[\s\S]*?\.rr-btn--accent[\s\S]*?document-reader__preferences-trigger[\s\S]*?min-width:\s*var\(--touch-target\)/,
  "coarse-pointer Research controls meet the touch target in both dimensions",
);
const provenanceButtonRule = css.match(
  /^\.research-provenance-edge__item \{([^}]*)\}/m,
);
const provenanceAnchorRule = css.match(
  /^\.research-provenance-edge__anchor \{([^}]*)\}/m,
);
assert.ok(provenanceButtonRule, "the provenance hit-target rule exists");
assert.ok(provenanceAnchorRule, "the painted provenance anchor rule exists");
assert.match(
  provenanceButtonRule[1],
  /min-width:\s*var\(--space-8\)/,
  "the provenance button owns the token-sized hit width",
);
assert.match(
  provenanceButtonRule[1],
  /min-height:\s*var\(--space-8\)/,
  "the provenance button owns the token-sized hit height",
);
assert.match(
  provenanceButtonRule[1],
  /background:\s*transparent/,
  "the larger provenance button stays visually invisible",
);
assert.match(
  provenanceAnchorRule[1],
  /min-width:\s*var\(--space-6\)/,
  "the painted anchor is narrower than its button hit target",
);
assert.match(
  provenanceAnchorRule[1],
  /min-height:\s*var\(--space-6\)/,
  "the painted anchor is shorter than its button hit target",
);
const listMarkerRule = css.match(
  /\.research-reader \.document-reader__column ol > \.rr-list-row::before,[\s\S]*?\.research-reader \.document-reader__column ul > \.rr-list-row::before \{([^}]*)\}/,
);
assert.ok(listMarkerRule, "the custom list marker rule exists");
assert.match(
  listMarkerRule[1],
  /white-space:\s*nowrap/,
  "multi-digit custom ordered markers never wrap or split",
);
assert.match(
  listMarkerRule[1],
  /inline-size:\s*max-content/,
  "custom markers retain intrinsic non-wrapping containment",
);
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
  /@container document-reader \(max-width: 65rem\)[\s\S]*?document-reader__layout[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\)[\s\S]*?document-reader__toc[\s\S]*?position:\s*absolute[\s\S]*?display:\s*block/,
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
const coarsePointerRules = css.slice(
  css.indexOf("@media (hover: none) and (pointer: coarse)"),
  css.indexOf("@media (prefers-reduced-motion: reduce)"),
);
const coarsePointerHeightTargets = coarsePointerRules.slice(
  0,
  coarsePointerRules.indexOf("}") + 1,
);
const coarsePointerHeightEnd = coarsePointerHeightTargets.length;
for (const selector of [
  ".research-reader .document-reader__toc-link",
  ".research-reader .rr-toclink",
  ".research-reader .document-reader__preferences-trigger",
  ".research-reader .document-reader__size-step",
  ".research-reader .document-reader__preference-option",
  ".research-reader .document-reader__reset",
]) {
  assert.match(
    coarsePointerHeightTargets,
    new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    `${selector} reaches the touch target height on coarse pointers`,
  );
}
assert.match(
  coarsePointerHeightTargets,
  /min-height:\s*var\(--touch-target\)/,
  "the coarse-pointer height target group uses the shared touch token",
);
const coarsePointerWidthTargets = coarsePointerRules.slice(
  coarsePointerHeightEnd,
  coarsePointerRules.indexOf("}", coarsePointerHeightEnd) + 1,
);
for (const selector of [
  ".research-reader .document-reader__preferences-trigger",
  ".research-reader .document-reader__size-step",
]) {
  assert.match(
    coarsePointerWidthTargets,
    new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    `${selector} reaches the touch target width on coarse pointers`,
  );
}
assert.match(
  coarsePointerWidthTargets,
  /min-width:\s*var\(--touch-target\)/,
  "the coarse-pointer square target group uses the shared touch token",
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
