// GET /api/voice/elevenlabs/catalog under every upstream anomaly (#6359).
//
// Two parallel upstream calls — /v1/voices and /v1/models — fold into one
// answer. A 401 on either is a key problem (`elevenlabs_key_invalid`); any
// other non-2xx on either is `elevenlabs_catalog_failed` naming that status;
// a socket failure on either is `elevenlabs_unreachable`; an unreadable or
// drifted 2xx body is an empty catalog rather than an error. The key never
// appears in any of them, both calls carry a deadline, and the route re-asks
// ElevenLabs the moment it is back.
import assert from "node:assert/strict";
import test from "node:test";

import { installUpstreamAnomalyFetch, type UpstreamHandler } from "../../../../../lib/testing/upstream-anomaly-fetch.ts";
import { captureOutcome, expectErrorStatus, runUpstreamAnomalyMatrix, type DegradedExpectation, type MatrixOutcome } from "../../../../../lib/testing/upstream-anomaly-matrix.ts";
import { isolateCaveHome } from "../../../../../lib/testing/scratch-cave-home.ts";

const home = isolateCaveHome("elevenlabs-catalog-anomalies");
const API_KEY = "xi-testonly-elevenlabs-never-dispatched-0123456789abcdef";
process.env.ELEVENLABS_API_KEY = API_KEY;

const harness = installUpstreamAnomalyFetch();
const { GET } = await import("./route.ts");
test.after(() => {
  harness.restore();
  home.cleanup();
});

const VOICES_PAYLOAD = {
  voices: [
    { voice_id: "AbCdEf123456", name: "Aunt Morgan", category: "cloned" },
    { voice_id: "21m00Tcm4TlvDq8ikWAM", name: "Rachel", category: "premade" },
    { voice_id: "../evil", name: "Bad" },
  ],
};

const MODELS_PAYLOAD = [
  { model_id: "eleven_turbo_v2_5", name: "Turbo v2.5", can_do_text_to_speech: true },
  { model_id: "scribe_v1", name: "Scribe (STT)", can_do_text_to_speech: false },
];

const catalog: UpstreamHandler = (request) => {
  const url = new URL(request.url);
  assert.equal(request.headers.get("xi-api-key"), API_KEY, "the key travels as xi-api-key and nowhere else");
  if (url.pathname === "/v1/voices") return Response.json(VOICES_PAYLOAD);
  if (url.pathname === "/v1/models") return Response.json(MODELS_PAYLOAD);
  return Response.json({ detail: { status: "not_found" } }, { status: 404 });
};
harness.healthy("elevenlabs", catalog);

const read = () => GET();

const catalogFailed = (status: number): DegradedExpectation => (outcome, anomaly) => {
  expectErrorStatus(502)(outcome, anomaly);
  const body = outcome.body as { error: string; hint: string };
  assert.equal(body.error, "elevenlabs_catalog_failed");
  assert.equal(body.hint, `ElevenLabs returned http ${status}.`);
};

