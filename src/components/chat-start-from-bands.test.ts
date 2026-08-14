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
  assert.match(bands, /className="cave-sf__band-count">\{meta\.count\}/, "the head shows meta.count");
  assert.match(bands, /className="cave-sf__band-note">\{meta\.note\}/, "the head shows meta.note");
  assert.match(bands, /className="cave-sf__band-label">\{meta\.label\}/, "the head shows meta.label");
  assert.doesNotMatch(
    bands,
    /\.length \+ " of " \+|\$\{[a-z]+\.length\} of /i,
    "the component never formats its own counts — startFromCount owns that",
  );
});

test("band anatomy follows the mock: tinted head, caret, strip of tiles", () => {
  assert.match(bands, /aria-expanded=\{open\}/, "the head is the collapse control, and says so");
  assert.match(
    bands,
    /data-kind=\{meta\.kind\} data-open=\{open\}/,
    "tint and collapse state ride data attributes the sheet reads",
  );
  assert.match(bands, /\{open \? \(\s*\n?\s*<div className="cave-sf__strip"/, "collapsing removes the strip");
  // Tile: a clamped title with one short badge, then a dotted mono sub-line.
  assert.match(bands, /className="cave-sf__tile-title">\{tile\.title\}/, "tiles lead with the title");
  assert.match(bands, /className="cave-sf__tile-badge">\{tile\.badge\}/, "tiles carry one badge");
  assert.match(
    bands,
    /className="cave-sf__tile-dot" aria-hidden/,
    "the sub-line leads with the band's tint dot",
  );
  assert.match(
    bands,
    /aria-label=\{tile\.ariaLabel \?\? tile\.title\}/,
    "every tile has an accessible name, falling back to its title",
  );
});

test("one tint mechanism — a per-band custom property, not six colour rules", () => {
  assert.match(css, /\.cave-sf__band \{\s*\n\s*--sf-tint:/, "the band declares the tint variable");
  for (const kind of ["chats", "tasks", "queue", "reviews"]) {
    assert.match(
      css,
      new RegExp(`\\.cave-sf__band\\[data-kind="${kind}"\\] \\{\\s*\\n\\s*--sf-tint: [^;]+;\\s*\\n\\}`),
      `${kind} sets the tint and nothing else`,
    );
  }
  // Every tinted surface derives from the variable, so a new source is one line.
  for (const surface of ["cave-sf__band-head", "cave-sf__tile", "cave-sf__tile-dot"]) {
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

test("the strip scrolls sideways rather than wrapping or growing the band", () => {
  const strip = css.match(/\.cave-sf__strip \{[\s\S]*?\n\}/)[0];
  assert.match(strip, /overflow-x: auto/, "overflow scrolls, so band height is independent of count");
  assert.doesNotMatch(strip, /flex-wrap/, "tiles never wrap into a second row");
  assert.match(
    css.match(/\.cave-sf__tile \{[\s\S]*?\n\}/)[0],
    /width: 224px/,
    "tiles are the mock's fixed 224px, so the strip reads as a rhythm",
  );
});
