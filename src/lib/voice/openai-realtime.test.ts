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
    lastDataChannel = {
      onmessage: null,
      readyState: "open",
      sent: [],
      send(payload: string) { this.sent.push(JSON.parse(payload)); },
      close() {},
    };
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

test("mintSession grant points SDP exchange at GA /v1/realtime/calls without ?model=", async () => {
  nextResponse = new Response(
    JSON.stringify({ value: "ek_ga", expires_at: 1 }),
    { status: 200 },
  );
  const grant = await openaiRealtimeProvider.mintSession("sk-x", {
    familiarId: "m",
    model: "gpt-realtime",
    voice: "alloy",
    instructions: "",
  });
  // Legacy `/v1/realtime?model=` returns beta_api_shape_disabled; the token is
  // model-bound so the GA calls URL must carry no query string.
  assert.equal(grant.connection.url, "https://api.openai.com/v1/realtime/calls");
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

// ── Live transcript + typed replies (cave-zr9dx) ──────────────────────────

test("assistant deltas accumulate into whole-turn partials and a speaking signal", async () => {
  nextResponse = new Response("v=0\r\n", { status: 201 });
  const partials: [string, string][] = [];
  const speaking: (string | null)[] = [];
  const finals: string[] = [];
  await openaiRealtimeProvider.clientAdapter.connect(sdpGrant, fakeMic, {
    ...noopCallbacks,
    onPartialTranscript(role: string, text: string) { partials.push([role, text]); },
    onSpeaking(utterance: string | null) { speaking.push(utterance); },
    onAssistantTranscriptFinal(text: string) { finals.push(text); },
  });
  const deltas = ["The candles ", "are lit."];
  for (const delta of deltas) {
    lastDataChannel?.onmessage?.({
      data: JSON.stringify({ type: "response.output_audio_transcript.delta", delta }),
    });
  }
  // Every other provider reports the accumulated turn; this adapter owes the
  // same contract so the live transcript renders by replacement.
  assert.deepEqual(partials, [
    ["assistant", "The candles "],
    ["assistant", "The candles are lit."],
  ]);
  assert.deepEqual(speaking, ["The candles ", "The candles are lit."]);

  lastDataChannel?.onmessage?.({
    data: JSON.stringify({
      type: "response.output_audio_transcript.done",
      transcript: "The candles are lit.",
    }),
  });
  assert.deepEqual(finals, ["The candles are lit."]);
  assert.equal(speaking[speaking.length - 1], null, "the highlight clears when the turn ends");
});

test("a second response starts from empty, not from the previous turn's text", async () => {
  nextResponse = new Response("v=0\r\n", { status: 201 });
  const partials: string[] = [];
  await openaiRealtimeProvider.clientAdapter.connect(sdpGrant, fakeMic, {
    ...noopCallbacks,
    onPartialTranscript(_role: string, text: string) { partials.push(text); },
  });
  const delta = (delta: string) =>
    lastDataChannel?.onmessage?.({
      data: JSON.stringify({ type: "response.output_audio_transcript.delta", delta }),
    });
  delta("First.");
  lastDataChannel?.onmessage?.({
    data: JSON.stringify({ type: "response.output_audio_transcript.done", transcript: "First." }),
  });
  delta("Second.");
  assert.deepEqual(partials, ["First.", "Second."]);
});

test("sendText queues a user item, asks for a response, and reports the turn", async () => {
  nextResponse = new Response("v=0\r\n", { status: 201 });
  const userFinals: string[] = [];
  const session = await openaiRealtimeProvider.clientAdapter.connect(sdpGrant, fakeMic, {
    ...noopCallbacks,
    onUserTranscriptFinal(text: string) { userFinals.push(text); },
  });
  session.sendText("  say that again  ");
  assert.deepEqual(
    lastDataChannel?.sent.map((ev: any) => ev.type),
    ["conversation.item.create", "response.create"],
  );
  assert.deepEqual(lastDataChannel?.sent[0].item.content, [
    { type: "input_text", text: "say that again" },
  ]);
  // A typed turn never passes through input-audio transcription, so the
  // adapter is the only thing that can put it in the transcript.
  assert.deepEqual(userFinals, ["say that again"]);
  session.sendText("   ");
  assert.equal(lastDataChannel?.sent.length, 2, "a blank reply sends nothing");
});

test("a typed reply mid-answer cancels the response first, and never otherwise", async () => {
  nextResponse = new Response("v=0\r\n", { status: 201 });
  const session = await openaiRealtimeProvider.clientAdapter.connect(sdpGrant, fakeMic, noopCallbacks);
  // Nothing in flight: `response.cancel` with no active response comes back as
  // an error event, so it must not be sent.
  session.interrupt();
  assert.deepEqual(lastDataChannel?.sent, []);

  lastDataChannel?.onmessage?.({
    data: JSON.stringify({ type: "response.output_audio_transcript.delta", delta: "Once upon" }),
  });
  session.sendText("stop");
  assert.deepEqual(
    lastDataChannel?.sent.map((ev: any) => ev.type),
    ["response.cancel", "conversation.item.create", "response.create"],
  );
});
