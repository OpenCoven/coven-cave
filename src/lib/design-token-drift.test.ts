// Design-token drift gate — Cave UX P3 (Sage's 2026-07-03 audit).
//
// The design-language shipping checklist (docs/coven-design-language.md §9,
// rule 1) is "tokens only — no hardcoded colors, radii, or font sizes". This
// gate keeps that contract enforceable in two tiers:
//
//   1. ZERO TOLERANCE for on-scale literals: running the codemod
//      (scripts/codemods/tokenize-css.mjs) over every in-scope CSS file must
//      be a no-op. A `font-size: 12px` that should be `var(--text-sm)` fails
//      here — fix by running:  node scripts/codemods/tokenize-css.mjs
//
//   2. RATCHETS for the judgment categories (off-scale px values, hex colors
//      outside token definitions, inline TSX style objects). These can only
//      go DOWN. If you add one deliberately (e.g. a genuinely dynamic inline
//      style), lower-or-equal is enforced — raise the baseline in the same
//      PR and say why. When you reduce drift, lower the baseline to bank it.
//
// The codemod's px→token tables are pinned against the live definitions in
// src/app/globals.css, so a token retune fails loudly instead of letting the
// codemod silently rewrite to stale values.
//
// RUN THIS FILE WITHOUT THE CSS FACADE HOOK. This gate measures the PHYSICAL
// CSS tree, so scripts/run-tests.mjs deliberately runs it without
// `--require ./scripts/css-source-contract-hook.cjs` (RAW_SOURCE_SCANNER_TESTS).
// Under the hook — the incantation every OTHER source-contract test wants —
// fs.readFileSync inlines import facades and every imported sheet is counted
// twice, inflating the ratchets ~1.6x into convincing but bogus "went UP"
// failures. The guard below fails fast instead (cave-d1a0p).

import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import cssContract from "../../scripts/css-source-contract.cjs";

// Self-defense: compare a facade read through (possibly patched) fs against
// the contract module's raw reader, which bound the original readFileSync
// before any hook could patch it. A mismatch means the facade hook is active
// and every number this gate would produce is wrong.
{
  const probe = new URL("../app/globals.css", import.meta.url);
  // assert.ok, not assert.equal: on failure the message is the diagnosis —
  // dumping two copies of the expanded stylesheet as a diff would bury it.
  assert.ok(
    readFileSync(probe, "utf8") === cssContract.readRawCssSync(probe, "utf8"),
    "design-token-drift.test.ts must run WITHOUT --require ./scripts/css-source-contract-hook.cjs " +
      "(see RAW_SOURCE_SCANNER_TESTS in scripts/run-tests.mjs). The facade hook inlines CSS imports, " +
      "double-counting every imported sheet and inflating the ratchets with false drift. " +
      "Run: node --experimental-strip-types --import ./scripts/test-alias-register.mjs --test src/lib/design-token-drift.test.ts",
  );
}

import {
  tokenizeCss,
  cssFilesInScope,
  FONT_SIZE_TOKENS,
  SPACE_TOKENS,
  RADIUS_TOKENS,
  FONT_SIZE_PROPS,
  SPACING_PROPS,
  RADIUS_PROPS,
  SANCTIONED_FONT_SIZE_LITERALS,
  EXEMPT_MARKER,
} from "../../scripts/codemods/tokenize-css.mjs";

