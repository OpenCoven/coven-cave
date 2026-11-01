// POST /api/images/generate under every upstream anomaly, once per provider (#6359).
//
// The route folds every provider failure into one 502 with a machine code:
// `provider_unreachable` when the socket never answered, `provider_generation_failed`
// when the provider answered with an error status (its own message rides along
// as providerMessage), `provider_empty_image` when a 2xx carried no image. The
// matrix proves each anomaly lands on the right code for both providers, that
// neither API key appears in any answer, and that the next request renders
// again the moment the provider is back.
import assert from "node:assert/strict";
import test from "node:test";

import { installUpstreamAnomalyFetch } from "../../../../lib/testing/upstream-anomaly-fetch.ts";
import {
  expectErrorStatus,
  runUpstreamAnomalyMatrix,
  type DegradedExpectation,
  type MatrixOutcome,
} from "../../../../lib/testing/upstream-anomaly-matrix.ts";
import { isolateCaveHome } from "../../../../lib/testing/scratch-cave-home.ts";

const home = isolateCaveHome("images-generate-anomalies");
const OPENAI_KEY = "sk-testonly-openai-never-dispatched-0123456789abcdef";
const GOOGLE_KEY = "gemini-testonly-never-dispatched-0123456789abcdef";
process.env.OPENAI_API_KEY = OPENAI_KEY;
process.env.GOOGLE_API_KEY = GOOGLE_KEY;

const harness = installUpstreamAnomalyFetch();
const { POST } = await import("./route.ts");
test.after(() => {
  harness.restore();
  home.cleanup();
});

const IMAGE_B64 = Buffer.from("stand-in image bytes").toString("base64");

harness.healthy("openai", async (request) => {
  const url = new URL(request.url);
  assert.equal(url.pathname, "/v1/images/generations");
  assert.equal(request.headers.get("authorization"), `Bearer ${OPENAI_KEY}`, "the key travels as a bearer and nowhere else");
  const body = (await request.json()) as { model: string; prompt: string; response_format?: string };
  assert.equal(body.model, "dall-e-3");
  assert.equal(body.response_format, "b64_json", "DALL·E needs an explicit base64 response format");
  return Response.json({ created: 1, data: [{ b64_json: IMAGE_B64 }] });
});

harness.healthy("gemini", async (request) => {
  const url = new URL(request.url);
  assert.equal(url.pathname, "/v1beta/models/imagen-3.0-generate-002:predict");
  assert.equal(request.headers.get("x-goog-api-key"), GOOGLE_KEY, "the key travels as the Google header and nowhere else");
  const body = (await request.json()) as { instances: Array<{ prompt: string }>; parameters: { aspectRatio: string } };
  assert.equal(body.parameters.aspectRatio, "1:1");
  return Response.json({ predictions: [{ bytesBase64Encoded: IMAGE_B64, mimeType: "image/png" }] });
});

// The catalog model pins the provider; both keys resolve, so neither request
// can silently fall through to the other provider.
const generate = (model: string) => () =>
  POST(
    new Request("http://localhost/api/images/generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: "a lantern in a cave", model }),
    }),
  );

const generationFailed = (providerMessage: RegExp): DegradedExpectation => (outcome, anomaly) => {
  expectErrorStatus(502)(outcome, anomaly);
  const body = outcome.body as { error: string; providerMessage?: string };
  assert.equal(body.error, "provider_generation_failed");
  assert.match(body.providerMessage ?? "", providerMessage, "the status line stands in when the provider sent no message");
};

const unreachable: DegradedExpectation = (outcome, anomaly) => {
  expectErrorStatus(502)(outcome, anomaly);
  assert.equal((outcome.body as { error: string }).error, "provider_unreachable");
};

const emptyImage: DegradedExpectation = (outcome, anomaly) => {
  expectErrorStatus(502)(outcome, anomaly);
  const body = outcome.body as { error: string; providerMessage?: string };
  assert.equal(body.error, "provider_empty_image", "a 2xx without an image is an empty answer, not a success");
  assert.equal(body.providerMessage, undefined);
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

const rendered = (provider: "openai" | "gemini", model: string, size: string) => (outcome: MatrixOutcome) => {
  assert.equal(outcome.status, 200, outcome.text);
  const body = outcome.body as { ok: boolean; dataUrl: string; mime: string; provider: string; model: string; size: string; quality?: string };
  assert.equal(body.ok, true);
  assert.equal(body.provider, provider);
  assert.equal(body.model, model);
  assert.equal(body.size, size);
  assert.equal(body.mime, "image/png");
  assert.equal(body.dataUrl, `data:image/png;base64,${IMAGE_B64}`);
};

test("POST /api/images/generate (OpenAI) across upstream anomalies", async (t) => {
  await runUpstreamAnomalyMatrix(t, {
    harness,
    id: "openai",
    secrets: [OPENAI_KEY, GOOGLE_KEY],
    invoke: generate("dall-e-3"),
    healthy: (outcome) => {
      rendered("openai", "dall-e-3", "1024x1024")(outcome);
      assert.equal((outcome.body as { quality?: string }).quality, "standard");
      assert.equal(harness.calls("gemini").length, 0, "a pinned OpenAI model never touches Gemini");
    },
    degraded,
  });
});

test("POST /api/images/generate (Gemini) across upstream anomalies", async (t) => {
  await runUpstreamAnomalyMatrix(t, {
    harness,
    id: "gemini",
    secrets: [OPENAI_KEY, GOOGLE_KEY],
    invoke: generate("imagen-3.0-generate-002"),
    healthy: (outcome) => {
      rendered("gemini", "imagen-3.0-generate-002", "1:1")(outcome);
      assert.equal((outcome.body as { quality?: string }).quality, undefined, "Imagen has no quality knob");
      assert.equal(harness.calls("openai").length, 0, "a pinned Imagen model never touches OpenAI");
    },
    degraded,
  });
});

test("the provider's own explanation reaches the client as providerMessage", async () => {
  harness.inject("openai", {
    kind: "http",
    status: 400,
    body: { error: { message: "Your request was rejected as a result of our safety system.", type: "invalid_request_error" } },
  });
  try {
    const response = await generate("dall-e-3")();
    assert.equal(response.status, 502);
    const body = await response.json();
    assert.equal(body.error, "provider_generation_failed");
    assert.equal(body.providerMessage, "Your request was rejected as a result of our safety system.");
  } finally {
    harness.heal("openai");
  }
});

test("a provider failure on one provider does not poison the other", async () => {
  harness.inject("openai", { kind: "network" });
  try {
    const gemini = await generate("imagen-3.0-generate-002")();
    assert.equal(gemini.status, 200, "Gemini keeps rendering while OpenAI is down");
    const openai = await generate("dall-e-3")();
    assert.equal(openai.status, 502);
    assert.equal((await openai.json()).error, "provider_unreachable");
  } finally {
    harness.heal("openai");
  }
});
