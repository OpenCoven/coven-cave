// The X API client under every upstream anomaly (#6359).
//
// Two matrices, because a read and a write have different truths under the
// same fault. A read maps each anomaly to a typed XApiError the caller can
// retry or surface: `upstream-unavailable`, `unauthorized`, `rate-limited`
// with a retry time, `invalid-response`. A write may only be wrong in one
// direction: once X might have taken the post, every failure — a 5xx, a
// stalled socket, a dead network, an unreadable reply — is `ambiguous-write`
// with `dispatched: true`, so no caller retries its way into a duplicate
// post. Only X's own 4xx refusal is a definite, retryable failure.
import assert from "node:assert/strict";
import test from "node:test";

import { XApiError } from "../x-api.ts";
import { installUpstreamAnomalyFetch } from "../testing/upstream-anomaly-fetch.ts";
import { runUpstreamAnomalyMatrix, type MatrixOutcome } from "../testing/upstream-anomaly-matrix.ts";
import { createXClient } from "./x-client.ts";

const ACCESS_TOKEN = "x_access_testonly_never_dispatched_0123456789";
const POST_ID = "1984000000000000001";
// The client's own request deadline, shortened so the `timeout` anomaly is
// the client aborting a stalled socket rather than the harness giving up.
const CLIENT_TIMEOUT_MS = 10;

const harness = installUpstreamAnomalyFetch({ install: false, hangMs: 200 });
test.after(() => harness.restore());

const client = createXClient({
  fetch: harness.fetch,
  clientId: "synthetic-client-id",
  now: () => Date.parse("2026-11-01T09:00:00.000Z"),
  setTimeout: (callback) => setTimeout(callback, CLIENT_TIMEOUT_MS),
});

harness.healthy("x", async (request) => {
  const url = new URL(request.url);
  assert.equal(request.headers.get("authorization"), `Bearer ${ACCESS_TOKEN}`, "the token travels as a bearer and nowhere else");
  if (request.method === "GET" && url.pathname === `/2/tweets/${POST_ID}`) {
    assert.equal(url.searchParams.get("expansions"), "author_id");
    return Response.json({
      data: { id: POST_ID, text: "the suite is green", author_id: "42", created_at: "2026-11-01T08:00:00.000Z" },
      includes: { users: [{ id: "42", username: "OpenCoven", name: "Open Coven" }] },
    });
  }
  if (request.method === "POST" && url.pathname === "/2/tweets") {
    const body = JSON.parse(await request.text()) as { text: string };
    return Response.json({ data: { id: "1984000000000000002", text: body.text } }, { status: 201 });
  }
  return Response.json({ title: "Not Found" }, { status: 404 });
});

const xError = (code: XApiError["code"], dispatched: boolean) => (outcome: MatrixOutcome) => {
  assert.ok(outcome.threw instanceof XApiError, `expected a typed XApiError, got ${outcome.text}`);
  assert.equal(outcome.threw.code, code);
  assert.equal(outcome.threw.dispatched, dispatched);
  assert.equal(outcome.threw.message, outcome.threw.safeMessage, "the thrown message is the safe message");
  assert.equal(outcome.threw.message.includes("Bad credentials"), false, "X's own diagnostic is not surfaced");
};

test("lookupXPost (a read) across upstream anomalies", async (t) => {
  await runUpstreamAnomalyMatrix(t, {
    harness,
    id: "x",
    mayThrow: true,
    secrets: [ACCESS_TOKEN],
    invoke: () => client.lookupXPost(ACCESS_TOKEN, POST_ID),
    healthy: (outcome) => {
      const post = outcome.value as { id: string; canonicalUrl: string; author: { username: string } };
      assert.equal(post.id, POST_ID);
      assert.equal(post.canonicalUrl, `https://x.com/opencoven/status/${POST_ID}`);
      assert.equal(post.author.username, "OpenCoven");
    },
    degraded: {
      "http-500": xError("upstream-unavailable", false),
      "http-502": xError("upstream-unavailable", false),
      "auth-revoked": (outcome) => {
        xError("unauthorized", false)(outcome);
        assert.equal((outcome.threw as XApiError).status, 401);
      },
      "rate-limit": (outcome) => {
        xError("rate-limited", false)(outcome);
        const error = outcome.threw as XApiError;
        assert.equal(error.status, 429);
        assert.equal(typeof error.retryAt, "string", "Retry-After is surfaced as a retry time");
      },
      timeout: xError("upstream-unavailable", false),
      network: xError("upstream-unavailable", false),
      "malformed-json": xError("invalid-response", false),
      "empty-body": xError("invalid-response", false),
      "schema-drift": xError("invalid-response", false),
    },
  });
});

test("createXPost (a write) across upstream anomalies: anything past X's refusal is ambiguous, never retryable", async (t) => {
  await runUpstreamAnomalyMatrix(t, {
    harness,
    id: "x",
    mayThrow: true,
    secrets: [ACCESS_TOKEN],
    invoke: () => client.createXPost(ACCESS_TOKEN, "the suite is green"),
    healthy: (outcome) => {
      assert.deepEqual(outcome.value, { id: "1984000000000000002", text: "the suite is green" });
    },
    degraded: {
      "http-500": xError("ambiguous-write", true),
      "http-502": xError("ambiguous-write", true),
      // A 4xx is X refusing the request: nothing was created, retry is safe.
      "auth-revoked": xError("unauthorized", false),
      "rate-limit": xError("rate-limited", false),
      timeout: xError("ambiguous-write", true),
      network: xError("ambiguous-write", true),
      // X said 2xx, so the post very likely exists even though its id is unreadable.
      "malformed-json": xError("ambiguous-write", true),
      "empty-body": xError("ambiguous-write", true),
      "schema-drift": xError("ambiguous-write", true),
    },
  });
});

test("a 400 on a write is a definite refusal: invalid-request, not dispatched", async () => {
  harness.inject("x", { kind: "http", status: 400, body: { title: "Invalid Request" } });
  await assert.rejects(client.createXPost(ACCESS_TOKEN, "again"), (error: unknown) => {
    assert.ok(error instanceof XApiError);
    assert.equal(error.code, "invalid-request");
    assert.equal(error.dispatched, false);
    return true;
  });
  harness.heal("x");
});

test("every call carries the client's own deadline", () => {
  for (const call of harness.calls("x")) assert.equal(call.hasDeadline, true);
});
