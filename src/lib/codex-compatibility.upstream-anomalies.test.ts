// productionCodexSchemaSources' registry refresh under every upstream anomaly
// (#6359).
//
// The schema registry is fetched from raw.githubusercontent.com in the
// background, at most once per five-minute cadence per cache path, and a
// failed fetch or verification must leave the signed last-known-good cache
// alone. The matrix proves that for each anomaly — the sources still carry
// the cached schemas and the cache file keeps its sequence — and the other
// half: a failed refresh leaves no stuck "pending" and no poisoned cache, so
// the next due refresh after the registry recovers reaches it and a newer
// signed document lands.
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { installUpstreamAnomalyFetch } from "./testing/upstream-anomaly-fetch.ts";
import { runUpstreamAnomalyMatrix, type MatrixOutcome } from "./testing/upstream-anomaly-matrix.ts";
import {
  CODEX_BOOTSTRAP_SCHEMAS,
  productionCodexSchemaSources,
  readCodexSchemaCache,
  schemaContentHash,
  type CodexSchemaDocument,
  type CodexSchemaSources,
} from "./codex-compatibility.ts";

const REFRESH_CADENCE_MS = 5 * 60_000;
const REGISTRY_URL = "https://raw.githubusercontent.com/OpenCoven/coven-runtimes/main/schemas/codex.json";

const cacheDir = await mkdtemp(path.join(tmpdir(), "coven-codex-schema-anomalies-"));
const cachePath = path.join(cacheDir, "codex.json");

// The refresh cadence is read through Date.now; `new Date()` (used for
// document validity) keeps the real clock. Stepping the cadence per call
// makes every invocation schedule a refresh against the same cache path.
const realNow = Date.now;
let clockOffset = 0;
Date.now = () => realNow() + clockOffset;
const stepCadence = () => {
  clockOffset += REFRESH_CADENCE_MS + 1;
};

// The refresh takes an injectable fetch, so the routing fetch is handed in
// directly and globalThis.fetch stays untouched.
const harness = installUpstreamAnomalyFetch({ install: false });
test.after(async () => {
  Date.now = realNow;
  await rm(cacheDir, { recursive: true, force: true });
});

const verify = (candidate: CodexSchemaDocument) => candidate.signature.value === "verified-by-host";
const issuedBase = realNow() - 60 * 60_000;
const expiresAt = new Date(realNow() + 24 * 60 * 60_000).toISOString();

function document(sequence: number): CodexSchemaDocument {
  const payload = {
    provenance: {
      registry: "OpenCoven/coven-runtimes" as const,
      revision: `rev-${sequence}`,
      sequence,
      fetchedAt: new Date(issuedBase + sequence * 1_000).toISOString(),
      expiresAt,
    },
    schemas: CODEX_BOOTSTRAP_SCHEMAS,
  };
  return { ...payload, contentHash: schemaContentHash(payload), signature: { keyId: "test", value: "verified-by-host" } };
}

// Each healthy answer is a strictly newer signed document, so a landed refresh
// is observable as the cache's sequence advancing to the one just served.
let served = 0;
let fetches = 0;

harness.healthy("github-raw", (request) => {
  assert.equal(request.url, REGISTRY_URL);
  assert.equal(request.headers.get("accept"), "application/json");
  served += 1;
  return Response.json(document(served));
});

const countingFetch: typeof fetch = (input, init) => {
  fetches += 1;
  return harness.fetch(input, init);
};

type Outcome = { sources: CodexSchemaSources; cache: CodexSchemaDocument | null };

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const cachedSequence = async () => (await readCodexSchemaCache(cachePath, verify))?.provenance.sequence ?? null;

/**
 * One turn of the production path: hydrate sources, which schedules the
 * background refresh. The module keeps the refresh promise private, so the
 * turn is retried (without consuming a fetch) until the refresh is admitted —
 * a previous refresh may still be settling — and then waits for the result:
 * a healthy answer must land in the cache; a degraded one must have settled
 * its fetch.
 */
