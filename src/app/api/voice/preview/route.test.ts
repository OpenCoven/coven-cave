// @ts-nocheck
import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Hermetic secret resolution: no real vault, no repo .env.local.
const TMP = mkdtempSync(join(tmpdir(), "voice-preview-route-"));
process.env.HOME = TMP;
process.env.COVEN_CAVE_ENV_FILE = join(TMP, "absent.env.local");

function req(voice: string | null) {
  const qs = voice === null ? "" : `?voice=${encodeURIComponent(voice)}`;
  return new Request(`http://test/api/voice/preview${qs}`);
}

const realFetch = globalThis.fetch;
let nextFetchResponse: Response | null = null;
let fetchCalls: Array<{ url: string; init: RequestInit }> = [];

globalThis.fetch = async (url, init) => {
  fetchCalls.push({ url: String(url), init: init ?? {} });
  if (nextFetchResponse) return nextFetchResponse;
  return realFetch(url, init);
};

const { GET, __clearPreviewCacheForTests } = await import("./route.ts");

// Restore the shared global for any tests that later run in this process.
after(() => { globalThis.fetch = realFetch; });

beforeEach(() => {
  delete process.env.OPENAI_API_KEY;
  nextFetchResponse = null;
  fetchCalls = [];
  __clearPreviewCacheForTests();
});

test("400 unknown_voice for ids outside the realtime catalog", async () => {
  for (const bad of ["onyx", "", null]) {
    const res = await GET(req(bad));
    const json = await res.json();
    assert.equal(res.status, 400);
    assert.equal(json.error, "unknown_voice");
  }
  assert.equal(fetchCalls.length, 0, "invalid ids never reach the provider");
});

test("400 vault_key_unresolved when no OpenAI key is configured", async () => {
  const res = await GET(req("alloy"));
  const json = await res.json();
  assert.equal(res.status, 400);
  assert.equal(json.error, "vault_key_unresolved");
  assert.equal(json.missingKey, "OPENAI_API_KEY");
});

test("200 happy path streams audio/mpeg and asks TTS for the picked voice", async () => {
  process.env.OPENAI_API_KEY = "sk-x";
  const bytes = new Uint8Array([1, 2, 3, 4]);
  nextFetchResponse = new Response(bytes, { status: 200 });

  const res = await GET(req("shimmer"));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "audio/mpeg");
  assert.match(res.headers.get("cache-control") ?? "", /private/);
  assert.deepEqual(new Uint8Array(await res.arrayBuffer()), bytes);

  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0].url, "https://api.openai.com/v1/audio/speech");
  assert.equal(fetchCalls[0].init.headers.Authorization, "Bearer sk-x");
  const sent = JSON.parse(fetchCalls[0].init.body);
  assert.equal(sent.voice, "shimmer");
  assert.equal(sent.model, "gpt-4o-mini-tts");
  assert.match(sent.input, /Shimmer/);
});

test("per-voice cache: the second preview never re-bills the provider", async () => {
  process.env.OPENAI_API_KEY = "sk-x";
  nextFetchResponse = new Response(new Uint8Array([9]), { status: 200 });
  await GET(req("ash"));
  const res = await GET(req("ash"));
  assert.equal(res.status, 200);
  assert.equal(fetchCalls.length, 1, "cached voice served without a provider call");
});

test("422 preview_unsupported when TTS rejects the voice param, and the verdict is cached", async () => {
  process.env.OPENAI_API_KEY = "sk-x";
  nextFetchResponse = new Response(
    JSON.stringify({ error: { message: "voice not supported", param: "voice" } }),
    { status: 400 },
  );
  const res = await GET(req("marin"));
  const json = await res.json();
  assert.equal(res.status, 422);
  assert.equal(json.error, "preview_unsupported");
  assert.ok(json.hint);

  const again = await GET(req("marin"));
  assert.equal(again.status, 422);
  assert.equal(fetchCalls.length, 1, "unsupported verdict cached — no repeat call");
});

test("a 400 unrelated to the voice param is NOT cached as unsupported", async () => {
  process.env.OPENAI_API_KEY = "sk-x";
  nextFetchResponse = new Response(
    JSON.stringify({ error: { message: "invalid input", param: "input" } }),
    { status: 400 },
  );
  const res = await GET(req("sage"));
  const json = await res.json();
  assert.equal(res.status, 502);
  assert.equal(json.error, "preview_failed");

  // A retry reaches the provider again and can succeed.
  nextFetchResponse = new Response(new Uint8Array([5]), { status: 200 });
  const retry = await GET(req("sage"));
  assert.equal(retry.status, 200);
  assert.equal(fetchCalls.length, 2);
});

test("502 preview_failed surfaces the provider message on non-400 failures", async () => {
  process.env.OPENAI_API_KEY = "sk-x";
  nextFetchResponse = new Response(
    JSON.stringify({ error: { message: "quota exhausted" } }),
    { status: 429 },
  );
  const res = await GET(req("verse"));
  const json = await res.json();
  assert.equal(res.status, 502);
  assert.equal(json.error, "preview_failed");
  assert.match(json.providerMessage, /quota exhausted/);
  assert.equal(cacheProbeCalls(), 1);

  // Transient failures are NOT cached — a retry reaches the provider again.
  nextFetchResponse = new Response(new Uint8Array([7]), { status: 200 });
  const retry = await GET(req("verse"));
  assert.equal(retry.status, 200);
  assert.equal(cacheProbeCalls(), 2);
});

function cacheProbeCalls() {
  return fetchCalls.length;
}

test("502 provider_unreachable when the TTS fetch itself throws", async () => {
  process.env.OPENAI_API_KEY = "sk-x";
  const throwingFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("ECONNREFUSED"); };
  try {
    const res = await GET(req("echo"));
    const json = await res.json();
    assert.equal(res.status, 502);
    assert.equal(json.error, "provider_unreachable");
  } finally {
    globalThis.fetch = throwingFetch;
  }
});