// ── ratchet baselines ────────────────────────────────────────────────────────
// Current counts as of the P3 codemod PR. Only lower these (banking progress)
// or raise them with an explicit justification in your PR.
const BASELINES = {
  offScaleFontSizePx: 146, // -5: banked — the GitHub card composer ("Final Card Components.dc.html" handoff, cave-076kh) ships fully on the type scale, and rebasing onto current main reclaimed the rest. +1: chat session redesign (Chat.dc.html 2a) — the assistant turn's serif familiar name keeps the design's 18px step, between --text-lg 16px and --text-xl 20px; every other size in the new session-chrome sheet is on the type scale (the new-session hero uses a clamp off the display size). 10.5px/11.5px/… — need per-case renormalization to the type scale (banked: canvas-editor.css on the type scale; familiar-tab retokenized the old hero/section styles; research-desk tabs shipped fully on the type scale, -3; familiar-tab five-section rebuild shipped fully on the type scale, -1; projects access page rebuild shipped fully on the type scale, -2). +1: Research Reader (Research Reader.dc.html handoff) — the EB Garamond findings hero <h1> keeps the design's 31px display size (between --text-display 28px and the next step); every other reader font-size uses the type scale and compact mono labels use the `font:` shorthand. -3: orphaned skill-browser removal reclaimed its off-scale sizes. -2: Phone control-sheet extraction replaced the legacy block with section-local tokenized CSS.
  offScaleSpacingPx: 1714, // -1: banked after the chat-detail merge removed one off-grid value. +19: Chart Room v2 ("Chart Room - Astra v2.dc.html" handoff, cave-iuc8h) — the new surface-chart-room.css keeps the mock's chart density off the 4px grid: 1px gaps on the scope menu, the chain-node stack and the picker's grouped rows (a 4px gap there reads as a break between options rather than a list); 2px segmented-control track insets, board/graph zoom pads and the flow node's more-toggle nudge; the 1-2px hairline paddings under the chain head and the lens bar. Three structural values pair with a sibling and cannot move alone: the -6px port offset is half the 12px dependency port (changing one detaches the dot from the node edge), the 236px gantt label gutter pairs with the label column's own width (they desync the bar track), and the 2px inset on that label keeps the project dot optically on the column rule. Everything larger was snapped to the space scale in this PR (the mock's 5/6/7/9/10/11/13/14px paddings and gaps all became --space-1..-4, and the node's 48px more-toggle clearance became calc(var(--space-6) * 2)), tokenize-css.mjs is a no-op over the file, every font-size is on the type scale, and the sheet carries zero hex. // -3: banked — the Chat.dc.html 2a find band (cave-7gr08) is entirely on the space scale, and it retired the old inline find bar whose pill carried off-grid padding and gaps. // -8: banked — the Review Deck's retired tab strip (cave-d9nta) took its off-scale padding with it, and the navigator that replaced it is entirely on the space scale. // +22: Weaves & Proposals redesign ("Weaves and Proposals.dc.html" handoff, cave-f8rdi) — the new surface-weaves.css keeps the mock's decision-surface density off the 4px grid: 6px icon-to-label gaps across crumbs, ghost buttons, tallies, verdict lines, strand heads and thread identifiers (8px separates the glyph from its word); 2px segmented-control track insets and the trace/lineage line gaps; 3px crumb insets that keep the back-arrow optically aligned with the crumb text. Every 5px micro-gap and pill inset was snapped to --space-1 in this PR instead (8 of them), every larger step is on the space scale, tokenize-css.mjs is a no-op over the file, all font-sizes are on the type scale, and the sheet carries zero hex. +12: chat session redesign (Chat.dc.html 2a/2b) — the session-chrome sheet keeps the mock's compact rhythm off the 4px grid (5px chip/stat gaps, 2px stat padding, 10px hero margin, the user card's 11px/15px padding), and the rail + new-chat launcher headers add 7px/10px label gaps with 5px count-pill insets. off-4px-grid pad/margin/gap components — banked: canvas-editor.css on the space scale (-1) + familiar-tab snapped to the 4px grid (-5). +123: research-desk redesign (cave-dl74) — the five tab sheets keep the design's compact even 2px-offset rhythm (6/10/14/18/22px gaps and paddings, same family the surface it replaced used); odd values were snapped to the grid in the same PR. +7: home-minimal PR (2026-07-22) — new home-composer/landing-composer.css + hearth-continuations.css compact UI rhythms (7px gaps, 6px accent-dot, 5px pill gap, 13px/14px organic pill padding — off-scale by design for visual compactness). -10: projects access page rebuild (cave-luq4) replaced the hub CSS fully on the space scale; re-banked at 1467 after rebasing onto main commits 7cf9d13f0..fbcadfd3b which added +4 (still -6 vs the pre-rebuild 1473). -1: drive-by banked in the hex-token chunk PR (cave-gyh2). +26: Queue tab redesign (Queue.dc.html handoff) — the refreshed familiar-work-queue.css keeps the design's compact rhythm (7px control gaps, 6px row-meta gaps, 5px check-dot gaps, 3px accent rail, 30px action-button height, 130px note-textarea min-height, 180px forward-menu min-width, 37px menu offset); on-scale values were tokenized by tokenize-css.mjs in the same PR and font-size literals were snapped to the type scale. -2: Tasks toolbar redesign (tasks-list-redesign-refresh) swapped the compact board header for the design's roomier command bar; net off-scale spacing dropped even though the new toolbar adds off-scale rhythm, because the removed compact-header + search-wrap block carried more off-grid values. +40: launcher 3a home dashboard (home-dashboard.css) — the work-led dashboard shell keeps the design mock's compact rhythm (13/22px chrome & board padding, 9/10/11/18/26px rail & row gaps/padding, 2/3/5/6/7px micro-gaps incl. the Resume CTA pill), off the 4px grid by design; the redesign also RECLAIMED the retired hearth/hero/Continue sheets, so this is the NET delta after removal; on-grid values were tokenized by the codemod in the same PR. +20: Review Deck redesign (Review Deck.dc.html handoff) — new review-deck.css keeps the design's compact rhythm (2px stat/pill micro-gaps, 3px pill padding, 5px pill gaps, 6px row/eyebrow margins, 7px key/button gaps, 14px panel-head padding), off the 4px grid by design; the trivially-equivalent 9/7/13px values were snapped to the space scale in the same PR and font-size literals to the type scale. +34: Familiar Analytics modernization (cave-q8uc, Familiar Analytics.dc.html handoff) — the refreshed familiar-analytics surface (surface-reporting.css) keeps the design mock's compact rhythm: 14px heal/contract-detail card padding, 10px attention/heal gaps, 11/13px collapse & button paddings, 7/9px heal-card button padding, 5/6px micro-gaps, 2/3px chip nudges — off the 4px grid by design for the dense card/chip/modal layout; on-scale values were tokenized by tokenize-css.mjs in the same PR. +3: Marketplace "Explore" redesign (Marketplace.dc.html handoff) — the merged Explore rail + toolbar keep the mock's compact rhythm (1px rail-row gap, 2px view-toggle inner padding, 10px rail-label inline padding); on-scale values were tokenized by tokenize-css.mjs in the same PR. -10: hearth-home restore / dashboard-to-new-chat — the hearth sheets' +7 compact rhythm returned, but relocating the dashboard into the chat empty state retired its chrome/dock/project-button blocks (13/22px chrome + 14/22px dock padding, 9/10/11px project paddings), a net reclaim. -12: new-chat dashboard simplification (cave-gxap) — the context rail retired (18px rail padding/gap, 9/10/11px project/quick/pick paddings & gaps, 2px micro-margin) and the board's 26px padding/gap snapped to the space scale; the rail-less board is a capped no-scroll column. +11: Research Reader (Research Reader.dc.html handoff) — the reader chrome keeps the design's compact reading rhythm off the 4px grid (34px page inset & doc top padding, 48px reading-column gutter, 22/14px contents-rail padding, 7px toc/link paddings, 15px lede indent, 20px list indent, 18px rail padding, and 5/6/7/9/10/11px micro paddings & gaps across the toolbar, source cards, and focus overlay); trivially on-grid values were tokenized by tokenize-css.mjs in the same PR. -39: orphaned skill-browser removal (cave-vewe follow-up) — deleting the retired surface's ~609-line .skill-browser__* block reclaimed its compact off-grid rhythm wholesale. -16: Phone control-sheet extraction replaced the legacy block with section-local tokenized CSS after rebasing onto current main. +87: daily report redesign ("Daily Report - Redesign.dc.html" handoff, variant 2a) — the chaptered-day surface keeps the mock's compact rhythm off the 4px grid: 2/3/5/6/7px micro-gaps across the week strip, stat band, streak pips, spine dots and cast rows; 9/10/11px control and card paddings; 14px band/cast/rail gaps; 18px chrome and panel-host insets; and the spine's structural 78px/62px gutters that pair with the negative `left` offsets of its time column and dots (changing one without the other desyncs the rail). All on-grid values were tokenized by tokenize-css.mjs in the same PR, and every font-size was snapped to the type/icon scales (net 0 on offScaleFontSizePx). Two of the four new sheets — daily-report-shipped.css and daily-report-modals.css — carry ZERO off-grid spacing, so this is the irreducible remainder from the shell and the carousel. +6: Canvas page redesign (Canvas.dc.html handoff) — the gallery and sketch editor keep the mock's segmented-control rhythm off the 4px grid: 3px track padding + 2px rider gaps on the kind filter and on the editor's mode/viewport groups, 2px padding + 1px gap on the inspector's weight segments, and the 18px card-field gap that pairs with the 226px thumbnail (dropping to 16px crowds the cards, 20px loses a column at common pane widths). Same compact-segment family the Marketplace Explore and Review Deck handoffs banked; the two trivially-equivalent values (a 2px popover-row gap and a 3px action-row inset) were snapped to the space scale in this PR instead, and every font-size snapped to the type scale (net 0 on offScaleFontSizePx). +16: Projects access refresh (Projects.dc.html handoff) — the ledger, view switcher, bulk band, card grid, rows table and by-level tree keep the mock's chip density off the 4px grid: 5px micro-gaps (ledger key, mix chips, grant chips, pill gaps), 7px ledger and mix-chip column gaps, 6px tree-chip, card-name and card-foot gaps, 3px card id gap, 2px view-switcher inset, and the 1px hairline rails. Every larger step was snapped to the space scale in this PR (the mock's 9/10/11/13/14px paddings and gaps became --space-2/-3/-4), which is why this is 16 and not the 41 the sheet started at; tokenize-css.mjs is a no-op over the file. +1: the Rituals inbox daily-report row — the 24-bar merge-by-hour sparkline needs a 1px hairline gap between bars; a 4px grid gap would erase the chart. Every other value in that sheet is on the space scale. +50: GitHub card composer ("Final Card Components.dc.html" handoff, cave-076kh) — the new gh-card-composer.css keeps the mock's cockpit density off the 4px grid: 10px header/status/sheet gaps and paddings, 9px section-body and margin rhythm, 7px slot and gate-row gaps, 5px palette-label and chip paddings, 11px pill/tab/merged insets, 6px commit-box padding, 3px tool and segment insets, 2px segment-track and meta nudges, the 1px toolbar gap, and the structural 29px section-body indent that aligns expanded rows under the section title (it pairs with the 11px caret + 13px glyph + gap ahead of it, so changing one without the others desyncs the accordion). Every plain single-value gap that sat 1px off a token was snapped to --space-1/--space-2 in this PR instead (14 of them), font-sizes are 100% on the type scale, and the sheet carries zero hex. -6: Research Studio media controls moved their new option fields and progress presentation fully onto the spacing scale.
  offScaleRadiusPx: 232, // -2: banked after the chat-detail merge removed two off-step radii. +4: Chart Room v2 (cave-iuc8h) — the 2px project dot and its 3px large variant, plus the 2px progress track and its fill: short solid marks 6-10px across, the same family the research-desk, Research Reader, daily-report, Projects and GitHub-composer handoffs banked (--radius-control 8px reads as a full circle at that size, which is the one shape a square project swatch must not be). Every container corner in the sheet uses --radius-sm/-md/-control/-pill, and the dependency port is a true 50% circle. // +6: chat session redesign (Chat.dc.html 2a/2b) — the context row's 6px mono chip and 4px stat cell, the group headers' 4px count pills and the rail row's 2px state tick: short compact marks between --radius-control 8px and square. Every container corner uses --radius-card/--radius-panel/--radius-pill. 4px/6px/10px/14px/… radii between the sanctioned steps. +5: research-desk 2px/4px accent-mark radii (short solid marks, not container corners). -5: projects access page rebuild removed the hub's off-step radii. +1: Research Reader accent-mark radius (the section-heading 2px tick, same short-solid-mark family as the research desk). -3: orphaned skill-browser removal reclaimed its off-step radii. -3: Phone control-sheet extraction replaced the legacy block with section-local tokenized CSS. +8: daily report redesign (2a handoff) — the chaptered-day surface's 1/2/3/4px radii on short solid marks (week-strip activity bars, streak pips, swimlane segments and merge ticks, the spine's accent rail), the same short-mark family the research-desk and Research Reader handoffs banked; every container corner snapped to --radius-control/-card/-panel/-sm in the same PR. -2: Canvas page redesign (Canvas.dc.html handoff) — the gallery card's 10px corner and the inspector swatch's `50%` circle snapped to --radius-card and --radius-pill. +3: Projects access refresh — the 5px radius on the card select-checkbox (17px) and the two 18px icon buttons (disclose, gear); --radius-control (8px) reads as a circle at those sizes. Every container corner in the new sheet uses --radius-control/-card/-pill. +1: the Rituals inbox daily-report row's 24-bar merge sparkline, same short-solid-mark family (a 3px-wide bar cannot take a scale radius). +8: GitHub card composer (cave-076kh) — the composer's 4px chips (reactions, assignee/label chips, gate-row actions, scope chips, toolbar buttons) and 3px segment thumbs (Write/Preview, merge method, verb mode), the same short-compact-mark family the research-desk, Research Reader, daily-report and Projects handoffs banked; --radius-control (8px) reads as a pill at a 19-22px chip height. Every control corner uses --radius-sm (the design's own "5-6px control" band) and every container --radius-control/--radius-pill.
  hexOutsideDefinitions: 0, // hex in render CSS (token definitions excluded) — -104: cave-gyh2 chunk 1 (dropped stale var(--token, #hex) fallbacks; mapped accent/danger/success fills to their semantic foregrounds; promoted --color-success-foreground and the codex --cv-* strays). -1 banked in the design-doc reconcile PR (cave-kf3x). -51: cave-yxiz chunk 2 zeroed the ratchet — document grounds (sketch/preview/thumb/QR) now share the fixed --surface-paper token in foundations.css; GitHub state badges promote --gh-merged/--gh-merged-ink and pair open/closed with the semantic status foregrounds; profile-card strays joined the --pfc-* palette; the magic-cast spell art promotes --spell-violet/--spell-core; QR ink, dashboard mark ink, and the avatar photo-overlay ink became local definitions; and pure shade/alpha arithmetic in color-mix()/mask gradients uses the CSS black/white keywords (sanctioned: they're mix anchors, not colors — matching the pre-existing keyword usage in dashboard.css and surface-compact-calendar.css). New hexes belong in token definitions; keywords are only for mix/mask arithmetic.
  inlineTsxStyles: 198, // +1: chat detail row renders a live computed percentage bar width; the value is runtime data and cannot be a static token. +1: thread-instruments stamp lane (cave-xb6g5) — the spine hands the stylesheet `--cave-spine-stamp-chars`, the length of the longest clock string it is about to render. That is the reader's own locale and clock format (24-hour "23:00" is 5, 12-hour "11:00 PM" is 8), so it is unknowable at author time and cannot be a token; a fixed value clips timestamps on any machine whose clock is wider than ours, which is the exact bug the lane was added to end. +1: Review Deck summary strip (cave-d9nta) — the bucket bar's fill paints each bucket's computed share of the deck through a `--rd-share` custom property; the percentage is derived from live GitHub state, so it cannot be a token. +8: thread instruments (cave-j86la) — every one is a measured or model-computed value, not presentation: the spine's per-node `top` and line height come from live turn-offset measurement, its stack height/segment heights are proportional to the turn's tool counts, and the minimap's pane height, caret `top`, per-event bar width/height and the shared hover card's row-anchored `top` are pane-measure + model-derived. +2: the context row's context-window meter paints a computed percentage width — a genuinely dynamic value, not presentation. style={{…}} in TSX; many are legit dynamic values (banked from 500 — the count had drifted far below the old ceiling; -2: projects access page rebuild dropped the hub's inline styles; +1: vendored Blaze.tsx canvas host uses dynamic style spread for WebGL positioning; +1: vendored Peel.tsx canvas host for page-peel reveal effect uses runtime-mutated inline styles; +2: project-setup modal color swatches paint runtime-only values (per-root tint + oklch palette choice); -1: orphaned skill-browser removal dropped its inline style; -45: Phone extraction moved static presentation out of settings-shell.tsx; -1 net: the daily report redesign retired daily-report-ui.tsx and shipped-table.tsx, and its own new inline styles are dynamic-only — CSS custom properties carrying computed percentages and the model's semantic tone; -1 more when the shipped rows' external links became in-app buttons opening the app's GitHub card; -3 net against the declared baseline after rebasing: one concurrent reduction banked, and two GitHub task-status dots moved from token-valued inline styles to state classes) +5: Chart Room v2 (cave-iuc8h) — every one carries a computed value into CSS through a custom property, never presentation: the chain diagram's per-node x/y from the connected-component layout, the gantt bar's left/width from dependency depth and its fill from the card's real project colour, the table's per-column width, and the help grid's column count from the measured breakpoint. The room's flow, graph and orchestration lanes do the same through multi-line style props; all of them are layout measured at runtime or colour read from board data, so none can be a token. // +1: Review Deck summary strip (cave-d9nta) — the bucket bar's fill paints each bucket's computed share of the deck through a `--rd-share` custom property; the percentage is derived from live GitHub state, so it cannot be a token. +8: thread instruments (cave-j86la) — every one is a measured or model-computed value, not presentation: the spine's per-node `top` and line height come from live turn-offset measurement, its stack height/segment heights are proportional to the turn's tool counts, and the minimap's pane height, caret `top`, per-event bar width/height and the shared hover card's row-anchored `top` are pane-measure + model-derived. +2: the context row's context-window meter paints a computed percentage width — a genuinely dynamic value, not presentation. style={{…}} in TSX; many are legit dynamic values (banked from 500 — the count had drifted far below the old ceiling; -2: projects access page rebuild dropped the hub's inline styles; +1: vendored Blaze.tsx canvas host uses dynamic style spread for WebGL positioning; +1: vendored Peel.tsx canvas host for page-peel reveal effect uses runtime-mutated inline styles; +2: project-setup modal color swatches paint runtime-only values (per-root tint + oklch palette choice); -1: orphaned skill-browser removal dropped its inline style; -45: Phone extraction moved static presentation out of settings-shell.tsx; -1 net: the daily report redesign retired daily-report-ui.tsx and shipped-table.tsx, and its own new inline styles are dynamic-only — CSS custom properties carrying computed percentages and the model's semantic tone; -1 more when the shipped rows' external links became in-app buttons opening the app's GitHub card; -3 net against the declared baseline after rebasing: one concurrent reduction banked, and two GitHub task-status dots moved from token-valued inline styles to state classes)
};

