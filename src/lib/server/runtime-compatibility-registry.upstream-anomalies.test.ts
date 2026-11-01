// refreshRuntimeCompatibility under every upstream anomaly (#6359).
//
// The catalog refresh keeps a last-known-good cache on disk and must treat
// every upstream failure as "retain": a null result and a byte-for-byte
// unchanged cache file. The matrix proves that for each anomaly and proves
// the other half — nothing about a failed refresh is remembered, so the
// first refresh after GitHub recovers reaches it and a newer catalog lands.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { installUpstreamAnomalyFetch } from "../testing/upstream-anomaly-fetch.ts";
import { runUpstreamAnomalyMatrix, type MatrixOutcome } from "../testing/upstream-anomaly-matrix.ts";
import {
  refreshRuntimeCompatibility,
  resolveRuntimeCompatibility,
  type RuntimeCompatibilitySnapshot,
} from "./runtime-compatibility-registry.ts";

const root = await mkdtemp(path.join(tmpdir(), "coven-runtime-compatibility-anomalies-"));
const cachePath = path.join(root, "copilot.json");
const at = new Date("2026-07-24T12:00:00.000Z");

// The refresh takes an injectable fetch, so the routing fetch is handed in
// directly and globalThis.fetch stays untouched.
const harness = installUpstreamAnomalyFetch({ install: false });
test.after(() => rm(root, { recursive: true, force: true }));

function index(version: string): string {
  return JSON.stringify({
    format: "1",
    runtimes: {
      copilot: [{ version, adapter: { id: "copilot", executable: "ignored", event_protocols: [] } }],
    },
  });
}

function blobSha(raw: string): string {
  return createHash("sha1").update(`blob ${Buffer.byteLength(raw)}\0`).update(raw).digest("hex");
}

let servingVersion = "2.0.0";

harness.healthy("github", (request) => {
  const url = new URL(request.url);
  assert.equal(url.pathname, "/repos/OpenCoven/coven-runtimes/contents/crates/coven-runtime-registry/canonical/index.json");
  assert.equal(url.searchParams.get("ref"), "main");
  assert.equal(request.headers.get("authorization"), null, "the catalog is public: no credential is attached");
  const raw = index(servingVersion);
  return Response.json({ encoding: "base64", content: Buffer.from(raw).toString("base64"), sha: blobSha(raw) });
});

const refresh = () => refreshRuntimeCompatibility("copilot", { cachePath, fetchImpl: harness.fetch, now: at, ttlMs: 60_000 });

const cacheText = () => readFile(cachePath, "utf8");
let lastGoodCache = "";

const retained = async (outcome: MatrixOutcome) => {
  assert.equal(outcome.value, null, "a failed refresh answers null");
  assert.equal(await cacheText(), lastGoodCache, "the last-known-good cache file is unchanged");
};

test("refreshRuntimeCompatibility across upstream anomalies", async (t) => {
  await runUpstreamAnomalyMatrix(t, {
    harness,
    id: "github",
    invoke: refresh,
    healthy: async (outcome) => {
      const snapshot = outcome.value as RuntimeCompatibilitySnapshot | null;
      assert.ok(snapshot, outcome.text);
      assert.equal(snapshot.runtimeVersion, servingVersion);
      assert.equal(snapshot.source.blobSha, blobSha(index(servingVersion)));
      assert.deepEqual(snapshot.eventProtocols, []);
      lastGoodCache = await cacheText();
      assert.equal(JSON.parse(lastGoodCache).runtimeVersion, servingVersion, "the healthy answer is what the cache holds");
    },
    degraded: { default: retained },
  });
});

test("a failure is not remembered past the heal: retain under the outage, then the next refresh lands a newer catalog", async () => {
  harness.inject("github", { kind: "http", status: 503, body: "<html>unavailable</html>", headers: { "content-type": "text/html" } });
  harness.reset();
  assert.equal(await refresh(), null);
  assert.equal(harness.calls("github").length, 1);
  assert.equal(await cacheText(), lastGoodCache);

  servingVersion = "3.0.0";
  harness.heal("github");
  harness.reset();
  const healed = await refresh();
  assert.equal(healed?.runtimeVersion, "3.0.0", "the first refresh after the heal reached GitHub and replaced the cache");
  assert.equal(harness.calls("github").length, 1);
  assert.equal(JSON.parse(await cacheText()).runtimeVersion, "3.0.0");
  lastGoodCache = await cacheText();
});

test("resolveRuntimeCompatibility serves a fresh last-known-good cache during an outage without a call", async () => {
  harness.inject("github", { kind: "network" });
  harness.reset();
  const resolved = await resolveRuntimeCompatibility("copilot", { cachePath, fetchImpl: harness.fetch, now: new Date(at.getTime() + 1_000) });
  assert.equal(resolved?.runtimeVersion, "3.0.0");
  assert.equal(harness.calls("github").length, 0, "a fresh cache answers without touching the upstream");

  // Past the cache expiry the resolver must go upstream, and the outage is then
  // null (the caller falls back to its checked-in baseline), not a stale answer.
  const expired = await resolveRuntimeCompatibility("copilot", { cachePath, fetchImpl: harness.fetch, now: new Date(at.getTime() + 61_000) });
  assert.equal(expired, null);
  assert.equal(harness.calls("github").length, 1);
  assert.equal(await cacheText(), lastGoodCache, "an expired cache is still not overwritten by a failure");

  harness.heal("github");
  harness.reset();
  const renewed = await resolveRuntimeCompatibility("copilot", { cachePath, fetchImpl: harness.fetch, now: new Date(at.getTime() + 61_000), ttlMs: 60_000 });
  assert.equal(renewed?.runtimeVersion, "3.0.0", "the same blob renews its expiry once GitHub is back");
  assert.equal(harness.calls("github").length, 1);
  assert.equal(renewed?.expiresAt, new Date(at.getTime() + 121_000).toISOString());
  harness.assertAllDeclared();
});

test("the catalog fetch carries a deadline", () => {
  const call = harness.calls("github").at(-1);
  assert.ok(call);
  assert.equal(call.hasDeadline, true);
});
