// openaiRealtimeProvider.mintSession under every upstream anomaly (#6359).
//
// The server half of the Realtime provider posts to /v1/realtime/client_secrets
// and hands back an ephemeral grant. Its contract is to throw on failure — the
// session route turns the message into a 502 with `error`/`providerMessage` —
// so the matrix opts into `mayThrow` and pins what each anomaly throws: a
// `provider_http_<status>` code (or the provider's own message when it sent
// one), the raw socket error, and a named "no ephemeral token" rejection for a
// drifted body. The vault key must never be in any of them, and the ephemeral
// token the grant carries is not the key. The WebRTC client adapter is out of
// scope here.
import assert from "node:assert/strict";
import test from "node:test";

import { installUpstreamAnomalyFetch } from "../testing/upstream-anomaly-fetch.ts";
import { runUpstreamAnomalyMatrix, type DegradedExpectation } from "../testing/upstream-anomaly-matrix.ts";

const API_KEY = "sk-testonly-openai-never-dispatched-0123456789abcdef";
const EPHEMERAL = "ek_testonly_ephemeral_client_secret";
const EXPIRES_AT_SEC = 1_800_000_000;

const harness = installUpstreamAnomalyFetch();
const { openaiRealtimeProvider } = await import("./openai-realtime.ts");
test.after(() => harness.restore());

harness.healthy("openai", async (request) => {
  const url = new URL(request.url);
  assert.equal(url.pathname, "/v1/realtime/client_secrets");
  assert.equal(request.headers.get("authorization"), `Bearer ${API_KEY}`, "the key travels as a bearer and nowhere else");
  const body = (await request.json()) as { session: { type: string; model: string; instructions: string; audio: { output: { voice: string } } } };
  assert.equal(body.session.type, "realtime");
  assert.equal(body.session.model, "gpt-realtime");
  assert.equal(body.session.audio.output.voice, "marin");
  assert.equal(body.session.instructions, "Be brief.");
  return Response.json({ value: EPHEMERAL, expires_at: EXPIRES_AT_SEC, session: { id: "sess_1" } });
});

const mint = () =>
  openaiRealtimeProvider.mintSession(API_KEY, {
    familiarId: "fam-1",
    model: "gpt-realtime",
    voice: "marin",
    instructions: "Be brief.",
  });

const throwsMessage = (message: string): DegradedExpectation => (outcome) => {
  assert.ok(outcome.threw instanceof Error, `expected a thrown Error, got ${outcome.text}`);
  assert.equal(outcome.threw.message, message);
  assert.equal(outcome.value, undefined, "a failed mint hands back no grant");
};

const throwsNamed = (name: string): DegradedExpectation => (outcome) => {
  assert.ok(outcome.threw instanceof Error, `expected a thrown Error, got ${outcome.text}`);
  assert.equal(outcome.threw.name, name);
  assert.equal(outcome.value, undefined);
};

test("openaiRealtimeProvider.mintSession across upstream anomalies", async (t) => {
  await runUpstreamAnomalyMatrix(t, {
    harness,
    id: "openai",
    secrets: [API_KEY],
    mayThrow: true,
    invoke: mint,
    healthy: (outcome) => {
      assert.equal(outcome.threw, undefined, outcome.text);
      const grant = outcome.value as { provider: string; clientSecret: string; expiresAt: string; connection: { kind: string; url: string; model: string; voice: string } };
      assert.equal(grant.provider, "openai");
      assert.equal(grant.clientSecret, EPHEMERAL, "the grant carries the ephemeral token, never the vault key");
      assert.equal(grant.expiresAt, new Date(EXPIRES_AT_SEC * 1000).toISOString());
      assert.deepEqual(grant.connection, {
        kind: "openai-realtime",
        url: "https://api.openai.com/v1/realtime/calls",
        model: "gpt-realtime",
        voice: "marin",
      });
    },
    degraded: {
      "http-500": throwsMessage("provider_http_500"),
      "http-502": throwsMessage("provider_http_502"),
      "auth-revoked": throwsMessage("provider_http_401"),
      "rate-limit": throwsMessage("provider_http_429"),
      // The mint carries no deadline of its own: the harness ceiling is what
      // ends the wait here, surfacing as the platform's TimeoutError.
      timeout: throwsNamed("TimeoutError"),
      network: (outcome) => {
        assert.ok(outcome.threw instanceof TypeError, outcome.text);
        assert.equal(outcome.threw.message, "fetch failed");
      },
      // A 2xx whose body is not JSON escapes as the parser's own error, not a
      // provider code; the session route still answers 502 with that message.
      "malformed-json": throwsNamed("SyntaxError"),
      "empty-body": throwsNamed("SyntaxError"),
      "schema-drift": throwsMessage("provider returned no ephemeral token"),
    },
  });
});

test("the provider's own explanation becomes the thrown message", async () => {
  harness.inject("openai", {
    kind: "http",
    status: 400,
    body: { error: { message: "Invalid value: 'gpt-realtime-nope'. Supported values are: 'gpt-realtime'.", param: "session.model", code: "invalid_value" } },
  });
  try {
    await assert.rejects(mint, {
      message: "Invalid value: 'gpt-realtime-nope'. Supported values are: 'gpt-realtime'.",
    });
  } finally {
    harness.heal("openai");
  }
});

test("an expiry the provider omits defaults to about a minute out", async () => {
  harness.inject("openai", { kind: "schema-drift", body: { value: EPHEMERAL } });
  try {
    const before = Date.now();
    const grant = await mint();
    const expiresAt = Date.parse(grant.expiresAt);
    assert.ok(expiresAt >= before + 59_000 && expiresAt <= Date.now() + 61_000, grant.expiresAt);
  } finally {
    harness.heal("openai");
  }
});
