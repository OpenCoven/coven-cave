// GET /api/voice/preview under every upstream anomaly (#6359).
//
// The route synthesizes one fixed sample per voice and caches it for the
// process lifetime, so the cache is the thing to get right under failure:
// only two verdicts may be remembered — the audio itself, and OpenAI's own
// "this voice is not on the TTS endpoint" rejection. A 5xx, a revoked key, a
// rate limit, a stalled socket, a dead network, or a 2xx with no bytes must
// stay retryable, so the next request reaches OpenAI again once it is back.
import assert from "node:assert/strict";
import test from "node:test";

import { installUpstreamAnomalyFetch } from "../../../../lib/testing/upstream-anomaly-fetch.ts";
import { expectErrorStatus, runUpstreamAnomalyMatrix, type DegradedExpectation } from "../../../../lib/testing/upstream-anomaly-matrix.ts";
import { isolateCaveHome } from "../../../../lib/testing/scratch-cave-home.ts";

const home = isolateCaveHome("voice-preview-anomalies");
const API_KEY = "sk-testonly-openai-never-dispatched-0123456789abcdef";
process.env.OPENAI_API_KEY = API_KEY;

const harness = installUpstreamAnomalyFetch();
const { GET, __clearPreviewCacheForTests } = await import("./route.ts");
test.after(() => {
  harness.restore();
  home.cleanup();
});

// An ID3 header followed by stand-in frames: enough to be bytes, not JSON.
const MP3 = Buffer.concat([Buffer.from([0x49, 0x44, 0x33, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]), Buffer.alloc(48, 0xff)]);

harness.healthy("openai", async (request) => {
  const url = new URL(request.url);
  assert.equal(url.pathname, "/v1/audio/speech");
  assert.equal(request.headers.get("authorization"), `Bearer ${API_KEY}`, "the key travels as a bearer and nowhere else");
  const body = (await request.json()) as { model: string; voice: string; input: string; response_format: string };
  assert.equal(body.model, "gpt-4o-mini-tts");
  assert.equal(body.voice, "alloy");
  assert.equal(body.response_format, "mp3");
  assert.ok(body.input.length > 0, "the fixed sample text is what gets spoken");
  return new Response(MP3, { status: 200, headers: { "content-type": "audio/mpeg" } });
});

const preview = () => GET(new Request("http://localhost/api/voice/preview?voice=alloy"));

const previewFailed = (providerMessage: string): DegradedExpectation => (outcome, anomaly) => {
  expectErrorStatus(502)(outcome, anomaly);
  const body = outcome.body as { error: string; providerMessage: string };
  assert.equal(body.error, "preview_failed");
  assert.equal(body.providerMessage, providerMessage);
};

const unreachable: DegradedExpectation = (outcome, anomaly) => {
  expectErrorStatus(502)(outcome, anomaly);
  assert.deepEqual(outcome.body, { ok: false, error: "provider_unreachable" });
};

// The route reads any 2xx body as audio without consulting the content-type,
// so a JSON body on a 200 is served as a sample. Documented here, not endorsed.
const servedAsAudio: DegradedExpectation = (outcome) => {
  assert.equal(outcome.status, 200);
  assert.equal(outcome.response?.headers.get("content-type"), "audio/mpeg");
};

test("GET /api/voice/preview across upstream anomalies", async (t) => {
  await runUpstreamAnomalyMatrix(t, {
    harness,
    id: "openai",
    secrets: [API_KEY],
    invoke: preview,
    // A cached sample answers without a call; the matrix needs every call to
    // reach OpenAI, so each invocation starts from an empty cache. The cache
    // contract itself is proven by the tests below.
    beforeEach: __clearPreviewCacheForTests,
    healthy: async (outcome) => {
      assert.equal(outcome.status, 200, outcome.text);
      assert.equal(outcome.response?.headers.get("content-type"), "audio/mpeg");
      assert.equal(outcome.response?.headers.get("cache-control"), "private, max-age=86400");
      const bytes = Buffer.from(await outcome.response!.arrayBuffer());
      assert.ok(bytes.equals(MP3), "the sample is relayed byte for byte");
    },
    degraded: {
      "http-500": previewFailed(""),
      "http-502": previewFailed(""),
      "auth-revoked": previewFailed(""),
      "rate-limit": previewFailed(""),
      timeout: unreachable,
      network: unreachable,
      "malformed-json": servedAsAudio,
      "schema-drift": servedAsAudio,
      "empty-body": (outcome, anomaly) => {
        expectErrorStatus(502)(outcome, anomaly);
        assert.equal((outcome.body as { error: string }).error, "preview_failed", "a 2xx with no bytes is not a sample");
      },
    },
  });
});

