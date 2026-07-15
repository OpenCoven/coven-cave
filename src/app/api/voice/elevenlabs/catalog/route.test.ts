// @ts-nocheck
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

const realFetch = globalThis.fetch;
// URL-aware mock: the route fetches /v1/voices and /v1/models in parallel.
let responsesByUrl: Map<string, () => Response> = new Map();

(globalThis as any).fetch = async (url: string | URL, init?: RequestInit) => {
  const key = [...responsesByUrl.keys()].find((fragment) => String(url).includes(fragment));
  if (key) return responsesByUrl.get(key)!();
  return realFetch(url as any, init);
};

const { GET } = await import("./route.ts");

const VOICES_PAYLOAD = {
  voices: [
    { voice_id: "AbCdEf123456", name: "Aunt Morgan", category: "cloned" },
    { voice_id: "21m00Tcm4TlvDq8ikWAM", name: "Rachel", category: "premade" },
    { voice_id: "../evil", name: "Bad" },
    { voice_id: "GhIjKl789012" },
  ],
};

const MODELS_PAYLOAD = [
  { model_id: "eleven_turbo_v2_5", name: "Turbo v2.5", can_do_text_to_speech: true },
  { model_id: "eleven_flash_v2_5", name: "Flash v2.5" },
  { model_id: "scribe_v1", name: "Scribe (STT)", can_do_text_to_speech: false },
  { model_id: "Bad/Model", name: "Nope" },
];

beforeEach(() => {
  delete process.env.ELEVENLABS_API_KEY;
  responsesByUrl = new Map();
});

test("400 vault_key_unresolved when ELEVENLABS_API_KEY is not set", async () => {
  const res = await GET();
  const json = await res.json();
  assert.equal(res.status, 400);
  assert.equal(json.error, "vault_key_unresolved");
  assert.equal(json.missingKey, "ELEVENLABS_API_KEY");
});

test("200 maps saved voices and TTS-capable models, dropping malformed entries", async () => {
  process.env.ELEVENLABS_API_KEY = "xi-good";
  responsesByUrl.set("/v1/voices", () => Response.json(VOICES_PAYLOAD));
  responsesByUrl.set("/v1/models", () => Response.json(MODELS_PAYLOAD));
  const res = await GET();
  const json = await res.json();
  assert.equal(res.status, 200);
  assert.equal(json.ok, true);
  assert.deepEqual(json.voices, [
    { id: "AbCdEf123456", name: "Aunt Morgan", category: "cloned" },
    { id: "21m00Tcm4TlvDq8ikWAM", name: "Rachel", category: "premade" },
    // Nameless entry stays selectable under its id; the path-shaped id is gone.
    { id: "GhIjKl789012", name: "GhIjKl789012" },
  ]);
  assert.deepEqual(json.models, [
    { id: "eleven_turbo_v2_5", name: "Turbo v2.5" },
    { id: "eleven_flash_v2_5", name: "Flash v2.5" },
  ]);
});

test("502 elevenlabs_key_invalid when either upstream call returns 401", async () => {
  process.env.ELEVENLABS_API_KEY = "xi-bad";
  responsesByUrl.set("/v1/voices", () => new Response("{}", { status: 401 }));
  responsesByUrl.set("/v1/models", () => Response.json(MODELS_PAYLOAD));
  const res = await GET();
  const json = await res.json();
  assert.equal(res.status, 502);
  assert.equal(json.error, "elevenlabs_key_invalid");
});

test("502 with the upstream status when a call fails non-401", async () => {
  process.env.ELEVENLABS_API_KEY = "xi-good";
  responsesByUrl.set("/v1/voices", () => Response.json(VOICES_PAYLOAD));
  responsesByUrl.set("/v1/models", () => new Response("{}", { status: 500 }));
  const res = await GET();
  const json = await res.json();
  assert.equal(res.status, 502);
  assert.equal(json.error, "elevenlabs_catalog_failed");
  assert.match(json.hint, /http 500/);
});

test("502 elevenlabs_unreachable when the network call throws", async () => {
  process.env.ELEVENLABS_API_KEY = "xi-good";
  responsesByUrl.set("/v1/voices", () => { throw new Error("no route to host"); });
  responsesByUrl.set("/v1/models", () => Response.json(MODELS_PAYLOAD));
  const res = await GET();
  const json = await res.json();
  assert.equal(res.status, 502);
  assert.equal(json.error, "elevenlabs_unreachable");
  assert.match(json.hint, /no route to host/);
});
