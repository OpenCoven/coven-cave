// @ts-nocheck
/**
 * Tests for src/lib/server/sessions-list-cache.ts (cave-53yx): the shared
 * SWR cache behind /api/sessions/list and its mutation invalidation hook.
 *
 * Part 1 — behavior: invalidateSessionsListCache() actually busts a fresh
 * entry so the next get recomputes.
 *
 * Part 2 — wiring pins: the list route uses the shared cache (not a private
 * one), every user-facing session mutator busts the cache after its write,
 * and the sweep-internal batch archivers deliberately do NOT (they run inside
 * the list compute; invalidating there would version-bump the entry away and
 * leave the cache permanently cold).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createSwrCache } from "../swr-cache.ts";
import {
  invalidateSessionsListCache,
  loadCachedSessionsList,
  sessionsListCacheKey,
  sessionsListCache,
} from "./sessions-list-cache.ts";

// ── behavior: invalidation forces a recompute ────────────────────────────────
{
  const result = (tag) => ({ payload: { ok: true, sessions: [], error: tag } });
  let computes = 0;
  const compute = (tag) => async () => {
    computes++;
    return result(tag);
  };

  const first = await sessionsListCache.get("test:cave-53yx", compute("v1"));
  assert.equal(first.payload.error, "v1", "cold get awaits the compute");
  assert.equal(computes, 1);

  const cached = await sessionsListCache.get("test:cave-53yx", compute("v2"));
  assert.equal(cached.payload.error, "v1", "fresh get is served from cache");
  assert.equal(computes, 1, "fresh get does not recompute");

  invalidateSessionsListCache();

  const recomputed = await sessionsListCache.get("test:cave-53yx", compute("v3"));
  assert.equal(
    recomputed.payload.error,
    "v3",
    "get after invalidateSessionsListCache() recomputes instead of serving the stale entry",
  );
  assert.equal(computes, 2);

  invalidateSessionsListCache(); // leave no test entry behind
}

// ── shared cached reader: route + dashboard reuse one cache contract ────────
{
  let now = 0;
  let computes = 0;
  const cache = createSwrCache({
    ttlMs: 2_000,
    staleServeMs: 30_000,
    canServeStale: (result) => result.payload.ok,
    now: () => now,
  });
  const compute = async (
    includeArchived,
    familiarId,
    collapseFamiliarWorkspace,
  ) => ({
    payload: {
      ok: true,
      sessions: [],
      error: `${++computes}:${includeArchived}:${familiarId}:${collapseFamiliarWorkspace}`,
    },
  });

  const first = await loadCachedSessionsList(false, "sage", false, {
    cache,
    compute,
  });
  const cached = await loadCachedSessionsList(false, "sage", false, {
    cache,
    compute,
  });
  assert.equal(first.payload.error, "1:false:sage:false");
  assert.equal(cached.payload.error, first.payload.error);
  assert.equal(computes, 1, "repeat reads of the same dashboard scope share the cache");

  cache.invalidate(sessionsListCacheKey(false, "sage", false));
  const invalidated = await loadCachedSessionsList(false, "sage", false, {
    cache,
    compute,
  });
  assert.equal(invalidated.payload.error, "2:false:sage:false");
  assert.equal(computes, 2, "an invalidated scope recomputes");

  now = 30_001;
  const expired = await loadCachedSessionsList(false, "sage", false, {
    cache,
    compute,
  });
  assert.equal(expired.payload.error, "3:false:sage:false");
  assert.equal(computes, 3, "an expired scope recomputes");

  const distinctScope = await loadCachedSessionsList(false, "sage", true, {
    cache,
    compute,
  });
  assert.equal(distinctScope.payload.error, "4:false:sage:true");
  assert.equal(computes, 4, "collapse mode remains part of the shared cache key");
}

// ── keying: unscoped null and the valid Familiar id "all" never alias ──────
{
  assert.notEqual(
    sessionsListCacheKey(false, null, false),
    sessionsListCacheKey(false, "all", false),
    "the cache key structurally distinguishes the unscoped null view from the valid Familiar id \"all\"",
  );

  let computes = 0;
  const cache = createSwrCache({
    ttlMs: 2_000,
    staleServeMs: 30_000,
    canServeStale: (result) => result.payload.ok,
  });
  const compute = async (
    includeArchived,
    familiarId,
    collapseFamiliarWorkspace,
  ) => ({
    payload: {
      ok: true,
      sessions: [],
      error: JSON.stringify({
        compute: ++computes,
        includeArchived,
        familiarId,
        collapseFamiliarWorkspace,
      }),
    },
  });

  const unscoped = await loadCachedSessionsList(false, null, false, {
    cache,
    compute,
  });
  const validAll = await loadCachedSessionsList(false, "all", false, {
    cache,
    compute,
  });
  const unscopedCached = await loadCachedSessionsList(false, null, false, {
    cache,
    compute,
  });
  const validAllCached = await loadCachedSessionsList(false, "all", false, {
    cache,
    compute,
  });

  assert.equal(
    unscoped.payload.error,
    JSON.stringify({
      compute: 1,
      includeArchived: false,
      familiarId: null,
      collapseFamiliarWorkspace: false,
    }),
  );
  assert.equal(
    validAll.payload.error,
    JSON.stringify({
      compute: 2,
      includeArchived: false,
      familiarId: "all",
      collapseFamiliarWorkspace: false,
    }),
  );
  assert.equal(
    unscopedCached.payload.error,
    unscoped.payload.error,
    "re-reading the unscoped view keeps its own cached payload",
  );
  assert.equal(
    validAllCached.payload.error,
    validAll.payload.error,
    "re-reading the valid Familiar id \"all\" keeps its own cached payload",
  );
  assert.notEqual(
    unscopedCached.payload.error,
    validAllCached.payload.error,
    "the unscoped and valid-\"all\" cached payloads cannot alias",
  );
}

// ── wiring pins ──────────────────────────────────────────────────────────────
const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

/** Source of one `export async function <name>` block (up to the next export). */
function fnBlock(source, name) {
  const start = source.indexOf(`export async function ${name}`);
  assert.notEqual(start, -1, `found export async function ${name}`);
  const next = source.indexOf("\nexport ", start + 1);
  return next === -1 ? source.slice(start) : source.slice(start, next);
}

