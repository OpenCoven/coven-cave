// POST /api/voice/local/chat under every upstream anomaly (#6359).
//
// The loopback brain proxy talks to whatever OpenAI-compatible server is on
// 127.0.0.1:11434 (Ollama's default) unless COVEN_LOCAL_LLM_URL says
// otherwise. There is no key, so the distinct contracts are about the hint:
// a socket that never opens or never answers is `local_llm_unreachable` and
// tells the person to start Ollama; an error status is `local_llm_error`
// carrying the server's own message; a 2xx with no text is `local_llm_empty`
// and suggests pulling the model. The healthy answer passes the completion
// text through trimmed, and the proxy re-asks the server the moment it is back.
import assert from "node:assert/strict";
import test from "node:test";

import { installUpstreamAnomalyFetch } from "../../../../../lib/testing/upstream-anomaly-fetch.ts";
import { expectErrorStatus, runUpstreamAnomalyMatrix, type DegradedExpectation } from "../../../../../lib/testing/upstream-anomaly-matrix.ts";

// The registry declares the loopback default; the env must not move it.
delete process.env.COVEN_LOCAL_LLM_URL;

const harness = installUpstreamAnomalyFetch();
const { POST } = await import("./route.ts");
test.after(() => harness.restore());

harness.healthy("local-llm", async (request) => {
  const url = new URL(request.url);
  assert.equal(url.host, "127.0.0.1:11434");
  assert.equal(url.pathname, "/v1/chat/completions");
  const body = (await request.json()) as { model: string; stream: boolean; messages: Array<{ role: string; content: string }> };
  assert.equal(body.model, "llama3.2");
  assert.equal(body.stream, false);
  assert.deepEqual(body.messages.at(-1), { role: "user", content: "What hums in the cave?" });
  return Response.json({
    id: "chatcmpl-1",
    choices: [{ index: 0, message: { role: "assistant", content: "  The lantern, mostly.  " }, finish_reason: "stop" }],
  });
});

const ask = () =>
  POST(
    new Request("http://localhost/api/voice/local/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        messages: [
          { role: "system", content: "You are the cave." },
          { role: "user", content: "What hums in the cave?" },
        ],
      }),
    }),
  );

const noLocalServer: DegradedExpectation = (outcome, anomaly) => {
  expectErrorStatus(502)(outcome, anomaly);
  const body = outcome.body as { error: string; hint: string };
  assert.equal(body.error, "local_llm_unreachable");
  assert.match(body.hint, /^No OpenAI-compatible server on http:\/\/127\.0\.0\.1:11434 \(/, "the hint names the base it tried");
  assert.match(body.hint, /Start Ollama \(`ollama serve`\) or LM Studio, or set COVEN_LOCAL_LLM_URL\./);
};

const serverError = (hint: string): DegradedExpectation => (outcome, anomaly) => {
  expectErrorStatus(502)(outcome, anomaly);
  assert.deepEqual(outcome.body, { ok: false, error: "local_llm_error", hint });
};

const noText: DegradedExpectation = (outcome, anomaly) => {
  expectErrorStatus(502)(outcome, anomaly);
  const body = outcome.body as { error: string; hint: string };
  assert.equal(body.error, "local_llm_empty");
  assert.match(body.hint, /The local model \(llama3\.2\) returned no text — is it pulled\? Try `ollama pull llama3\.2`\./);
};

test("POST /api/voice/local/chat across upstream anomalies", async (t) => {
  await runUpstreamAnomalyMatrix(t, {
    harness,
    id: "local-llm",
    invoke: ask,
    healthy: (outcome) => {
      assert.equal(outcome.status, 200, outcome.text);
      assert.deepEqual(outcome.body, { ok: true, text: "The lantern, mostly." });
      const call = harness.calls("local-llm").at(-1);
      assert.ok(call);
      assert.equal(call.hasDeadline, true, "a local model that never answers must not hang the voice loop forever");
    },
    degraded: {
      "http-500": serverError("local model server returned http 500"),
      "http-502": serverError("local model server returned http 502"),
      // The harness's 401/429 bodies carry a string `error`, the shape Ollama
      // uses: the server's own word becomes the hint.
      "auth-revoked": serverError("unauthorized"),
      "rate-limit": serverError("rate_limited"),
      timeout: noLocalServer,
      network: noLocalServer,
      "malformed-json": noText,
      "empty-body": noText,
      "schema-drift": noText,
    },
  });
});

test("an OpenAI-shaped error object is relayed as the hint", async () => {
  harness.inject("local-llm", {
    kind: "http",
    status: 404,
    body: { error: { message: "model 'llama3.2' not found, try pulling it first", type: "api_error" } },
  });
  try {
    const response = await ask();
    assert.equal(response.status, 502);
    assert.deepEqual(await response.json(), {
      ok: false,
      error: "local_llm_error",
      hint: "model 'llama3.2' not found, try pulling it first",
    });
  } finally {
    harness.heal("local-llm");
  }
});

test("a configured COVEN_LOCAL_LLM_URL is what the unreachable hint names", async () => {
  process.env.COVEN_LOCAL_LLM_URL = "http://127.0.0.1:1234/";
  harness.reset();
  try {
    // 127.0.0.1:1234 is no declared upstream, so the harness refuses the
    // socket the way a closed port would.
    const response = await ask();
    assert.equal(response.status, 502);
    const body = await response.json();
    assert.equal(body.error, "local_llm_unreachable");
    assert.match(body.hint, /^No OpenAI-compatible server on http:\/\/127\.0\.0\.1:1234 \(/, "the trailing slash is trimmed and the configured base is named");
    assert.equal(harness.undeclared().length, 1);
  } finally {
    delete process.env.COVEN_LOCAL_LLM_URL;
    harness.reset();
  }
  assert.equal((await ask()).status, 200, "back on the default base the server answers again");
});
