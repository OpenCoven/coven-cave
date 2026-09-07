import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./calendar-view-primitives.tsx", import.meta.url), "utf8");

assert.match(source, /export const FamiliarColorContext/, "calendar item primitives share the familiar accent provider");
// Not `export function` (cave-25914): relTimeShort is used only by ItemChip in
// this module, and isOverdueReminder only by urgencyColor/urgencyLabel/ItemChip
// here. Pinning the keyword made module-private helpers permanently public —
// the assertion is that the behaviour has ONE owner, which module scope states
// more strongly than an unused export.
assert.match(source, /function relTimeShort/, "agenda relative-time behavior has a focused owner");
assert.doesNotMatch(source, /export function (relTimeShort|isOverdueReminder)/, "…and that owner is module-private, since nothing outside imports it");
assert.match(source, /if \(abs < 60 \* 12\)/, "relative-time cues retain their 12-hour cap");
assert.match(source, /export function defaultEntryFireAt/, "new-entry scheduling defaults are shared by all calendar views");
assert.match(source, /export function ItemChip/, "agenda item rendering is a reusable calendar primitive");
assert.match(source, /export function AgendaDeadlineRow/, "board deadline rendering remains distinct from reminders");
