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

// ── Phrase → plan tracking (cave-rdfc) ───────────────────────────────────────
// A parsed schedule that no named preset represents must survive as the
// "custom" preset carrying the exact recurrence — never silently downgrade to
// a one-shot (the old mon,wed,fri bug).
assert.match(modal, /return \{ preset: "custom", customRec: rec \};/, "unrepresentable recurrences map to the custom preset");
assert.match(modal, /if \(preset === "custom"\) return customRec \?\? \{ type: "none" \};/, "submit honors the custom recurrence verbatim");
assert.match(modal, /whenText: whenText\.trim\(\) \|\| null,/, "the human phrase is persisted with the draft");
assert.match(modal, /const \[whenDirty, setWhenDirty\] = useState\(false\);/, "edit mode tracks phrase dirtiness");
assert.match(modal, /if \(isEditing && !whenDirty\) return;/, "retyping the phrase in edit mode retakes the picker");

// The plan echo shows the cadence sentence and upcoming fires, announced to AT.
assert.match(modal, /describeRecurrence\(planRecurrence, \{ hour12 \}\)/, "plan echo describes the cadence in words");
assert.match(modal, /nextOccurrences\(planRecurrence, Date\.now\(\), 3\)/, "plan echo lists the next 3 concrete fires");
assert.match(modal, /aria-live="polite"/, "plan echo is announced politely to AT");
assert.match(modal, /\{planCadence \? "Repeats" : "Once"\}/, "plan echo distinguishes one-shots from repeats");

// ── Both paths carry link ────────────────────────────────────────────────────
assert.match(modal, /link,/, "draft submitted to create/update should include the link");

// Accessible dialog: role/aria-modal/labelled heading + focus trap.
assert.ok(modal.includes('import { useFocusTrap } from "@/lib/use-focus-trap"'), "imports useFocusTrap");
assert.ok(modal.includes("useFocusTrap(open, dialogRef, { onEscape: onClose })"), "traps focus + closes on Escape");
assert.ok(modal.includes('role="dialog"') && modal.includes('aria-modal="true"'), "overlay exposes dialog semantics");
assert.ok(modal.includes('aria-labelledby="new-reminder-title"'), "dialog labelled by heading");
assert.ok(modal.includes('id="new-reminder-title"'), "heading carries labelledby id");

// Shared control primitives/radius tokens.
assert.ok(modal.includes('import { Button } from "@/components/ui/button"'), "modal action buttons use the shared Button primitive");
assert.ok(modal.includes('import { IconButton } from "@/components/ui/icon-button"'), "modal close button uses the shared IconButton primitive");
assert.doesNotMatch(modal, /<button\b/, "modal should not hand-roll button controls");
assert.doesNotMatch(modal, /rounded-md/, "modal should use control radius tokens instead of hard-coded rounded-md");

console.log("new-reminder-modal.test.ts: ok");