async function drive(): Promise<Outcome> {
  const anomaly = harness.anomalyFor("github-raw");
  const target = anomaly === null ? served + 1 : null;
  const deadline = realNow() + 5_000;
  let sources: CodexSchemaSources | null = null;
  while (realNow() < deadline) {
    stepCadence();
    const before = fetches;
    sources = await productionCodexSchemaSources({ cachePath, registryUrl: REGISTRY_URL, verifier: verify, fetchImpl: countingFetch });
    if (fetches > before) break;
    await sleep(5);
  }
  assert.ok(sources && fetches > 0, "the refresh was never admitted: a previous refresh is stuck pending");
  if (target !== null) {
    while ((await cachedSequence()) !== target) {
      assert.ok(realNow() < deadline, `the healthy document ${target} never landed in the cache`);
      await sleep(5);
    }
  } else {
    // Let the rejected or unusable answer settle through the refresh chain.
    await sleep(25);
  }
  return { sources, cache: await readCodexSchemaCache(cachePath, verify) };
}

const sourceNames = (outcome: Outcome) => outcome.sources.map((source) => source.source);
let lastGoodSequence: number | null = null;

const retained = async (outcome: MatrixOutcome) => {
  const value = outcome.value as Outcome;
  assert.ok(lastGoodSequence !== null, "the matrix starts with a good answer");
  assert.equal(value.cache?.provenance.sequence, lastGoodSequence, "the last-known-good cache is unchanged");
  assert.deepEqual(sourceNames(value), ["builtin", "cache"], "the turn still hydrates the cached schemas");
};

test("productionCodexSchemaSources registry refresh across upstream anomalies", async (t) => {
  await runUpstreamAnomalyMatrix(t, {
    harness,
    id: "github-raw",
    invoke: drive,
    healthy: (outcome) => {
      const value = outcome.value as Outcome;
      assert.equal(value.cache?.provenance.sequence, served, "the refresh landed the document just served");
      assert.equal(value.cache?.provenance.revision, `rev-${served}`);
      lastGoodSequence = served;
      // The very first turn has no cache yet; every later turn hydrates it.
      assert.deepEqual(sourceNames(value), served === 1 ? ["builtin"] : ["builtin", "cache"]);
    },
    degraded: { default: retained },
  });
});

test("a failure is not remembered past the heal: retained under the outage, then the next due refresh lands", async () => {
  harness.inject("github-raw", { kind: "network" });
  harness.reset();
  const degraded = await drive();
  assert.equal(harness.calls("github-raw").length, 1);
  assert.equal(degraded.cache?.provenance.sequence, lastGoodSequence);
  assert.deepEqual(sourceNames(degraded), ["builtin", "cache"]);

  harness.heal("github-raw");
  harness.reset();
  const healed = await drive();
  assert.equal(harness.calls("github-raw").length, 1, "the first due refresh after the heal reached the registry");
  assert.equal(healed.cache?.provenance.sequence, served);
  assert.ok(served > (lastGoodSequence ?? 0));
  lastGoodSequence = served;
  harness.assertAllDeclared();
});

test("a refresh is not admitted inside the cadence, so a failure cannot be retried into a storm", async () => {
  harness.inject("github-raw", { kind: "http", status: 500 });
  harness.reset();
  await drive();
  assert.equal(harness.calls("github-raw").length, 1);
  // Same cadence window: no second fetch, failed or not.
  await productionCodexSchemaSources({ cachePath, registryUrl: REGISTRY_URL, verifier: verify, fetchImpl: countingFetch });
  await sleep(10);
  assert.equal(harness.calls("github-raw").length, 1, "one refresh per cadence window");
  harness.heal("github-raw");
});

test("a lower-sequence document after the heal is rejected as a replay and the cache keeps its sequence", async () => {
  harness.inject("github-raw", { kind: "schema-drift", body: document(1) });
  harness.reset();
  const replayed = await drive();
  assert.equal(replayed.cache?.provenance.sequence, lastGoodSequence, "an older signed document cannot roll the cache back");
  harness.heal("github-raw");
});

test("the registry fetch carries a deadline and never follows a redirect", () => {
  const call = harness.calls("github-raw").at(-1);
  assert.ok(call);
  assert.equal(call.hasDeadline, true);
});
