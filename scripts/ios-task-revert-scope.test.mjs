// cave-rlmot: an optimistic task mutation that fails must restore only the card
// that failed. Reassigning the whole `tasks` array rolls back concurrent edits
// to unrelated cards that had already succeeded.
//
// iOS Swift is NOT compiled by CI, so this source-text contract is the only
// gate. Each assertion is checked to FAIL against its regression, not merely
// to pass.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const model = await readFile(
  new URL("../apps/ios/CovenCave/CovenCave/State/AppModel.swift", import.meta.url),
  "utf8",
);

/** Extract a brace-balanced block starting at `marker` (which ends at its `{`). */
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

// No optimistic task path may restore the whole array. This is the whole point
// of the change, and a single reintroduced site is a silent data-loss bug: the
// failing card's rollback also discards a sibling card's successful edit.
assert.doesNotMatch(
  model,
  /\n\s*tasks = previous\n/,
  "no task mutation may reassign the whole tasks array on failure",
);

assert.match(model, /private struct TaskMutationToken \{/, "task mutations should carry a per-card token");
assert.match(model, /private final class TaskMutationCoordinator \{/, "task mutations should have a typed single-flight coordinator");
assert.match(
  model,
  /previousTask\?\.cancel\(\)[\s\S]*_ = await previousTask\?\.result/,
  "same-field requests should cancel the older task and wait before sending the newer request",
);
assert.match(model, /private func beginTaskMutation\(/, "task mutations should register per-card generations");
assert.match(
  model,
  /private func applyTaskServerUpdate\([\s\S]*for token: TaskMutationToken[\s\S]*\) -> Bool/,
  "task mutations should merge only their authoritative fields back from the server response",
);
assert.match(
  model,
  /private func revertTaskMutation\([\s\S]*TaskMutationToken[\s\S]*\) -> Bool/,
  "task mutations should roll back only the fields owned by the failed mutation",
);
assert.doesNotMatch(
  model,
  /applyTask\(id: card\.id\) \{ \$0 = updated \}/,
  "task mutations must not replace the whole live card with a stale server echo",
);

// Every in-place mutator uses the scoped mutation token rather than a whole-card restore.
for (const fn of [
  "requestTaskStatus",
  "requestTaskPriority",
  "requestTaskSteps",
  "requestTaskNotes",
  "requestTaskTitle",
  "requestTaskDates",
  "requestTaskProjectMove",
  "requestTaskSession",
]) {
  const body = blockAfter(model, `func ${fn}(`);
  assert.ok(body, `${fn} must exist`);
  assert.match(
    body,
    /beginTaskMutation\([\s\S]*id: (card\.id|cardId),[\s\S]*field:/,
    `${fn} must start a scoped task mutation before it writes optimistically`,
  );
  assert.match(
    body,
    /scheduleTaskMutationRequest\(mutation\)/,
    `${fn} must run through the task-mutation coordinator`,
  );
  assert.doesNotMatch(
    body,
    /applyTask\(id: card\.id\) \{ \$0 = updated \}/,
    `${fn} must not replace the whole card with a stale server echo`,
  );
}

const move = blockAfter(model, "func requestTaskProjectMove(");
assert.ok(move, "requestTaskProjectMove must exist");
assert.match(
  move,
  /beginTaskMutation\([\s\S]*id: card\.id,[\s\S]*field: \.projectId[\s\S]*\)/,
  "moving a task to a project must track projectId with a scoped mutation token",
);
assert.match(
  move,
  /scheduleTaskMutationRequest\(mutation\)/,
  "moving a task to a project must route through the same-field coordinator",
);

// deleteTask is the one that cannot use revertTask: the card is REMOVED, so
// applyTask finds no index and silently no-ops, dropping the task the delete
// failed to remove. It must reinsert instead, at the position it held.
const del = blockAfter(model, "func deleteTask(_ card: BoardCard) async {");
assert.ok(del, "deleteTask must exist");
assert.doesNotMatch(
  del,
  /revertTask\(/,
  "deleteTask must NOT use revertTask — a removed card has no index to edit, so it would no-op",
);
assert.match(
  del,
  /guard let client, let index = tasks\.firstIndex\(where: \{ \$0\.id == card\.id \}\) else \{ return \}/,
  "deleteTask must capture the index before removing",
);
assert.match(
  del,
  /reinsertTask\(removed, at: index\)/,
  "a failed delete must put the card back where it was",
);

const reinsert = blockAfter(model, "private func reinsertTask(_ card: BoardCard, at index: Int) {");
assert.ok(reinsert, "reinsertTask must exist");
assert.match(
  reinsert,
  /guard !tasks\.contains\(where: \{ \$0\.id == card\.id \}\) else \{ return \}/,
  "reinserting must not duplicate a card that is already back",
);
assert.match(
  reinsert,
  /tasks\.insert\(card, at: min\(index, tasks\.count\)\)/,
  "reinsert must clamp the index — the list can be shorter than when the card was removed",
);

console.log("ios-task-revert-scope: ok");
