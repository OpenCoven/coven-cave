// GET /api/rss under every upstream anomaly (#6359).
//
// The route fans out over the user's feed list and degrades per feed: one
// dead host costs its own items and flips its `ok` chip, never the whole
// answer. The list is two feeds on two registry entries — hnrss.org
// (`rss-feeds`) and huggingface.co (`huggingface`) — so the matrix can fault
// one upstream while the other stays healthy and prove the survivor's items
// are still served. The five-minute window is stepped past between calls; the
// explicit tests at the end pin what the window does and does not remember.
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { installUpstreamAnomalyFetch } from "../../../lib/testing/upstream-anomaly-fetch.ts";
import { runUpstreamAnomalyMatrix, type MatrixOutcome } from "../../../lib/testing/upstream-anomaly-matrix.ts";
import { isolateCaveHome } from "../../../lib/testing/scratch-cave-home.ts";

const home = isolateCaveHome("rss-anomalies");
writeFileSync(
  path.join(process.env.COVEN_HOME!, "rss-feeds.json"),
  JSON.stringify([
    { id: "hn", title: "Hacker News", url: "https://hnrss.org/frontpage", category: "Tech" },
    { id: "hf", title: "Hugging Face", url: "https://huggingface.co/blog/feed.xml", category: "AI" },
  ]),
  "utf8",
);

const TTL_MS = 5 * 60 * 1000;
let now = Date.UTC(2026, 10, 1, 12);
const realNow = Date.now;
Date.now = () => now;

const harness = installUpstreamAnomalyFetch();
const { GET } = await import("./route.ts");
test.after(() => {
  harness.restore();
  Date.now = realNow;
  home.cleanup();
});

function rss(title: string, link: string): Response {
  const xml = `<?xml version="1.0"?><rss version="2.0"><channel><title>${title}</title>
<item><title>${title}: story</title><link>${link}</link><pubDate>Sat, 01 Nov 2026 08:00:00 GMT</pubDate><description>story</description></item>
</channel></rss>`;
  return new Response(xml, { status: 200, headers: { "content-type": "application/rss+xml" } });
}

harness.healthy("rss-feeds", (request) => {
  assert.equal(new URL(request.url).host, "hnrss.org");
  return rss("Hacker News", "https://news.ycombinator.com/item?id=1");
});
harness.healthy("huggingface", (request) => {
  assert.equal(new URL(request.url).pathname, "/blog/feed.xml");
  return rss("Hugging Face", "https://huggingface.co/blog/story");
});

const stepPastWindow = () => {
  now += TTL_MS + 1;
};

const read = (query = "") => GET(new Request(`http://localhost/api/rss${query}`));

type Body = {
  ok: boolean;
  items: Array<{ id: string; source: string; link: string }>;
  sources: Array<{ id: string; ok: boolean }>;
  fetchedAt: string;
};

const sourceOk = (body: Body, id: string): boolean => {
  const source = body.sources.find((entry) => entry.id === id);
  assert.ok(source, `source ${id} is listed`);
  return source.ok;
};

const healthyBody = (outcome: MatrixOutcome) => {
  assert.equal(outcome.status, 200, outcome.text);
  const body = outcome.body as Body;
  assert.equal(body.ok, true);
  assert.equal(sourceOk(body, "hn"), true);
  assert.equal(sourceOk(body, "hf"), true);
  assert.deepEqual(body.items.map((item) => item.source).sort(), ["Hacker News", "Hugging Face"]);
};

/** hnrss.org is down; Hugging Face's items are still served and only the HN chip is off. */
const hnLostHfKept = (outcome: MatrixOutcome) => {
  assert.equal(outcome.status, 200, "the route answers even with a feed down");
  const body = outcome.body as Body;
  assert.equal(body.ok, true, "the answer is still ok; the failure is per source");
  assert.equal(sourceOk(body, "hn"), false, "the failing feed's chip is off");
  assert.equal(sourceOk(body, "hf"), true, "the healthy feed's chip stays on");
  assert.deepEqual(body.items.map((item) => item.source), ["Hugging Face"], "the survivor's items are served");
};

