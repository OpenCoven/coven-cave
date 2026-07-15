// @ts-nocheck
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TMP = mkdtempSync(join(tmpdir(), "voice-session-route-"));
process.env.HOME = TMP;

const FAMILIAR_ID = "milo";
const SESSION_ID = "sess-route";

function writeFamiliar(record: Record<string, unknown>) {
  const dir = join(TMP, ".coven", "cave");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "config.json"),
    JSON.stringify({ familiars: { [FAMILIAR_ID]: record } }),
  );
}

function writeSession(turns: any[] = []) {
  const dir = join(TMP, ".coven", "cave", "conversations");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${SESSION_ID}.json`), JSON.stringify({
    sessionId: SESSION_ID, familiarId: FAMILIAR_ID, harness: "claude",
    createdAt: "2026-06-01T00:00:00Z", updatedAt: "2026-06-01T00:00:00Z",
    turns,
  }));
}

function req(body: unknown) {
  return new Request("http://test/api/voice/session", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

const realFetch = globalThis.fetch;
let nextFetchResponse: Response | null = null;
let lastFetchCall: { url: string; init: RequestInit } | null = null;

(globalThis as any).fetch = async (url: string | URL, init?: RequestInit) => {
  lastFetchCall = { url: String(url), init: init ?? {} };
  if (nextFetchResponse) return nextFetchResponse;
  return realFetch(url as any, init);
};

const { POST } = await import("./route.ts");

beforeEach(() => {
  delete process.env.OPENAI_API_KEY;
  delete process.env.GOOGLE_API_KEY;
  nextFetchResponse = null;
  lastFetchCall = null;
});

test("400 when familiarId missing", async () => {
  const res = await POST(req({ sessionId: SESSION_ID }));
  const json = await res.json();
  assert.equal(res.status, 400);
  assert.equal(json.ok, false);
});

test("400 invalid_session when sessionId is unsafe", async () => {
  writeFamiliar({ display_name: "M", role: "x", voiceProvider: "openai" });
  const res = await POST(req({ familiarId: FAMILIAR_ID, sessionId: "../escape" }));
  const json = await res.json();
  assert.equal(res.status, 400);
  assert.equal(json.error, "invalid_session");
});

test("404 when familiar not found", async () => {
  const res = await POST(req({ familiarId: "ghost", sessionId: SESSION_ID }));
  assert.equal(res.status, 404);
});

test("400 voice_not_configured when familiar has no voiceProvider", async () => {
  writeFamiliar({ display_name: "M", role: "x" });
  const res = await POST(req({ familiarId: FAMILIAR_ID, sessionId: SESSION_ID }));
  const json = await res.json();
  assert.equal(res.status, 400);
  assert.equal(json.error, "voice_not_configured");
});

test("400 unknown_provider when voiceProvider is unrecognized", async () => {
  writeFamiliar({ display_name: "M", role: "x", voiceProvider: "bogus" });
  const res = await POST(req({ familiarId: FAMILIAR_ID, sessionId: SESSION_ID }));
  const json = await res.json();
  assert.equal(res.status, 400);
  assert.equal(json.error, "unknown_provider");
});

test("400 vault_key_unresolved when key not in env/vault", async () => {
  writeFamiliar({ display_name: "M", role: "x", voiceProvider: "openai" });
  writeSession([]);
  const res = await POST(req({ familiarId: FAMILIAR_ID, sessionId: SESSION_ID }));
  const json = await res.json();
  assert.equal(res.status, 400);
  assert.equal(json.error, "vault_key_unresolved");
  assert.equal(json.missingKey, "OPENAI_API_KEY");
});

test("502 provider_mint_failed surfaces provider message verbatim", async () => {
  writeFamiliar({ display_name: "M", role: "x", voiceProvider: "openai" });
  writeSession([]);
  process.env.OPENAI_API_KEY = "sk-x";
  nextFetchResponse = new Response(
    JSON.stringify({ error: { message: "quota exhausted" } }),
    { status: 429 },
  );
  const res = await POST(req({ familiarId: FAMILIAR_ID, sessionId: SESSION_ID }));
  const json = await res.json();
  assert.equal(res.status, 502);
  assert.equal(json.error, "provider_mint_failed");
  assert.match(json.providerMessage, /quota exhausted/);
});

test("200 happy path returns grant and ULID-shaped callId", async () => {
  writeFamiliar({
    display_name: "M",
    role: "x",
    voiceProvider: "openai",
    voiceModel: "gpt-realtime",
    voiceName: "alloy",
  });
  writeSession([]);
  process.env.OPENAI_API_KEY = "sk-x";
  nextFetchResponse = new Response(
    JSON.stringify({ value: "ek_z", expires_at: 1750000000 }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
  const res = await POST(req({ familiarId: FAMILIAR_ID, sessionId: SESSION_ID }));
  const json = await res.json();
  assert.equal(res.status, 200);
  assert.equal(json.ok, true);
  assert.equal(json.grant.clientSecret, "ek_z");
  assert.equal(json.grant.connection.model, "gpt-realtime");
  // 26-char Crockford base32 ULID shape (alphabet excludes I, L, O, U).
  assert.match(json.callId, /^[0-9A-HJKMNP-TV-Z]{26}$/);
  assert.ok(lastFetchCall);
  assert.equal(lastFetchCall.url, "https://api.openai.com/v1/realtime/client_secrets");
  const sentBody = JSON.parse(lastFetchCall.init.body as string);
  assert.equal(sentBody.session.model, "gpt-realtime");
  assert.equal(sentBody.session.audio.output.voice, "alloy");
});

test("200 familiar-brain provider mints keyless and binds the session id", async () => {
  writeFamiliar({
    display_name: "M",
    role: "x",
    voiceProvider: "familiar",
    voiceName: "Samantha",
  });
  writeSession([]);
  // No vault key in env — a keyless provider must never hit the vault gate.
  const res = await POST(req({ familiarId: FAMILIAR_ID, sessionId: SESSION_ID }));
  const json = await res.json();
  assert.equal(res.status, 200);
  assert.equal(json.ok, true);
  assert.equal(json.grant.provider, "familiar");
  assert.equal(json.grant.connection.kind, "familiar-brain");
  assert.equal(json.grant.connection.familiarId, FAMILIAR_ID);
  assert.equal(json.grant.connection.sessionId, SESSION_ID);
  assert.equal(json.grant.connection.voice, "Samantha");
});

test("400 vault_key_unresolved for elevenlabs without ELEVENLABS_API_KEY", async () => {
  delete process.env.ELEVENLABS_API_KEY;
  writeFamiliar({ display_name: "M", role: "x", voiceProvider: "elevenlabs" });
  writeSession([]);
  const res = await POST(req({ familiarId: FAMILIAR_ID, sessionId: SESSION_ID }));
  const json = await res.json();
  assert.equal(res.status, 400);
  assert.equal(json.error, "vault_key_unresolved");
  assert.equal(json.missingKey, "ELEVENLABS_API_KEY");
});

test("200 elevenlabs provider mints with defaults and binds the session id", async () => {
  writeFamiliar({ display_name: "M", role: "x", voiceProvider: "elevenlabs" });
  writeSession([]);
  process.env.ELEVENLABS_API_KEY = "xi-good";
  nextFetchResponse = new Response("[]", { status: 200 });
  const res = await POST(req({ familiarId: FAMILIAR_ID, sessionId: SESSION_ID }));
  const json = await res.json();
  delete process.env.ELEVENLABS_API_KEY;
  assert.equal(res.status, 200);
  assert.equal(json.ok, true);
  assert.equal(json.grant.provider, "elevenlabs");
  assert.equal(json.grant.connection.kind, "elevenlabs-familiar");
  assert.equal(json.grant.connection.sessionId, SESSION_ID);
  // Route DEFAULTS applied: Rachel + turbo, overridable per-familiar.
  assert.equal(json.grant.connection.voiceId, "21m00Tcm4TlvDq8ikWAM");
  assert.equal(json.grant.connection.modelId, "eleven_turbo_v2_5");
  // The vault key must never reach the client.
  assert.equal(JSON.stringify(json).includes("xi-good"), false);
});
