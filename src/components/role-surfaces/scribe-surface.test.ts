import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  countWords,
  deskSummary,
  parseTags,
  readingTimeLabel,
  scribeStatus,
} from "./scribe-craft.ts";

const surface = readFileSync(new URL("./scribe-surface.tsx", import.meta.url), "utf8");
const register = readFileSync(new URL("./register.tsx", import.meta.url), "utf8");
const docs = readFileSync(new URL("../../../docs/role-surfaces.md", import.meta.url), "utf8");

// ── Craft rules (behavioral, real module) ────────────────────────────────────

test("countWords counts prose tokens, not markdown noise", () => {
  assert.equal(countWords(""), 0);
  assert.equal(countWords("   \n\t "), 0);
  assert.equal(countWords("one two  three\nfour"), 4);
  // Pure punctuation runs aren't words; tokens containing letters/digits are.
  assert.equal(countWords("— * … !!!"), 0);
  assert.equal(countWords("v2 release — 3 fixes"), 4);
});

test("readingTimeLabel rounds at ~200 wpm and stays honest when empty", () => {
  assert.equal(readingTimeLabel(0), "—");
  assert.equal(readingTimeLabel(120), "<1 min read");
  assert.equal(readingTimeLabel(200), "1 min read");
  assert.equal(readingTimeLabel(900), "5 min read");
});

test("parseTags splits like the Knowledge API does", () => {
  assert.deepEqual(parseTags(""), []);
  assert.deepEqual(parseTags("notes, systems  writing"), ["notes", "systems", "writing"]);
  assert.deepEqual(parseTags(" ,  , "), []);
});

test("deskSummary totals drafts, published entries, and words", () => {
  const summary = deskSummary([
    { body: "five words of honest prose", publishedId: "entry-1" },
    { body: "two words", publishedId: null },
    { body: "", publishedId: null },
  ]);
  assert.deepEqual(summary, { drafts: 3, published: 1, words: 7 });
});

test("scribeStatus reads ok on a clear desk and busy while drafting", () => {
  assert.deepEqual(scribeStatus({ drafts: 0, words: 0 }), { label: "desk clear", tone: "ok" });
  assert.deepEqual(scribeStatus({ drafts: 1, words: 40 }), { label: "1 draft · 40 words", tone: "busy" });
  assert.deepEqual(scribeStatus({ drafts: 3, words: 812 }), { label: "3 drafts · 812 words", tone: "busy" });
});

// ── Surface wiring (source pins) ─────────────────────────────────────────────

test("publishing writes real Knowledge Vault entries and republishes in place", () => {
  assert.match(surface, /fetch\("\/api\/knowledge"/);
  assert.match(surface, /method: "POST"/);
  assert.match(surface, /selected\.publishedId \? \{ id: selected\.publishedId \} : \{\}/);
  assert.match(surface, /scope: state\.scope === "global" \? "global" : \[familiarId\]/);
  assert.match(surface, /Republish/);
  assert.match(surface, /openGrimoireDoc\("knowledge"/);
});

test("source material comes from real memory and journal, published works from the vault", () => {
  assert.match(surface, /context\.memory\.listEntries\(\)/);
  assert.match(surface, /fetch\("\/api\/journal"/);
  assert.match(surface, /openGrimoireDoc\("journal"/);
  assert.match(surface, /\/api\/knowledge\?familiarId=\$\{encodeURIComponent\(familiarId\)\}/);
  assert.match(surface, /SurfaceEmpty/);
  assert.match(surface, /useRoleSurfaceState<ScribeState>/);
});

test("the desk exposes errors and state accessibly", () => {
  assert.match(surface, /role="alert"/);
  assert.match(surface, /aria-current=\{draft\.id === state\.selectedId/);
  assert.match(surface, /aria-pressed=\{state\.scope === "familiar"\}/);
  assert.match(surface, /aria-label="Draft body"/);
});

test("registration names the Writing Desk with its own accent and drawer chrome", () => {
  assert.match(register, /id: SCRIBE_SURFACE_ID/);
  assert.match(register, /role: "scribe"/);
  assert.match(register, /title: "Writing Desk"/);
  assert.match(register, /iconName: "ph:feather"/);
  assert.match(register, /accentHue: 320/);
  assert.match(register, /combo: "mod\+shift\+d",\s*\n\s*description: "Toggle the published works drawer"/);
  assert.match(register, /scribeStatus\(deskSummary\(/);
});

test("the Writing Desk is documented as an initial room", () => {
  assert.match(docs, /\*\*Writing Desk\*\* \(`scribe-writing-desk`, role `scribe`\)/);
});
