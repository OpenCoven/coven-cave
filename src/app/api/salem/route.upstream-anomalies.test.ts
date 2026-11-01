// /api/salem under every upstream anomaly (#6359).
//
// Two upstreams behind one registry entry: the hosted retrieval API
// (salem.opencoven.ai, asked first for docs context, then for a streamed
// answer) and the llms-full.txt corpus (docs.opencoven.ai, the local
// token-overlap fallback with a module-level hourly cache). The asks here
// carry no familiarId, so the local-familiar synthesis hop — a loopback call
// to /api/chat/generate/enhance that needs a running daemon — is never
// reached; the matrix drives the hosted-context → hosted-answer → local
// retrieval chain only.
//
// The corpus cache is the self-healing half: a failed fetch must not become
// the cache. Before #6359 a 200 with an empty or torn body was parsed to zero
// chunks and held for the hour, so every ask answered "the docs fetch failed"
// long after docs.opencoven.ai recovered; the route now treats an empty
// corpus as a failed fetch.
import assert from "node:assert/strict";
import test from "node:test";

import { installUpstreamAnomalyFetch } from "../../../lib/testing/upstream-anomaly-fetch.ts";
import { runUpstreamAnomalyMatrix, type MatrixOutcome } from "../../../lib/testing/upstream-anomaly-matrix.ts";

const CACHE_TTL_MS = 60 * 60 * 1000;
let now = Date.UTC(2026, 10, 1, 9);
const realNow = Date.now;
Date.now = () => now;

const harness = installUpstreamAnomalyFetch();
const { GET, POST } = await import("./route.ts");
test.after(() => {
  harness.restore();
  Date.now = realNow;
});

const CONTEXT = "Permissions are granted per familiar in Familiar Studio → Brain.";
const CORPUS = [
  "Source: https://docs.opencoven.ai/permissions",
  "# Permissions",
  "Permissions are granted per familiar. A read permission mode never writes.",
  "",
  "Source: https://docs.opencoven.ai/familiars",
  "# Familiars",
  "A familiar is a configured agent with a model, skills and a workspace.",
].join("\n");

harness.healthy("opencoven-docs", async (request) => {
  const url = new URL(request.url);
  if (url.host === "salem.opencoven.ai" && url.pathname === "/api/chat") {
    const body = JSON.parse(await request.text()) as { message: string; mode?: string };
    if (body.mode === "context") return Response.json({ mode: "context", context: CONTEXT, results: [] });
    return new Response("Hosted streamed answer.", { status: 200, headers: { "content-type": "text/plain" } });
  }
  if (url.host === "docs.opencoven.ai" && url.pathname === "/llms-full.txt") {
    return new Response(CORPUS, { status: 200, headers: { "content-type": "text/plain" } });
  }
  return new Response("Not Found", { status: 404 });
});

const stepPastCorpusCache = () => {
  now += CACHE_TTL_MS + 1;
};

const ask = () =>
  POST(
    new Request("http://localhost/api/salem", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "How do permissions work?" }),
    }),
  );

type AskBody = { reply: string; source: string; localContextUsed?: boolean; error?: string };
type StatusBody = { docsStatus: { loaded: boolean; chunkCount: number; fetchedAt: string | null; error: string | null; source: string } };

const hostedContext = (outcome: MatrixOutcome) => {
  assert.equal(outcome.status, 200, outcome.text);
  const body = outcome.body as AskBody;
  assert.equal(body.source, "chat-api-context");
  assert.equal(body.reply, CONTEXT);
  assert.equal(body.localContextUsed, false);
};

/** Every hop failed: the route still answers 200 with a reply that points at the docs site. */
const everyHopFailed = (outcome: MatrixOutcome) => {
  assert.equal(outcome.status, 200, "an upstream outage is never a 500 to the Ask Salem panel");
  const body = outcome.body as AskBody;
  assert.equal(body.source, "error");
  assert.match(body.reply, /docs fetch failed/);
  assert.match(body.reply, /docs\.opencoven\.ai/);
  assert.equal(body.error, undefined);
};

/** The hosted answer hop streams any 200 body verbatim: a torn JSON body becomes the reply. */
const hostedAnswerVerbatim = (outcome: MatrixOutcome) => {
  assert.equal(outcome.status, 200);
  const body = outcome.body as AskBody;
  assert.equal(body.source, "chat-api", "a 2xx that is not context mode falls through to the streamed-answer hop");
  assert.ok(body.reply.length > 0);
};

test("POST /api/salem across upstream anomalies (no familiar: hosted context → hosted answer → local retrieval)", async (t) => {
  await runUpstreamAnomalyMatrix(t, {
    harness,
    id: "opencoven-docs",
    beforeEach: stepPastCorpusCache,
    invoke: ask,
    healthy: hostedContext,
    degraded: {
      "http-500": (outcome) => {
        everyHopFailed(outcome);
        assert.match((outcome.body as AskBody).reply, /HTTP 500/);
        assert.equal(harness.calls("opencoven-docs").length, 3, "context, answer, then the corpus: every hop was tried");
      },
      "http-502": everyHopFailed,
      "auth-revoked": everyHopFailed,
      "rate-limit": everyHopFailed,
      timeout: everyHopFailed,
      network: everyHopFailed,
      "malformed-json": hostedAnswerVerbatim,
      "empty-body": (outcome) => {
        everyHopFailed(outcome);
        assert.match((outcome.body as AskBody).reply, /empty corpus/);
      },
      "schema-drift": hostedAnswerVerbatim,
    },
  });
});

