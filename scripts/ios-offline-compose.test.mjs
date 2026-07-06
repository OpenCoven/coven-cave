import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// Offline compose (cave-u6k): composing while the phone has no route to the
// desktop used to dead-end in a transport error. Prose now parks on the
// thread as a `queued` user message — persisted across restarts via the
// normal thread snapshot — and replays through the ordinary send fan-out on
// the next reconnect, with a server-tail check so a send that actually made
// it through isn't doubled.

const read = (p) => readFile(new URL(`../${p}`, import.meta.url), "utf8");
const thread = await read("apps/ios/CovenCave/CovenCave/State/ChatThread.swift");
const model = await read("apps/ios/CovenCave/CovenCave/State/AppModel.swift");
const chatView = await read("apps/ios/CovenCave/CovenCave/Views/ChatView.swift");
const bubble = await read("apps/ios/CovenCave/CovenCave/Views/MessageBubble.swift");

// --- Model: queued is an OPTIONAL Codable field (old snapshots must decode) --
assert.match(
  thread,
  /var queued: Bool\?/,
  "DisplayMessage.queued must be optional so pre-feature snapshots still decode",
);
assert.match(
  thread,
  /var isQueued: Bool \{ queued == true \}/,
  "isQueued reads the optional safely",
);

// --- Compose path: offline branches to enqueue, never to the network --------
assert.match(
  chatView,
  /if app\.connectionState != \.connected \{[\s\S]{0,220}?thread\.enqueue\(outgoing, attachments: attachments\)/,
  "ChatView.send parks prose on the thread when disconnected",
);
assert.match(
  chatView,
  /showToast\("Queued — sends when reconnected", systemImage: "clock"\)/,
  "queueing is announced with a toast",
);
assert.match(
  chatView,
  /if app\.connectionState != \.connected \{[\s\S]{0,120}?thread\.enqueue\(text\)/,
  "suggestion chips queue offline too",
);
assert.match(
  thread,
  /func enqueue\(_ text: String, attachments: \[CaveClient\.ChatAttachment\] = \[\]\)/,
  "ChatThread.enqueue exists for offline compose",
);

// --- Transport-failure conversion: only when provably unsent ----------------
assert.match(
  thread,
  /if let userMessageId, !receivedAnyEvent, Self\.isOfflineTransportError\(error\)/,
  "a failed send queues ONLY when no SSE event arrived and the error is connect-level",
);
assert.match(
  thread,
  /messages\.removeAll \{ \$0\.id == messageId \}\s*\n\s*mutate\(userMessageId\) \{ \$0\.queued = true \}/,
  "queue-conversion removes the placeholder bubble and flags the user message",
);
assert.match(
  thread,
  /case \.notConnectedToInternet, \.cannotFindHost, \.cannotConnectToHost,\s*\n\s*\.dnsLookupFailed, \.networkConnectionLost, \.dataNotAllowed,\s*\n\s*\.internationalRoamingOff:/,
  "offline classification is a closed connect-level set (timeouts excluded)",
);
assert.doesNotMatch(
  thread,
  /\.timedOut[\s\S]{0,80}?return true/,
  "timeouts are ambiguous (the request may have reached the server) — never queue them",
);

// --- Replay: reconnect flush, in order, duplicate-safe -----------------------
assert.match(
  model,
  /connectionState = \.connected\s*\n\s*await refreshAccessTokenIfNeeded\(\)\s*\n\s*flushQueuedMessages\(\)/,
  "reconnect (refreshConnection .found) flushes the offline queue",
);
assert.match(
  model,
  /await refreshAccessTokenIfNeeded\(\)\s*\n\s*flushQueuedMessages\(\)\s*\n\s*return/,
  "the foreground ping-success path flushes too",
);
assert.match(
  model,
  /guard let client, !flushingQueued else \{ return \}/,
  "overlapping reconnect signals flush once",
);
assert.match(
  thread,
  /func replayQueued\(client: CaveClient, onChange: @escaping \(\) -> Void\) async/,
  "ChatThread.replayQueued drives the reconnect send",
);
assert.match(
  thread,
  /if await adoptServerTurnIfPresent\(prompt: prompt, familiarId: familiarId,/,
  "replay checks the server's conversation tail before re-sending (no duplicate turns)",
);
assert.match(
  thread,
  /convo\.turns\[lastUser\]\.text == prompt/,
  "the duplicate check anchors on the exact prompt text",
);
assert.match(
  thread,
  /if messages\.first\(where: \{ \$0\.id == queuedId \}\)\?\.isQueued == true \{ return \}/,
  "a re-drop mid-replay stops the flush instead of spinning",
);

// --- UI: queued reads as waiting, not as an error ----------------------------
assert.match(
  bubble,
  /if isUser, message\.isQueued \{\s*\n\s*Label\("Queued — sends when reconnected", systemImage: "clock"\)/,
  "queued user messages carry a quiet clock chip",
);
assert.match(
  bubble,
  /accessibilityLabel\("Queued\. Sends when the desktop is reachable again\."\)/,
  "the queued state is announced to assistive tech",
);

console.log("ios-offline-compose.test.mjs: ok");
