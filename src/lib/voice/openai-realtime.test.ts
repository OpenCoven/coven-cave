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

test("mintSession POSTs to OpenAI Realtime sessions endpoint with bearer auth", async () => {
  captured = [];
  nextResponse = new Response(
    JSON.stringify({
      client_secret: { value: "ephem_123", expires_at: 1750000000 },
      id: "sess_x",
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
  await openaiRealtimeProvider.mintSession("sk-test", {
    familiarId: "m",
    model: "gpt-4o-realtime-preview",
    voice: "alloy",
    instructions: "you are Milo",
    conversationSeed: [],
  });
  assert.equal(captured.length, 1);
  assert.equal(captured[0].url, "https://api.openai.com/v1/realtime/sessions");
  assert.equal(captured[0].init.method, "POST");
  const headers = new Headers(captured[0].init.headers as HeadersInit);
  assert.equal(headers.get("authorization"), "Bearer sk-test");
  assert.equal(headers.get("content-type"), "application/json");
});

test("mintSession passes model, voice, instructions, input_audio_transcription in body", async () => {
  captured = [];
  nextResponse = new Response(
    JSON.stringify({ client_secret: { value: "x", expires_at: 1 } }),
    { status: 200 },
  );
  await openaiRealtimeProvider.mintSession("sk-test", {
    familiarId: "m",
    model: "gpt-4o-realtime-preview",
    voice: "verse",
    instructions: "be brief",
  });
  const body = JSON.parse(captured[0].init.body as string);
  assert.equal(body.model, "gpt-4o-realtime-preview");
  assert.equal(body.voice, "verse");
  assert.equal(body.instructions, "be brief");
  assert.ok(body.input_audio_transcription, "transcription must be requested");
});

test("mintSession returns grant with provider, clientSecret, expiresAt, connection.kind", async () => {
  nextResponse = new Response(
    JSON.stringify({
      client_secret: { value: "ephem_42", expires_at: 1751111111 },
    }),
    { status: 200 },
  );
  const grant = await openaiRealtimeProvider.mintSession("sk-x", {
    familiarId: "m",
    model: "gpt-4o-realtime-preview",
    voice: "alloy",
    instructions: "",
  });
  assert.equal(grant.provider, "openai");
  assert.equal(grant.clientSecret, "ephem_42");
  assert.equal(typeof grant.expiresAt, "string");
  assert.equal(grant.connection.kind, "openai-realtime");
  assert.equal(grant.connection.model, "gpt-4o-realtime-preview");
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
