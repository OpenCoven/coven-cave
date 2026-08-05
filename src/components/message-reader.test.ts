// @ts-nocheck
// Source pins for the Expand reader, Reader.dc.html frame 3a ("the reader as
// it ships"):
//
//   • the reader replaces frame 1a's plain sheet — no MarkdownExpandModal
//     survives, and the Expand action opens this instead;
//   • the rail, the reading estimate and the footer are all derived from data
//     the turn already carries, never invented — a tab with nothing behind it
//     is not rendered, and neither is a footer with no tabs;
//   • the provenance the reader shows is the SAME tool events the transcript
//     renders, so the two can never disagree;
//   • the chrome is tokenised (the design gate) and has a reduced-motion story.
//
// The rail's own derivation is unit-tested in lib/reader-outline.test.ts —
// these pin that the surface renders it, and renders it once.
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";

const reader = readFileSync(new URL("./message-reader.tsx", import.meta.url), "utf8");
const bubble = readFileSync(new URL("./message-bubble.tsx", import.meta.url), "utf8");
const chatView = readFileSync(new URL("./chat-view.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../styles/cave-chat/reader.css", import.meta.url), "utf8");
const facade = readFileSync(new URL("../styles/cave-chat.css", import.meta.url), "utf8");

test("3a — Expand opens the reader, and frame 1a's sheet is gone", () => {
  assert.doesNotMatch(
    bubble,
    /MarkdownExpandModal/,
    "the superseded 1a modal must not survive alongside its replacement",
  );
  assert.match(
    bubble,
    /<MessageReader[\s\S]{0,2000}<MarkdownContent\s*\n\s*text=\{readerCited\.body\}[\s\S]{0,300}<\/MessageReader>/,
    "the reader takes the rendered answer as children — it must not import the markdown pipeline itself",
  );
  assert.doesNotMatch(
    reader,
    /MarkdownBlock|@create-markdown/,
    "message-bubble owns the markdown pipeline; importing it back would cycle",
  );
});

test("3a — the reader's weight is paid on open, not on every visit to /", () => {
  // The reader is a modal behind an explicit click. Shipping its sheet through
  // the cave-chat.css facade put ~17 KB on the / route's first paint for every
  // session, including the ones that never expand a message — which is exactly
  // what blew `bundle-budget: initial / route CSS` (882 KB vs 865 KB).
  // Asserted on the @import STATEMENT rather than the bare substring: the
  // contract is "the facade does not pull the reader sheet into the cascade",
  // and a substring check also fires on any copy of the sheet's own text.
  assert.doesNotMatch(
    facade,
    /@import\s+["'][^"']*reader\.css["']/,
    "the facade is loaded by every chat surface — the reader sheet must not ride it",
  );
  assert.match(
    reader,
    /import "@\/styles\/cave-chat\/reader\.css";/,
    "the component owns its sheet, so the CSS rides its lazy chunk",
  );
  assert.match(
    bubble,
    /const MessageReader = dynamic\(\s*\n\s*\(\) => import\("@\/components\/message-reader"\)\.then\(\(m\) => m\.MessageReader\),\s*\n\s*\{ ssr: false \},\s*\n\s*\);/,
    "and the component itself loads only when Expand is clicked",
  );
});

test("3a — the reader renders the CITED body, not raw footnote plumbing", () => {
  // Caught by looking at the running app, not by a test: the bubble renders
  // renderCitedBody(content).body while the reader was handed raw `text`, so a
  // cited answer showed literal [^label] markers inline AND dumped the whole
  // footnote definition block into the prose.
  assert.match(
    bubble,
    /const readerCited = useMemo\(\(\) => renderCitedBody\(text\), \[text\]\);/,
    "the reader's body is the cited body, exactly as the bubble renders it",
  );
  assert.match(
    bubble,
    /text=\{readerCited\.body\}/,
    "and that cited body is what gets rendered",
  );
  assert.match(
    bubble,
    /<MessageReader\s*\n\s*text=\{text\}/,
    "`text` stays RAW on the reader — Copy/Export hand back portable markdown "
      + "and the Sources tab needs the footnote definitions to parse",
  );
});

test("3a — cited sources are interactive chips, not bare links", () => {
  // MarkdownBlock renders markdown; MarkdownContent is the renderer that also
  // mounts InlineCitationPreviews against its container ref. The reader used
  // the former, so citations degraded to plain underlined links while the
  // transcript showed real source chips.
  assert.match(
    bubble,
    /<MarkdownContent\s*\n\s*text=\{readerCited\.body\}\s*\n\s*citations=\{readerCited\.citations\}/,
    "the reader passes citations to the renderer that wires the previews",
  );
  assert.match(
    bubble,
    /className=\{`cave-md\$\{className \? ` \$\{className\}` : ""\}`\}/,
    "MarkdownContent takes an optional className so a surface sets its own "
      + "reading scale instead of forking the component",
  );
});

