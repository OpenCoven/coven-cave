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
const accessIndex = chatRoute.indexOf("await assertProjectAccess", postIndex);
const queueIndex = chatRoute.indexOf(
  "const offlineChatResponse = await maybeQueueOfflineChat",
  postIndex,
);
const imageWriteIndex = chatRoute.indexOf("writeImageAttachmentsToTemp", queueIndex);
const harnessPromptIndex = chatRoute.indexOf("const harnessPrompt =", queueIndex);

assert.ok(postIndex >= 0, "Chat send POST handler should exist");
assert.ok(accessIndex >= 0, "Chat send should still perform project access checks");
assert.ok(queueIndex > accessIndex, "Offline queueing must run after project access checks");
assert.ok(
  queueIndex < imageWriteIndex,
  "Offline queueing should run before image temp-file writes",
);
assert.ok(
  queueIndex < harnessPromptIndex,
  "Offline queueing should run before prompt assembly and harness spawning work",
);