// ── unit sanity for the codemod transform ───────────────────────────────────

{
  // On-scale literals tokenize; result is idempotent.
  const src = ".a {\n  font-size: 12px;\n  padding: 8px 12px;\n  border-radius: 999px;\n}\n";
  const out = tokenizeCss(src);
  assert.ok(out.includes("font-size: var(--text-sm);"));
  assert.ok(out.includes("padding: var(--space-2) var(--space-3);"));
  assert.ok(out.includes("border-radius: var(--radius-pill);"));
  assert.equal(tokenizeCss(out), out, "codemod must be idempotent");

  // Off-scale, zero, negative, calc/var-wrapped, and rem values are untouched.
  // font-size: 16px is the sanctioned iOS anti-zoom floor (see the codemod's
  // table comment) and stays literal too.
  const keep = [
    "  font-size: 10.5px;",
    "  font-size: 16px;",
    "  font-size: 0.875rem;",
    "  padding: 0 11px;",
    "  margin: -8px;",
    "  gap: calc(8px + 1px);",
    "  padding: var(--x, 12px);",
    "  border-radius: 6px;",
    "  line-height: 16px;", // not a tokenized property
    "  width: 12px;", // not a tokenized property
  ];
  for (const line of keep) {
    const block = `.a {\n${line}\n}\n`;
    assert.equal(tokenizeCss(block), block, `must not rewrite: ${line.trim()}`);
  }

  // Token definitions stay literal — that's where px belongs.
  const def = ":root {\n  --space-2: 8px;\n  --text-sm: 12px;\n}\n";
  assert.equal(tokenizeCss(def), def);

  // Comments (block and inline-before) are never rewritten.
  const comment = "/*\n  padding: 8px;\n*/\n.a { /* gap: 4px */ color: red; }\n";
  assert.equal(tokenizeCss(comment), comment);

  // The exempt marker is an explicit opt-out.
  const exempt = `.a {\n  font-size: 12px; /* ${EXEMPT_MARKER}: needs fixed px */\n}\n`;
  assert.equal(tokenizeCss(exempt), exempt);
}