const unreachable: DegradedExpectation = (outcome, anomaly) => {
  expectErrorStatus(502)(outcome, anomaly);
  const body = outcome.body as { error: string; hint: string };
  assert.equal(body.error, "elevenlabs_unreachable");
  assert.match(body.hint, /^Couldn't reach ElevenLabs \(/);
};

const emptyCatalog = (outcome: MatrixOutcome) => {
  assert.equal(outcome.status, 200);
  assert.deepEqual(outcome.body, { ok: true, voices: [], models: [] }, "an unreadable body is an empty catalog, not an error");
};

const fullCatalog = (outcome: MatrixOutcome) => {
  assert.equal(outcome.status, 200, outcome.text);
  assert.deepEqual(outcome.body, {
    ok: true,
    voices: [
      { id: "AbCdEf123456", name: "Aunt Morgan", category: "cloned" },
      { id: "21m00Tcm4TlvDq8ikWAM", name: "Rachel", category: "premade" },
    ],
    models: [{ id: "eleven_turbo_v2_5", name: "Turbo v2.5" }],
  });
  const calls = harness.calls("elevenlabs");
  assert.deepEqual(calls.map((call) => new URL(call.url).pathname).sort(), ["/v1/models", "/v1/voices"]);
  for (const call of calls) assert.equal(call.hasDeadline, true, `${call.url} is unbounded`);
};

test("GET /api/voice/elevenlabs/catalog across upstream anomalies", async (t) => {
  await runUpstreamAnomalyMatrix(t, {
    harness,
    id: "elevenlabs",
    secrets: [API_KEY],
    invoke: read,
    healthy: fullCatalog,
    degraded: {
      "http-500": catalogFailed(500),
      "http-502": catalogFailed(502),
      "auth-revoked": (outcome, anomaly) => {
        expectErrorStatus(502)(outcome, anomaly);
        const body = outcome.body as { error: string; hint: string };
        assert.equal(body.error, "elevenlabs_key_invalid");
        assert.match(body.hint, /ELEVENLABS_API_KEY/);
      },
      "rate-limit": catalogFailed(429),
      timeout: unreachable,
      network: unreachable,
      "malformed-json": emptyCatalog,
      "empty-body": emptyCatalog,
      "schema-drift": emptyCatalog,
    },
  });
});

/** Run `fn` with one of the two upstream paths answering `answer` instead. */
async function withOnePathDegraded(pathname: "/v1/voices" | "/v1/models", answer: () => Response, fn: () => Promise<void>) {
  harness.healthy("elevenlabs", (request, call) => (new URL(request.url).pathname === pathname ? answer() : catalog(request, call)));
  try {
    harness.reset();
    await fn();
  } finally {
    harness.healthy("elevenlabs", catalog);
  }
}

test("when only one of the two parallel calls fails", async (t) => {
  await t.test("models 500 while voices are fine: catalog_failed naming the failing status", async () => {
    await withOnePathDegraded("/v1/models", () => Response.json({ detail: "boom" }, { status: 500 }), async () => {
      const response = await read();
      assert.equal(response.status, 502);
      assert.deepEqual(await response.json(), {
        ok: false,
        error: "elevenlabs_catalog_failed",
        hint: "ElevenLabs returned http 500.",
      });
      assert.equal(harness.calls("elevenlabs").length, 2, "both calls were still issued");
    });
  });

  await t.test("voices 401 while models are fine: the key verdict wins", async () => {
    await withOnePathDegraded("/v1/voices", () => Response.json({ detail: { status: "invalid_api_key" } }, { status: 401 }), async () => {
      const response = await read();
      assert.equal(response.status, 502);
      assert.equal((await response.json()).error, "elevenlabs_key_invalid");
    });
  });

  await t.test("voices 429 while models are fine: catalog_failed names the 429", async () => {
    await withOnePathDegraded("/v1/voices", () => new Response("", { status: 429, headers: { "retry-after": "3" } }), async () => {
      const response = await read();
      assert.equal(response.status, 502);
      assert.equal((await response.json()).hint, "ElevenLabs returned http 429.");
    });
  });

  await t.test("models socket failure while voices are fine: unreachable", async () => {
    const dead = () => {
      throw new TypeError("fetch failed");
    };
    await withOnePathDegraded("/v1/models", dead, async () => {
      const response = await read();
      assert.equal(response.status, 502);
      const body = await response.json();
      assert.equal(body.error, "elevenlabs_unreachable");
      assert.equal(body.hint, "Couldn't reach ElevenLabs (fetch failed).");
    });
  });

  await t.test("models unreadable while voices are fine: voices listed, models empty", async () => {
    await withOnePathDegraded("/v1/models", () => new Response("[{", { status: 200, headers: { "content-type": "application/json" } }), async () => {
      const response = await read();
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.equal(body.voices.length, 2);
      assert.deepEqual(body.models, []);
    });
  });

  await t.test("with both paths healthy again the full catalog is back", async () => {
    harness.reset();
    fullCatalog(await captureOutcome(read));
  });
});
