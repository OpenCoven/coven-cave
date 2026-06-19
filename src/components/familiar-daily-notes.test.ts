// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./familiar-daily-notes.tsx", import.meta.url), "utf8");

assert.match(source, /export function FamiliarDailyNotes/, "FamiliarDailyNotes must be exported");

assert.match(
  source,
  /fetch\(`\/api\/familiars\/\$\{familiar\.id\}\/notes\?date=\$\{slug\}`\)/,
  "loads a day's note from the per-familiar notes route",
);

assert.match(
  source,
  /method: "POST"[\s\S]*body: JSON\.stringify\(\{ date, notes, reflection \}\)/,
  "saves notes + reflection back to the notes route via POST",
);

assert.match(source, /DAILY_NOTE_SECTIONS\.notes/, "renders the Notes section heading");
assert.match(source, /DAILY_NOTE_SECTIONS\.reflection/, "renders the Self-reflection section heading");

assert.match(source, /id="daily-notes-body"/, "has a Notes textarea");
assert.match(source, /id="daily-notes-reflection"/, "has a Self-reflection textarea");

assert.match(source, /onBlur=\{handleBlurSave\}/, "autosaves on blur");
assert.match(
  source,
  /\(e\.metaKey \|\| e\.ctrlKey\) && e\.key\.toLowerCase\(\) === "s"/,
  "saves on ⌘/Ctrl+S",
);

assert.match(source, /Past entries/, "lists past entries for the familiar");
assert.match(source, /disabled=\{date >= today\}/, "cannot navigate into the future");

console.log("familiar-daily-notes: all assertions passed");
