import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  refreshRuntimeCompatibility,
  resolveRuntimeCompatibility,
  validateRuntimeCompatibilitySnapshot,
} from "./runtime-compatibility-registry.ts";

const root = await mkdtemp(path.join(tmpdir(), "coven-runtime-compatibility-"));
const cachePath = path.join(root, "copilot.json");
const at = new Date("2026-07-24T12:00:00.000Z");

function index(version: string, eventProtocols: unknown[] = []) {
  return indexEntries([{ version, eventProtocols }]);
}

function indexEntries(entries: Array<{ version: string; eventProtocols?: unknown[] }>) {
  return JSON.stringify({
    format: "1",
    runtimes: {
      copilot: entries.map(({ version, eventProtocols = [] }) => ({
        version,
        adapter: {
          id: "copilot",
          // Launch fields are intentionally irrelevant to the cache contract.
          executable: "malicious-launcher",
          stream_args: { prefix_args: ["--allow-all"] },
          event_protocols: eventProtocols,
        },
      })),
    },
  });
}

function response(raw: string, sha?: string): Response {
  const blobSha = sha ?? createHash("sha1").update(`blob ${Buffer.byteLength(raw)}\0`).update(raw).digest("hex");
  return new Response(JSON.stringify({ encoding: "base64", content: Buffer.from(raw).toString("base64"), sha: blobSha }), { status: 200 });
}

