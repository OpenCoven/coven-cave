import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import {
  clearLiveChatGeneration,
  clearLiveChatGenerationAliases,
  readLiveChatGeneration,
  reconcileLiveChatGenerationSession,
  recordLiveChatGeneration,
} from "./chat-turn-state.ts";

const touchedSessionIds = new Set<string>();

afterEach(() => {
  for (const sessionId of touchedSessionIds) {
    clearLiveChatGeneration(sessionId);
  }
  touchedSessionIds.clear();
});

function snapshot(sessionId: string, runId: string) {
  touchedSessionIds.add(sessionId);
  return {
    sessionId,
    runId,
    turns: [],
    activeLeafId: "",
    controller: new AbortController(),
    updatedAt: Date.now(),
  };
}

test("done-only replacement migrates the snapshot and clears both stable aliases", () => {
  const origin = "done-only-origin";
  const replacement = "done-only-replacement";
  const runId = "done-only-run";
  touchedSessionIds.add(replacement);
  const generation = {
    sessionId: origin,
    sessionAliases: new Set([origin]),
  };
  recordLiveChatGeneration(snapshot(origin, runId));

  reconcileLiveChatGenerationSession(generation, replacement, runId);

  assert.equal(readLiveChatGeneration(origin), null);
  assert.equal(readLiveChatGeneration(replacement)?.sessionId, replacement);
  assert.equal(readLiveChatGeneration(replacement)?.runId, runId);
  assert.deepEqual([...generation.sessionAliases], [origin, replacement]);

  clearLiveChatGenerationAliases(generation.sessionAliases, runId);

  assert.equal(readLiveChatGeneration(origin), null);
  assert.equal(readLiveChatGeneration(replacement), null);
});

test("null-origin generation: empty aliases capture the assigned session and cleanup clears it", () => {
  // Null-origin sends (new blank chats) start with sessionId=null and an empty
  // alias set.  The first "session" event calls reconcileLiveChatGenerationSession
  // which adds the assigned id to sessionAliases.  If that aliasing is missing,
  // clearLiveChatGenerationAliases iterates an empty set and the assigned session's
  // registry entry survives as a zombie — reopening that session would adopt a
  // stale stream that has already ended.
  const sessionId = "null-origin-assigned";
  const runId = "null-origin-run";
  touchedSessionIds.add(sessionId);
  const generation: { sessionId: string | null; sessionAliases: Set<string> } = {
    sessionId: null,
    sessionAliases: new Set(),
  };

  // "session" event assigns the server-created session id
  reconcileLiveChatGenerationSession(generation, sessionId, runId);

  assert.deepEqual([...generation.sessionAliases], [sessionId],
    "alias set gains the first assigned session id after reconcile");
  assert.equal(generation.sessionId, sessionId);

  // persistLiveTurns records a snapshot under the assigned id
  recordLiveChatGeneration(snapshot(sessionId, runId));
  assert.equal(readLiveChatGeneration(sessionId)?.sessionId, sessionId);

  // Terminal cleanup must clear the assigned session via aliases
  clearLiveChatGenerationAliases(generation.sessionAliases, runId);
  assert.equal(readLiveChatGeneration(sessionId), null,
    "alias-based cleanup clears the null-origin's assigned session — no zombie survives");
});

test("cleanup for a replaced run preserves a newer run under its origin alias", () => {  const origin = "newer-origin";
  const replacement = "older-replacement";
  const oldRunId = "older-run";
  const newRunId = "newer-run";
  touchedSessionIds.add(replacement);
  const generation = {
    sessionId: origin,
    sessionAliases: new Set([origin]),
  };
  recordLiveChatGeneration(snapshot(origin, oldRunId));
  reconcileLiveChatGenerationSession(generation, replacement, oldRunId);
  recordLiveChatGeneration(snapshot(origin, newRunId));

  clearLiveChatGenerationAliases(generation.sessionAliases, oldRunId);

  assert.equal(readLiveChatGeneration(origin)?.runId, newRunId);
  assert.equal(readLiveChatGeneration(replacement), null);
});
