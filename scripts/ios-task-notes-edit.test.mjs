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
// Scope the match to one function body by brace matching. The previous
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
const requestNotes = blockAfter(model, "func requestTaskNotes(_ card: BoardCard, _ notes: String) -> Task<Void, Never>? {");
assert.ok(requestNotes, "requestTaskNotes should exist");
assert.match(requestNotes, /applyTask\(id: card\.id\) \{ \$0\.notes = trimmed \}/, "requestTaskNotes should apply optimistically");
assert.match(
  requestNotes,
  /guard trimmed != \(card\.notes \?\? ""\),[\s\S]*let mutation = beginTaskMutation\(id: card\.id, field: \.notes\) else \{ return nil \}/,
  "requestTaskNotes should register a per-card mutation token before its optimistic update",
);
assert.match(
  requestNotes,
  /scheduleTaskMutationRequest\(mutation\)/,
  "requestTaskNotes should send through the per-field single-flight coordinator",
);
const performNotes = blockAfter(model, "private func performTaskNotesMutation(");
assert.ok(performNotes, "performTaskNotesMutation should exist");
assert.match(
  performNotes,
  /client\.updateTask\([\s\S]*cardId: cardId,[\s\S]*status: nil,[\s\S]*priority: nil,[\s\S]*steps: nil,[\s\S]*notes: notes[\s\S]*\)/,
  "performTaskNotesMutation should PATCH the notes through the shared task-field client helper",
);
assert.match(
  performNotes,
  /_ = applyTaskServerUpdate\(updated, for: mutation\)/,
  "performTaskNotesMutation should merge only its authoritative fields back from the server response",
);
assert.match(
  performNotes,
  /catch \{[\s\S]*guard revertTaskMutation\(mutation\) else \{ return \}/,
  "performTaskNotesMutation should revert only its own optimistic fields when the PATCH fails",
);

// Detail view edits notes via a sheet, with edit + add affordances.
assert.match(
  detail,
  /\.sheet\(isPresented: \$editingNotes\) \{[\s\S]*NotesEditorView\(initialText: live\.notes \?\? ""\) \{ text in[\s\S]*app\.requestTaskNotes\(live, text\)/,
  "detail view should present a notes editor wired to requestTaskNotes",
);
assert.match(detail, /private var notesSection: some View/, "notes section should branch on presence");
assert.match(detail, /Label\("Add notes", systemImage: "square\.and\.pencil"\)/, "empty notes should show an Add notes action");
assert.match(detail, /Label\(hasNotes \? "Edit notes" : "Add notes"/, "actions menu should offer edit/add notes");

// The editor itself guards Save until the text changes.
assert.match(detail, /struct NotesEditorView: View/, "a NotesEditorView should exist");
assert.match(detail, /Button\("Save"\) \{ onSave\(text\); dismiss\(\) \}\s*\.disabled\(text == initialText\)/, "Save should be disabled until edited");

console.log("ios-task-notes-edit.test.mjs: ok");
