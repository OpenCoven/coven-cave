// @ts-nocheck
import { test } from "node:test";
import assert from "node:assert/strict";

let captured: { url: string; init: RequestInit }[] = [];
let nextResponse: Response = new Response("{}", { status: 200 });

(globalThis as any).fetch = async (url: string | URL, init?: RequestInit) => {
  captured.push({ url: String(url), init: init ?? {} });
  return nextResponse;
};

const { openaiRealtimeProvider } = await import("./openai-realtime.ts");

test("mintSession POSTs to /v1/realtime/client_secrets with bearer auth", async () => {
  captured = [];
  nextResponse = new Response(
    JSON.stringify({ value: "ek_123", expires_at: 1750000000 }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
  await openaiRealtimeProvider.mintSession("sk-test", {
    familiarId: "m",
    model: "gpt-realtime",
    voice: "alloy",
    instructions: "you are Milo",
    conversationSeed: [],
  });
  assert.equal(captured.length, 1);
  assert.equal(captured[0].url, "https://api.openai.com/v1/realtime/client_secrets");
  assert.equal(captured[0].init.method, "POST");
  const headers = new Headers(captured[0].init.headers as HeadersInit);
  assert.equal(headers.get("authorization"), "Bearer sk-test");
  assert.equal(headers.get("content-type"), "application/json");
});

test("mintSession wraps model/voice/instructions/transcription inside session.audio", async () => {
  captured = [];
  nextResponse = new Response(
    JSON.stringify({ value: "ek_x", expires_at: 1 }),
    { status: 200 },
  );
  await openaiRealtimeProvider.mintSession("sk-test", {
    familiarId: "m",
    model: "gpt-realtime",
    voice: "verse",
    instructions: "be brief",
  });
  const body = JSON.parse(captured[0].init.body as string);
  assert.ok(body.session, "request body must wrap fields in a `session` object");
  assert.equal(body.session.type, "realtime");
  assert.equal(body.session.model, "gpt-realtime");
  assert.equal(body.session.instructions, "be brief");
  assert.equal(body.session.audio.output.voice, "verse");
  assert.ok(body.session.audio.input.transcription, "transcription must be requested");
});

test("mintSession returns grant with provider, clientSecret, expiresAt, connection.kind", async () => {
  nextResponse = new Response(
    JSON.stringify({ value: "ek_42", expires_at: 1751111111 }),
    { status: 200 },
  );
  const grant = await openaiRealtimeProvider.mintSession("sk-x", {
    familiarId: "m",
    model: "gpt-realtime",
    voice: "alloy",
    instructions: "",
  });
  assert.equal(grant.provider, "openai");
  assert.equal(grant.clientSecret, "ek_42");
  assert.equal(typeof grant.expiresAt, "string");
  assert.equal(grant.connection.kind, "openai-realtime");
  assert.equal(grant.connection.model, "gpt-realtime");
});

test("mintSession surfaces provider error message verbatim on non-2xx", async () => {
  nextResponse = new Response(
    JSON.stringify({ error: { message: "model not enabled for this account" } }),
    { status: 403 },
  );
  await assert.rejects(
    () => openaiRealtimeProvider.mintSession("sk-x", {
      familiarId: "m", model: "x", voice: "x", instructions: "",
    }),
    /model not enabled for this account/,
  );
});
