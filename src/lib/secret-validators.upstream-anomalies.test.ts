// validateGithubToken under every upstream anomaly (#6359).
//
// The validator's contract is a verdict object, never a throw, and the pasted
// token must never leave through it. The matrix proves the three honest
// answers stay distinct: 401/403 is "rejected", any other failure names the
// status or says GitHub was unreachable, and a 200 that names no account is
// unverified: not valid, and not worded as a rejection (#6368).
import assert from "node:assert/strict";
import test from "node:test";

import { installUpstreamAnomalyFetch } from "./testing/upstream-anomaly-fetch.ts";
import { runUpstreamAnomalyMatrix, type MatrixOutcome } from "./testing/upstream-anomaly-matrix.ts";
import { resetUpstreamHealth } from "./server/upstream-fetch.ts";
import { validateGithubToken, validateSecret, type SecretValidation } from "./secret-validators.ts";

const TOKEN = "ghp_matrixonly_never_dispatched_fedcba9876543210";

// The validator takes an injectable fetch, so the routing fetch is handed in
// directly and globalThis.fetch stays untouched; the validator still routes it
// through upstreamFetch, so the deadline, retry and ledger apply to it.
const harness = installUpstreamAnomalyFetch({ install: false });

harness.healthy("github", (request) => {
  const url = new URL(request.url);
  assert.equal(url.pathname, "/user");
  assert.equal(request.headers.get("authorization"), `Bearer ${TOKEN}`, "the token travels as a bearer and nowhere else");
  assert.equal(request.headers.get("accept"), "application/vnd.github+json");
  return Response.json({ login: "octocat", id: 1 });
});

const verdict = (outcome: MatrixOutcome) => outcome.body as SecretValidation;

const rejectedWithStatus = (status: number) => (outcome: MatrixOutcome) => {
  assert.deepEqual(verdict(outcome), { ok: false, error: `GitHub API error (${status})` });
};

const unreachable = (outcome: MatrixOutcome) => {
  assert.deepEqual(verdict(outcome), { ok: false, error: "could not reach GitHub" });
};

const unverified = (outcome: MatrixOutcome) => {
  assert.deepEqual(verdict(outcome), { ok: false, error: "GitHub answered without identifying the token's account" });
};

test("validateGithubToken across upstream anomalies", async (t) => {
  await runUpstreamAnomalyMatrix(t, {
    harness,
    id: "github",
    secrets: [TOKEN],
    expectLiveDetection: true,
    invoke: () => validateGithubToken(TOKEN, harness.fetch),
    healthy: (outcome) => {
      assert.deepEqual(verdict(outcome), { ok: true, login: "octocat" });
    },
    degraded: {
      "http-500": rejectedWithStatus(500),
      "http-502": rejectedWithStatus(502),
      "auth-revoked": (outcome) => {
        assert.deepEqual(verdict(outcome), { ok: false, error: "token rejected by GitHub" });
      },
      // A 429 is reported by status: it is "not now", and must not read as a bad token.
      "rate-limit": rejectedWithStatus(429),
      timeout: unreachable,
      network: unreachable,
      "malformed-json": unverified,
      "empty-body": unverified,
      "schema-drift": unverified,
    },
  });
});

test("a primary rate limit (403 with no remaining budget) reads as rejected, like every 403", async () => {
  // GitHub signals a primary rate limit with 403 + x-ratelimit-remaining: 0.
  // The validator folds every 403 into "token rejected" (see the report).
  harness.inject("github", { kind: "rate-limit", status: 403 });
  assert.deepEqual(await validateGithubToken(TOKEN, harness.fetch), { ok: false, error: "token rejected by GitHub" });
  harness.heal("github");
  // The primary rate limit opened a 7 s cooldown on the host; treat it as elapsed.
  resetUpstreamHealth("github");
  assert.deepEqual(await validateGithubToken(TOKEN, harness.fetch), { ok: true, login: "octocat" });
});

test("validateSecret routes GITHUB_PAT through the same validator and the same fetch", async () => {
  harness.inject("github", { kind: "network" });
  assert.deepEqual(await validateSecret("GITHUB_PAT", TOKEN, harness.fetch), { ok: false, error: "could not reach GitHub" });
  harness.heal("github");
  harness.reset();
  assert.deepEqual(await validateSecret("GITHUB_PAT", TOKEN, harness.fetch), { ok: true, login: "octocat" });
  assert.equal(harness.calls("github").length, 1);
  harness.assertAllDeclared();
});

test("the validation call carries a deadline even with an injected fetch", () => {
  // upstreamFetch bounds every attempt, so a stalled socket ends as a
  // TimeoutError ("could not reach GitHub") instead of hanging until undici gives up.
  const call = harness.calls("github").at(-1);
  assert.ok(call);
  assert.equal(call.hasDeadline, true);
});
