// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const modal = readFileSync(new URL("./new-reminder-modal.tsx", import.meta.url), "utf8");

// ── Edit mode ────────────────────────────────────────────────────────────────
assert.match(modal, /editing\?: ReminderEdit;/, "modal should accept an optional editing prop");
assert.match(modal, /onUpdate\?: \(id: string, draft: NewReminderDraft\) => Promise<void> \| void;/, "modal should accept an onUpdate handler");
assert.match(modal, /const isEditing = !!editing;/, "modal should derive an editing flag");
assert.match(
  modal,
  /\{isEditing \? "Edit reminder" : "New reminder"\}/,
  "heading should switch to 'Edit reminder' in edit mode",
);
assert.match(
  modal,
  /if \(editing && onUpdate\) \{\s*await onUpdate\(editing\.id, draft\);/,
  "submit should call onUpdate(id, draft) when editing",
);
assert.match(modal, /: "Save"/, "submit label should read 'Save' in edit mode");
assert.match(modal, /\? "Saving…"/, "submit label should read 'Saving…' while saving an edit");

// ── Edit prefill maps recurrence back to a preset ────────────────────────────
assert.match(modal, /function presetForRecurrence/, "should map a stored recurrence back to a picker preset");
assert.match(modal, /setRecurPreset\(preset\)/, "edit prefill should restore the recurrence preset");
assert.match(modal, /setLink\(editing\.link \?\? null\)/, "edit prefill should restore the link");

// ── Both paths carry link ────────────────────────────────────────────────────
assert.match(modal, /link,/, "draft submitted to create/update should include the link");

console.log("new-reminder-modal.test.ts: ok");
