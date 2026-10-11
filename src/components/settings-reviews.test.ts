// @ts-nocheck
// #5930: Settings › General › Reviews owns "Include my pull requests in
// Reviews" (default on). Source pins: the switch writes the server-backed
// github preference, announces the change, and is findable from search.
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";

import { SETTINGS_INDEX } from "./settings-sections.ts";

const reviews = readFileSync(new URL("./settings-reviews.tsx", import.meta.url), "utf8");
const shell = readFileSync(new URL("./settings-shell.tsx", import.meta.url), "utf8");

test("General renders the Reviews group", () => {
  assert.match(shell, /import \{ ReviewsSettingsGroup \} from "\.\/settings-reviews";/);
  assert.match(shell, /<ReviewsSettingsGroup \/>/);
  assert.match(reviews, /<SettingsGroup label="Reviews" variant="ruled" panel=\{false\}>/);
});

test("the include switch reads and writes github.reviewOwnPrs", () => {
  assert.match(reviews, /label="Include my pull requests in Reviews"/);
  assert.match(reviews, /role="switch"/);
  assert.match(reviews, /aria-checked=\{github\.reviewOwnPrs\}/);
  assert.match(reviews, /updateAppPreferences\(\{ github: \{ reviewOwnPrs: !github\.reviewOwnPrs \} \}\)/);
  assert.match(reviews, /announce\(/, "the change is announced");
  assert.match(reviews, /showSettingsSavedAfterPreferencesFlush\(\)/, "the save is confirmed like every other switch");
});

test("search finds the Reviews group", () => {
  const entry = SETTINGS_INDEX.find((e) => e.section === "general" && e.group === "Reviews");
  assert.ok(entry, "General › Reviews is a search destination");
  for (const word of ["pull requests", "own", "review"]) assert.match(entry.keywords, new RegExp(word));
});