// ── pin: codemod tables mirror the live globals.css token definitions ──────

{
  const globals = cssContract.readEffectiveCssSync("src/app/globals.css", "utf8") as string;
  const defined = new Map<string, string>();
  for (const m of globals.matchAll(/^\s*(--[a-z0-9-]+)\s*:\s*([^;]+);/gim)) {
    if (!defined.has(m[1])) defined.set(m[1], m[2].trim()); // first (=:root dark) wins
  }
  for (const [table, name] of [
    [FONT_SIZE_TOKENS, "font-size"],
    [SPACE_TOKENS, "space"],
    [RADIUS_TOKENS, "radius"],
  ] as const) {
    for (const [px, token] of table as Map<string, string>) {
      assert.equal(
        defined.get(token),
        px,
        `${name} table drift: codemod maps ${px} -> ${token}, but globals.css defines ${token}: ${defined.get(token) ?? "(missing)"} — update scripts/codemods/tokenize-css.mjs to match`,
      );
    }
  }
}

// ── tier 1: the codemod is a no-op over the tree (no on-scale literals) ─────

const files = cssFilesInScope();
assert.ok(files.length > 10, "scanner should find the src CSS tree");

for (const rel of files) {
  const source = readFileSync(rel, "utf8");
  assert.equal(
    tokenizeCss(source),
    source,
    `${rel} has on-scale px literals that must use tokens — run: node scripts/codemods/tokenize-css.mjs`,
  );
}

