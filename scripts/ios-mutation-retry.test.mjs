// cave-ioswipe.1: idempotent mutation retries in CaveClient, plus a Retry
// affordance on the failure toast instead of only reverting.
//
// A swipe delete/done must survive a single transient network blip: CaveClient
// retries the DELETE/PATCH idempotently ([350ms, 1s, 3s] within a bounded
// budget) BEFORE the optimistic UI is ever reverted, and the revert toast that
// only appears after those retries are exhausted now offers a Retry button that
// re-runs the failed mutation.
//
// iOS Swift is NOT compiled by CI, so this source-text contract is the only
// gate. Each assertion is checked to FAIL against its regression, not merely
// to pass.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (p) => readFile(new URL("../" + p, import.meta.url), "utf8");
const iosRoot = "apps/ios/CovenCave/CovenCave";

const client = await read(iosRoot + "/Networking/CaveClient.swift");
const model = await read(iosRoot + "/State/AppModel.swift");
const toastView = await read(iosRoot + "/Views/ToastView.swift");

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

// --- Retry policy: GET/HEAD keep the short plan ----------------------------
const plan = blockAfter(client, "private static func retryPlan(");
assert.ok(plan, "retryPlan must exist");
assert.match(plan, new RegExp(String.raw`case "GET", "HEAD":\s*return RetryPlan\(delays: \[\.milliseconds\(350\), \.seconds\(1\)\], budget: nil\)`), "GET/HEAD must keep the short two-attempt plan (350ms, 1s) with no budget");

// --- DELETE / PATCH / PUT retry [350ms, 1s, 3s] ONLY when opted in ---------
assert.match(plan, new RegExp(String.raw`case "DELETE", "PATCH", "PUT":\s*guard retryingIdempotentMutation else \{`), "DELETE/PATCH/PUT must only retry when the caller explicitly opts in");
assert.match(plan, new RegExp(String.raw`case "DELETE", "PATCH", "PUT":[\s\S]*?delays: \[\.milliseconds\(350\), \.seconds\(1\), \.seconds\(3\)\],\s*budget: idempotentMutationRetryBudget`), "an opted-in DELETE/PATCH/PUT must retry [350ms, 1s, 3s] within the mutation budget");

// --- POST retries only behind an explicit Idempotency-Key ------------------
assert.match(plan, new RegExp(String.raw`case "POST":[\s\S]*?Idempotency-Key[\s\S]*?key\?\.isEmpty == false\s*\?\s*RetryPlan\([\s\S]*?delays: \[\.milliseconds\(350\), \.seconds\(1\), \.seconds\(3\)\],\s*budget: idempotentMutationRetryBudget\s*\)\s*:\s*RetryPlan\(delays: \[\], budget: nil\)`), "POST must retry [350ms, 1s, 3s] ONLY when an Idempotency-Key header is present");
assert.match(plan, new RegExp(String.raw`default:\s*return RetryPlan\(delays: \[\], budget: nil\)`), "unknown methods must never retry");

// --- Transient-only gate ----------------------------------------------------
// isTransient() is the single source of truth for "a retry could cure this".
assert.match(client, new RegExp(String.raw`private static func isTransient\(_ error: Error\) -> Bool \{[\s\S]*?guard let urlError = error as\? URLError else \{ return false \}[\s\S]*?case \.timedOut, \.cannotFindHost, \.cannotConnectToHost, \.networkConnectionLost,[\s\S]*?return true[\s\S]*?default:\s*return false`), "isTransient must classify only transport-level blips as retryable");
assert.match(client, new RegExp(String.raw`guard attempt < retryDelays\.count, isTransient\(error\) else \{ throw error \}`), "performData must retry only transient failures, and only within the delay list");
assert.match(client, new RegExp(String.raw`static let defaultIdempotentMutationRetryBudget: Duration = \.seconds\(20\)`), "the mutation retry budget must stay explicitly bounded (20s)");

// --- Swipe mutations opt in, so a single transient blip never reaches revert --
// The revert paths in AppModel only run after CaveClient exhausted its bounded
// transient retries; these call sites are what make "a blip does not revert"
// true for swipe delete/done.
const optIns = [
  ["deleteTask", new RegExp(String.raw`func deleteTask\(cardId: String\) async throws \{[\s\S]*?method: "DELETE"[\s\S]*?retryingIdempotentMutation: true`)],
  ["patchTask (task status/done)", new RegExp(String.raw`private func patchTask\(cardId: String, payload: Data\) async throws -> BoardCard \{[\s\S]*?method: "PATCH"[\s\S]*?retryingIdempotentMutation: true`)],
  ["setSessionFlags (thread archive/pin)", new RegExp(String.raw`func setSessionFlags\([\s\S]*?method: "PATCH"[\s\S]*?retryingIdempotentMutation: true`)],
  ["deleteSession (thread delete)", new RegExp(String.raw`func deleteSession\(sessionId: String\) async throws \{[\s\S]*?method: "DELETE"[\s\S]*?retryingIdempotentMutation: true`)],
];
for (const [name, call] of optIns) {
  assert.match(client, call, name + " must opt its mutation into idempotent retries");
}

