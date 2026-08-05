// @ts-nocheck
//
// Source pins for the code reading path (cave-f6mu9). The model logic is
// covered behaviorally in src/lib/code-reading.test.ts; what these guard is
// the WIRING, which is the part that silently rots: chrome that renders but is
// never wired, a context that is never provided, a handoff whose origin is
// dropped one hop before it arrives.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (rel) => readFile(new URL(rel, import.meta.url), "utf8");

const bubble = await read("./message-bubble.tsx");
const wiring = await read("./message-dom-wiring.ts");
const chatView = await read("./chat-view.tsx");
const workspace = await read("./workspace.tsx");
const codeView = await read("./code-view.tsx");
const inspector = await read("./code-reading-inspector.tsx");
const codeCss = await read("../styles/cave-md/code.css");

// ── Chrome renders with the identity the wiring layer needs ─────────────────

// Provenance must be derived from the fence, not guessed downstream: it is
// what gates every action, so the render and the wiring must agree on one
// source of truth.
assert.match(bubble, /deriveReadingBlock\(info\)/, "the frame derives provenance from the fence info");
assert.match(
  bubble,
  /data-code-provenance="\$\{escHtml\(block\.provenance\)\}"/,
  "provenance rides on the wrap so the wiring layer can read it back",
);
assert.match(bubble, /data-code-path="\$\{escHtml\(block\.path\)\}"/, "the path rides on the wrap");

// The controls exist in the markup…
assert.match(bubble, /cave-code-read-btn/, "renders a Read control");
assert.match(bubble, /cave-code-compare-btn/, "renders a Compare control");
assert.match(bubble, /cave-code-prov cave-code-prov--/, "renders the provenance pill");
assert.match(bubble, /class="cave-code-stale" hidden/, "the staleness slot starts hidden");

// Compare is gated on provenance — a quoted block has no working tree to
// compare against, so the control must not render for one.
assert.match(
  bubble,
  /canCompare\(block\.provenance\)\s*\?/,
  "Compare renders only when the provenance supports it",
);

// ── …and are actually wired ─────────────────────────────────────────────────

