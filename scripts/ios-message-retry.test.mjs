import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// A failed reply should be recoverable with a VISIBLE Retry button (not just the
// long-press menu), and retrying must re-stream only the failed bubble's familiar
// — so it works in group chats and doesn't duplicate the user's prompt. This
// test locks that wiring across the bubble, the view, and the thread model.

const read = (p) => readFile(new URL(`../${p}`, import.meta.url), "utf8");

const base = "apps/ios/CovenCave/CovenCave";
const bubble = await read(`${base}/Views/MessageBubble.swift`);
const view = await read(`${base}/Views/ChatView.swift`);
const thread = await read(`${base}/State/ChatThread.swift`);

// --- Visible retry button on error bubbles ----------------------------------
assert.match(
  bubble,
  /if !isUser, message\.isError, let onRetry \{[\s\S]*?Label\("Retry reply", systemImage: "arrow\.clockwise"\)/,
  "MessageBubble should render a visible Retry button on a failed (isError) reply",
);
assert.match(
  bubble,
  /\.accessibilityLabel\("Retry generating this reply"\)/,
  "the visible Retry button should carry an accessibility label",
);

// --- canRetry covers failures (any time) AND groups -------------------------
// The guard starts on role/streaming — no `!thread.isGroup` exclusion any more
// (retry is per-familiar in place, so it's safe for groups).
assert.match(
  view,
  /func canRetry\(_ message: DisplayMessage\) -> Bool \{\s*guard message\.role == \.assistant, !message\.streaming,/,
  "canRetry's guard should no longer exclude group threads",
);
assert.match(
  view,
  /func canRetry[\s\S]*?return message\.isError \|\| message\.id == thread\.messages\.last\?\.id/,
  "canRetry should allow retrying a failed reply any time, or the latest reply",
);
// Retry routes through the in-place thread.retry (not delete-and-resend).
assert.match(
  view,
  /func retryAssistant[\s\S]*?thread\.retry\([\s\S]*?assistant\.id,[\s\S]*?client: client,[\s\S]*?onConnectionFailure: \{ app\.noteConnectionFailure\(\$0\) \}/,
  "retryAssistant should call thread.retry in place and report connection failures",
);

// --- thread.retry re-streams a single familiar in place ---------------------
assert.match(
  thread,
  /func retry\(_ messageId: String, client: CaveClient,\s*liveDispatchLeaseIsCurrent: @escaping \(\) -> Bool,\s*persistAfterRefusal: @escaping \(\) async -> Bool,\s*onRefusal: @escaping \(\) -> Void,[\s\S]{0,160}onChange: @escaping \(\) -> Void\) -> Task<Void, Never>\?/,
  "retry requires a live dispatch lease and durable, visible refusal handling",
);
assert.match(
  thread,
  /func retry[\s\S]*?messages\[\.\.<idx\]\.last\(where: \{ \$0\.role == \.user \}\)/,
  "retry should replay the nearest preceding user prompt (works for group fan-out order)",
);
assert.match(
  thread,
  /func retry[\s\S]*?\$0\.text = ""; \$0\.isError = false; \$0\.streaming = true[\s\S]*?stream\(\s*familiarId: familiarId/,
  "retry should reset the bubble and re-stream only its familiar (not a full send fan-out)",
);

const retry = thread.slice(thread.indexOf("func retry("), thread.indexOf("/// Append an inline system note"));
assert.match(retry, /ChatDispatchBinding\(thread: self, familiarIds: \[familiarId\]\)/);
assert.match(retry, /binding\.matches\(self, includingSessions: true\),\s*liveDispatchLeaseIsCurrent\(\)/);
assert.match(retry, /liveDispatchLeaseIsCurrent: mayDispatch/);
assert.match(retry, /let previousReply = messages\[idx\]/);
assert.match(retry, /guard refusedBeforeDispatch else \{ return \}[\s\S]*messages\[current\] == retryPlaceholder[\s\S]*messages\[current\] = previousReply[\s\S]*await persistAfterRefusal\(\)/);
assert.match(view, /func retryAssistant[\s\S]*captureConnectionDispatchLease\(\)[\s\S]*thread\.retry\([\s\S]*liveDispatchLeaseIsCurrent: \{\s*dispatchIsCurrent\(dispatchBinding, in: thread, lease: dispatchLease\)/);
const tests = await read("apps/ios/CovenCave/CovenCaveTests/ChatRetryDispatchTests.swift");
for (const scenario of [
  "testRevocationAfterRetryReturnsRestoresAndPersistsOriginalReply",
  "testDeferredNetworkPreflightRechecksAuthorityAndRestoresOriginalReply",
  "testRootSessionAndRosterDriftBeforeDeferredPOSTFailClosed",
  "testRefusalDoesNotOverwriteANewerTranscriptEdit",
  "testFrozenSendBindingAllowsSiblingSessionEstablishmentButNotRetargeting",
]) {
  assert.ok(tests.includes(`func ${scenario}(`), `native regression scenario ${scenario} is present`);
}

console.log("ios-message-retry: OK");
