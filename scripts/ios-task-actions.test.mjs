import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const client = await readFile(
  new URL("../apps/ios/CovenCave/CovenCave/Networking/CaveClient.swift", import.meta.url),
  "utf8",
);
const model = await readFile(
  new URL("../apps/ios/CovenCave/CovenCave/State/AppModel.swift", import.meta.url),
  "utf8",
);
const list = await readFile(
  new URL("../apps/ios/CovenCave/CovenCave/Views/TasksView.swift", import.meta.url),
  "utf8",
);
const detail = await readFile(
  new URL("../apps/ios/CovenCave/CovenCave/Views/TaskDetailView.swift", import.meta.url),
  "utf8",
);

// Client speaks the board mutation contract. (Match the core params loosely so
// adding further optional fields — e.g. notes — doesn't break this assertion.)
assert.match(
  client,
  /func updateTask\(cardId: String, status: CardStatus\? = nil,[\s\S]*?priority: CardPriority\? = nil,[\s\S]*?steps: \[CardStep\]\? = nil[\s\S]*?\) async throws -> BoardCard/,
  "CaveClient should expose updateTask(status:priority:steps:…)",
);
assert.match(
  client,
  /func deleteTask\(cardId: String\) async throws \{[\s\S]*method: "DELETE"/,
  "CaveClient.deleteTask should DELETE /api/board/{id}",
);
assert.match(
  client,
  /private func patchTask\(cardId: String, payload: Data\) async throws -> BoardCard/,
  "PATCH plumbing should funnel through a shared patchTask helper",
);

// Model exposes optimistic actions that revert on failure.
for (const fn of ["setTaskStatus", "setTaskPriority", "toggleStep", "deleteTask"]) {
  assert.match(model, new RegExp(`func ${fn}\\(`), `AppModel should expose ${fn}`);
}
assert.match(
  model,
  /func deleteTask\(_ card: BoardCard\) async \{[\s\S]*let previous = tasks[\s\S]*tasks\.removeAll[\s\S]*catch[\s\S]*tasks = previous/,
  "deleteTask should optimistically remove and revert on failure",
);
assert.match(
  model,
  /private func applyTask\(id: String, _ mutate: \(inout BoardCard\) -> Void\)/,
  "AppModel should have an applyTask mutation helper",
);

// List surfaces swipe + context-menu actions with a delete confirmation.
assert.match(list, /\.contextMenu \{ taskMenu\(card\) \}/, "rows should attach the task context menu");
assert.match(
  list,
  /\.swipeActions\(edge: \.trailing, allowsFullSwipe: true\)/,
  "rows should have trailing swipe actions",
);
assert.match(
  list,
  /await app\.setTaskStatus\(card, card\.status == \.done \? \.running : \.done\)/,
  "swipe should toggle Done/Reopen",
);
assert.match(list, /confirmationDialog\("Delete this task\?"/, "list should confirm deletes");
assert.match(
  list,
  /Menu \{[\s\S]*ForEach\(CardStatus\.allCases[\s\S]*ForEach\(CardPriority\.allCases/,
  "taskMenu should offer status and priority submenus",
);

// Detail view reads the live card and offers an actions menu + tappable steps.
assert.match(
  detail,
  /private var live: BoardCard \{ app\.tasks\.first \{ \$0\.id == card\.id \} \?\? card \}/,
  "detail view should read the live card from the store",
);
assert.match(detail, /private var actionsMenu: some View/, "detail view should have an actions menu");
assert.match(
  detail,
  /Button \{ Task \{ await app\.toggleStep\(live, stepId: step\.id\) \} \}/,
  "detail steps should be tappable to toggle done",
);
assert.match(
  detail,
  /Button\("Delete", role: \.destructive\) \{\s*Task \{ await app\.deleteTask\(card\); dismiss\(\) \}/,
  "deleting from the detail view should pop back",
);

console.log("ios-task-actions.test.mjs: ok");
