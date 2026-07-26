import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (rel) => readFile(new URL(`../${rel}`, import.meta.url), "utf8");
const iosRoot = "apps/ios/CovenCave/CovenCave";

const client = await read(`${iosRoot}/Networking/CaveClient.swift`);
const model = await read(`${iosRoot}/State/AppModel.swift`);
const detail = await read(`${iosRoot}/Views/TaskDetailView.swift`);

// Client can PATCH notes.
assert.match(
  client,
  /func updateTask\(cardId: String, status: CardStatus\? = nil, priority: CardPriority\? = nil,\s*steps: \[CardStep\]\? = nil, notes: String\? = nil\) async throws -> BoardCard/,
  "updateTask should accept a notes argument",
);
assert.match(client, /if let notes \{ try c\.encode\(notes, forKey: \.notes\) \}/, "TaskFieldsPatch should encode notes when set");

// Model exposes an optimistic notes setter that reverts on failure.
assert.match(
  model,
  /func setTaskNotes\(_ card: BoardCard, _ notes: String\) async \{[\s\S]*applyTask\(id: card\.id\) \{ \$0\.notes = trimmed \}[\s\S]*client\.updateTask\(cardId: card\.id, notes: trimmed\)[\s\S]*catch[\s\S]*tasks = previous/,
  "setTaskNotes should be optimistic with revert",
);
assert.match(
  model,
  /guard trimmed != \(card\.notes \?\? ""\) else \{ return \}/,
  "setTaskNotes should no-op when nothing changed",
);

// Detail view edits notes via a sheet, with edit + add affordances.
assert.match(
  detail,
  /\.sheet\(isPresented: \$editingNotes\) \{[\s\S]*NotesEditorView\(initialText: live\.notes \?\? ""\) \{ text in[\s\S]*await app\.setTaskNotes\(live, text\)/,
  "detail view should present a notes editor wired to setTaskNotes",
);
assert.match(detail, /private var notesSection: some View/, "notes section should branch on presence");
assert.match(detail, /Label\("Add notes", systemImage: "square\.and\.pencil"\)/, "empty notes should show an Add notes action");
assert.match(detail, /Label\(hasNotes \? "Edit notes" : "Add notes"/, "actions menu should offer edit/add notes");

// The editor itself guards Save until the text changes.
assert.match(detail, /struct NotesEditorView: View/, "a NotesEditorView should exist");
assert.match(detail, /Button\("Save"\) \{ onSave\(text\); dismiss\(\) \}\s*\.disabled\(text == initialText\)/, "Save should be disabled until edited");

console.log("ios-task-notes-edit.test.mjs: ok");
