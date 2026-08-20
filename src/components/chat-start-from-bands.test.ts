// @ts-nocheck
// Source pins for the shared new-session launcher (Chat.dc.html option 2b).
//
// The design's whole point is that the two new-session surfaces stop being two
// designs: a brand-new chat (ChatNewDashboard) and an existing zero-turn
// session (ChatEmptyState) render the SAME bands from the SAME model. These
// pins protect the three things that make that true — one component, one tint
// mechanism, one source of counts — plus the band anatomy the mock specifies.
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";

const bands = readFileSync(new URL("./chat-start-from-bands.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../styles/cave-chat/start-from.css", import.meta.url), "utf8");
const facade = readFileSync(new URL("../styles/cave-chat.css", import.meta.url), "utf8");
const emptyState = readFileSync(new URL("./chat-empty-state.tsx", import.meta.url), "utf8");
const dashboard = readFileSync(new URL("./chat-new-dashboard.tsx", import.meta.url), "utf8");

test("both new-session surfaces render through this one component", () => {
  for (const [name, source] of [["zero-turn page", emptyState], ["new-chat dashboard", dashboard]]) {
    assert.match(
      source,
      /import \{\s*ChatStartFromBands,[\s\S]{0,160}?\} from "@\/components\/chat-start-from-bands";/,
      `${name} imports the shared launcher`,
    );
    assert.match(source, /<ChatStartFromBands bands=\{bands\}/, `${name} renders it`);
    assert.match(
      source,
      /const bands: StartFromBand\[\] = \[\];/,
      `${name} assembles bands rather than hand-rolling sections`,
    );
  }
  // A surface that grew its own strip markup would defeat the point.
  for (const source of [emptyState, dashboard]) {
    assert.doesNotMatch(source, /cave-sf__/, "band markup lives in the shared component only");
  }
});

test("counts and notes come from the shared pure model, never from the caller", () => {
  assert.match(
    bands,
    /import type \{ StartFromGroupMeta, StartFromKind \} from "@\/lib\/chat-start-from";/,
    "the band's head is typed by the shared group model",
  );
  assert.match(bands, /className="cave-sf__source-count">\{meta\.count\}/, "the source shows meta.count");
  assert.match(bands, /title=\{meta\.note\}/, "the source exposes meta.note");
  assert.match(bands, /className="cave-sf__source-label">\{meta\.label\}/, "the source shows meta.label");
  assert.doesNotMatch(
    bands,
    /\.length \+ " of " \+|\$\{[a-z]+\.length\} of /i,
    "the component never formats its own counts — startFromCount owns that",
  );
});

test("launcher uses source tabs and one paged tile deck", () => {
  assert.match(
    bands,
    /role="tablist" aria-label="Start-from sources"/,
    "sources switch in one compact tab row",
  );
  assert.match(bands, /aria-selected=\{active\}/, "the active source is exposed accessibly");
  assert.match(bands, /className="cave-sf__deck"[\s\S]{0,80}role="tabpanel"/, "only one source deck renders at a time");
  assert.match(bands, /const START_FROM_PAGE_SIZE = 4;/, "each page is capped to four tiles");
  assert.match(bands, /pageItems = items\.slice\(pageStart, pageStart \+ START_FROM_PAGE_SIZE\)/, "the deck paginates instead of scrolling");
  assert.match(bands, /aria-label="Previous start-from page"/, "the deck has explicit previous-page navigation");
  assert.match(bands, /aria-label="Next start-from page"/, "the deck has explicit next-page navigation");
  // Tile: a clamped title with one short badge, then a dotted mono sub-line.
  assert.match(bands, /className="cave-sf__tile-title">\{item\.tile\.title\}/, "tiles lead with the title");
  assert.match(bands, /className="cave-sf__tile-badge">\{item\.tile\.badge\}/, "tiles carry one badge");
  assert.match(
    bands,
    /className="cave-sf__tile-dot" aria-hidden/,
    "the sub-line leads with the band's tint dot",
  );
  assert.match(
    bands,
    /aria-label=\{item\.tile\.ariaLabel \?\? item\.tile\.title\}/,
    "every tile has an accessible name, falling back to its title",
  );
});

test("one tint mechanism — a per-source custom property, not six colour rules", () => {
  assert.match(css, /\.cave-sf__source \{\s*\n\s*--sf-tint:/, "the source tab declares the tint variable");
  for (const kind of ["chats", "tasks", "queue", "reviews"]) {
    assert.match(
      css,
      new RegExp(`\\.cave-sf \\[data-kind="${kind}"\\] \\{\\s*\\n\\s*--sf-tint: [^;]+;\\s*\\n\\}`),
      `${kind} sets the tint and nothing else`,
    );
  }
  // Every tinted surface derives from the variable, so a new source is one line.
  for (const surface of [
    'cave-sf__source\\[aria-selected="true"\\]',
    "cave-sf__tile:hover:not\\(:disabled\\)",
    "cave-sf__tile-dot",
  ]) {
    assert.match(
      css.match(new RegExp(`\\.${surface} \\{[\\s\\S]*?\\n\\}`))[0],
      /var\(--sf-tint\)/,
      `.${surface} derives its colour from --sf-tint`,
    );
  }
});

test("the sheet stays on tokens and ships through the chat facade", () => {
  assert.match(facade, /@import "\.\/cave-chat\/start-from\.css";/, "the facade imports the sheet");
  // One deliberate literal: Reviews' GitHub blue, which has no token (the same
  // exception activity.css's read-tool accent takes). Anything else is drift.
  const hexes = css.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
  assert.deepEqual(hexes, [], "no hardcoded hex — every colour is a token or a derived mix");
  const literals = css.match(/oklch\([^)]*\)/g) ?? [];
  assert.deepEqual(
    literals,
    ["oklch(0.74 0.13 235)"],
    "the only raw colour is the Reviews blue, and it is commented as such",
  );
  assert.match(
    css,
    /there is no blue token/,
    "the literal carries the reason it is a literal",
  );
});

test("the deck stays within one or two rows and never scrolls internally", () => {
  const deck = css.match(/\.cave-sf__deck \{[\s\S]*?\n\}/)[0];
  assert.match(deck, /grid-template-columns: repeat\(4, minmax\(0, 1fr\)\)/, "desktop presents one four-card row");
  assert.match(
    css,
    /@media \(max-width: 760px\)[\s\S]*?\.cave-sf__deck \{[\s\S]*?grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/,
    "compact panes use two columns and at most two rows",
  );
  assert.doesNotMatch(deck, /overflow-[xy]: auto/, "the deck never hides choices behind a scrollbar");
  assert.match(
    css.match(/\.cave-sf__tile \{[\s\S]*?\n\}/)[0],
    /min-width: 0/,
    "tiles share the available grid width instead of forcing overflow",
  );
});
