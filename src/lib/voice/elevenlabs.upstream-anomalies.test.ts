// probeElevenLabs under every upstream anomaly (#6359).
//
// The mint-time key probe takes its fetch as a parameter, so the harness is
// handed in as that argument rather than installed on the global. The probe
// never throws: a 401 is `elevenlabs_key_invalid`, any other non-2xx is
// `elevenlabs_probe_failed` naming the status, a stalled socket or dead
// network is `elevenlabs_unreachable`, and any 2xx — whatever its body — is a
// good key. The key never appears in a detail, and the call is bounded.
import assert from "node:assert/strict";
import test from "node:test";

import { installUpstreamAnomalyFetch } from "../testing/upstream-anomaly-fetch.ts";
import { runUpstreamAnomalyMatrix, type DegradedExpectation, type MatrixOutcome } from "../testing/upstream-anomaly-matrix.ts";

const API_KEY = "xi-testonly-elevenlabs-never-dispatched-0123456789abcdef";

const realFetch = globalThis.fetch;
const harness = installUpstreamAnomalyFetch({ install: false });
const { probeElevenLabs } = await import("./elevenlabs.ts");

harness.healthy("elevenlabs", (request) => {
  const url = new URL(request.url);
  assert.equal(url.pathname, "/v1/models");
  assert.equal(request.headers.get("xi-api-key"), API_KEY, "the key travels as xi-api-key and nowhere else");
  return Response.json([{ model_id: "eleven_turbo_v2_5", name: "Turbo v2.5", can_do_text_to_speech: true }]);
});

const probe = () => probeElevenLabs(API_KEY, harness.fetch);

const probeFailed = (status: number): DegradedExpectation => (outcome) => {
  assert.deepEqual(outcome.value, { ok: false, code: "elevenlabs_probe_failed", detail: `http ${status}` });
};

const unreachable: DegradedExpectation = (outcome) => {
  const result = outcome.value as { ok: false; code: string; detail: string };
  assert.equal(result.ok, false);
  assert.equal(result.code, "elevenlabs_unreachable");
  assert.ok(result.detail.length > 0, "the socket error is named so the overlay can show it");
};

const goodKey = (outcome: MatrixOutcome) => {
  assert.equal(outcome.threw, undefined, outcome.text);
  assert.deepEqual(outcome.value, { ok: true }, "the probe judges the status, not the body");
};

test("probeElevenLabs across upstream anomalies", async (t) => {
  await runUpstreamAnomalyMatrix(t, {
    harness,
    id: "elevenlabs",
    secrets: [API_KEY],
    invoke: probe,
    healthy: (outcome) => {
      goodKey(outcome);
      const call = harness.calls("elevenlabs").at(-1);
      assert.ok(call);
      assert.equal(call.hasDeadline, true, "an unbounded probe would stall the whole mint on a dead socket");
    },
    degraded: {
      "http-500": probeFailed(500),
      "http-502": probeFailed(502),
      "auth-revoked": (outcome) => {
        const result = outcome.value as { ok: false; code: string; detail: string };
        assert.equal(result.ok, false);
        assert.equal(result.code, "elevenlabs_key_invalid");
        assert.match(result.detail, /ELEVENLABS_API_KEY/);
      },
      "rate-limit": probeFailed(429),
      timeout: unreachable,
      network: (outcome) => {
        unreachable(outcome, { kind: "network" });
        assert.equal((outcome.value as { detail: string }).detail, "fetch failed");
      },
      "malformed-json": goodKey,
      "empty-body": goodKey,
      "schema-drift": goodKey,
    },
  });
});

test("the injected fetch is the only one the probe uses", () => {
  assert.equal(globalThis.fetch, realFetch, "install: false leaves the global fetch alone");
  assert.notEqual(harness.fetch, realFetch);
});
