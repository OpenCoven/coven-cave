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

test("cleanup for a replaced run preserves a newer run under its origin alias", () => {
  const origin = "newer-origin";
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