assert.match(wiring, /function wireCodeReading\(/, "there is a reading wiring pass");
assert.match(
  wiring,
  /wireCodeReading\(el, reading, projectRoot, turnId\)/,
  "useWireCopyButtons runs the reading pass with the owning turn and root",
);
assert.match(
  wiring,
  /readButton\?\.addEventListener\("click", openSnippet\)/,
  "the Read control gets a click handler",
);
assert.match(
  wiring,
  /compareButton\?\.addEventListener\("click", openCompare\)/,
  "the Compare control gets a click handler",
);
assert.match(
  wiring,
  /_caveReadingIdentity[\s\S]{0,900}?projectRoot[\s\S]{0,180}?sourceSessionId[\s\S]{0,180}?turnId[\s\S]{0,180}?path[\s\S]{0,180}?lang[\s\S]{0,180}?provenance/,
  "listener reuse is keyed by every captured open-payload provenance field",
);
assert.match(
  wiring,
  /codeReadingWireIdentityMatches\(/,
  "same-root session or turn changes run through the full identity comparison before listener reuse",
);
assert.match(
  wiring,
  /flagged\._caveReadingOnRead = reading\.onRead;[\s\S]{0,220}?codeReadingWireIdentityMatches/,
  "unchanged provenance reuses its listener while dispatching through the current reader callback",
);

// Compare must land on the compare tab, not the snippet the reader already saw.
assert.match(wiring, /open\("compare"\)/, "Compare opens the compare tab");

// No inspector on this surface ⇒ no controls. Rendering a button that does
// nothing is worse than rendering none, and the same markdown renders on
// settings/journal/palette surfaces that have no inspector.
assert.match(
  wiring,
  /if \(reading\) \{\s*wrap\.classList\.add\("cave-code-wrap--readable"\)/,
  "controls are revealed only where a reading context exists",
);
assert.match(
  codeCss,
  /\.cave-code-read-btn,\s*\n\.cave-code-compare-btn \{\s*\n\s*display: none;/,
  "the controls are hidden by default in CSS, not merely unwired",
);

// The staleness check must read the WORKING TREE, and must not claim anything
// before it has an answer.
assert.match(wiring, /\/api\/project-file\?path=/, "staleness reads the real file");
assert.match(wiring, /if \(!marker\.isConnected\) return;/, "a re-render mid-flight is not a crash");
assert.match(
  wiring,
  /wrap\.setAttribute\("data-code-staleness", state\)/,
  "the verdict lands on the wrap so CSS can react to it",
);

// ── The chat surface provides the context and renders the panel ─────────────

assert.match(chatView, /<CodeReadingContext\.Provider value=\{codeReading\}>/, "chat provides the reading context");
assert.match(chatView, /<CodeReadingInspector/, "chat renders the inspector");
assert.match(
  wiring,
  /const identity: CodeReadingWireIdentity = \{[\s\S]{0,180}?projectRoot,/,
  "the reader request captures the rendered turn's immutable root",
);
assert.match(
  wiring,
  /export type CodeReadingRequest = \{[\s\S]*?turnId: string \| null;[\s\S]*?sourceSessionId: string \| null;/,
  "reader requests carry stable turn and source-session identity",
);
assert.match(
  wiring,
  /const identity: CodeReadingWireIdentity = \{[\s\S]{0,180}?sourceSessionId: reading\.sourceSessionId,[\s\S]{0,120}?turnId,/,
  "the DOM handoff captures the owning message and ChatView session",
);
assert.match(
  wiring,
  /flagged\._caveReadingOnRead\?\.\(\{[\s\S]{0,80}?\.\.\.identity/,
  "the click handler emits the current identity through the current callback",
);
assert.match(
  chatView,
  /projectRoot=\{readingTarget\.projectRoot\}/,
  "the inspector keeps using the captured root after the active project changes",
);
assert.match(
  chatView,
  /setReadingTarget\(\(current\) =>[\s\S]{0,180}?reconcileCodeReadingTargetRoot\([\s\S]{0,160}?sessionId,[\s\S]{0,160}?turnProjectRoots/,
  "a pending reader reconciles its existing target when turn metadata supplies the immutable root",
);
assert.doesNotMatch(
  chatView,
  /<CodeReadingInspector[^>]*\bkey=/,
  "provenance settlement updates the mounted reader instead of replacing it",
);
assert.match(
  inspector,
  /target\.sourceSessionId,[\s\S]{0,180}?target\.turnId,[\s\S]{0,240}?target\.code,[\s\S]{0,180}?target\.tab/,
  "provenance-only target updates preserve the reader's local tab and selection state",
);
assert.match(
  inspector,
  /disabled=\{entry\.id !== "snippet" && !projectRoot\}/,
  "working-tree tabs stay disabled until immutable root provenance arrives",
);
assert.match(
  inspector,
  /disabled=\{!canOpen\}[\s\S]{0,160}?Open in workshop/,
  "the workshop handoff stays visible but disabled until provenance enables it",
);
// The pin is read after mount: localStorage does not exist during SSR and
// reading it during render would hydrate-mismatch.
assert.match(
  chatView,
  /useEffect\(\(\) => \{\s*\n\s*setReadingPin\(readCodeReadingPin\(familiar\.id\)\);/,
  "the stored pin is adopted after mount, not read during render",
);
assert.match(chatView, /writeCodeReadingPin\(pin, familiar\.id\)/, "the pin persists per familiar");

// Reference and Quote must reach the composer — the whole point of selecting
// lines is carrying them into the reply.
assert.match(chatView, /onReference=\{/, "Reference is wired to the composer");
assert.match(chatView, /onQuote=\{/, "Quote is wired to the composer");

// ── The handoff keeps its origin all the way to the workshop ────────────────

assert.match(
  chatView,
  /new CustomEvent\("cave:open-project-file", \{[\s\S]{0,220}?projectRoot: readingTarget\.projectRoot,[\s\S]{0,120}?sourceSessionId: readingTarget\.sourceSessionId/,
  "Open in workshop reuses the shell route with immutable turn and source-session provenance",
);
assert.match(chatView, /origin: \{ \.\.\.origin, selectionLabel: range \}/, "the selected range travels with the open");
assert.match(
  workspace,
  /origin: detail\.origin/,
  "the shell handler forwards the origin into the pending open",
);
assert.match(
  workspace,
  /const sessionId = detail\.sourceSessionId \?\? undefined;/,
  "the shell routes Code handoffs with the captured source session",
);
assert.doesNotMatch(
  workspace,
  /activeChatSessionIdRef/,
  "Code handoffs never borrow the mutable primary chat session (including split-pane origins)",
);
assert.match(codeView, /<CodeSourceContext/, "the Code surface renders the source-context card");
assert.match(
  codeView,
  /setOriginDismissed\(false\)/,
  "a new arrival re-shows the card — dismissing means 'read', not 'never again'",
);

// ── A11y and layout promises ────────────────────────────────────────────────

// Only the phone-width modal traps focus; a split/overlay inspector sits beside
// a live conversation and trapping there would strand the reader.
assert.match(
  inspector,
  /useFocusTrap\(mode === "modal", panelRef/,
  "focus is trapped for the modal layout only",
);
assert.match(inspector, /aria-modal=\{mode === "modal" \? true : undefined\}/, "aria-modal matches the real behavior");
assert.match(inspector, /focus-ring/, "interactive elements carry the focus ring");
assert.match(inspector, /aria-pressed=\{selected\}/, "line rows expose their selected state");

// ── Review findings from PR #4197 ───────────────────────────────────────────

// One classifier decides "is this a patch", so the diff RENDERING and the
// provenance PILL can never disagree. Before this, a ```patch fence got the
// "patch" pill with none of the diff parsing.
assert.match(
  bubble,
  /const isDiff = block\.isDiff;/,
  "diff rendering uses the same classifier as the provenance pill",
);
assert.doesNotMatch(
  bubble,
  /const isDiff = lang === "diff"/,
  "the old lang-only diff check must not come back — it disagrees with deriveReadingBlock",
);

// A failed read must not render as a confident "gone". Only a 404 is absent.
for (const [source, name] of [[wiring, "the wiring layer"], [inspector, "the inspector"]]) {
  assert.match(source, /res\.status === 404/, `${name} treats only a 404 as absent`);
  assert.match(source, /kind: "unreadable"|phase: "error"/, `${name} has a distinct unreadable outcome`);
}
assert.match(
  wiring,
  /stalenessForRead\(/,
  "the wiring layer maps a read OUTCOME to staleness, not a nullable string",
);
assert.doesNotMatch(
  inspector,
  /staleness\(target\.code, diskContent\)/,
  "the inspector must not collapse a read failure into `missing`",
);

// Line selection is a range of toggles, not a single-select listbox — and
// listbox would also require the options to be the container's direct children.
assert.doesNotMatch(inspector, /role="listbox"/, "code lines are not a listbox");
assert.doesNotMatch(inspector, /role="option"/, "line numbers are not listbox options");
assert.match(inspector, /aria-pressed=\{selected\}/, "line numbers announce pressed state");

// Selection is not colour-only.
assert.match(
  await read("../styles/code-reading.css"),
  /\.cri-row--selected \{[\s\S]*?box-shadow: inset 2px 0 0/,
  "selection carries a rule as well as a tint",
);
