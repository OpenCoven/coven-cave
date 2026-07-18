import test from "node:test";
import assert from "node:assert/strict";
import {
  startVoiceConversation,
  discardVoiceSessionIfEmpty,
  voiceChatStartErrorMessage,
} from "./start-voice-chat.ts";

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

test("voiceChatStartErrorMessage translates common codes and preserves unknown context", () => {
  assert.equal(voiceChatStartErrorMessage("network"), "Couldn't start a voice chat — is the daemon running?");
  assert.equal(
    voiceChatStartErrorMessage("familiar_not_found"),
    "Couldn't start a voice chat: that familiar no longer exists.",
  );
  assert.equal(voiceChatStartErrorMessage("save_failed"), "Couldn't start a voice chat (save_failed).");
});

test("discardVoiceSessionIfEmpty issues a single ifEmpty DELETE and reports deleted:true", async () => {
  const { impl, calls } = fetchStub([{ json: { ok: true, deleted: true } }]);
  const deleted = await discardVoiceSessionIfEmpty("s-1", impl);
  assert.equal(deleted, true);
  // One call only — the server checks emptiness and deletes atomically, so
  // there's no client-side GET→DELETE gap for an in-flight first exchange
  // to land in.
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "/api/chat/conversation/s-1?ifEmpty=1");
  assert.equal(calls[0].init?.method, "DELETE");
});

test("discardVoiceSessionIfEmpty reports false when the server left a non-empty conversation alone", async () => {
  const { impl, calls } = fetchStub([{ json: { ok: true, deleted: false } }]);
  const deleted = await discardVoiceSessionIfEmpty("s-1", impl);
  assert.equal(deleted, false);
  assert.equal(calls.length, 1);
});

test("discardVoiceSessionIfEmpty treats an unparsable response as not deleted", async () => {
  const impl = (async () => ({
    ok: true,
    status: 200,
    json: async () => { throw new Error("bad json"); },
  })) as unknown as typeof fetch;
  const deleted = await discardVoiceSessionIfEmpty("s-1", impl);
  assert.equal(deleted, false);
});

test("discardVoiceSessionIfEmpty maps a thrown fetch to false", async () => {
  const impl = (async () => { throw new Error("offline"); }) as unknown as typeof fetch;
  const deleted = await discardVoiceSessionIfEmpty("s-1", impl);
  assert.equal(deleted, false);
});

test("discardVoiceSessionIfEmpty URI-encodes the session id in the path", async () => {
  const { impl, calls } = fetchStub([{ json: { ok: true, deleted: true } }]);
  await discardVoiceSessionIfEmpty("s/1 weird?id", impl);
  assert.equal(calls[0].url, `/api/chat/conversation/${encodeURIComponent("s/1 weird?id")}?ifEmpty=1`);
});
