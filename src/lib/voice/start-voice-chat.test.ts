import test from "node:test";
import assert from "node:assert/strict";
import { startVoiceConversation, discardVoiceSessionIfEmpty } from "./start-voice-chat.ts";

type FetchCall = { url: string; init?: RequestInit };

function fetchStub(responses: Array<{ status?: number; json: unknown }>) {
  const calls: FetchCall[] = [];
  const impl = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const next = responses.shift() ?? { status: 500, json: { ok: false } };
    return {
      ok: (next.status ?? 200) < 400,
      status: next.status ?? 200,
      json: async () => next.json,
    };
  }) as unknown as typeof fetch;
  return { impl, calls };
}

test("startVoiceConversation posts familiarId + projectRoot and returns the sessionId", async () => {
  const { impl, calls } = fetchStub([{ json: { ok: true, sessionId: "s-1" } }]);
  const result = await startVoiceConversation("fam-1", "/tmp/proj", impl);
  assert.deepEqual(result, { ok: true, sessionId: "s-1" });
  assert.equal(calls[0].url, "/api/chat/conversation");
  assert.equal(calls[0].init?.method, "POST");
  assert.deepEqual(JSON.parse(String(calls[0].init?.body)), { familiarId: "fam-1", projectRoot: "/tmp/proj" });
});

test("startVoiceConversation omits projectRoot when null", async () => {
  const { impl, calls } = fetchStub([{ json: { ok: true, sessionId: "s-2" } }]);
  await startVoiceConversation("fam-1", null, impl);
  assert.deepEqual(JSON.parse(String(calls[0].init?.body)), { familiarId: "fam-1" });
});

test("startVoiceConversation surfaces the server error", async () => {
  const { impl } = fetchStub([{ status: 404, json: { ok: false, error: "familiar_not_found" } }]);
  const result = await startVoiceConversation("ghost", null, impl);
  assert.deepEqual(result, { ok: false, error: "familiar_not_found" });
});

test("startVoiceConversation maps a thrown fetch to a network error", async () => {
  const impl = (async () => { throw new Error("offline"); }) as unknown as typeof fetch;
  const result = await startVoiceConversation("fam-1", null, impl);
  assert.deepEqual(result, { ok: false, error: "network" });
});

test("discardVoiceSessionIfEmpty deletes only zero-turn conversations", async () => {
  const { impl, calls } = fetchStub([
    { json: { ok: true, conversation: { turns: [] } } },
    { json: { ok: true, deleted: true } },
  ]);
  const deleted = await discardVoiceSessionIfEmpty("s-1", impl);
  assert.equal(deleted, true);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, "/api/chat/conversation/s-1");
  assert.equal(calls[1].url, "/api/chat/conversation/s-1");
  assert.equal(calls[1].init?.method, "DELETE");
});

test("discardVoiceSessionIfEmpty keeps conversations that have turns", async () => {
  const { impl, calls } = fetchStub([
    { json: { ok: true, conversation: { turns: [{ id: "t1" }] } } },
  ]);
  const deleted = await discardVoiceSessionIfEmpty("s-1", impl);
  assert.equal(deleted, false);
  assert.equal(calls.length, 1); // no DELETE issued
});

test("discardVoiceSessionIfEmpty is a no-op when the conversation is missing", async () => {
  const { impl, calls } = fetchStub([{ status: 404, json: { ok: false, error: "not found" } }]);
  const deleted = await discardVoiceSessionIfEmpty("s-1", impl);
  assert.equal(deleted, false);
  assert.equal(calls.length, 1);
});
