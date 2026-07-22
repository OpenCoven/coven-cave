import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import {
  DEFAULT_STOP_PHRASE,
  STOP_PHRASE_MAX_LENGTH,
  matchesStopPhrase,
  normalizeStopUtterance,
  parseStopPhrases,
} from "./stop-phrase.ts";
import {
  applyPreferencesPatch,
  createDefaultPreferences,
  normalizeCavePreferences,
  validatePreferencesPatch,
} from "./preferences-schema.ts";

// ── Matching semantics ────────────────────────────────────────────────────────

test("matchesStopPhrase: exact phrase matches through case/whitespace/punctuation", () => {
  assert.equal(matchesStopPhrase("stop", "stop"), true);
  assert.equal(matchesStopPhrase("Stop", "stop"), true);
  assert.equal(matchesStopPhrase("  STOP!  ", "stop"), true);
  assert.equal(matchesStopPhrase("stop.", "stop"), true);
  assert.equal(matchesStopPhrase("stop…", "stop"), true);
  assert.equal(matchesStopPhrase("halt  right   there", "Halt right there"), true);
});

test("matchesStopPhrase: containing the phrase is NOT a match — instructions pass through", () => {
  assert.equal(matchesStopPhrase("stop using tabs", "stop"), false);
  assert.equal(matchesStopPhrase("please stop", "stop"), false);
  assert.equal(matchesStopPhrase("stopwatch", "stop"), false);
  assert.equal(matchesStopPhrase("don't stop", "stop"), false);
});

test("matchesStopPhrase: comma-separated preference offers multiple options", () => {
  const phrases = "stop, cancel , HALT,abort";
  assert.equal(matchesStopPhrase("stop", phrases), true);
  assert.equal(matchesStopPhrase("Cancel!", phrases), true);
  assert.equal(matchesStopPhrase("halt", phrases), true);
  assert.equal(matchesStopPhrase("  abort.  ", phrases), true);
  assert.equal(matchesStopPhrase("continue", phrases), false);
  // Still exact-match only, per option.
  assert.equal(matchesStopPhrase("cancel the meeting", phrases), false);
  assert.equal(matchesStopPhrase("stop, cancel", phrases), false);
});

test("parseStopPhrases: normalizes, dedupes, and drops empty segments", () => {
  assert.deepEqual(parseStopPhrases("stop, cancel , HALT,abort"), [
    "stop",
    "cancel",
    "halt",
    "abort",
  ]);
  assert.deepEqual(parseStopPhrases("stop,,  ,Stop!,stop"), ["stop"]);
  assert.deepEqual(parseStopPhrases(","), []);
  assert.deepEqual(parseStopPhrases(""), []);
});

test("default stop phrase preference ships multiple comma-separated options", () => {
  const options = parseStopPhrases(DEFAULT_STOP_PHRASE);
  assert.ok(options.length > 1, "default offers more than one stop phrase");
  assert.ok(options.includes("stop"));
  for (const option of options) assert.equal(matchesStopPhrase(option, DEFAULT_STOP_PHRASE), true);
});

test("matchesStopPhrase: empty/blank phrase disables matching entirely", () => {
  assert.equal(matchesStopPhrase("stop", ""), false);
  assert.equal(matchesStopPhrase("", ""), false);
  assert.equal(matchesStopPhrase("stop", "   "), false);
  assert.equal(matchesStopPhrase("stop", " , ,"), false);
  // Punctuation-only phrase normalizes to empty → off.
  assert.equal(matchesStopPhrase("!!!", "!!!"), false);
});

test("matchesStopPhrase: oversized composer text short-circuits without matching", () => {
  const huge = `stop ${"x".repeat(STOP_PHRASE_MAX_LENGTH * 4)}`;
  assert.equal(matchesStopPhrase(huge, "stop"), false);
});

test("normalizeStopUtterance canonicalizes case, whitespace, trailing punctuation", () => {
  assert.equal(normalizeStopUtterance("  Stop  That!! "), "stop that");
  assert.equal(normalizeStopUtterance("STOP."), "stop");
  assert.equal(normalizeStopUtterance(""), "");
});

// ── Preference schema plumbing ────────────────────────────────────────────────

test("preferences default stopPhrase and survive normalize/patch round-trips", () => {
  const defaults = createDefaultPreferences();
  assert.equal(defaults.general.stopPhrase, DEFAULT_STOP_PHRASE);

  // Legacy files without the field normalize to the default.
  const legacy = normalizeCavePreferences({ general: { newsHeadlines: false } });
  assert.equal(legacy.general.stopPhrase, DEFAULT_STOP_PHRASE);

  // A patch can change it; empty string persists (that is the off switch).
  const custom = applyPreferencesPatch(defaults, { general: { stopPhrase: "halt" } });
  assert.equal(custom.general.stopPhrase, "halt");
  const disabled = applyPreferencesPatch(custom, { general: { stopPhrase: "" } });
  assert.equal(disabled.general.stopPhrase, "");
  assert.equal(disabled.general.newsHeadlines, true);
});

test("validatePreferencesPatch validates stopPhrase as a trimmed bounded string", () => {
  const parsed = validatePreferencesPatch({
    general: { stopPhrase: `  halt${"x".repeat(STOP_PHRASE_MAX_LENGTH * 4)}` },
  });
  const phrase = parsed.general?.stopPhrase ?? "";
  assert.equal(phrase.length, STOP_PHRASE_MAX_LENGTH);
  assert.equal(phrase.startsWith("halt"), true);
  assert.throws(() => validatePreferencesPatch({ general: { stopPhrase: 7 } }));
});

// ── Wiring pins ───────────────────────────────────────────────────────────────

const repoRoot = path.resolve(import.meta.dirname, "..", "..");

test("chat composer send() intercepts the stop phrase before busy queueing", () => {
  const src = readFileSync(path.join(repoRoot, "src/components/chat-view.tsx"), "utf8");
  assert.match(src, /matchesStopPhrase, readStopPhrase \} from "@\/lib\/stop-phrase"/);
  const intercept = src.indexOf("busy && matchesStopPhrase(text, readStopPhrase())");
  assert.ok(intercept > 0, "send() consults the stop phrase while busy");
  const queue = src.indexOf("if (busy) {", intercept);
  assert.ok(queue > intercept, "intercept sits before the busy queue path");
  const between = src.slice(intercept, queue);
  assert.match(between, /cancelSend\(\)/);
});

test("Settings → General exposes the stop phrases field", () => {
  const src = readFileSync(path.join(repoRoot, "src/components/settings-shell.tsx"), "utf8");
  assert.match(src, /<StopPhraseField \/>/);
  assert.match(src, /writeStopPhrase\(draft\)/);
  assert.match(src, /aria-label="Stop phrases"/);
});
