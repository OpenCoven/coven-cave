// POST /api/projects/icon under every upstream anomaly, once per provider (#6359).
//
// Same provider contract as /api/images/generate — one 502 with a machine code
// per failure class — plus a budget of its own: the route charges a 60 s
// per-project cooldown before it calls a paid provider. The matrix proves the
// provider codes, the key never leaking, and recovery; the tests after it
// prove the route's own 429 (`rate_limited`, Retry-After, no provider call)
// cannot be confused with the provider's 429 (502 `provider_generation_failed`,
// one provider call, no Retry-After).
import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";

import { installUpstreamAnomalyFetch } from "../../../../lib/testing/upstream-anomaly-fetch.ts";
import {
  expectErrorStatus,
  runUpstreamAnomalyMatrix,
  type DegradedExpectation,
  type MatrixOutcome,
} from "../../../../lib/testing/upstream-anomaly-matrix.ts";
import { isolateCaveHome } from "../../../../lib/testing/scratch-cave-home.ts";

const home = isolateCaveHome("projects-icon-anomalies");
const OPENAI_KEY = "sk-testonly-openai-never-dispatched-0123456789abcdef";
const GOOGLE_KEY = "gemini-testonly-never-dispatched-0123456789abcdef";
process.env.OPENAI_API_KEY = OPENAI_KEY;
process.env.GOOGLE_API_KEY = GOOGLE_KEY;
// A sidecar token in the developer's shell would turn every request non-local.
delete process.env.COVEN_CAVE_AUTH_TOKEN;

const harness = installUpstreamAnomalyFetch();
const { POST } = await import("./route.ts");
const { projectIconRateLimiter } = await import("../../../../lib/server/project-icon-rate-limit.ts");
test.after(() => {
  harness.restore();
  home.cleanup();
});

/** A real, decodable PNG: the route re-encodes the provider's bytes through sharp. */
const PNG = await sharp({
  create: { width: 64, height: 64, channels: 3, background: { r: 180, g: 40, b: 90 } },
}).png().toBuffer();
const PNG_B64 = PNG.toString("base64");

harness.healthy("openai", async (request) => {
  const url = new URL(request.url);
  assert.equal(url.pathname, "/v1/images/generations");
  assert.equal(request.headers.get("authorization"), `Bearer ${OPENAI_KEY}`);
  const body = (await request.json()) as { model: string; output_format: string };
  assert.equal(body.model, "gpt-image-2.5-flare");
  assert.equal(body.output_format, "webp");
  return Response.json({ created: 1, data: [{ b64_json: PNG_B64 }] });
});

harness.healthy("gemini", (request) => {
  const url = new URL(request.url);
  assert.equal(url.pathname, "/v1beta/models/imagen-3.0-generate-002:predict");
  assert.equal(request.headers.get("x-goog-api-key"), GOOGLE_KEY);
  return Response.json({ predictions: [{ bytesBase64Encoded: PNG_B64, mimeType: "image/png" }] });
});

const ROOT = "/Users/dev/coven-cave";

// The connected chat model picks the provider; both keys resolve, so neither
// request can silently fall through to the other provider.
const generate = (model: string) => () =>
  POST(
    new Request("http://localhost:3000/api/projects/icon", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        host: "localhost:3000",
        origin: "http://localhost:3000",
      },
      body: JSON.stringify({ name: "coven-cave", root: ROOT, variant: 7, model }),
    }),
  );

const generationFailed = (providerMessage: RegExp): DegradedExpectation => (outcome, anomaly) => {
  expectErrorStatus(502)(outcome, anomaly);
  const body = outcome.body as { error: string; providerMessage?: string };
  assert.equal(body.error, "provider_generation_failed");
  assert.match(body.providerMessage ?? "", providerMessage);
};

const unreachable: DegradedExpectation = (outcome, anomaly) => {
  expectErrorStatus(502)(outcome, anomaly);
  assert.equal((outcome.body as { error: string }).error, "provider_unreachable");
};

const emptyImage: DegradedExpectation = (outcome, anomaly) => {
  expectErrorStatus(502)(outcome, anomaly);
  assert.equal((outcome.body as { error: string }).error, "provider_empty_image");
};

const degraded = {
  "http-500": generationFailed(/^500\b/),
  "http-502": generationFailed(/^502\b/),
  "auth-revoked": generationFailed(/^401 Unauthorized$/),
  "rate-limit": generationFailed(/^429 Too Many Requests$/),
  timeout: unreachable,
  network: unreachable,
  "malformed-json": emptyImage,
  "empty-body": emptyImage,
  "schema-drift": emptyImage,
};