// The list route consumes the shared cache and delegates the cached compute.
{
  const route = read("../../app/api/sessions/list/route.ts");
  assert.match(
    route,
    /loadCachedSessionsList/,
    "the list route delegates reads through the shared cached reader",
  );
  assert.match(
    route,
    /loadCachedSessionsList\(\s*includeArchived,\s*familiarId,\s*collapseFamiliarWorkspace,\s*\)/,
    "the route reuses the shared cache wrapper instead of duplicating cache logic",
  );
}

// Every user-facing session mutator busts the cache after its state write…
{
  const config = read("../cave-config.ts");
  for (const mutator of [
    "recordOwnedSession",
    "recordSessionFamiliar",
    "setSessionTitle",
    "archiveSessionLocal",
    "summonSessionLocal",
    "setSessionKeepLocal",
    "extendSessionAutoArchiveLocal",
    "sacrificeSessionLocal",
    "autoArchiveReflectedSessionLocal",
  ]) {
    assert.match(
      fnBlock(config, mutator),
      /invalidateSessionsListCache\(\)/,
      `${mutator} invalidates the sessions-list cache`,
    );
  }

  // …but the sweep-internal batch archivers must NOT: they run inside the
  // list compute and would leave the cache permanently cold.
  for (const sweep of ["autoArchiveSessionsLocal", "archiveSessionsForMergedPrs"]) {
    assert.doesNotMatch(
      fnBlock(config, sweep),
      /invalidateSessionsListCache\(\)/,
      `${sweep} is sweep-internal and must not invalidate mid-compute`,
    );
  }
}

// Conversation writes/deletes surface new & removed local chat rows.
{
  const conversations = read("../cave-conversations.ts");
  for (const mutator of ["saveConversation", "deleteConversation"]) {
    assert.match(
      fnBlock(conversations, mutator),
      /invalidateSessionsListCache\(\)/,
      `${mutator} invalidates the sessions-list cache`,
    );
  }
}

// Daemon-side mutations without a local-state mutator invalidate in-route.
{
  assert.match(
    read("../../app/api/sessions/[id]/kill/route.ts"),
    /invalidateSessionsListCache\(\)/,
    "the kill route invalidates the sessions-list cache after a successful kill",
  );
  const prune = read("../../app/api/sessions/prune/route.ts");
  assert.match(
    prune,
    /if \(!dryRun && native\.data\.pruned > 0\) invalidateSessionsListCache\(\)/,
    "the daemon prune path invalidates only when sessions were actually pruned",
  );
  assert.match(
    prune,
    /if \(candidates\.length > 0\) invalidateSessionsListCache\(\)/,
    "the client prune path invalidates whenever candidates were attempted — local tombstones land even when the CLI sacrifice fails (cave-sufj)",
  );
}

console.log("sessions-list-cache.test.ts: ok");
