// @ts-nocheck
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./voice-call-button.tsx", import.meta.url), "utf8");

test("button renders disabled when familiar.voiceProvider is unset", () => {
  assert.match(
    source,
    /disabled=\{[^}]*!familiar\.voiceProvider[^}]*\}/,
    "voice-call-button should disable itself when voiceProvider is unset",
  );
});

test("button surfaces voice_not_configured tooltip when disabled", () => {
  assert.match(
    source,
    /title=\{[^}]*Open Familiar Studio/,
    "voice-call-button should show a 'Open Familiar Studio' hint when disabled",
  );
});

test("button calls onOpen when clicked", () => {
  assert.match(
    source,
    /onClick=\{[^}]*onOpen[^}]*\}/,
    "voice-call-button should wire onClick to the onOpen prop",
  );
});

test("button uses a phone icon", () => {
  assert.match(
    source,
    /ph:phone/i,
    "voice-call-button should use a phone iconify glyph",
  );
});