const rendered = (provider: "openai" | "gemini") => (outcome: MatrixOutcome) => {
  assert.equal(outcome.status, 200, outcome.text);
  const body = outcome.body as { ok: boolean; dataUrl: string; mime: string; provider: string };
  assert.equal(body.ok, true);
  assert.equal(body.provider, provider);
  assert.equal(body.mime, "image/webp", "the stored format is the canonical re-encode, never the provider's declared type");
  assert.match(body.dataUrl, /^data:image\/webp;base64,[A-Za-z0-9+/]+=*$/);
};

test("POST /api/projects/icon (OpenAI) across upstream anomalies", async (t) => {
  await runUpstreamAnomalyMatrix(t, {
    harness,
    id: "openai",
    secrets: [OPENAI_KEY, GOOGLE_KEY],
    invoke: generate("openai/gpt-5.5"),
    // The cooldown is per project root; every matrix call is a fresh budget.
    beforeEach: () => projectIconRateLimiter.reset(),
    healthy: (outcome) => {
      rendered("openai")(outcome);
      assert.equal(harness.calls("gemini").length, 0, "an OpenAI-connected model never touches Gemini");
    },
    degraded,
  });
});

test("POST /api/projects/icon (Gemini) across upstream anomalies", async (t) => {
  await runUpstreamAnomalyMatrix(t, {
    harness,
    id: "gemini",
    secrets: [OPENAI_KEY, GOOGLE_KEY],
    invoke: generate("google/gemini-2.5-pro"),
    beforeEach: () => projectIconRateLimiter.reset(),
    healthy: (outcome) => {
      rendered("gemini")(outcome);
      assert.equal(harness.calls("openai").length, 0, "a Gemini-connected model never touches OpenAI");
    },
    degraded,
  });
});

test("the route's own cooldown and the provider's rate limit are distinguishable", async (t) => {
  await t.test("the route's cooldown: 429 rate_limited with Retry-After and no provider call", async () => {
    projectIconRateLimiter.reset();
    harness.heal();
    assert.equal((await generate("openai/gpt-5.5")()).status, 200);

    harness.reset();
    const repeated = await generate("openai/gpt-5.5")();
    assert.equal(repeated.status, 429);
    const body = await repeated.json();
    assert.equal(body.ok, false);
    assert.equal(body.error, "rate_limited");
    assert.ok(Number.isInteger(body.retryAfterSeconds) && body.retryAfterSeconds >= 1 && body.retryAfterSeconds <= 60, String(body.retryAfterSeconds));
    assert.equal(repeated.headers.get("retry-after"), String(body.retryAfterSeconds));
    assert.match(body.hint, /Try again in \d+ seconds?\./);
    assert.equal(body.providerMessage, undefined);
    assert.equal(harness.calls().length, 0, "a cooled-down request must not bill the provider");
  });

  await t.test("the provider's rate limit: 502 provider_generation_failed, one provider call, no Retry-After", async () => {
    projectIconRateLimiter.reset();
    harness.reset();
    harness.inject("openai", { kind: "rate-limit", retryAfterSeconds: 30 });
    try {
      const limited = await generate("openai/gpt-5.5")();
      assert.equal(limited.status, 502, "an upstream 429 is a provider failure, not the route's own budget");
      const body = await limited.json();
      assert.equal(body.ok, false);
      assert.equal(body.error, "provider_generation_failed");
      assert.equal(body.providerMessage, "429 Too Many Requests");
      assert.equal(body.retryAfterSeconds, undefined);
      assert.equal(limited.headers.get("retry-after"), null, "the provider's Retry-After is not relayed as if it were the route's");
      assert.equal(harness.calls("openai").length, 1);
    } finally {
      harness.heal("openai");
    }
  });

  await t.test("once the provider is back the next fresh-budget request renders", async () => {
    projectIconRateLimiter.reset();
    harness.reset();
    const response = await generate("openai/gpt-5.5")();
    assert.equal(response.status, 200);
    assert.equal(harness.calls("openai").length, 1);
  });
});

test("the provider's own explanation reaches the client as providerMessage", async () => {
  projectIconRateLimiter.reset();
  harness.inject("gemini", {
    kind: "http",
    status: 403,
    body: { error: { code: 403, message: "Imagen API has not been used in this project before.", status: "PERMISSION_DENIED" } },
  });
  try {
    const response = await generate("google/gemini-2.5-pro")();
    assert.equal(response.status, 502);
    const body = await response.json();
    assert.equal(body.error, "provider_generation_failed");
    assert.equal(body.providerMessage, "Imagen API has not been used in this project before.");
  } finally {
    harness.heal("gemini");
  }
});
