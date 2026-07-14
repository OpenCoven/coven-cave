// @ts-nocheck
import { test } from "node:test";
import assert from "node:assert/strict";

let captured: { url: string; init: RequestInit }[] = [];
let nextResponse: Response = new Response("{}", { status: 200 });

(globalThis as any).fetch = async (url: string | URL, init?: RequestInit) => {
  captured.push({ url: String(url), init: init ?? {} });
  return nextResponse;
};

// Minimal WebRTC stubs so clientAdapter.connect runs under node.
let lastDataChannel: { onmessage: ((ev: { data: unknown }) => void) | null; close: () => void } | null = null;
(globalThis as any).RTCPeerConnection = class {
  ontrack: unknown = null;
  onconnectionstatechange: unknown = null;
  addTrack() {}
  createDataChannel() {
    lastDataChannel = { onmessage: null, close() {} };
    return lastDataChannel;
  }
  async createOffer() { return { type: "offer", sdp: "v=0\r\n" }; }
  async setLocalDescription() {}
  async setRemoteDescription() {}
  close() {}
};
(globalThis as any).MediaStream = class {
  addTrack() {}
  getAudioTracks() { return []; }
};

const fakeMic = { getAudioTracks: () => [] } as any;
const noopCallbacks = {
  onUserTranscriptFinal() {},
  onAssistantTranscriptFinal() {},
  onPartialTranscript() {},
  onError() {},
  onDisconnect() {},
};
const sdpGrant = {
  provider: "openai",
  clientSecret: "ek_test",
  expiresAt: new Date().toISOString(),
  connection: { kind: "openai-realtime", url: "https://api.openai.com/v1/realtime/calls" },
} as any;

const { openaiRealtimeProvider } = await import("./openai-realtime.ts");
const { VoiceConnectError } = await import("./types.ts");

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

test("connect: failed SDP exchange throws VoiceConnectError with provider detail as hint", async () => {
  captured = [];
  nextResponse = new Response(
    JSON.stringify({ error: { message: 'Model "mock-model" is not supported in realtime mode.', code: "invalid_model" } }),
    { status: 400 },
  );
  await assert.rejects(
    () => openaiRealtimeProvider.clientAdapter.connect(sdpGrant, fakeMic, noopCallbacks),
    (err: unknown) => {
      assert.ok(err instanceof VoiceConnectError, "throws VoiceConnectError");
      assert.equal(err.message, "sdp_exchange_failed_400");
      assert.match(err.hint ?? "", /mock-model.*not supported in realtime mode/);
      return true;
    },
  );
});

test("connect: failed SDP exchange with non-JSON body still throws coded error, no hint", async () => {
  captured = [];
  nextResponse = new Response("<html>bad gateway</html>", { status: 502 });
  await assert.rejects(
    () => openaiRealtimeProvider.clientAdapter.connect(sdpGrant, fakeMic, noopCallbacks),
    (err: unknown) => {
      assert.ok(err instanceof VoiceConnectError);
      assert.equal(err.message, "sdp_exchange_failed_502");
      assert.equal(err.hint, undefined);
      return true;
    },
  );
});

test("data-channel error events surface provider message as hint under a stable code", async () => {
  captured = [];
  nextResponse = new Response("v=0\r\n", { status: 201 });
  let seen: unknown = null;
  await openaiRealtimeProvider.clientAdapter.connect(sdpGrant, fakeMic, {
    ...noopCallbacks,
    onError(err: unknown) { seen = err; },
  });
  lastDataChannel?.onmessage?.({
    data: JSON.stringify({ type: "error", error: { message: "session expired" } }),
  });
  assert.ok(seen instanceof VoiceConnectError, "onError receives VoiceConnectError");
  assert.equal((seen as any).message, "provider_error");
  assert.equal((seen as any).hint, "session expired");
});
