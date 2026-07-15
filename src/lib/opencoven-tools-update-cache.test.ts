import assert from "node:assert/strict";
import { test } from "node:test";
import {
  OPEN_COVEN_TOOLS,
  composeOpenCovenToolStatus,
  type NpmLatestCheck,
} from "./opencoven-tools-status.ts";
import { createOpenCovenToolUpdateCache } from "./opencoven-tools-update-cache.ts";

const probe = {
  path: "/tools/coven",
  executablePath: "/tools/node_modules/@opencoven/cli/bin/coven.js",
  executableVerified: true,
  version: "0.1.1",
  packageName: "@opencoven/cli",
  packagePath: "/tools/node_modules/@opencoven/cli",
} as const;

function tools(latestCheck: NpmLatestCheck) {
  return [composeOpenCovenToolStatus(OPEN_COVEN_TOOLS[0], probe, latestCheck)];
}

function verified(checkedAt: string, latest = "0.1.1") {
  return tools({ status: "verified", checkedAt, latest });
}

function failed(checkedAt: string, error: "timeout" | "registry_error" | "malformed_version") {
  return tools({ status: "failed", checkedAt, error });
}

test("fresh GETs use the TTL while stale GETs return immediately and revalidate", async () => {
  let now = 0;
  let calls = 0;
  const cache = createOpenCovenToolUpdateCache({
    now: () => now,
    ttlMs: 100,
    load: async () => verified(`2026-07-15T22:00:0${++calls}.000Z`),
  });

  const cold = await cache.get();
  assert.equal(cold.freshness, "fresh");
  assert.equal(calls, 1);
  assert.equal((await cache.get()).refreshing, false);
  assert.equal(calls, 1, "fresh GET does not query npm again");

  now = 101;
  const stale = await cache.get();
  assert.equal(stale.freshness, "stale");
  assert.equal(stale.refreshing, true);
  assert.equal(stale.checkedAt, cold.checkedAt, "SWR returns the prior value immediately");

  const refreshed = await cache.force();
  assert.equal(calls, 2, "the forced request joins the SWR lookup already in flight");
  assert.equal(refreshed.freshness, "fresh");
  assert.notEqual(refreshed.checkedAt, cold.checkedAt);
});

test("manual force bypasses a fresh cache and receives a new checkedAt", async () => {
  let calls = 0;
  const cache = createOpenCovenToolUpdateCache({
    load: async () => verified(`2026-07-15T22:01:0${++calls}.000Z`),
  });
  const first = await cache.get();
  const forced = await cache.force();
  assert.equal(calls, 2);
  assert.notEqual(forced.checkedAt, first.checkedAt);
});

test("concurrent automatic and forced checks share one in-flight lookup", async () => {
  let calls = 0;
  let release!: (value: ReturnType<typeof verified>) => void;
  const pending = new Promise<ReturnType<typeof verified>>((resolve) => {
    release = resolve;
  });
  const cache = createOpenCovenToolUpdateCache({
    load: async () => {
      calls += 1;
      return pending;
    },
  });

  const automatic = cache.get();
  const forced = cache.force();
  assert.equal(calls, 1);
  release(verified("2026-07-15T22:02:00.000Z"));
  assert.deepEqual(await forced, await automatic);
  assert.equal(calls, 1);
});

test("failed refresh retains the last successful result as stale", async () => {
  let calls = 0;
  const cache = createOpenCovenToolUpdateCache({
    load: async () =>
      ++calls === 1
        ? verified("2026-07-15T22:03:00.000Z")
        : failed("2026-07-15T22:04:00.000Z", "timeout"),
  });
  const first = await cache.get();
  const fallback = await cache.force();
  assert.equal(fallback.freshness, "stale");
  assert.equal(fallback.stale, true);
  assert.equal(fallback.error, "timeout");
  assert.equal(fallback.checkedAt, first.checkedAt);
  assert.deepEqual(fallback.tools, first.tools);
});

test("cold timeout, registry, and malformed failures return bounded unavailable states", async () => {
  for (const error of ["timeout", "registry_error", "malformed_version"] as const) {
    const cache = createOpenCovenToolUpdateCache({
      load: async () => failed("2026-07-15T22:05:00.000Z", error),
    });
    const snapshot = await cache.get();
    assert.equal(snapshot.freshness, "unavailable");
    assert.equal(snapshot.error, error);
    assert.equal(snapshot.stale, false);
  }
});

test("automatic GET caches an unavailable result while manual force still retries", async () => {
  let calls = 0;
  const cache = createOpenCovenToolUpdateCache({
    load: async () => {
      calls += 1;
      return failed(`2026-07-15T22:05:0${calls}.000Z`, "registry_error");
    },
  });
  const cold = await cache.get();
  const cached = await cache.get();
  assert.equal(calls, 1);
  assert.equal(cached.checkedAt, cold.checkedAt);

  const forced = await cache.force();
  assert.equal(calls, 2);
  assert.notEqual(forced.checkedAt, cold.checkedAt);
});

test("invalidation makes the next GET authoritative again", async () => {
  let calls = 0;
  const cache = createOpenCovenToolUpdateCache({
    load: async () => verified(`2026-07-15T22:06:0${++calls}.000Z`),
  });
  await cache.get();
  cache.invalidate();
  const refreshed = await cache.get();
  assert.equal(calls, 2);
  assert.equal(refreshed.checkedAt, "2026-07-15T22:06:02.000Z");
});

test("invalidation prevents a pre-install in-flight check from repopulating the cache", async () => {
  let calls = 0;
  let releaseOld!: (value: ReturnType<typeof verified>) => void;
  const old = new Promise<ReturnType<typeof verified>>((resolve) => {
    releaseOld = resolve;
  });
  const cache = createOpenCovenToolUpdateCache({
    load: async () => {
      calls += 1;
      return calls === 1 ? old : verified("2026-07-15T22:07:02.000Z");
    },
  });

  const preInstall = cache.get();
  cache.invalidate();
  const postInstall = await cache.force();
  releaseOld(verified("2026-07-15T22:07:01.000Z"));
  await preInstall;

  assert.equal(calls, 2, "post-install refresh does not join an obsolete lookup");
  assert.equal(postInstall.checkedAt, "2026-07-15T22:07:02.000Z");
  assert.equal((await cache.get()).checkedAt, postInstall.checkedAt);
});
