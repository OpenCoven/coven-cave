// GET /api/home-tweets under every upstream anomaly (#6359).
//
// The Home Tweets strip fails soft: whatever rss.app does, the route answers
// `ok: true` with the last good items rather than an error the widget would
// render. The matrix pins the two halves of that contract — a non-2xx, a
// stalled socket or a dead network serves the previous timeline, and the
// failure is never written into the five-minute window, so the first call
// after rss.app recovers goes to rss.app. Non-feed 200s preserve the last
// good timeline; valid empty RSS/Atom envelopes may replace it.
import assert from "node:assert/strict";
import test from "node:test";

import { STANDARD_UPSTREAM_ANOMALIES, installUpstreamAnomalyFetch } from "../../../lib/testing/upstream-anomaly-fetch.ts";
import { runUpstreamAnomalyMatrix, type MatrixOutcome } from "../../../lib/testing/upstream-anomaly-matrix.ts";

const TTL_MS = 5 * 60 * 1000;
let now = Date.UTC(2026, 10, 1);
const realNow = Date.now;
Date.now = () => now;

const harness = installUpstreamAnomalyFetch();
const { GET } = await import("./route.ts");
test.after(() => {
  harness.restore();
  Date.now = realNow;
});

const TWEET_URL = "https://x.com/OpenCoven/status/1984000000000000001";
const FEED_XML = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
  <title>OpenCoven on X</title>
  <item>
    <title>OpenCoven: the suite is green</title>
    <link>${TWEET_URL}</link>
    <pubDate>Sat, 01 Nov 2026 08:00:00 GMT</pubDate>
    <description>the suite is green</description>
  </item>
</channel></rss>`;

harness.healthy("x-rss-bridge", (request) => {
  assert.equal(new URL(request.url).pathname, "/feeds/RJweavVApIIJt0XC.xml");
  return new Response(FEED_XML, { status: 200, headers: { "content-type": "application/rss+xml" } });
});

const stepPastWindow = () => {
  now += TTL_MS + 1;
};

const read = (query = "") => GET(new Request(`http://localhost/api/home-tweets${query}`));

type Body = { ok: boolean; items: Array<{ url: string; title: string; handle: string | null; isoDate: string | null }> };

const healthyBody = (outcome: MatrixOutcome) => {
  assert.equal(outcome.status, 200, outcome.text);
  const body = outcome.body as Body;
  assert.equal(body.ok, true);
  assert.equal(body.items.length, 1);
  assert.equal(body.items[0].url, TWEET_URL);
  assert.equal(body.items[0].handle, "@OpenCoven");
  assert.equal(body.items[0].title, "OpenCoven: the suite is green");
  assert.equal(body.items[0].isoDate, "2026-11-01T08:00:00.000Z");
};

/** The previous timeline, untouched: a bad minute at rss.app never blanks the strip. */
const servesLastGoodItems = (outcome: MatrixOutcome) => {
  assert.equal(outcome.status, 200, "the route fails soft");
  const body = outcome.body as Body;
  assert.equal(body.ok, true, "a degraded answer is still ok: true for the widget");
  assert.equal(body.items.length, 1, "the last good timeline is served");
  assert.equal(body.items[0].url, TWEET_URL);
};

test("GET /api/home-tweets across upstream anomalies", async (t) => {
  await runUpstreamAnomalyMatrix(t, {
    harness,
    id: "x-rss-bridge",
    beforeEach: stepPastWindow,
    invoke: () => read(),
    healthy: healthyBody,
    degraded: {
      "http-500": servesLastGoodItems,
      "http-502": servesLastGoodItems,
      "auth-revoked": servesLastGoodItems,
      "rate-limit": servesLastGoodItems,
      timeout: servesLastGoodItems,
      network: servesLastGoodItems,
      "malformed-json": servesLastGoodItems,
      "empty-body": servesLastGoodItems,
      "schema-drift": servesLastGoodItems,
    },
  });
});

test("a failed fetch is not written into the window: the first call after rss.app heals is live", async () => {
  stepPastWindow();
  harness.reset();
  healthyBody(await captureJson(read()));
  assert.equal(harness.calls("x-rss-bridge").length, 1);

  stepPastWindow();
  harness.inject("x-rss-bridge", { kind: "http", status: 503 });
  harness.reset();
  servesLastGoodItems(await captureJson(read()));
  // upstreamFetch retries a failed read once before the route sees it.
  assert.equal(harness.calls("x-rss-bridge").length, 2, "the window had expired, so the route asked rss.app");

  harness.heal("x-rss-bridge");
  harness.reset();
  healthyBody(await captureJson(read()));
  assert.equal(harness.calls("x-rss-bridge").length, 1, "no clock step: the 503 was never cached, so the healed call went upstream");

  harness.reset();
  healthyBody(await captureJson(read()));
  assert.equal(harness.calls("x-rss-bridge").length, 0, "the good answer is then held for the window");
});

test("?refresh=1 bypasses the window and reaches rss.app", async () => {
  harness.reset();
  healthyBody(await captureJson(read()));
  assert.equal(harness.calls("x-rss-bridge").length, 0, "inside the window the cache answers");
  harness.reset();
  healthyBody(await captureJson(read("?refresh=1")));
  assert.equal(harness.calls("x-rss-bridge").length, 1, "refresh=1 goes to rss.app");
});

test("a non-feed 200 preserves the last good timeline and the healed call is live", async () => {
  stepPastWindow();
  harness.inject("x-rss-bridge", { kind: "malformed-json" });
  servesLastGoodItems(await captureJson(read()));
  harness.heal("x-rss-bridge");
  harness.reset();
  healthyBody(await captureJson(read()));
  assert.equal(harness.calls("x-rss-bridge").length, 1, "the bad parse was not cached");
});

test("the feed fetch carries a deadline", () => {
  const call = harness.calls("x-rss-bridge").at(-1);
  assert.ok(call);
  assert.equal(call.hasDeadline, true);
});

async function captureJson(pending: Promise<Response>): Promise<MatrixOutcome> {
  const response = await pending;
  const text = await response.clone().text();
  return { value: response, response, status: response.status, text, body: JSON.parse(text), threw: undefined };
}

test("every anomaly preserves route cache state and heals without advancing the route clock", async () => {
  for (const { name, anomaly } of STANDARD_UPSTREAM_ANOMALIES) {
    stepPastWindow();
    healthyBody(await captureJson(read("?refresh=1")));
    stepPastWindow();
    harness.inject("x-rss-bridge", anomaly);
    servesLastGoodItems(await captureJson(read()));
    harness.heal("x-rss-bridge");
    harness.reset();
    healthyBody(await captureJson(read()));
    assert.equal(harness.calls("x-rss-bridge").length, 1, name);
  }
});

test("a valid empty feed may replace the cached timeline", async () => {
  stepPastWindow();
  harness.inject("x-rss-bridge", { kind: "http", status: 200, body: '<rss version="2.0"><channel><title>Empty</title></channel></rss>', headers: { "content-type": "application/rss+xml" } });
  assert.deepEqual((await (await read()).json()).items, []);
  harness.heal("x-rss-bridge");
  harness.reset();
  assert.deepEqual((await (await read()).json()).items, []);
  assert.equal(harness.calls().length, 0, "valid empty feeds are healthy cache entries");
});
