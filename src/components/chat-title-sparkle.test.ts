// @ts-nocheck
// Source pins for cave-quiva — the title row's "name this chat" sparkle
// (Chat.dc.html 2a ②). These pin the contracts the control depends on:
// that it is conditional on a transcript being in scope, that its state is
// carried for assistive tech and not only in opacity, and that the naming
// itself stays on the pure offline heuristic rather than a titling round-trip.
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";

const header = readFileSync(new URL("./chat-session-header.tsx", import.meta.url), "utf8");
const chatView = readFileSync(new URL("./chat-view.tsx", import.meta.url), "utf8");
const css = readFileSync(
  new URL("../styles/cave-chat/session-chrome.css", import.meta.url),
  "utf8",
);

test("the sparkle only renders when a transcript is actually in scope", () => {
  // A title row with no turns behind it (a rail row, a session chip) must fall
  // back to the manual pencil rather than ship a control that can only no-op.
  assert.match(
    header,
    /\{generateTitle \? \(\s*<button/,
    "the sparkle button is gated on the generateTitle prop",
  );
  assert.match(
    header,
    /generateTitle\?: \(\) => string \| null/,
    "generateTitle is an optional pure derivation, not a required async fetch",
  );
});

test("generation state is exposed to assistive tech, not just as opacity", () => {
  assert.match(header, /aria-busy=\{generating \|\| undefined\}/, "aria-busy carries the run state");
  assert.match(header, /disabled=\{generating\}/, "the control cannot be re-entered mid-run");
  for (const label of ["Generate name", "Generating name"]) {
    assert.ok(
      header.includes(`"${label}"`),
      `the ${label} label is present for the tooltip and the accessible name`,
    );
  }
  // The accessible name must track the state, so both labels feed aria-label.
  assert.match(
    header,
    /aria-label=\{generating \? "Generating name" : "Generate name"\}/,
    "the accessible name flips with the state",
  );
});

test("a null derivation leaves the existing title alone", () => {
  // Blanking a chat's name because the heuristic had nothing to say would be a
  // destructive no-op; the guard is what makes the control safe to mash.
  assert.match(
    header,
    /const next = generateTitle\?\.\(\)\?\.trim\(\);\s*\n\s*if \(!next\) return;/,
    "an empty derivation returns before any PATCH",
  );
});

test("the chat view supplies the title from the transcript it already holds", () => {
  assert.match(
    chatView,
    /import \{ generateChatTitle \} from "@\/lib\/chat-title-generation";/,
    "the pure heuristic is the naming engine",
  );
  assert.match(
    chatView,
    /useCallback\(\(\) => generateChatTitle\(turns\), \[turns\]\)/,
    "the derivation reads the live turns",
  );
  assert.match(chatView, /generateTitle=\{generateTitleFromTranscript\}/, "MetaLine receives it");
  // No titling route: the control must keep working with the daemon down.
  assert.ok(
    !/api\/sessions\/[^"']*\/title/.test(chatView + header),
    "naming does not depend on a titling round-trip",
  );
});

test("the sparkle is hover-revealed and the title dims while it runs", () => {
  // Pin the declarations individually — a lazy [\s\S]*? across the whole sheet
  // would pass on unrelated rules and prove nothing.
  const spark = css.match(/\.cave-chat-title-spark \{[^}]*\}/);
  assert.ok(spark, ".cave-chat-title-spark is declared");
  assert.match(spark[0], /opacity:\s*0;/, "the glyph starts hidden so the header reads title-first");

  const reveal = css.match(/\.cave-chat-title:hover \.cave-chat-title-spark[^{]*\{[^}]*\}/);
  assert.ok(reveal, "hover/focus reveals the glyph");
  assert.match(reveal[0], /opacity:\s*1;/, "the reveal sets full opacity");
  assert.match(
    reveal[0],
    /focus-visible/,
    "keyboard focus reveals it too — hover alone would strand keyboard users",
  );

  const dim = css.match(/\.cave-chat-title button\[data-generating="true"\] \{[^}]*\}/);
  assert.ok(dim, "the title dims while the rename is in flight");
  assert.match(dim[0], /opacity:\s*0\.35;/, "the design's 0.35 dim");
});
