// fetchSorsaXArticle under every upstream anomaly (#6359).
//
// The provider's contract is a typed XArticleProviderError, so the matrix
// runs with `mayThrow` and pins the code and retryability each anomaly maps
// to: an outage or a dead socket is `upstream-unavailable`, the provider's
// own 401 is `unauthorized`, a 429 is `rate-limited`, the client's own
// deadline is `timeout`, a torn or drifted body is `invalid-response`, and
// — the honest surprise — an empty 200 is `not-article`. The API key rides
// the ApiKey header and must never appear in an error.
import assert from "node:assert/strict";
import test from "node:test";

import { XArticleProviderError, type XArticleFailureCode } from "../x-articles.ts";
import { installUpstreamAnomalyFetch } from "../testing/upstream-anomaly-fetch.ts";
import { runUpstreamAnomalyMatrix, type MatrixOutcome } from "../testing/upstream-anomaly-matrix.ts";
import { fetchSorsaXArticle } from "./x-article-sorsa.ts";

const ARTICLE_URL = "https://x.com/OpenCoven/status/123456789?ref=timeline";
const API_KEY = "sorsa_testonly_never_dispatched_0123456789";
// The client's own deadline fires well inside the harness ceiling, so the
// `timeout` anomaly exercises the AbortError → `timeout` mapping rather than
// the harness's TimeoutError fallback.
const CLIENT_TIMEOUT_MS = 50;
const harness = installUpstreamAnomalyFetch({ install: false, hangMs: 500 });
test.after(() => harness.restore());

harness.healthy("sorsa", async (request) => {
  assert.equal(request.method, "POST");
  assert.equal(new URL(request.url).pathname, "/v3/article");
  assert.equal(request.headers.get("apikey"), API_KEY, "the key travels in the ApiKey header and nowhere else");
  const body = JSON.parse(await request.text()) as { tweet_link: string };
  assert.match(body.tweet_link, /\/status\/123456789$/);
  return Response.json({
    full_text: "A reviewed title\nThe body of the article.",
    preview_text: "Lead preview.",
    cover_image_url: "https://cdn.sorsa.io/articles/cover.png",
    published_at: "2026-08-17T12:34:56Z",
    author: { id: "42", username: "opencoven", display_name: "Open Coven" },
  });
});

const fetchArticle = () =>
  fetchSorsaXArticle(ARTICLE_URL, {
    apiKey: API_KEY,
    fetchImpl: harness.fetch,
    timeoutMs: CLIENT_TIMEOUT_MS,
    now: () => new Date("2026-11-01T09:00:00.000Z"),
  });

const providerError = (code: XArticleFailureCode, retryable: boolean) => (outcome: MatrixOutcome) => {
  assert.ok(outcome.threw instanceof XArticleProviderError, `expected a typed provider error, got ${outcome.text}`);
  assert.equal(outcome.threw.code, code);
  assert.equal(outcome.threw.retryable, retryable);
  assert.equal(outcome.threw.message.includes(API_KEY), false);
  assert.equal(String(outcome.threw).includes("Bad credentials"), false, "the upstream's own diagnostic is not surfaced");
};

test("fetchSorsaXArticle across upstream anomalies", async (t) => {
  await runUpstreamAnomalyMatrix(t, {
    harness,
    id: "sorsa",
    mayThrow: true,
    secrets: [API_KEY],
    invoke: fetchArticle,
    healthy: (outcome) => {
      const article = outcome.value as { provider: string; sourcePostId: string; title: string; author: { username: string }; fetchedAt: string };
      assert.equal(article.provider, "sorsa");
      assert.equal(article.sourcePostId, "123456789");
      assert.equal(article.title, "A reviewed title");
      assert.equal(article.author.username, "opencoven");
      assert.equal(article.fetchedAt, "2026-11-01T09:00:00.000Z");
    },
    degraded: {
      "http-500": providerError("upstream-unavailable", true),
      "http-502": providerError("upstream-unavailable", true),
      "auth-revoked": providerError("unauthorized", false),
      "rate-limit": providerError("rate-limited", true),
      timeout: providerError("timeout", true),
      network: providerError("upstream-unavailable", true),
      "malformed-json": providerError("invalid-response", true),
      "empty-body": providerError("not-article", false),
      "schema-drift": providerError("invalid-response", true),
    },
  });
});

test("the remaining HTTP verdicts: 403 is unauthorized, 404 is not an article, an oversized body is too large", async () => {
  for (const [anomaly, code, retryable] of [
    [{ kind: "http", status: 403 }, "unauthorized", false],
    [{ kind: "http", status: 404 }, "not-article", false],
    [{ kind: "http", status: 200, body: { full_text: "x" }, headers: { "content-length": String(2 * 1_048_576) } }, "too-large", false],
  ] as const) {
    harness.inject("sorsa", anomaly);
    await assert.rejects(fetchArticle(), (error: unknown) => {
      assert.ok(error instanceof XArticleProviderError);
      assert.equal(error.code, code);
      assert.equal(error.retryable, retryable);
      assert.equal(String(error).includes(API_KEY), false);
      return true;
    });
  }
  harness.heal("sorsa");
  assert.equal((await fetchArticle()).provider, "sorsa");
});

test("every call carries the client's own deadline", () => {
  for (const call of harness.calls("sorsa")) assert.equal(call.hasDeadline, true);
});
