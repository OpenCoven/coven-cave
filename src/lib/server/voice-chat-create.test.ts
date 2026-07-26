import test from "node:test";
import assert from "node:assert/strict";
import { createVoiceChatSession, type VoiceChatCreateDeps } from "./voice-chat-create.ts";
import type { ConversationFile } from "../cave-conversations.ts";

function depsFor(overrides: Partial<VoiceChatCreateDeps> = {}) {
  const saved: ConversationFile[] = [];
  const recorded: Array<{ sessionId: string; familiarId: string }> = [];
  const titles: Array<{ sessionId: string; title: string }> = [];
  const deps: VoiceChatCreateDeps = {
    loadFamiliarBinding: async () => ({ harness: "claude" }),
    saveConversation: async (conv) => { saved.push(conv); },
    recordSessionFamiliar: async (sessionId, familiarId) => { recorded.push({ sessionId, familiarId }); },
    setSessionTitle: async (sessionId, title) => { titles.push({ sessionId, title }); },
    defaultTitle: () => "New chat",
    mintSessionId: () => "test-session-id",
    ...overrides,
  };
  return { deps, saved, recorded, titles };
}

test("creates an empty conversation with call origin and returns the id", async () => {
  const { deps, saved, recorded, titles } = depsFor();
  const result = await createVoiceChatSession(deps, { familiarId: "fam-1", projectRoot: null });
  assert.deepEqual(result, { ok: true, sessionId: "test-session-id" });
  assert.equal(saved.length, 1);
  const conv = saved[0];
  assert.equal(conv.sessionId, "test-session-id");
  assert.equal(conv.familiarId, "fam-1");
  assert.equal(conv.harness, "claude");
  assert.equal(conv.origin, "call");
  assert.deepEqual(conv.turns, []);
  assert.equal(conv.runtime, undefined);
  assert.deepEqual(recorded, [{ sessionId: "test-session-id", familiarId: "fam-1" }]);
  assert.deepEqual(titles, [{ sessionId: "test-session-id", title: "New chat" }]);
});

test("records the project root as a local runtime", async () => {
  const { deps, saved } = depsFor();
  const result = await createVoiceChatSession(deps, { familiarId: "fam-1", projectRoot: "/tmp/proj" });
  assert.equal(result.ok, true);
  assert.equal(saved[0].runtime, "local:/tmp/proj");
});

test("unknown familiar -> familiar_not_found, nothing persisted", async () => {
  const { deps, saved, recorded } = depsFor({ loadFamiliarBinding: async () => null });
  const result = await createVoiceChatSession(deps, { familiarId: "ghost", projectRoot: null });
  assert.deepEqual(result, { ok: false, error: "familiar_not_found" });
  assert.equal(saved.length, 0);
  assert.equal(recorded.length, 0);
});

test("save failure -> save_failed", async () => {
  const { deps } = depsFor({ saveConversation: async () => { throw new Error("disk full"); } });
  const result = await createVoiceChatSession(deps, { familiarId: "fam-1", projectRoot: null });
  assert.deepEqual(result, { ok: false, error: "save_failed" });
});

test("minted session ids default to UUIDs (safe conversation ids)", async () => {
  const seen: string[] = [];
  const { deps } = depsFor({
    saveConversation: async (conv) => { seen.push(conv.sessionId); },
  });
  delete (deps as Partial<VoiceChatCreateDeps>).mintSessionId; // exercise the default minting path
  const result = await createVoiceChatSession(deps, { familiarId: "fam-1", projectRoot: null });
  assert.equal(result.ok, true);
  assert.match(seen[0], /^[0-9a-f-]{36}$/);
});
