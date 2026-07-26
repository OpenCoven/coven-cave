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
  /if !isUser, message\.isError, let onRetry \{[\s\S]*?Label\("Retry", systemImage: "arrow\.clockwise"\)/,
  "MessageBubble should render a visible Retry button on a failed (isError) reply",
);
assert.match(
  bubble,
  /\.accessibilityLabel\("Retry sending this message"\)/,
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
  /func retryAssistant[\s\S]*?thread\.retry\(assistant\.id, client: client\)/,
  "retryAssistant should call thread.retry in place",
);

// --- thread.retry re-streams a single familiar in place ---------------------
assert.match(
  thread,
  /func retry\(_ messageId: String, client: CaveClient, onChange: @escaping \(\) -> Void\)/,
  "ChatThread should expose retry(messageId:client:onChange:)",
);
assert.match(
  thread,
  /func retry[\s\S]*?messages\[\.\.<idx\]\.last\(where: \{ \$0\.role == \.user \}\)/,
  "retry should replay the nearest preceding user prompt (works for group fan-out order)",
);
assert.match(
  thread,
  /func retry[\s\S]*?\$0\.text = ""; \$0\.isError = false; \$0\.streaming = true[\s\S]*?stream\(familiarId: familiarId/,
  "retry should reset the bubble and re-stream only its familiar (not a full send fan-out)",
);

console.log("ios-message-retry: OK");
