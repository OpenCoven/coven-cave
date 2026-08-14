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

// Every in-place mutator reverts just its own card.
for (const fn of [
  "setTaskStatus",
  "setTaskPriority",
  "toggleStep",
  "commitSteps",
  "setTaskNotes",
  "setTaskTitle",
  "setTaskDates",
]) {
  const body = blockAfter(model, `func ${fn}(`);
  assert.ok(body, `${fn} must exist`);
  assert.match(
    body,
    /revertTask\(id: card\.id, to: previous\)/,
    `${fn} must restore only the card that failed`,
  );
}

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

// revertTask itself must stay per-id.
const revert = blockAfter(model, "private func revertTask(id: String, to previous: [BoardCard]) {");
assert.ok(revert, "revertTask must exist");
assert.match(
  revert,
  /guard let old = previous\.first\(where: \{ \$0\.id == id \}\) else \{ return \}/,
  "revertTask must look up a single card by id",
);

console.log("ios-task-revert-scope: ok");