test("the corpus cache is not poisoned by a 200 with no corpus in it", async () => {
  // No corpus has been cached yet: the asks above never reached a healthy
  // docs fetch. An empty 200 must leave it that way, so the first GET after
  // docs.opencoven.ai heals goes upstream without waiting out the hour.
  harness.inject("opencoven-docs", { kind: "empty-body" });
  harness.reset();
  const poisoned = (await (await GET()).json()) as StatusBody;
  assert.equal(poisoned.docsStatus.loaded, false);
  assert.equal(poisoned.docsStatus.chunkCount, 0);
  assert.equal(poisoned.docsStatus.error, "empty corpus");
  assert.equal(poisoned.docsStatus.fetchedAt, null, "a failed fetch does not stamp the cache");
  assert.equal(harness.calls("opencoven-docs").length, 1);

  harness.heal("opencoven-docs");
  harness.reset();
  const healed = (await (await GET()).json()) as StatusBody;
  assert.equal(harness.calls("opencoven-docs").length, 1, "no clock step: the empty corpus was not cached, so the healed GET went upstream");
  assert.equal(healed.docsStatus.loaded, true);
  assert.equal(healed.docsStatus.chunkCount, 2);
  assert.equal(healed.docsStatus.error, null);

  harness.reset();
  await GET();
  assert.equal(harness.calls("opencoven-docs").length, 0, "the real corpus is then held for the hour");
});

const corpusLoaded = (outcome: MatrixOutcome) => {
  assert.equal(outcome.status, 200, outcome.text);
  const { docsStatus } = outcome.body as StatusBody;
  assert.equal(docsStatus.loaded, true);
  assert.equal(docsStatus.chunkCount, 2);
  assert.equal(docsStatus.error, null);
  assert.equal(docsStatus.source, "https://docs.opencoven.ai/llms-full.txt");
};

/** The hourly refresh failed: the stale corpus is still served, with the error named. */
const staleCorpusWithError = (outcome: MatrixOutcome) => {
  assert.equal(outcome.status, 200);
  const { docsStatus } = outcome.body as StatusBody;
  assert.equal(docsStatus.loaded, true, "a failed refresh keeps the last good corpus");
  assert.equal(docsStatus.chunkCount, 2);
  assert.equal(typeof docsStatus.error, "string", "the degraded status says why");
};

test("GET /api/salem across upstream anomalies (corpus refresh)", async (t) => {
  await runUpstreamAnomalyMatrix(t, {
    harness,
    id: "opencoven-docs",
    beforeEach: stepPastCorpusCache,
    invoke: () => GET(),
    healthy: corpusLoaded,
    degraded: {
      default: staleCorpusWithError,
      "empty-body": (outcome) => {
        staleCorpusWithError(outcome);
        assert.equal((outcome.body as StatusBody).docsStatus.error, "empty corpus");
      },
      "malformed-json": (outcome) => {
        staleCorpusWithError(outcome);
        assert.equal((outcome.body as StatusBody).docsStatus.error, "empty corpus");
      },
    },
  });
});

test("a failed hourly refresh is retried on the next call, not remembered for another hour", async () => {
  stepPastCorpusCache();
  harness.inject("opencoven-docs", { kind: "http", status: 503 });
  harness.reset();
  const stale = (await (await GET()).json()) as StatusBody;
  assert.equal(stale.docsStatus.error, "HTTP 503");
  assert.equal(stale.docsStatus.loaded, true);
  assert.equal(harness.calls("opencoven-docs").length, 1);

  harness.heal("opencoven-docs");
  harness.reset();
  const healed = (await (await GET()).json()) as StatusBody;
  assert.equal(harness.calls("opencoven-docs").length, 1, "no clock step: the failed refresh did not restamp the cache");
  assert.equal(healed.docsStatus.error, null);
});

test("with the hosted API down, a local retrieval answer is grounded in the cached corpus", async () => {
  // The corpus cache is fresh (stamped by the last healed GET). The network
  // fault covers both hosts, but the fresh cache answers without a fetch, so
  // the chain lands on local retrieval rather than the error reply — the
  // fallback the route promises.
  harness.inject("opencoven-docs", { kind: "network" });
  harness.reset();
  const body = (await (await ask()).json()) as AskBody & { context?: Array<{ heading: string }>; fetchError: string | null };
  assert.equal(body.source, "retrieval");
  assert.match(body.reply, /\*\*Permissions\*\*/);
  assert.equal(body.fetchError, null);
  assert.equal(harness.calls("opencoven-docs").filter((call) => call.host === "docs.opencoven.ai").length, 0, "a fresh corpus answers without a fetch");
  harness.heal("opencoven-docs");
});

test("every upstream call carries a deadline", () => {
  for (const call of harness.calls()) assert.equal(call.hasDeadline, true, call.url);
});
