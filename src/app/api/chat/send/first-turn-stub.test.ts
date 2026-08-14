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
  /createConversationStub,[\s\S]*?stripConversationStubTurn,[\s\S]*?withConversationLock,[\s\S]*?\} from "@\/lib\/cave-conversations";/,
  "Chat send should persist and serialize first-turn stubs through the conversation store helpers",
);
assert.match(
  chatRoute,
  /markChatRunProjectionSettled,[\s\S]*?markChatRunTransportSettled,[\s\S]*?registerChatRun,[\s\S]*?unregisterChatRun,[\s\S]*?addChatRunKeys,[\s\S]*?type ChatRunHandle,[\s\S]*?\} from "@\/lib\/server\/chat-stop-registry";/,
  "Chat send should distinguish transport settlement from projection settlement in the shared run registry",
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
  /userTurn: \{[\s\S]*?id: pendingUserTurnId,[\s\S]*?\.\.\.persistedTurnControls\(body, responseMetadata\.retryModel\)/,
  "the coven-run stub preserves the selected model-control snapshot before stream completion",
);

assert.match(
  chatRoute,
  /if \(stubWrite\) await stubWrite;\s*const isFirstExchange = await withConversationLock\(finalSessionId, async \(\) => \{\s*const existing = await loadConversation\(finalSessionId\);/,
  "the coven-run save must settle the stub write and lock before loading, so a stub or model PATCH can never lose an authoritative update",
);
assert.match(
  chatRoute,
  /markChatRunTransportSettled\(runHandle\);[\s\S]*?const cancelledByUser = runHandle\.stopRequested;[\s\S]*?if \(finalSessionId && \(!launchFailure \|\| persistCovenProcessFailure\)\) \{\s*try \{\s*pushProgress\("save-transcript", "Saving transcript", "running"/,
  "general Coven transports must freeze Stop only after transport completion and before persistence starts",
);
assert.match(
  chatRoute,
  /pushProgress\("save-transcript", "Transcript saved", "done"\);[\s\S]*?\}\s*\n\s*markChatRunProjectionSettled\(runHandle\);[\s\S]*?push\(\{\s*kind: "done"[\s\S]*?unregisterChatRun\(runHandle\);/,
  "general transports keep the session live through persistence, then settle projection before final unregister/cleanup",
);

assert.match(
  chatRoute,
  /const ownsFirstExchangeTitle =\s*body\.sessionId == null \|\|\s*\(\s*body\.startNewConversation === true &&\s*existingConversation == null &&\s*taskCard != null\s*\);/,
  "the route must derive title ownership from submitted-session provenance while preserving Board reservations",
);

assert.match(
  chatRoute,
  /title: ownsFirstExchangeTitle\s*\? chatSummaryTitle\(\{ userText: promptText \}\) \?\? defaultChatTitleForSession\(announcedId\)\s*: defaultChatTitleForSession\(announcedId\),/,
  "the generic stub materializes daemon-only resumes without deriving their local title from the follow-up prompt",
);

assert.match(
  chatRoute,
  /createConversationStub\(\{[\s\S]*?sessionId: announcedId,[\s\S]*?\}\)\.then\(async \(created\) => \{\s*if \(created && ownsFirstExchangeTitle\) \{\s*await setDefaultStubTitleAuto\([\s\S]*?\);\s*\}\s*return created;\s*\}\)\.catch/,
  "generic stub title initialization runs only when this request owns the first exchange",
);

assert.match(
  chatRoute,
  /const firstExchange =\s*ownsFirstExchangeTitle && \(!existing \|\| hadFirstTurnStub\);[\s\S]*?if \(!existing && ownsFirstExchangeTitle\) \{\s*await setDefaultStubTitleAuto\(finalSessionId, chatTitle\);\s*\}/,
  "the generic final save gates both default ownership and first-exchange auto-naming on request provenance",
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
  /if \(gatewayDispatch\.kind === "accepted"\)[\s\S]*?const stubWrite = createConversationStub\(\{[\s\S]*?modelIntent: modelIntentForSend\(args\.body, args\.modelState\),[\s\S]*?userTurn:/,
  "an accepted Gateway first turn persists its session model intent before the response completes",
);

const openClawStubWrites = [
  ...chatRoute.matchAll(
    /const stubWrite = createConversationStub\(\{[\s\S]*?harness: "openclaw",[\s\S]*?\}\)\.then\(async \(created\) => \{[\s\S]*?if \(created && ownsFirstExchangeTitle\) \{[\s\S]*?await setDefaultStubTitleAuto\(conversationId, stubTitle\);[\s\S]*?\}[\s\S]*?return created;[\s\S]*?\}\)\.catch\(\(\) => false\);/g,
  ),
];
assert.equal(
  openClawStubWrites.length,
  2,
  "both OpenClaw transports initialize title ownership only for an authoritative new chat whose stub was created",
);
assert.match(
  chatRoute,
  /openClawChatResponse\(\{[\s\S]*?ownsFirstExchangeTitle,\s*\}\)/,
  "OpenClaw consumes the same route-wide first-exchange ownership decision as generic harnesses",
);
assert.equal(
  (
    chatRoute.match(
      /const (?:isFirstExchange|firstExchange) =\s*ownsFirstExchangeTitle && (?:\(!existing \|\| hadFirstTurnStub\)|hadFirstTurnStub);/g,
    ) ?? []
  ).length,
  3,
  "both OpenClaw close paths and the generic close path gate first-exchange naming on authoritative new-chat provenance",
);
assert.doesNotMatch(
  chatRoute,
  /void setDefaultStubTitleAuto\(conversationId, stubTitle\);\s*const stubWrite = createConversationStub/,
  "a resumed OpenClaw chat must not overwrite its auto-owned title before the stub no-op is known",
);

assert.match(
  chatRoute,
  /await stubWrite;\s*const isFirstExchange = await withConversationLock\(sessionId, async \(\) => \{\s*const existing = await loadConversation\(sessionId\);/,
  "the OpenClaw close handler must settle the stub write and lock before loading the conversation",
);
assert.match(
  chatRoute,
  /markChatRunTransportSettled\(runHandle\);[\s\S]*?if \(sessionId\) \{\s*try \{\s*pushProgress\("save-transcript", "Saving transcript", "running"/,
  "OpenClaw transport settlement must freeze Stop before transcript persistence begins",
);
assert.match(
  chatRoute,
  /pushProgress\("save-transcript", "Transcript saved", "done"\);[\s\S]*?markChatRunProjectionSettled\(runHandle\);[\s\S]*?unregisterChatRun\(runHandle\);[\s\S]*?push\(\{\s*kind: "done"/,
  "OpenClaw keeps projection live through persistence, then settles projection/unregisters before the final done event",
);

assert.match(
  chatRoute,
  /if \(isFirstExchange && !isError\) \{\s*await autoNameSessionFromFirstExchange\(sessionId, args\.promptText\);/,
  "OpenClaw auto-naming must key off isFirstExchange now that stubs pre-create the conversation",
);

// ── Shared turn identity ─────────────────────────────────────────────────────

assert.equal(
  (
    chatRoute.match(
      /const hadFirstTurnStub = (?:existing\s*\? stripConversationStubTurn\(existing, pendingUserTurnId\)\s*: false|stripConversationStubTurn\(existing, pendingUserTurnId\));/g,
    ) ?? []
  ).length,
  3,
  "all save paths must strip the stub turn so the authoritative user turn re-lands cleanly",
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

// ── Stop + liveness by conversation id (cave-0g2x follow-through) ────────────
// A new chat's run registers under only the client runId (body.sessionId is
// null until the harness mints an id). announceSession must late-key the run
// registry with the announced id so /api/chat/stop works mid-first-turn and
// the sessions-list liveness probe (hasActiveChatRun) sees the run.
assert.match(
  chatRoute,
  /const announceSession = \(id: string\) => \{[\s\S]{0,1200}addChatRunKeys\(runHandle, \[announcedId\]\)/,
  "announceSession late-keys the run registry with the announced conversation id",
);

// ── autoNameSessionFromFirstExchange uses chatSummaryTitle (Gap 1 contract) ──
// The summary must be derived via the shared chatSummaryTitle heuristic, NOT
// chatTitleFromPrompt (which uses a 64-char truncation and bypasses the shared
// formatter). The function must also load the stored conversation so it can
// pass the first settled assistant text to chatSummaryTitle.

assert.match(
  chatRoute,
  /import \{[^}]*chatSummaryTitle[^}]*\} from "@\/lib\/cave-chat-titles"/,
  "chatSummaryTitle must be imported from @/lib/cave-chat-titles",
);

// D: setSessionTitleAutoIfOwned must be imported from cave-config.
assert.match(
  chatRoute,
  /import \{[^}]*setSessionTitleAutoIfOwned[^}]*\} from "@\/lib\/cave-config"/,
  "setSessionTitleAutoIfOwned must be imported from @/lib/cave-config",
);

{
  const fnMarker = "async function autoNameSessionFromFirstExchange";
  const fnStart = chatRoute.indexOf(fnMarker);
  assert.ok(fnStart >= 0, "autoNameSessionFromFirstExchange function must exist");
  // Grab the function body — from its start to the next top-level async function.
  const nextFn = chatRoute.indexOf("\nasync function ", fnStart + 1);
  const fnBody = nextFn > fnStart ? chatRoute.slice(fnStart, nextFn) : chatRoute.slice(fnStart, fnStart + 2000);

  assert.match(
    fnBody,
    /chatSummaryTitle\(\s*\{/,
    "autoNameSessionFromFirstExchange must call chatSummaryTitle with an exchange object",
  );
  assert.doesNotMatch(
    fnBody,
    /const summary = chatTitleFromPrompt/,
    "autoNameSessionFromFirstExchange must not derive the title summary via chatTitleFromPrompt",
  );
  assert.match(
    fnBody,
    /loadConversation/,
    "autoNameSessionFromFirstExchange must load the stored conversation for the settled exchange",
  );
  // D: must use atomic helper, not plain setSessionTitle.
  assert.match(
    fnBody,
    /setSessionTitleAutoIfOwned/,
    "autoNameSessionFromFirstExchange must call setSessionTitleAutoIfOwned (atomic ownership check)",
  );
  assert.doesNotMatch(
    fnBody,
    /await setSessionTitle\(sessionId,/,
    "autoNameSessionFromFirstExchange must not call setSessionTitle — use setSessionTitleAutoIfOwned",
  );
}

// Periodic renaming must make its ownership decision and title write in one
// config-state mutation. A separate read/check followed by an unconditional
// write can overwrite a manual rename that lands between those operations.
{
  const fnMarker = "async function maybeAutoRenameFromContext";
  const fnStart = chatRoute.indexOf(fnMarker);
  assert.ok(fnStart >= 0, "periodic auto-rename helper exists");
  const nextFn = chatRoute.indexOf("\nasync function ", fnStart + fnMarker.length);
  const fnBody = chatRoute.slice(fnStart, nextFn);
  assert.match(
    fnBody,
    /setSessionTitleAutoIfOwned\([\s\S]*policy\.preserveManualTitles/,
    "periodic rename atomically checks ownership and writes under the configured policy",
  );
  assert.doesNotMatch(
    fnBody,
    /\bsetSessionTitleAuto\(/,
    "periodic rename must not perform an unconditional later write",
  );
  assert.doesNotMatch(
    fnBody,
    /isAutoOwnedTitle\(/,
    "periodic rename must not split its ownership check from the state write",
  );
  assert.match(
    fnBody,
    /isRenameDueAtTurn\(assistantTurns, policy\.everyTurns\)/,
    "periodic renaming remains controlled by the configured assistant-turn cadence",
  );
}

// D: No stub title path may use chatTitleFromPrompt as the selected title.
assert.doesNotMatch(
  chatRoute,
  /const stubTitle = chatTitleFromPrompt\(/,
  "no stub title may be derived with chatTitleFromPrompt as the selected title",
);
assert.doesNotMatch(
  chatRoute,
  /createConversationStub\(\{[\s\S]{0,1500}?title:\s*chatTitleFromPrompt\(/,
  "no createConversationStub call may set title via chatTitleFromPrompt",
);

// D: setDefaultStubTitleAuto must exist, be named correctly, and use the atomic helper.
{
  const helperMarker = "async function setDefaultStubTitleAuto";
  const helperStart = chatRoute.indexOf(helperMarker);
  assert.ok(helperStart >= 0, "setDefaultStubTitleAuto helper must exist (renamed from setDefaultSessionTitleIfMissing)");
  const nextFn = chatRoute.indexOf("\nasync function ", helperStart + 1);
  const helperBody = nextFn > helperStart
    ? chatRoute.slice(helperStart, nextFn)
    : chatRoute.slice(helperStart, helperStart + 500);
  assert.match(
    helperBody,
    /setSessionTitleAutoIfOwned/,
    "setDefaultStubTitleAuto must call setSessionTitleAutoIfOwned (atomic auto-owned write)",
  );
}
