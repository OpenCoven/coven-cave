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
  offScaleFontSizePx: 139, // -2: banked — the familiar-analytics workbench rebuild ("Familiar Analytics.dc.html" handoff, cave-l4ttp) ships every size in the new sheet on the type scale, and retiring the old scrolling page's hero/KPI/section chrome reclaimed two off-scale sizes outright. -5: banked — the GitHub triage stream + detail rebuild ("Cody Github.dc.html" handoff) ships every size in both new sheets on the type scale, and retiring the table + the old glass masthead reclaimed their off-scale sizes outright. // -5: banked — the GitHub card composer ("Final Card Components.dc.html" handoff, cave-076kh) ships fully on the type scale, and rebasing onto current main reclaimed the rest. +1: chat session redesign (Chat.dc.html 2a) — the assistant turn's serif familiar name keeps the design's 18px step, between --text-lg 16px and --text-xl 20px; every other size in the new session-chrome sheet is on the type scale (the new-session hero uses a clamp off the display size). 10.5px/11.5px/… — need per-case renormalization to the type scale (banked: canvas-editor.css on the type scale; familiar-tab retokenized the old hero/section styles; research-desk tabs shipped fully on the type scale, -3; familiar-tab five-section rebuild shipped fully on the type scale, -1; projects access page rebuild shipped fully on the type scale, -2). +1: Research Reader (Research Reader.dc.html handoff) — the EB Garamond findings hero <h1> keeps the design's 31px display size (between --text-display 28px and the next step); every other reader font-size uses the type scale and compact mono labels use the `font:` shorthand. -3: orphaned skill-browser removal reclaimed its off-scale sizes. -2: Phone control-sheet extraction replaced the legacy block with section-local tokenized CSS.
  offScaleSpacingPx: 1631, // -15: banked — the Coding Room rebuild and the PR reader (cave-0rcku, cave-l82dm) are token-only stylesheets, and retiring the context dock's CSS took its off-scale insets with it. -8: banked — the siderail parity work: one --rail-pad inset across both rails and one vertical rhythm retired the containers' own 6px/8px/10px literals along with the forked header chrome. -6: banked — the siderail's shared header plus the one-inset cleanup: the Home nav scroll, the section tabs and the footer now all read var(--rail-pad) instead of their own 6px/8px, so the rail lines up in both rooms and three literals went with it. -5: banked — the siderail's shared header (cave sidebar parity) replaced the two hand-copied Home/Chat header blocks with one .rail-header sheet, so the forked off-grid paddings and gaps went with them. +1: live call transcript (cave-zr9dx) — the spoken-word highlight's `padding: 0 2px`. The <mark> tints the words the familiar is voicing INSIDE a turn bubble that is already tinted, so the run needs a hair of inline padding or the tint touches the glyphs on both sides; --space-1 (4px) at that scale reads as a gap in the sentence, which is the one thing a mid-sentence highlight must not do. Same micro-mark family the Chart Room, Weaves, Review Deck and GitHub-composer handoffs banked. Every other spacing value the call overlay added — 5 gaps, 3 paddings and the reply form's stack — snapped to --space-1/-2/-3 in this PR, so the sheet went +1 rather than the +11 it started at. // -65: banked — the familiar-analytics workbench rebuild (cave-l4ttp) snapped the mock's 5/6/7/9/10/11/13/14/15/18/22/26px paddings and gaps to --space-1..-6 across the whole new sheet, and retiring the old page's section/KPI/hero chrome reclaimed the rest. What remains in the sheet is only the 1/2/3px micro-mark family (badge padding, tick nudges) the earlier handoffs already banked. +4: GitHub triage stream + detail rebuild ("Cody Github.dc.html" handoff) — the mock's 5/7/9/10/11/13/14px paddings and gaps were ALL snapped to --space-1..-4 in this PR, so what remains is only the micro-mark family the Chart Room, Weaves, Review Deck and GitHub-composer handoffs already banked: 6px glyph-to-label gaps (8px separates an icon from its word, which is exactly what a stage badge, a signal chip and a gate label must not do), 6px inline padding on the 17-19px stage badges and row verbs (--space-2 turns a 17px pill into a lozenge), and the 2/3px nudges on the signal strip, the peek margin and the facts column. Retiring the table and the old glass masthead reclaimed most of what the two new sheets added, which is why this is +4 rather than the +40 they started at; every font-size in both sheets is on the type scale (-5 banked above) and tokenize-css.mjs is a no-op over them.
  offScaleRadiusPx: 231, // -2: banked — the same shared-header extraction retired the Chat rail's hardcoded 10px New-chat radius (and its switcher twin) in favour of var(--radius-control), which is the drift that made the two rails visibly disagree across themes. +1: GitHub triage stream ("Cody Github.dc.html" handoff) — the row's three-segment signal strip paints 4px-wide bars, and a 1px radius is the only step that reads as a rounded mark rather than a lozenge; --radius-sm turns a 4px bar into a dot. Same short-solid-mark family the research-desk, Research Reader, daily-report and Rituals-sparkline entries banked. The strip's 2px track/fill radii reuse the existing budget-meter step, every container corner in the new stream and detail sheets uses --radius-sm/-md/-lg/-control/-pill/-panel, and both sheets went DOWN on spacing and font-size in the same PR. // -2: banked after the chat-detail merge removed two off-step radii. +4: Chart Room v2 (cave-iuc8h) — the 2px project dot and its 3px large variant, plus the 2px progress track and its fill: short solid marks 6-10px across, the same family the research-desk, Research Reader, daily-report, Projects and GitHub-composer handoffs banked (--radius-control 8px reads as a full circle at that size, which is the one shape a square project swatch must not be). Every container corner in the sheet uses --radius-sm/-md/-control/-pill, and the dependency port is a true 50% circle. // +6: chat session redesign (Chat.dc.html 2a/2b) — the context row's 6px mono chip and 4px stat cell, the group headers' 4px count pills and the rail row's 2px state tick: short compact marks between --radius-control 8px and square. Every container corner uses --radius-card/--radius-panel/--radius-pill. 4px/6px/10px/14px/… radii between the sanctioned steps. +5: research-desk 2px/4px accent-mark radii (short solid marks, not container corners). -5: projects access page rebuild removed the hub's off-step radii. +1: Research Reader accent-mark radius (the section-heading 2px tick, same short-solid-mark family as the research desk). -3: orphaned skill-browser removal reclaimed its off-step radii. -3: Phone control-sheet extraction replaced the legacy block with section-local tokenized CSS. +8: daily report redesign (2a handoff) — the chaptered-day surface's 1/2/3/4px radii on short solid marks (week-strip activity bars, streak pips, swimlane segments and merge ticks, the spine's accent rail), the same short-mark family the research-desk and Research Reader handoffs banked; every container corner snapped to --radius-control/-card/-panel/-sm in the same PR. -2: Canvas page redesign (Canvas.dc.html handoff) — the gallery card's 10px corner and the inspector swatch's `50%` circle snapped to --radius-card and --radius-pill. +3: Projects access refresh — the 5px radius on the card select-checkbox (17px) and the two 18px icon buttons (disclose, gear); --radius-control (8px) reads as a circle at those sizes. Every container corner in the new sheet uses --radius-control/-card/-pill. +1: the Rituals inbox daily-report row's 24-bar merge sparkline, same short-solid-mark family (a 3px-wide bar cannot take a scale radius). +8: GitHub card composer (cave-076kh) — the composer's 4px chips (reactions, assignee/label chips, gate-row actions, scope chips, toolbar buttons) and 3px segment thumbs (Write/Preview, merge method, verb mode), the same short-compact-mark family the research-desk, Research Reader, daily-report and Projects handoffs banked; --radius-control (8px) reads as a pill at a 19-22px chip height. Every control corner uses --radius-sm (the design's own "5-6px control" band) and every container --radius-control/--radius-pill.
  hexOutsideDefinitions: 0, // hex in render CSS (token definitions excluded) — -104: cave-gyh2 chunk 1 (dropped stale var(--token, #hex) fallbacks; mapped accent/danger/success fills to their semantic foregrounds; promoted --color-success-foreground and the codex --cv-* strays). -1 banked in the design-doc reconcile PR (cave-kf3x). -51: cave-yxiz chunk 2 zeroed the ratchet — document grounds (sketch/preview/thumb/QR) now share the fixed --surface-paper token in foundations.css; GitHub state badges promote --gh-merged/--gh-merged-ink and pair open/closed with the semantic status foregrounds; profile-card strays joined the --pfc-* palette; the magic-cast spell art promotes --spell-violet/--spell-core; QR ink, dashboard mark ink, and the avatar photo-overlay ink became local definitions; and pure shade/alpha arithmetic in color-mix()/mask gradients uses the CSS black/white keywords (sanctioned: they're mix anchors, not colors — matching the pre-existing keyword usage in dashboard.css and surface-compact-calendar.css). New hexes belong in token definitions; keywords are only for mix/mask arithmetic.
  inlineTsxStyles: 215, // +4: the Coding Room rebuild ("Cody Code Reading v2.dc.html" handoff, cave-0rcku) adds four numbers no stylesheet can hold: the review rail's USER-DRAGGED width, the two segments of its added/removed bar (each a percentage of that session's own diff), and the terminal drawer's animated height. The fixed constants from the same frame — the 272px tree column and the 28px collapsed spine — deliberately did NOT come here; they are layout constants and live in surface-code-room.css. +3: Research Desk rebuild ("Research Desk App.dc.html" handoff, cave-na7oc) binds three custom properties that only exist at render time: `--research-progress` (the stepper wash's width, a fraction of settled phases), `--research-bound-fill` (each bound reading's meter, a fraction of that mission's own budget) and `--research-queue-width` (the run queue's user-dragged, persisted pixel width). All three are per-mission or per-user measurements — a stylesheet can hold the ramp and the track, but not the number. Everything else the four new/rebuilt research sheets add is class-driven. +1: Sessions surface rebuild ("Chat Session - Prototype.dc.html" handoff, cave-n3jg2) passes `--row-tint` per familiar; the tint is editable user data, so no token can express it. -1: reverting the summoning rite removes its dynamic `--stone-scale` model property. The rest of the inline-style budget is unchanged: remaining sites are still dynamic percentages, measurements, runtime colours, and layout coordinates carried into CSS custom properties rather than static presentation.
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
