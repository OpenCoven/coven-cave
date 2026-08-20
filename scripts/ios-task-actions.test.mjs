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

// Client speaks the board mutation contract.
assert.match(
  client,
  /func updateTask\(cardId: String, status: CardStatus\? = nil, priority: CardPriority\? = nil,\s*steps: \[CardStep\]\? = nil, notes: String\? = nil\) async throws -> BoardCard/,
  "CaveClient should expose updateTask(status:priority:steps:notes:)",
);
assert.match(
  client,
  /func updateTaskProject\(cardId: String, projectId: String\) async throws -> BoardCard/,
  "CaveClient should expose the idempotent projectId PATCH helper for recovery moves",
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
for (const fn of ["requestTaskStatus", "requestTaskPriority", "requestTaskProjectMove", "deleteTask"]) {
  assert.match(model, new RegExp(`func ${fn}\\(`), `AppModel should expose ${fn}`);
}
assert.match(
  model,
  /private final class TaskMutationCoordinator[\s\S]*previousTask\?\.cancel\(\)[\s\S]*_ = await previousTask\?\.result/,
  "task mutations should single-flight by card+field, cancelling the older request before the newer one sends",
);
assert.match(
  model,
  /func requestTaskProjectMove\([\s\S]*_ card: BoardCard,[\s\S]*applyTask\(id: card\.id\) \{ \$0\.projectId = projectId \}[\s\S]*scheduleTaskMutationRequest\(mutation\)/,
  "task recovery moves should optimistically patch projectId and reconcile through the client helper",
);
assert.match(
  model,
  /private func performTaskProjectMutation\([\s\S]*client\.updateTaskProject\(cardId: cardId, projectId: projectId\)/,
  "task recovery moves should PATCH projectId through the project helper once their lane reaches the network",
);
assert.match(
  model,
  /private func performTaskProjectMutation\([\s\S]*repairTaskChatScopeAfterProjectMove\(cardId: cardId\)[\s\S]*reportTaskMoveRepairIssue/,
  "task recovery moves should surface stale-chat repair failures instead of silently keeping a mismatched link",
);
assert.match(
  model,
  /func deleteTask\(_ card: BoardCard\) async \{[\s\S]*tasks\.remove\(at: index\)[\s\S]*catch[\s\S]*reinsertTask\(removed, at: index\)/,
  // Same intent; the revert narrowed from the whole array to this one card, and
  // a removed card must be reinserted rather than edited in place (cave-rlmot).
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
  /app\.requestTaskStatus\(card, card\.status == \.done \? \.running : \.done\)/,
  // Same intent as before; the call moved off a bare `Task { await ... }` onto
  // the cancellable entry point so rapid toggles can't apply a stale response
  // (cave-ioswipe.4).
  "swipe should toggle Done/Reopen",
);
assert.match(list, /confirmationDialog\("Delete this task\?"/, "list should confirm deletes");
assert.match(
  list,
  /Menu \{[\s\S]*ForEach\(CardStatus\.allCases[\s\S]*ForEach\(CardPriority\.allCases/,
  "taskMenu should offer status and priority submenus",
);
assert.doesNotMatch(
  list,
  /case status = "Status", project = "Project", familiar = "Familiar", priority = "Priority"/,
  "single-project Tasks should no longer offer Project grouping",
);
assert.match(
  list,
  /static func normalizedGroupByRaw\(_ rawValue: String\) -> String \{[\s\S]*GroupBy\(rawValue: rawValue\)\?\.rawValue \?\? GroupBy\.familiar\.rawValue[\s\S]*\}/,
  "legacy stored Project grouping should migrate to a supported default",
);
assert.match(
  list,
  /if !app\.projectFamiliars\.isEmpty \{[\s\S]*ForEach\(app\.projectFamiliars\)/,
  "familiar filter options should come from the active project's familiar roster",
);
assert.match(
  list,
  /guard let card = Self\.requestedCardToOpen\(app\.cardToOpen, in: app\.projectTasks\) else \{/,
  "opening a task from the project-scoped list should refuse cards outside app.projectTasks",
);

// Detail view reads the live card and offers an actions menu + tappable steps.
assert.match(
  detail,
  /private var live: BoardCard \{ app\.tasks\.first \{ \$0\.id == card\.id \} \?\? card \}/,
  "detail view should read the live card from the store",
);
assert.match(
  detail,
  /FamiliarPickerSheet \{ fam in[\s\S]*Task \{ await app\.openChat\(for: live, familiarId: fam\.id\) \}/,
  "task familiar picker should route through AppModel with the live task snapshot",
);
assert.match(
  detail,
  /if let thread = app\.linkedThread\(for: live\)[\s\S]*Button \{ Task \{ await app\.openChat\(for: live\) \} \}[\s\S]*Button\(role: \.destructive\) \{ app\.unlinkTask\(live\) \}/,
  "linked task chats should open and unlink against the live task snapshot",
);
assert.match(
  detail,
  /Button \{\s*if live\.familiarId != nil \{\s*Task \{ await app\.openChat\(for: live\) \}\s*\}\s*else \{ showFamiliarPicker = true \}\s*\} label: \{[\s\S]*Label\("Start a chat"/,
  "Start a chat should use the live task familiar or fall back to the familiar picker",
);
assert.match(
  detail,
  /if needsProjectRecovery \{[\s\S]*actionChip\("Project", value: "Move to project…", color: chrome\.accent\) \{[\s\S]*showProjectPicker = true/,
  "projectless or unregistered tasks should offer a recovery-only Move to project action",
);
assert.match(
  detail,
  /private var needsProjectRecovery: Bool \{[\s\S]*guard let normalizedProjectId else \{ return true \}[\s\S]*guard app\.projectsLoaded else \{ return false \}[\s\S]*return app\.project\(normalizedProjectId\) == nil/,
  "deleted-project tasks should enter the same recovery move flow as projectless tasks once the catalog loads",
);
assert.match(
  detail,
  /MoveTaskProjectSheet\(task: live\) \{ project in[\s\S]*app\.requestTaskProjectMove\(live, project: project\)/,
  "the recovery project picker should route through AppModel's optimistic moveTaskToProject mutation",
);
assert.match(
  detail,
  /displayChip\("Project", value: registeredProject\?\.name \?\? "Loading…"\)/,
  "registered tasks should keep the Project field read-only in the detail grid",
);
assert.match(detail, /private var actionsMenu: some View/, "detail view should have an actions menu");
assert.match(
  detail,
  /Button \{ Haptics\.tap\(\); app\.requestToggleTaskStep\(live, stepId: step\.id\) \}/,
  "detail steps should be tappable to toggle done (with haptic confirmation)",
);
assert.match(
  detail,
  /Button\("Delete", role: \.destructive\) \{\s*Task \{ await app\.deleteTask\(card\); dismiss\(\) \}/,
  "deleting from the detail view should pop back",
);
for (const label of ["Start a chat", "Open in chat"]) {
  assert.match(
    detail,
    new RegExp(
      `Label\\("${label}",[\\s\\S]{0,120}?\\.foregroundStyle\\(chrome\\.accentForeground\\)`,
    ),
    `${label} should use the luminance-aware foreground on its accent-filled button`,
  );
}

console.log("ios-task-actions.test.mjs: ok");
