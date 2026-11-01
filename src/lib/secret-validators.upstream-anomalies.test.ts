// validateGithubToken under every upstream anomaly (#6359).
//
// The validator's contract is a verdict object, never a throw, and the pasted
// token must never leave through it. The matrix proves the three honest
// answers stay distinct: 401/403 is "rejected", any other failure names the
// status or says GitHub was unreachable, and a 200 whose body is unusable is
// still "valid" with the login left unknown rather than a false rejection.
import assert from "node:assert/strict";
import test from "node:test";

import { installUpstreamAnomalyFetch } from "./testing/upstream-anomaly-fetch.ts";
import { runUpstreamAnomalyMatrix, type MatrixOutcome } from "./testing/upstream-anomaly-matrix.ts";
import { validateGithubToken, validateSecret, type SecretValidation } from "./secret-validators.ts";

const TOKEN = "ghp_matrixonly_never_dispatched_fedcba9876543210";

// The validator takes an injectable fetch, so the routing fetch is handed in
// directly and globalThis.fetch stays untouched.
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

const validWithoutLogin = (outcome: MatrixOutcome) => {
  // GitHub accepted the token (200) but the identity body was unreadable:
  // the verdict stays "valid" and the login is simply unknown.
  assert.equal(verdict(outcome).ok, true);
  assert.equal(verdict(outcome).login, undefined);
  assert.equal(verdict(outcome).error, undefined);
};

test("validateGithubToken across upstream anomalies", async (t) => {
  await runUpstreamAnomalyMatrix(t, {
    harness,
    id: "github",
    secrets: [TOKEN],
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
      "malformed-json": validWithoutLogin,
      "empty-body": validWithoutLogin,
      "schema-drift": (outcome) => {
        // The token is valid; GitHub's drifted body carries a non-string
        // `login`, which the validator passes through untyped (see the
        // report: src/lib/secret-validators.ts:25 does not check the type).
        assert.equal(verdict(outcome).ok, true);
        assert.notEqual(verdict(outcome).login, "octocat");
        assert.equal(verdict(outcome).error, undefined);
      },
    },
  });
});

test("a primary rate limit (403 with no remaining budget) reads as rejected, like every 403", async () => {
  // GitHub signals a primary rate limit with 403 + x-ratelimit-remaining: 0.
  // The validator folds every 403 into "token rejected" (see the report).
  harness.inject("github", { kind: "rate-limit", status: 403 });
  assert.deepEqual(await validateGithubToken(TOKEN, harness.fetch), { ok: false, error: "token rejected by GitHub" });
  harness.heal("github");
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

test("the validation call carries no deadline of its own", () => {
  // Documented, not endorsed: the validator relies on its caller (or the
  // transport) to bound the request. A stalled socket here would hang until
  // undici gives up. Recorded in the report for src/lib/secret-validators.ts:14.
  const call = harness.calls("github").at(-1);
  assert.ok(call);
  assert.equal(call.hasDeadline, false);
});
