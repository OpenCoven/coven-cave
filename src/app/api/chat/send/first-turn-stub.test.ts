// First-turn visibility (cave-0g2x): new chats must be persisted as a stub
// conversation the moment their session id exists — not only at end-of-stream
// — so /api/sessions/list can surface them during the entire first turn, and a
// mid-turn crash leaves a listed chat holding the user's message. These pins
// hold the route wiring for both harness paths (coven-run and OpenClaw).
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const chatRoute = await readFile(new URL("./route.ts", import.meta.url), "utf8");

assert.match(
  chatRoute,
  /createConversationStub,[\s\S]*?stripConversationStubTurn,[\s\S]*?\} from "@\/lib\/cave-conversations";/,
  "Chat send should persist first-turn stubs through the conversation store helpers",
);

// ── coven-run path ───────────────────────────────────────────────────────────

assert.match(
  chatRoute,
  /stubWrite = createConversationStub\(\{\s*sessionId: announcedId,[\s\S]*?\}\)\.catch\(\(\) => undefined\);\s*push\(\{ kind: "session", sessionId: announcedId \}\);/,
  "announceSession must start the stub write before pushing the session frame, keyed to the stable announced id",
);

assert.match(
  chatRoute,
  /id: pendingUserTurnId,\s*text: promptText,/,
  "the coven-run stub must carry the pending user turn under the shared pre-minted id",
);

assert.match(
  chatRoute,
  /if \(stubWrite\) await stubWrite;\s*const existing = await loadConversation\(finalSessionId\);/,
  "the coven-run save must settle the stub write before loading, so a late stub can never clobber the authoritative transcript",
);

assert.match(
  chatRoute,
  /if \(isFirstExchange && !result\.is_error && !cancelledByUser\) \{\s*await autoNameSessionFromFirstExchange\(finalSessionId, promptText\);/,
  "auto-naming must still fire for new chats whose conversation now pre-exists as a stub",
);

// ── OpenClaw path ────────────────────────────────────────────────────────────

assert.match(
  chatRoute,
  /const stubWrite = createConversationStub\(\{\s*sessionId: conversationId,[\s\S]*?harness: "openclaw",/,
  "the OpenClaw path must write its stub up front, keyed to the conversation id it mints before spawning",
);

assert.match(
  chatRoute,
  /await stubWrite;\s*const existing = await loadConversation\(sessionId\);/,
  "the OpenClaw close handler must settle the stub write before loading the conversation",
);

assert.match(
  chatRoute,
  /if \(isFirstExchange && !isError\) \{\s*await autoNameSessionFromFirstExchange\(sessionId, args\.promptText\);/,
  "OpenClaw auto-naming must key off isFirstExchange now that stubs pre-create the conversation",
);

// ── Shared turn identity ─────────────────────────────────────────────────────

assert.equal(
  (chatRoute.match(/const hadFirstTurnStub = existing\s*\? stripConversationStubTurn\(existing, pendingUserTurnId\)\s*: false;/g) ?? []).length,
  2,
  "both save paths must strip the stub turn so the authoritative user turn re-lands cleanly",
);

assert.equal(
  (chatRoute.match(/const userTurnId = pendingUserTurnId;/g) ?? []).length,
  2,
  "both save paths must reuse the stub's pre-minted user-turn id",
);

assert.doesNotMatch(
  chatRoute,
  /const userTurnId = crypto\.randomUUID\(\)/,
  "no save path may mint a fresh user-turn id divorced from the stub's — that would duplicate the first turn",
);
