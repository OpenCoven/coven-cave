import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const chatRoute = await readFile(
  new URL("../../../../lib/server/chat-send-service.ts", import.meta.url),
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
  /runId: args\.body\.runId,/,
  "Queued offline chat payloads should preserve the normalized client run id for queue-time attention persistence",
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

const postIndex = chatRoute.indexOf("export async function executeChatSend");
const accessIndex = chatRoute.indexOf("await authorizeChatProjectLaunch", postIndex);
const queueIndex = chatRoute.indexOf(
  "const offlineChatResponse = await maybeQueueOfflineChat",
  postIndex,
);
const imageWriteIndex = chatRoute.indexOf("writeImageAttachmentsToRuntime", queueIndex);
const harnessPromptIndex = chatRoute.indexOf("const harnessPrompt =", queueIndex);

assert.ok(postIndex >= 0, "Chat send service entry point should exist");
assert.ok(accessIndex >= 0, "Chat send should still run the project launch gate");
assert.ok(queueIndex > accessIndex, "Offline queueing must run after project launch authorization");
// Checked separately from the ordering below: `indexOf` returns -1 when the
// symbol is renamed, and `queueIndex < -1` then fails as an ORDERING violation,
// which sends the next reader looking for a reordered handler that is fine.
// The cave-cxwgy rename cost exactly that detour before this guard existed.
assert.ok(
  imageWriteIndex >= 0,
  "Image staging call not found in the chat route — if it was renamed, update this probe",
);
assert.ok(
  queueIndex < imageWriteIndex,
  "Offline queueing should run before image staging writes",
);
assert.ok(
  queueIndex < harnessPromptIndex,
  "Offline queueing should run before prompt assembly and harness spawning work",
);
assert.match(
  chatRoute,
  /maybeQueueOfflineChat[\s\S]*?openRunBuffer\(\[args\.body\.runId, sessionId\]\)[\s\S]*?runBuffer\.record\(event\)[\s\S]*?runBuffer\.finish\(\)/,
  "offline completion events use the same bounded canonical run sequence",
);

// ── cave-zs85n Task 5: the queued-offline "done" event reports success after
//    both the queue item and original user turn are durably persisted.
//    ChatView's "done" handler treats
//    any isError:false terminal as persistence-confirmed
//    (chat-sidebar-wiring.test.ts pins this), so persistence must finish before
//    the stream settles. ─────────────────────────────────────────────────────
const offlineChatResponseBlock = chatRoute.match(
  /async function maybeQueueOfflineChat\([\s\S]*?\n\}\n/,
)?.[0] ?? "";
assert.ok(offlineChatResponseBlock, "maybeQueueOfflineChat should be defined");
assert.match(
  offlineChatResponseBlock,
  /const queuedUserTurnId = crypto\.randomUUID\(\);[\s\S]*userTurnId: queuedUserTurnId,[\s\S]*await persistQueuedOfflineConversation\(\{[\s\S]*userTurn: \{[\s\S]*id: queuedUserTurnId,[\s\S]*attachments: args\.persistedAttachments[\s\S]*attentionClearOperationForTurn\(args\.body\.runId\)[\s\S]*persistedTurnControls\([\s\S]*parentId: args\.body\.parentTurnId/,
  "the queue payload and original local human turn share one stable id and preserve attachments, controls, parentage, and the attention operation",
);
assert.doesNotMatch(
  offlineChatResponseBlock,
  /replaySessions|replaySessionId|daemonSessionId|continuity|resolveReplayBacked/,
  "queue-time persistence must not promise replay continuity or daemon identity",
);
const queuedSessionIndex = offlineChatResponseBlock.indexOf('push({ kind: "session", sessionId });');
const queuedProgressIndex = offlineChatResponseBlock.indexOf('id: "queued-offline"');
const queuedDoneIndex = offlineChatResponseBlock.indexOf('kind: "done"');
const queuedPersistenceIndex = offlineChatResponseBlock.indexOf("await persistQueuedOfflineConversation");
assert.ok(
  queuedPersistenceIndex >= 0 && queuedPersistenceIndex < queuedSessionIndex,
  "the original user turn must be durable before the queued stream announces success",
);
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
  "the queued offline stream's done event reports genuine durable acceptance",
);