// ── tier 2: ratchets ────────────────────────────────────────────────────────

/** Strip block comments so commented-out CSS never counts as drift. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
}

const DECL_RE = /^(\s*)([a-zA-Z-]+)(\s*:\s*)([^;]*);/;
const PX_RE = /^([0-9]+(?:\.[0-9]+)?)px$/;

function countOffScale(
  source: string,
  props: Set<string>,
  table: Map<string, string>,
  sanctioned: Set<string> = new Set(),
): number {
  let count = 0;
  for (const line of stripComments(source).split("\n")) {
    if (line.includes(EXEMPT_MARKER)) continue;
    if (line.trimStart().startsWith("--")) continue;
    const m = DECL_RE.exec(line);
    if (!m || !props.has(m[2].toLowerCase())) continue;
    for (const piece of m[4].split(/\s+/)) {
      const px = PX_RE.exec(piece);
      if (!px) continue;
      const value = Number.parseFloat(px[1]);
      if (value === 0) continue; // zero needs no token
      if (sanctioned.has(`${value}px`)) continue;
      if (!table.has(`${value}px`)) count += 1;
    }
  }
  return count;
}

function countHexOutsideDefinitions(source: string): number {
  let count = 0;
  for (const line of stripComments(source).split("\n")) {
    if (line.trimStart().startsWith("--")) continue; // token definitions are sanctioned
    count += (line.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []).length;
  }
  return count;
}

const totals = {
  offScaleFontSizePx: 0,
  offScaleSpacingPx: 0,
  offScaleRadiusPx: 0,
  hexOutsideDefinitions: 0,
};
for (const rel of files) {
  const source = readFileSync(rel, "utf8");
  totals.offScaleFontSizePx += countOffScale(
    source,
    FONT_SIZE_PROPS,
    FONT_SIZE_TOKENS,
    SANCTIONED_FONT_SIZE_LITERALS,
  );
  totals.offScaleSpacingPx += countOffScale(source, SPACING_PROPS, SPACE_TOKENS);
  totals.offScaleRadiusPx += countOffScale(source, RADIUS_PROPS, RADIUS_TOKENS);
  totals.hexOutsideDefinitions += countHexOutsideDefinitions(source);
}

function countInlineTsxStyles(dir: string): number {
  let count = 0;
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) count += countInlineTsxStyles(full);
    else if (entry.endsWith(".tsx"))
      count += (readFileSync(full, "utf8").match(/style=\{\{/g) ?? []).length;
  }
  return count;
}
const inlineTsxStyles = countInlineTsxStyles("src");

function ratchet(name: keyof typeof BASELINES, actual: number) {
  assert.ok(
    actual <= BASELINES[name],
    `token-drift ratchet "${name}" went UP: ${actual} > baseline ${BASELINES[name]}. ` +
      `New hardcoded values need tokens (docs/coven-design-language.md §9 rule 1); ` +
      `if this one is genuinely dynamic/off-scale by design, raise the baseline in this PR and justify it.`,
  );
  if (actual < BASELINES[name]) {
    console.log(
      `[token-drift] ${name}: ${actual} < baseline ${BASELINES[name]} — lower the baseline to bank the progress`,
    );
  }
}

ratchet("offScaleFontSizePx", totals.offScaleFontSizePx);
ratchet("offScaleSpacingPx", totals.offScaleSpacingPx);
ratchet("offScaleRadiusPx", totals.offScaleRadiusPx);
ratchet("hexOutsideDefinitions", totals.hexOutsideDefinitions);
ratchet("inlineTsxStyles", inlineTsxStyles);

console.log(
  `design-token-drift: ok (codemod no-op over ${files.length} css files; ratchets ` +
    `font=${totals.offScaleFontSizePx} space=${totals.offScaleSpacingPx} radius=${totals.offScaleRadiusPx} ` +
    `hex=${totals.hexOutsideDefinitions} inline=${inlineTsxStyles})`,
);
