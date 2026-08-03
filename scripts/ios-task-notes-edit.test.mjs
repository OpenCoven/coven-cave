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
// Scope the match to setTaskNotes' own body by brace matching. The previous
// form was one regex over the whole file with `[\s\S]*` between clauses, so
// after `catch` it ran greedily into LATER functions — it passed while
// setTaskNotes itself still reverted the whole array, because some other
// mutation further down had the per-card call (cave-rlmot).
function blockAfter(src, marker) {
  const start = src.indexOf(marker);
  if (start < 0) return null;
  let depth = 0;
  for (let i = start + marker.length - 1; i < src.length; i += 1) {
    if (src[i] === "{") depth += 1;
    else if (src[i] === "}") {
      depth -= 1;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  return null;
}
const setNotes = blockAfter(model, "func setTaskNotes(_ card: BoardCard, _ notes: String) async {");
assert.ok(setNotes, "setTaskNotes should exist");
assert.match(setNotes, /applyTask\(id: card\.id\) \{ \$0\.notes = trimmed \}/, "setTaskNotes should apply optimistically");
assert.match(setNotes, /client\.updateTask\(cardId: card\.id, notes: trimmed\)/, "setTaskNotes should PATCH the notes");
assert.match(
  setNotes,
  /catch \{\s*\n\s*revertTask\(id: card\.id, to: previous\)/,
  "setTaskNotes should revert on failure — and only its own card (cave-rlmot)",
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