try {
  const first = await refreshRuntimeCompatibility("copilot", {
    cachePath,
    now: at,
    ttlMs: 60_000,
    fetchImpl: async () => response(index("2.0.0")),
  });
  assert.equal(first?.runtimeVersion, "2.0.0", "the canonical accepted protocol metadata is cached");
  assert.deepEqual(first?.eventProtocols, [], "the cache excludes executable and argv launch configuration");
  assert.ok(first && validateRuntimeCompatibilitySnapshot(first, at), "cache has an integrity hash and expiry");

  const coalescedCachePath = path.join(root, "coalesced.json");
  let refreshFetches = 0;
  const sharedFetch = async () => {
    refreshFetches += 1;
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
    return response(index("2.0.0"));
  };
  const [coalescedFirst, coalescedSecond] = await Promise.all([
    refreshRuntimeCompatibility("copilot", { cachePath: coalescedCachePath, now: at, fetchImpl: sharedFetch }),
    refreshRuntimeCompatibility("copilot", { cachePath: coalescedCachePath, now: at, fetchImpl: sharedFetch }),
  ]);
  assert.equal(refreshFetches, 1, "concurrent refresh callers share one canonical registry request");
  assert.equal(coalescedFirst?.runtimeVersion, "2.0.0");
  assert.equal(coalescedSecond?.runtimeVersion, "2.0.0");

  const offline = await resolveRuntimeCompatibility("copilot", {
    cachePath,
    now: new Date(at.getTime() + 1_000),
    fetchImpl: async () => { throw new Error("offline"); },
  });
  assert.equal(offline?.source.blobSha, first?.source.blobSha, "fresh last-known-good cache works offline");

  const rollback = await refreshRuntimeCompatibility("copilot", {
    cachePath,
    now: new Date(at.getTime() + 2_000),
    fetchImpl: async () => response(index("1.0.0")),
  });
  assert.equal(rollback, null, "a lower registry runtime version cannot roll back cached compatibility");
  assert.equal(JSON.parse(await readFile(cachePath, "utf8")).runtimeVersion, "2.0.0");

  const prerelease = await refreshRuntimeCompatibility("copilot", {
    cachePath,
    now: new Date(at.getTime() + 2_500),
    fetchImpl: async () => response(index("2.0.0-rc.1")),
  });
  assert.equal(prerelease, null, "a prerelease cannot replace the corresponding stable cached version");

  const sameVersionChanged = await refreshRuntimeCompatibility("copilot", {
    cachePath,
    now: new Date(at.getTime() + 2_750),
    fetchImpl: async () => response(index("2.0.0", [{ id: "different-schema" }])),
  });
  assert.equal(sameVersionChanged, null, "different content at the same runtime version cannot replace LKG");

  const [higher, lower] = await Promise.all([
    refreshRuntimeCompatibility("copilot", {
      cachePath,
      now: new Date(at.getTime() + 3_000),
      fetchImpl: async () => response(index("3.0.0")),
    }),
    refreshRuntimeCompatibility("copilot", {
      cachePath,
      now: new Date(at.getTime() + 3_000),
      fetchImpl: async () => response(index("2.5.0")),
    }),
  ]);
  assert.ok(higher?.runtimeVersion === "3.0.0" || lower?.runtimeVersion === "3.0.0");
  assert.equal(JSON.parse(await readFile(cachePath, "utf8")).runtimeVersion, "3.0.0", "concurrent refreshes cannot downgrade LKG");

  const semverCachePath = path.join(root, "semver-order.json");
  const semverOrder = await refreshRuntimeCompatibility("copilot", {
    cachePath: semverCachePath,
    now: new Date(at.getTime() + 3_250),
    fetchImpl: async () => response(indexEntries([{ version: "1.0.0-a" }, { version: "1.0.0-B" }])),
  });
  assert.equal(semverOrder?.runtimeVersion, "1.0.0-a", "ASCII SemVer ordering selects a above B regardless of locale");

  const protocolUnion = await refreshRuntimeCompatibility("copilot", {
    cachePath: path.join(root, "protocol-union.json"),
    now: new Date(at.getTime() + 3_400),
    fetchImpl: async () => response(indexEntries([
      { version: "1.5.0", eventProtocols: [{ id: "copilot-jsonl-v1" }] },
      { version: "2.0.0", eventProtocols: [{ id: "copilot-jsonl-v2" }] },
    ])),
  });
  assert.equal(protocolUnion?.runtimeVersion, "2.0.0", "the highest accepted revision remains the rollback version");
  assert.deepEqual(
    protocolUnion?.eventProtocols,
    [{ id: "copilot-jsonl-v1" }, { id: "copilot-jsonl-v2" }],
    "schemas from every accepted registry revision remain available for client-version selection",
  );

  const staleLockPath = `${cachePath}.lock`;
  await writeFile(staleLockPath, "interrupted refresh", "utf8");
  const staleAt = new Date(Date.now() - 31_000);
  await utimes(staleLockPath, staleAt, staleAt);
  const [reclaimedLower, reclaimedHigher] = await Promise.all([
    refreshRuntimeCompatibility("copilot", {
      cachePath,
      now: new Date(at.getTime() + 3_500),
      fetchImpl: async () => response(index("4.0.0")),
    }),
    refreshRuntimeCompatibility("copilot", {
      cachePath,
      now: new Date(at.getTime() + 3_500),
      fetchImpl: async () => response(index("5.0.0")),
    }),
  ]);
  assert.ok(reclaimedLower?.runtimeVersion === "5.0.0" || reclaimedHigher?.runtimeVersion === "5.0.0", "a stale lock is reclaimed by exactly one owner");
  assert.equal(JSON.parse(await readFile(cachePath, "utf8")).runtimeVersion, "5.0.0", "concurrent stale-lock recovery preserves monotonic cache updates");

  const corrupt = await refreshRuntimeCompatibility("copilot", {
    cachePath,
    now: new Date(at.getTime() + 3_000),
    fetchImpl: async () => response(index("3.0.0"), "0".repeat(40)),
  });
  assert.equal(corrupt, null, "a mismatched Git blob hash is rejected before parsing");
  assert.equal(JSON.parse(await readFile(cachePath, "utf8")).runtimeVersion, "5.0.0", "failed refresh preserves last-known-good data");

  const expired = await resolveRuntimeCompatibility("copilot", {
    cachePath,
    now: new Date(at.getTime() + 24 * 60 * 60_000 + 4_000),
    fetchImpl: async () => { throw new Error("offline"); },
  });
  assert.equal(expired, null, "expired cache is not selected when refresh is unavailable");
} finally {
  await rm(root, { recursive: true, force: true });
}

console.log("runtime-compatibility-registry: ok");
