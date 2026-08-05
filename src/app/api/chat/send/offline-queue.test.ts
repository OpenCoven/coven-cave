import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const chatRoute = await readFile(
  new URL("./route.ts", import.meta.url),
  "utf8",
);

assert.match(
  chatRoute,
  /import \{ deriveTravelClientStatus \} from "@\/lib\/travel-client-state";/,
  "Chat send should derive travel authority before deciding whether to spawn a harness",
);

assert.match(
  chatRoute,
  /enqueueOfflineTravelItem\(\{\s*kind: "chat"/,
  "Offline travel chat sends should persist a chat item in the travel queue",
);

assert.match(
  chatRoute,
  /hubReachable: state\.travel\.hubUnreachableSince \? false : null/,
  "Chat send should respect a previously recorded hub outage without probing the hub inline",
);

assert.match(
  chatRoute,
  /if \(travelStatus\.authority !== "travel-local"\) return null;/,
  "Only travel-local authority should divert chat sends into the offline queue",
);

assert.match(
  chatRoute,
  /attachments: args\.persistedAttachments/,
  "Queued offline chat payloads should keep transcript-safe attachment metadata, not preview payloads",
);

assert.match(
  chatRoute,
  /id: "queued-offline"[\s\S]*label: "Queued for travel sync"/,
  "The SSE response should tell the chat UI that the turn was queued offline",
);

assert.match(
  chatRoute,
  /"content-type": "text\/event-stream; charset=utf-8"/,
  "Queued offline chat should preserve the /api/chat/send SSE contract",
);

const postIndex = chatRoute.indexOf("export async function POST");
const accessIndex = chatRoute.indexOf("await authorizeChatProjectLaunch", postIndex);
const queueIndex = chatRoute.indexOf(
  "const offlineChatResponse = await maybeQueueOfflineChat",
  postIndex,
);
const imageWriteIndex = chatRoute.indexOf("writeImageAttachmentsToTemp", queueIndex);
const harnessPromptIndex = chatRoute.indexOf("const harnessPrompt =", queueIndex);

assert.ok(postIndex >= 0, "Chat send POST handler should exist");
assert.ok(accessIndex >= 0, "Chat send should still run the project launch gate");
assert.ok(queueIndex > accessIndex, "Offline queueing must run after project launch authorization");
assert.ok(
  queueIndex < imageWriteIndex,
  "Offline queueing should run before image temp-file writes",
);
assert.ok(
  queueIndex < harnessPromptIndex,
  "Offline queueing should run before prompt assembly and harness spawning work",
);

// ── cave-zs85n Task 5: the queued-offline "done" event reports success the
//    moment the human turn is *accepted into the travel queue*, not once it
//    is durably persisted to the conversation file (that only happens later,
//    when travel sync flushes the queue). ChatView's "done" handler treats
//    any isError:false terminal as persistence-confirmed
//    (chat-sidebar-wiring.test.ts pins this), so this route must never signal
//    isError:true here just to *look* unsettled — the sidebar-attention
//    correctness for this gap lives entirely in the projection's
//    baseline-vs-canonical comparison (chat-attention-projection.ts /
//    chat-attention-projection.test.ts), not in a special "done" shape. ────
const offlineChatResponseBlock = chatRoute.match(
  /async function maybeQueueOfflineChat\([\s\S]*?\n\}\n/,
)?.[0] ?? "";
assert.ok(offlineChatResponseBlock, "maybeQueueOfflineChat should be defined");
const queuedSessionIndex = offlineChatResponseBlock.indexOf('push({ kind: "session", sessionId });');
const queuedProgressIndex = offlineChatResponseBlock.indexOf('id: "queued-offline"');
const queuedDoneIndex = offlineChatResponseBlock.indexOf('kind: "done"');
assert.ok(queuedSessionIndex >= 0, "the queued offline stream should push a session event");
assert.ok(queuedProgressIndex >= 0, "the queued offline stream should push the queued-offline progress step");
assert.ok(queuedDoneIndex >= 0, "the queued offline stream should push a terminal done event");
assert.ok(
  queuedSessionIndex < queuedProgressIndex && queuedProgressIndex < queuedDoneIndex,
  "the queued offline stream must push session, then the queued-offline progress step, then done — in that order, so ChatView records the attention clear before the outcome settles",
);
assert.match(
  offlineChatResponseBlock,
  /push\(\{\s*kind: "done",\s*isError: false,/,
  "the queued offline stream's done event must report isError:false — it is a genuine acceptance, not a failure — even though the human turn is not yet durably persisted; premature attention-projection retirement is guarded at the projection layer, not by faking an error here",
);