async function previewWithoutClearing(): Promise<{ status: number; body: unknown; upstreamCalls: number }> {
  harness.reset();
  const response = await preview();
  const text = await response.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: response.status, body, upstreamCalls: harness.calls("openai").length };
}

test("what the preview cache remembers", async (t) => {
  await t.test("a healthy sample is cached: the second request never reaches OpenAI", async () => {
    __clearPreviewCacheForTests();
    harness.heal();
    assert.equal((await previewWithoutClearing()).status, 200);
    const second = await previewWithoutClearing();
    assert.equal(second.status, 200);
    assert.equal(second.upstreamCalls, 0);
  });

  await t.test("OpenAI's voice-parameter rejection is cached as 422 preview_unsupported", async () => {
    __clearPreviewCacheForTests();
    harness.inject("openai", {
      kind: "http",
      status: 400,
      body: { error: { message: "Unsupported value: 'alloy' is not supported with this model.", param: "voice", code: "unsupported_value" } },
    });
    const rejected = await previewWithoutClearing();
    assert.equal(rejected.status, 422);
    assert.equal((rejected.body as { error: string }).error, "preview_unsupported");
    assert.equal(rejected.upstreamCalls, 1);

    harness.heal("openai");
    const remembered = await previewWithoutClearing();
    assert.equal(remembered.status, 422, "the verdict is about the account, not the moment — it stays");
    assert.equal(remembered.upstreamCalls, 0, "a remembered verdict does not re-ask OpenAI");

    __clearPreviewCacheForTests();
    assert.equal((await previewWithoutClearing()).status, 200, "only clearing the cache re-asks");
  });

  await t.test("a 400 about anything but the voice is not cached", async () => {
    __clearPreviewCacheForTests();
    harness.inject("openai", {
      kind: "http",
      status: 400,
      body: { error: { message: "Invalid value for model.", param: "model" } },
    });
    const rejected = await previewWithoutClearing();
    assert.equal(rejected.status, 502);
    assert.deepEqual(rejected.body, { ok: false, error: "preview_failed", providerMessage: "Invalid value for model." });

    harness.heal("openai");
    const healed = await previewWithoutClearing();
    assert.equal(healed.status, 200);
    assert.equal(healed.upstreamCalls, 1, "the next request reaches OpenAI again");
  });

  for (const [name, anomaly] of [
    ["a 5xx", { kind: "http", status: 503, body: { error: { message: "The server is overloaded." } } }],
    ["a revoked key", { kind: "auth-revoked" }],
    ["a rate limit", { kind: "rate-limit" }],
    ["a stalled socket", { kind: "timeout" }],
    ["a dead network", { kind: "network" }],
    ["an empty 2xx body", { kind: "empty-body" }],
  ] as const) {
    await t.test(`${name} is not cached: the next request reaches OpenAI again`, async () => {
      __clearPreviewCacheForTests();
      harness.inject("openai", anomaly);
      const degraded = await previewWithoutClearing();
      assert.equal(degraded.status, 502, JSON.stringify(degraded.body));
      assert.equal(degraded.upstreamCalls, 1);

      harness.heal("openai");
      const healed = await previewWithoutClearing();
      assert.equal(healed.status, 200, `${name}: still failing after OpenAI healed — the failure was cached`);
      assert.equal(healed.upstreamCalls, 1, `${name}: the healed request never reached OpenAI`);
    });
  }
});