// --- The failure toast carries a Retry affordance ---------------------------
const message = blockAfter(model, "struct ToastMessage: Identifiable");
assert.ok(message, "ToastMessage must exist");
assert.match(message, new RegExp(String.raw`var actionTitle: String\?`), "ToastMessage should carry an optional action title");
assert.match(message, new RegExp(String.raw`var action: \(@MainActor \(\) -> Void\)\?`), "ToastMessage should carry an optional MainActor action to run on tap");

const show = blockAfter(model, "func showToast(");
assert.ok(show, "showToast must exist");
assert.match(show, new RegExp(String.raw`actionTitle: String\? = nil,\s*\n\s*action: \(@MainActor \(\) -> Void\)\? = nil`), "showToast should accept and forward an optional action");
assert.match(show, new RegExp(String.raw`toast = ToastMessage\([\s\S]*?actionTitle: actionTitle,[\s\S]*?action: action`), "showToast must store the action on the ToastMessage it publishes");

// reportRevert must offer Retry instead of only saying "reverted".
const revert = blockAfter(model, "private func reportRevert(");
assert.ok(revert, "reportRevert must exist");
assert.match(revert, new RegExp(String.raw`retry: \(@MainActor \(\) -> Void\)\? = nil`), "reportRevert should accept an optional retry closure");
assert.match(revert, new RegExp(String.raw`actionTitle: retry == nil \? nil : "Retry"`), "reportRevert should surface a Retry button exactly when a retry closure is supplied");

// reportPartial (thread flag fan-out) keeps the same affordance.
const partial = blockAfter(model, "private func reportPartial(");
assert.ok(partial, "reportPartial must exist");
assert.match(partial, new RegExp(String.raw`retry: \(@MainActor \(\) -> Void\)\? = nil`), "reportPartial should accept an optional retry closure");

// --- The swipe paths wire the affordance ------------------------------------
const status = blockAfter(model, "private func performTaskStatusMutation(");
assert.ok(status, "performTaskStatusMutation must exist");
assert.match(status, new RegExp(String.raw`reportRevert\("update the task"\) \{[\s\S]*?requestTaskStatus\(card, status\)`), "a failed task status write (swipe done) must offer a Retry that re-runs the same status write");

const del = blockAfter(model, "func deleteTask(_ card: BoardCard) async {");
assert.ok(del, "deleteTask must exist");
assert.match(del, new RegExp(String.raw`reportRevert\("delete the task"\) \{[\s\S]*?deleteTask\(removed\)`), "a failed task delete (swipe delete) must offer a Retry that re-runs the delete");

for (const fn of ["setThreadArchived", "setThreadPinned"]) {
  const body = blockAfter(model, "func " + fn + "(");
  assert.ok(body, fn + " must exist");
  assert.match(body, new RegExp(String.raw`retry: \{ \[weak self\] in self\?\.${fn}\(thread, `), fn + " must wire a Retry that re-applies the same flag");
}

const fan = blockAfter(model, "private func fanOutThreadFlag(");
assert.ok(fan, "fanOutThreadFlag must exist");
assert.match(fan, new RegExp(String.raw`retry: \(@MainActor \(\) -> Void\)\? = nil,`), "fanOutThreadFlag should accept a retry closure from its callers");
assert.match(fan, new RegExp(String.raw`reportPartial\(failed, of: ids\.count, verb: verb, retry: retry\)`), "a failed flag fan-out must surface the retry on its toast");

const delPartial = blockAfter(model, "private func reportDeletePartial(");
assert.ok(delPartial, "reportDeletePartial must exist");
assert.match(delPartial, new RegExp(String.raw`retry: \(@MainActor \(\) -> Void\)\? = nil`), "reportDeletePartial should accept an optional retry closure");

// --- ToastView renders the button -------------------------------------------
assert.match(toastView, new RegExp(String.raw`if let actionTitle = message\.actionTitle, message\.action != nil \{[\s\S]*?Button \{[\s\S]*?message\.action\?\(\)`), "ToastView must render a button that runs the toast action (not swallow the affordance)");

console.log("ios-mutation-retry: ok");
