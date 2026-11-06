// capturePin's fixed-host GitHub path under every upstream anomaly (#6359).
//
// Only `kind: "github"` is exercised: a github.com URL maps through
// githubApiTarget to api.github.com (issue/PR/readme JSON) or
// raw.githubusercontent.com (blob text), and fetchCapped/readBodyCapped reach
// those fixed hosts through globalThis.fetch — no DNS, no user hostname. The
// `url` kind goes through https.request and the public-only resolver, which
// never touches fetch, so it is out of this matrix's reach by design.
//
// capturePin never throws; the matrix pins which failures become a 502
// "GitHub returned HTTP n" / "GitHub fetch failed" / "GitHub response
// unreadable", which become a 422 "empty", and which still produce a pin.
import assert from "node:assert/strict";
import test from "node:test";

import { installUpstreamAnomalyFetch } from "../testing/upstream-anomaly-fetch.ts";
import { runUpstreamAnomalyMatrix, type MatrixOutcome } from "../testing/upstream-anomaly-matrix.ts";
import { capturePin, type PinCaptureResult } from "./pin-sources.ts";

const harness = installUpstreamAnomalyFetch();
test.after(() => harness.restore());

const ISSUE_URL = "https://github.com/OpenCoven/coven-cave/issues/6359";
const BLOB_URL = "https://github.com/OpenCoven/coven-cave/blob/main/docs/guide.md";
const GUIDE = "# Guide\n\nPinned from the repository.\n";

harness.healthy("github", (request) => {
  const url = new URL(request.url);
  assert.equal(url.pathname, "/repos/OpenCoven/coven-cave/issues/6359");
  assert.equal(request.headers.get("authorization"), null, "pin capture is anonymous: no credential is attached");
  assert.match(request.headers.get("accept") ?? "", /application\/vnd\.github/);
  return Response.json({ number: 6359, title: "Upstream anomaly matrix", body: "Drive every caller through the matrix." });
});

harness.healthy("github-raw", (request) => {
  const url = new URL(request.url);
  assert.equal(url.pathname, "/OpenCoven/coven-cave/main/docs/guide.md");
  assert.equal(request.headers.get("accept"), "text/plain");
  return new Response(GUIDE, { status: 200, headers: { "content-type": "text/plain; charset=utf-8" } });
});

const result = (outcome: MatrixOutcome) => outcome.body as PinCaptureResult;

const failed = (status: number, error: string | RegExp) => (outcome: MatrixOutcome) => {
  const value = result(outcome);
  assert.equal(value.ok, false, `expected a failed capture, got ${outcome.text.slice(0, 200)}`);
  if (!value.ok) {
    assert.equal(value.status, status);
    if (typeof error === "string") assert.equal(value.error, error);
    else assert.match(value.error, error);
  }
};

const httpStatus = (status: number) => failed(502, `GitHub returned HTTP ${status}`);

test("capturePin github issue (api.github.com) across upstream anomalies", async (t) => {
  await runUpstreamAnomalyMatrix(t, {
    harness,
    id: "github",
    invoke: () => capturePin({ kind: "github", ref: ISSUE_URL }),
    healthy: (outcome) => {
      const value = result(outcome);
      assert.equal(value.ok, true, outcome.text);
      if (value.ok) {
        assert.equal(value.pin.kind, "github");
        assert.equal(value.pin.ref, ISSUE_URL);
        assert.equal(value.pin.title, "OpenCoven/coven-cave#6359 — Upstream anomaly matrix");
        assert.equal(value.pin.content, "# Upstream anomaly matrix\n\nDrive every caller through the matrix.");
      }
    },
    degraded: {
      "http-500": httpStatus(500),
      "http-502": httpStatus(502),
      "auth-revoked": httpStatus(401),
      "rate-limit": httpStatus(429),
      timeout: failed(502, "GitHub fetch failed"),
      network: failed(502, "GitHub fetch failed"),
      "malformed-json": failed(502, "GitHub response unreadable"),
      "empty-body": failed(502, "GitHub response unreadable"),
      "schema-drift": (outcome) => {
        // Well-formed JSON with no title/body still yields a pin, headed by
        // the label and otherwise empty (see the report: pin-sources.ts:352).
        const value = result(outcome);
        assert.equal(value.ok, true);
        if (value.ok) {
          assert.equal(value.pin.title, "OpenCoven/coven-cave#6359 —");
          assert.equal(value.pin.content, "# OpenCoven/coven-cave#6359\n\n");
        }
      },
    },
  });
});

test("capturePin github blob (raw.githubusercontent.com) across upstream anomalies", async (t) => {
  await runUpstreamAnomalyMatrix(t, {
    harness,
    id: "github-raw",
    invoke: () => capturePin({ kind: "github", ref: BLOB_URL }),
    healthy: (outcome) => {
      const value = result(outcome);
      assert.equal(value.ok, true, outcome.text);
      if (value.ok) {
        assert.equal(value.pin.title, "OpenCoven/coven-cave: docs/guide.md");
        assert.equal(value.pin.content, GUIDE);
      }
    },
    degraded: {
      "http-500": httpStatus(500),
      "http-502": httpStatus(502),
      "auth-revoked": httpStatus(401),
      "rate-limit": httpStatus(429),
      timeout: failed(502, "GitHub fetch failed"),
      network: failed(502, "GitHub fetch failed"),
      // The raw path is text: a 200 with any bytes is pinned verbatim, and a
      // 200 with no bytes is "empty".
      "malformed-json": (outcome) => {
        const value = result(outcome);
        assert.equal(value.ok, true);
        if (value.ok) assert.equal(value.pin.content, '{"data":[{"id":1,"name":"trunc');
      },
      "empty-body": failed(422, "GitHub content was empty"),
      "schema-drift": (outcome) => {
        const value = result(outcome);
        assert.equal(value.ok, true);
        if (value.ok) assert.match(value.pin.content, /"unexpected":true/);
      },
    },
  });
});

test("a redirect from the fixed host is not followed: it is a failed capture, not a second fetch", async () => {
  harness.reset();
  harness.inject("github", { kind: "http", status: 302, body: "", headers: { location: "https://evil.invalid/" } });
  const value = await capturePin({ kind: "github", ref: ISSUE_URL });
  assert.deepEqual(value, { ok: false, error: "GitHub returned HTTP 302", status: 502 });
  assert.equal(harness.calls().length, 1, "redirect: manual means the Location is never fetched");
  harness.heal("github");
  harness.assertAllDeclared();
});

test("an oversized declared body is refused before it is read", async () => {
  harness.inject("github-raw", { kind: "http", status: 200, body: "x", headers: { "content-type": "text/plain", "content-length": String(64 * 1024 * 1024) } });
  const value = await capturePin({ kind: "github", ref: BLOB_URL });
  assert.deepEqual(value, { ok: false, error: "GitHub response unreadable", status: 502 });
  harness.heal("github-raw");
  const healed = await capturePin({ kind: "github", ref: BLOB_URL });
  assert.equal(healed.ok, true);
});

test("both fixed-host fetches carry a deadline", async () => {
  harness.reset();
  await capturePin({ kind: "github", ref: ISSUE_URL });
  await capturePin({ kind: "github", ref: BLOB_URL });
  for (const call of harness.calls()) assert.equal(call.hasDeadline, true, call.url);
  harness.assertAllDeclared();
});
