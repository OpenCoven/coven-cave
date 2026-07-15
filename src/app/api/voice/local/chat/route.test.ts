// @ts-nocheck
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

const realFetch = globalThis.fetch;
let nextFetch: ((url: string, init: RequestInit) => Promise<Response>) | null = null;
let lastCall: { url: string; body: any } | null = null;

globalThis.fetch = async (url, init) => {
  lastCall = { url: String(url), body: init?.body ? JSON.parse(String(init.body)) : null };
  if (nextFetch) return nextFetch(String(url), init ?? {});
  return realFetch(url, init);
};

const { POST } = await import("./route.ts");

function req(body: unknown) {
  return new Request("http://test/api/voice/local/chat", {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  nextFetch = null;
  lastCall = null;
  delete process.env.COVEN_LOCAL_LLM_URL;
});

test("400 on invalid json and missing/invalid messages", async () => {
  assert.equal((await POST(req("{nope"))).status, 400);
  assert.equal((await POST(req({}))).status, 400);
  assert.equal((await POST(req({ messages: [] }))).status, 400);
  const badRole = await POST(req({ messages: [{ role: "tool", content: "x" }] }));
  assert.equal(badRole.status, 400);
  assert.equal((await badRole.json()).error, "invalid_role");
  const oversize = await POST(req({
    messages: [{ role: "user", content: "x".repeat(8_001) }],
  }));
  assert.equal((await oversize.json()).error, "invalid_content");
});

test("502 local_llm_unreachable with an actionable hint when the loopback is down", async () => {
  nextFetch = async () => { throw new Error("ECONNREFUSED"); };
  const res = await POST(req({ messages: [{ role: "user", content: "hi" }] }));
  assert.equal(res.status, 502);
  const json = await res.json();
  assert.equal(json.error, "local_llm_unreachable");
  assert.match(json.hint, /Ollama|LM Studio/);
  assert.match(json.hint, /COVEN_LOCAL_LLM_URL/);
});

test("502 local_llm_error surfaces the server's own message", async () => {
  nextFetch = async () => new Response(
    JSON.stringify({ error: { message: "model 'nope' not found" } }),
    { status: 404 },
  );
  const res = await POST(req({ messages: [{ role: "user", content: "hi" }] }));
  assert.equal(res.status, 502);
  const json = await res.json();
  assert.equal(json.error, "local_llm_error");
  assert.match(json.hint, /model 'nope' not found/);
});

test("502 local_llm_empty when the model answers with no text", async () => {
  nextFetch = async () => new Response(
    JSON.stringify({ choices: [{ message: { content: "" } }] }),
    { status: 200 },
  );
  const res = await POST(req({ model: "llama3.2", messages: [{ role: "user", content: "hi" }] }));
  const json = await res.json();
  assert.equal(json.error, "local_llm_empty");
  assert.match(json.hint, /ollama pull llama3.2/);
});

test("forwards system + turns to the loopback chat-completions API and returns the text", async () => {
  nextFetch = async () => new Response(
    JSON.stringify({ choices: [{ message: { content: "  hello there  " } }] }),
    { status: 200 },
  );
  const res = await POST(req({
    model: "qwen3",
    messages: [
      { role: "system", content: "You are Milo." },
      { role: "user", content: "hi" },
      { role: "assistant", content: "hey" },
      { role: "user", content: "how are you?" },
    ],
  }));
  const json = await res.json();
  assert.deepEqual(json, { ok: true, text: "hello there" });
  assert.match(lastCall.url, /^http:\/\/127\.0\.0\.1:11434\/v1\/chat\/completions$/);
  assert.equal(lastCall.body.model, "qwen3");
  assert.equal(lastCall.body.stream, false);
  assert.equal(lastCall.body.messages[0].role, "system");
  assert.equal(lastCall.body.messages.length, 4);
});

test("honors the COVEN_LOCAL_LLM_URL base override", async () => {
  process.env.COVEN_LOCAL_LLM_URL = "http://127.0.0.1:1234";
  nextFetch = async () => new Response(
    JSON.stringify({ choices: [{ message: { content: "ok" } }] }),
    { status: 200 },
  );
  await POST(req({ messages: [{ role: "user", content: "hi" }] }));
  assert.match(lastCall.url, /^http:\/\/127\.0\.0\.1:1234\//);
});
