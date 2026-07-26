import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./calendar-view-primitives.tsx", import.meta.url), "utf8");

assert.match(source, /export const FamiliarColorContext/, "calendar item primitives share the familiar accent provider");
assert.match(source, /export function relTimeShort/, "agenda relative-time behavior has a focused owner");
assert.match(source, /if \(abs < 60 \* 12\)/, "relative-time cues retain their 12-hour cap");
assert.match(source, /export function defaultEntryFireAt/, "new-entry scheduling defaults are shared by all calendar views");
assert.match(source, /export function ItemChip/, "agenda item rendering is a reusable calendar primitive");
assert.match(source, /export function AgendaDeadlineRow/, "board deadline rendering remains distinct from reminders");