test("3a — the rail and the reading estimate come from the pure model", () => {
  assert.match(
    reader,
    /import \{ outlineBaseLevel, readerOutline, readingStats \} from "@\/lib\/reader-outline";/,
    "no second heading parser in the component",
  );
  assert.match(
    reader,
    /const \[navOpen, setNavOpen\] = useState\(\(\) => outline\.length > 0\);/,
    "an answer with no headings opens with the rail closed rather than empty",
  );
  assert.match(
    reader,
    /\{navOpen && outline\.length \? \(\s*<nav className="cave-reader-rail"/,
    "the rail never renders without headings to navigate",
  );
});

test("3a — the rail anchors to the DOM the markdown pipeline actually rendered", () => {
  assert.match(
    reader,
    /const observer = new MutationObserver\(anchor\);/,
    "Shiki renders asynchronously — a one-shot anchor would bind to an empty document",
  );
  assert.match(
    reader,
    /const entry = outline\[i\];\s*\n\s*if \(entry && el\.id !== entry\.id\) el\.id = entry\.id;/,
    "the nth heading element takes the nth outline id, so rail and document stay aligned",
  );
});

test("3a — provenance is the turn's own tool events, and absent when there are none", () => {
  assert.match(
    chatView,
    /readerTools=\{turnTools\}/,
    "the reader reads the same tool events the turn carries",
  );
  assert.match(
    reader,
    /const batches = useMemo\(\(\) => \(tools\?\.length \? toolBatches\(tools\) : \[\]\), \[tools\]\);/,
    "batches come from the shared pure model, not a second derivation",
  );
  assert.match(
    reader,
    /if \(citations\.length\) available\.push\("sources"\);\s*\n\s*if \(batches\.length\) available\.push\("tools"\);\s*\n\s*if \(skills\.length\) available\.push\("skills"\);/,
    "a tab is offered only when something is behind it",
  );
  assert.match(
    reader,
    /\{tabs\.length \? \(\s*\n\s*<div className="cave-reader-foot">/,
    "with no tabs at all the footer itself is absent — an empty panel claims more than a missing one",
  );
});

test("3a — a batch is the same colour in the footer as in the stream", () => {
  const activity = readFileSync(new URL("../styles/cave-chat/activity.css", import.meta.url), "utf8");
  assert.match(
    activity,
    /:is\(\.cave-tool-block, \.cave-tool-run, \.cave-tool-batch, \.cave-reader-row--batch\)\[data-tool-category="shell"\]/,
    "the reader joins the stream's own selector list rather than copying its values",
  );
  assert.doesNotMatch(
    css,
    /\.cave-reader-row--batch\[data-tool-category=/,
    "a second copy of the category tints is a drift waiting to happen",
  );
  assert.match(
    css,
    /\.cave-reader-row--batch \{\s*\n\s*--tool-accent: var\(--text-muted\);/,
    "an uncategorised batch still needs a defined accent to mix against",
  );
});

test("3a — the Tools tab offers three readings of the same calls", () => {
  assert.match(
    reader,
    /import \{ skillGroups, toolRollups, toolSteps \} from "@\/lib\/reader-provenance";/,
    "each view is a regrouping from the pure model, not a second derivation in the component",
  );
  for (const view of ["batches", "tools", "timeline"]) {
    assert.match(
      reader,
      new RegExp(`footTab === "tools" && toolsView === "${view}"`),
      `the ${view} view is rendered`,
    );
  }
  assert.match(
    reader,
    /\{footTab === "skills" && groups\.length > 1 \? \(/,
    "one group is not a split — the Skills switch appears only when By type says something new",
  );
});

test("3a — the view switch is the app's Segmented control, not a second one", () => {
  assert.match(
    reader,
    /import \{ Segmented \} from "@\/components\/ui\/settings-controls";/,
    "reuse before inventing (AGENTS.md design-system contract)",
  );
  assert.doesNotMatch(css, /\.cave-reader-seg/, "no bespoke segmented control in the reader sheet");
  assert.match(
    reader,
    /<div className="cave-reader-tablist" role="tablist" aria-label="Provenance">/,
    "the switch sits BESIDE the tablist — a non-tab child inside role=tablist is a lie to AT",
  );
});

test("3a — Escape unwinds one layer at a time", () => {
  const escape = reader.match(/const escape = useCallback\([\s\S]*?\}, \[viewer, exportOpen, onClose\]\);/)?.[0] ?? "";
  assert.ok(escape, "expected an escape handler");
  assert.match(escape, /if \(viewer\)[\s\S]*if \(exportOpen\)[\s\S]*onClose\(\);/, "viewer, then menu, then the reader");
  assert.match(
    reader,
    /useFocusTrap\(true, dialogRef, \{ onEscape: escape \}\);/,
    "the shared trap owns focus return, as every other modal does",
  );
});

test("3a — the selection ask-bar only exists where there is somewhere to ask", () => {
  assert.match(
    reader,
    /const onSelect = useCallback\(\(\) => \{\s*\n\s*if \(!onAsk\) return;/,
    "no handler, no selection tracking",
  );
  assert.match(
    reader,
    /\{selection && onAsk \? \(/,
    "the bar is gated on both a selection and a destination",
  );
  assert.match(
    reader,
    /setSelection\(picked\.length > 1 \? picked : null\);/,
    "a stray click collapses the range — it must not raise the bar",
  );
  assert.match(
    reader,
    /onMouseUp=\{onSelect\}\s*\n\s*onKeyUp=\{onSelect\}\s*\n\s*onTouchEnd=\{onSelect\}/,
    "mouse, keyboard, and touch selection all surface the same ask-bar",
  );
});

test("3a — Ask about this stages the SELECTION, not the whole turn", () => {
  assert.match(
    chatView,
    /function replyToTurn\(turn: Turn, quote\?: string\) \{/,
    "the quoted-reply path takes a passage",
  );
  assert.match(
    chatView,
    /const snippet = buildReplySnippet\(quote \?\? source\);/,
    "with no quote the whole turn is the subject, exactly as Reply means",
  );
  assert.match(
    chatView,
    /return replyFor\(turn\) \? \(quote: string\) => replyToTurn\(turn, quote\) : undefined;/,
    "asking is gated exactly like quoting — absent wherever Reply is",
  );
  assert.match(chatView, /onAskAbout=\{handlers\(\)\.askAboutFor\(t\)\}/, "the rows supply it");
});

test("3a — Export PDF prints the reader, not the app behind it", () => {
  const print = css.match(/@media print \{[\s\S]*?\n\}/)?.[0] ?? "";
  assert.ok(print, "expected a print block — window.print() alone prints the transcript underneath");
  assert.match(
    print,
    /body > \*:not\(\.cave-reader-backdrop\) \{ display: none !important; \}/,
    "the app behind the overlay must not print",
  );
  assert.match(print, /\.cave-reader-rail,\s*\n\s*\.cave-reader-foot,/, "screen-only chrome drops out");
  assert.match(
    print,
    /\.cave-reader-doc \{\s*\n\s*overflow: visible;/,
    "a scroll container prints one screenful; the document has to flow",
  );
  assert.match(reader, /const exportPdf = useCallback\(\(\) => \{[\s\S]*?window\.print\(\);/, "Export → PDF drives it");
});

test("3a — the chrome is tokenised and survives reduced motion", () => {
  const hex = css.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
  assert.deepEqual(hex, [], `reader.css must not hardcode colors, found: ${hex.join(", ")}`);

  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/, "anything that moves needs a still story");
  assert.match(
    css,
    /\.cave-reader-copyfill \{ transform: scaleX\(1\); \}/,
    "without the wipe the copy button must still confirm — the fill lands instantly, not never",
  );
  assert.match(
    css,
    /@media \(max-width: 60rem\)[\s\S]*?\.cave-reader-rail \{\s*\n\s*position: absolute;/,
    "below two-column width the rail overlays rather than eating the measure",
  );
  assert.match(
    css,
    /\.cave-reader-stat--sources \{ color: var\(--accent-presence\); \}/,
    "reader status colours should come from shared tokens rather than fixed values",
  );
  assert.match(
    reader,
    /import \{ smoothScrollBehavior \} from "@\/lib\/use-prefers-reduced-motion";/,
    "imperative scrolling should reuse the shared reduced-motion helper",
  );
  assert.match(
    reader,
    /scrollIntoView\(\{ behavior: smoothScrollBehavior\(\), block: "start" \}\);/,
    "rail jumps should honor reduced-motion preferences",
  );
});

test("3a — the export menu is named for assistive tech", () => {
  assert.match(
    reader,
    /<span className="cave-reader-menu" role="menu" aria-label="Export options">/,
    "menus need an accessible name so screen readers announce what opened",
  );
});

test("3a — the progress hairline never triggers layout", () => {
  assert.match(
    css,
    /\.cave-reader-progress__bar \{[\s\S]*?transform: scaleX\(0\);[\s\S]*?transition: transform var\(--duration-fast\) linear;/,
    "a width transition on every scroll frame would relayout the head",
  );
  assert.match(
    reader,
    /style=\{\{ transform: `scaleX\(\$\{progress\}\)` \}\}/,
    "the component drives the same transform, not a width",
  );
});
