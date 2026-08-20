// cave-ioswipe.4: swipe destructive-action semantics and status-write races.
//
// iOS Swift is NOT compiled by CI, so this source-text contract is the only
// gate. Each assertion is checked to FAIL against its regression, not merely
// to pass.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (p) => readFile(new URL(`../${p}`, import.meta.url), "utf8");
const model = await read("apps/ios/CovenCave/CovenCave/State/AppModel.swift");
const linked = await read("apps/ios/CovenCave/CovenCave/Views/LinkedTasksSheet.swift");
const tasksView = await read("apps/ios/CovenCave/CovenCave/Views/TasksView.swift");
const detailView = await read("apps/ios/CovenCave/CovenCave/Views/TaskDetailView.swift");

// -- Full-swipe semantics -------------------------------------------------
// `unlinkTask` runs immediately with no confirmation and no undo, so an
// accidental full swipe is unrecoverable. Chats and Threads already opt out
// for the same reason; this sheet was the outlier.
assert.match(
  linked,
  /\.swipeActions\(edge: \.trailing, allowsFullSwipe: false\) \{\s*\n\s*Button\(role: \.destructive\) \{ app\.unlinkTask\(card\) \}/,
  "the destructive unlink swipe must opt out of full swipe — omitting allowsFullSwipe defaults it to TRUE",
);

// TasksView is allowed a full-swipe delete precisely because it does not
// delete: it opens a confirmation. If that ever becomes a direct call, the
// full swipe stops being safe.
//
// Extract the block by brace matching rather than a fixed character window —
// a window can slide onto an identical-looking Button elsewhere in the file
// (TasksView has one at the row context menu) and pass while the swipe itself
// regressed.
function blockAfter(src, marker) {
  const start = src.indexOf(marker);
  if (start < 0) return null;
  let i = start + marker.length - 1; // marker ends at its opening brace
  let depth = 0;
  for (; i < src.length; i += 1) {
    if (src[i] === "{") depth += 1;
    else if (src[i] === "}") {
      depth -= 1;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  return null;
}

const trailingSwipe = blockAfter(
  tasksView,
  ".swipeActions(edge: .trailing, allowsFullSwipe: true) {",
);
assert.ok(trailingSwipe, "TasksView must keep a trailing swipe action");
assert.match(
  trailingSwipe,
  /Button\(role: \.destructive\) \{ pendingDelete = card \}/,
  "TasksView's full-swipe delete must route through pendingDelete (a confirmation), not delete outright",
);

// -- Status-write races ---------------------------------------------------
assert.match(
  model,
  /private final class TaskMutationCoordinator \{[\s\S]*previousTask\?\.cancel\(\)[\s\S]*_ = await previousTask\?\.result/,
  "a newer same-field write must cancel the older lane task and wait for it before sending",
);

const request = blockAfter(
  model,
  "func requestTaskStatus(_ card: BoardCard, _ status: CardStatus) -> Task<Void, Never>? {",
);
assert.ok(request, "requestTaskStatus must still exist");
assert.match(
  request,
  /beginTaskMutation\(id: card\.id, field: \.status\)[\s\S]*applyTask\(id: card\.id\) \{ \$0\.statusRaw = status\.rawValue \}[\s\S]*scheduleTaskMutationRequest\(mutation\)/,
  "requestTaskStatus must optimistically update status, register a scoped token, and route through the coordinator",
);

// The two cancellation guards are the substance of the fix. Without the first,
// a superseded response overwrites newer optimistic state; without the second,
// the CancellationError thrown by the cancel itself triggers a revert that
// clobbers the newer intent.
const setStatus = blockAfter(
  model,
  "private func performTaskStatusMutation(",
);
assert.ok(setStatus, "performTaskStatusMutation must still exist");
const body = setStatus;
assert.match(
  body,
  /let updated = try await client\.updateTask\([\s\S]*cardId: cardId,[\s\S]*status: status,[\s\S]*\)\s*\n(?:\s*\/\/[^\n]*\n)*\s*guard !Task\.isCancelled else \{ return \}\s*\n\s*guard applyTaskServerUpdate\(updated, for: mutation\) else \{ return \}/,
  "a superseded response must not be applied — guard cancellation before the scoped server merge",
);
assert.match(
  body,
  /\} catch \{\s*\n(?:\s*\/\/[^\n]*\n)*\s*guard !Task\.isCancelled else \{ return \}/,
  "cancellation arrives as a thrown error — reverting on it would undo the newer intent",
);
assert.doesNotMatch(
  body,
  /\n\s*tasks = previous\n/,
  "restoring the whole array rolls back other cards' concurrent edits; revert only this card",
);
assert.match(
  body,
  /guard revertTaskMutation\(mutation\) else \{ return \}/,
  "failure must revert only the scoped optimistic fields for the card that failed",
);
assert.match(
  model,
  /private func revertTaskMutation\([\s\S]*TaskMutationToken[\s\S]*\) -> Bool/,
  "the scoped revert helper must exist so stale failures cannot restore an older whole-card snapshot",
);

// -- No view may re-introduce an uncancellable write ----------------------
for (const [name, src] of [
  ["TasksView", tasksView],
  ["TaskDetailView", detailView],
  ["LinkedTasksSheet", linked],
]) {
  assert.doesNotMatch(
    src,
    /Task \{ await app\.setTaskStatus\(/,
    `${name} must call app.requestTaskStatus — a detached Task cannot be cancelled, which is the bug`,
  );
}
assert.match(tasksView, /app\.requestTaskStatus\(/, "TasksView must use the managed entry point");
assert.match(detailView, /app\.requestTaskStatus\(/, "TaskDetailView must use the managed entry point");

console.log("ios-swipe-ux: ok");