/** hnrss.org answered 200 with a body that is not a feed: no HN items, chip still on. */
const hnEmptyHfKept = (outcome: MatrixOutcome) => {
  assert.equal(outcome.status, 200);
  const body = outcome.body as Body;
  assert.equal(sourceOk(body, "hn"), true, "a 200 that is not a feed parses to zero items, which the route reads as ok");
  assert.equal(sourceOk(body, "hf"), true);
  assert.deepEqual(body.items.map((item) => item.source), ["Hugging Face"]);
};

test("GET /api/rss across upstream anomalies on one of two feeds", async (t) => {
  await runUpstreamAnomalyMatrix(t, {
    harness,
    id: "rss-feeds",
    beforeEach: stepPastWindow,
    invoke: () => read(),
    healthy: healthyBody,
    degraded: {
      "http-500": hnLostHfKept,
      "http-502": hnLostHfKept,
      "auth-revoked": hnLostHfKept,
      "rate-limit": hnLostHfKept,
      timeout: hnLostHfKept,
      network: hnLostHfKept,
      "malformed-json": hnEmptyHfKept,
      "empty-body": hnEmptyHfKept,
      "schema-drift": hnEmptyHfKept,
    },
  });
});

test("every feed down at once is still a 200 with empty items and every chip off", async () => {
  stepPastWindow();
  harness.inject("rss-feeds", { kind: "network" });
  harness.inject("huggingface", { kind: "timeout" });
  harness.reset();
  try {
    const body = (await (await read()).json()) as Body;
    assert.equal(body.ok, true);
    assert.deepEqual(body.items, []);
    assert.equal(sourceOk(body, "hn"), false);
    assert.equal(sourceOk(body, "hf"), false);
    assert.equal(harness.calls("rss-feeds").length, 1);
    assert.equal(harness.calls("huggingface").length, 1);
  } finally {
    harness.heal();
  }
});

test("the window holds a degraded answer until ?refresh=1 or expiry (documented, not fixed)", async () => {
  // Finding: the route caches whatever it assembled, including an answer with
  // a feed marked ok:false, for the full window. A feed outage therefore stays
  // visible for up to five minutes after the host recovers unless the widget
  // asks with refresh=1. Bounded and user-recoverable, so recorded rather than
  // changed here.
  stepPastWindow();
  harness.inject("rss-feeds", { kind: "http", status: 503 });
  harness.reset();
  hnLostHfKept(await captureJson(read()));
  assert.equal(harness.calls("rss-feeds").length, 1);

  harness.heal("rss-feeds");
  harness.reset();
  hnLostHfKept(await captureJson(read()));
  assert.equal(harness.calls().length, 0, "inside the window the degraded answer is served without a fetch");

  harness.reset();
  healthyBody(await captureJson(read("?refresh=1")));
  assert.equal(harness.calls("rss-feeds").length, 1, "refresh=1 bypasses the window and reaches hnrss.org");
  assert.equal(harness.calls("huggingface").length, 1);

  harness.reset();
  healthyBody(await captureJson(read()));
  assert.equal(harness.calls().length, 0, "the refreshed good answer is then held for the window");

  stepPastWindow();
  harness.reset();
  healthyBody(await captureJson(read()));
  assert.equal(harness.calls().length, 2, "past the window every feed is fetched again");
});

test("each feed fetch carries a deadline", () => {
  for (const call of harness.calls()) assert.equal(call.hasDeadline, true, call.url);
});

async function captureJson(pending: Promise<Response>): Promise<MatrixOutcome> {
  const response = await pending;
  const text = await response.clone().text();
  return { value: response, response, status: response.status, text, body: JSON.parse(text), threw: undefined };
}
