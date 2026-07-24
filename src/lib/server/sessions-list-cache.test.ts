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
import {
  invalidateSessionsListCache,
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

// ── wiring pins ──────────────────────────────────────────────────────────────
const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

/** Source of one `export async function <name>` block (up to the next export). */
function fnBlock(source, name) {
  const start = source.indexOf(`export async function ${name}`);
  assert.notEqual(start, -1, `found export async function ${name}`);
  const next = source.indexOf("\nexport ", start + 1);
  return next === -1 ? source.slice(start) : source.slice(start, next);
}

// The list route consumes the SHARED cache; a locally re-created cache would
// silently detach it from the invalidation hook.
{
  const route = read("../../app/api/sessions/list/route.ts");
  assert.match(
    route,
    /import \{\s*sessionsListCache,[\s\S]{0,120}\} from "@\/lib\/server\/sessions-list-cache"/,
    "the list route imports the shared sessions-list cache",
  );
  assert.doesNotMatch(
    route,
    /createSwrCache/,
    "the list route does not create a private cache instance",
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
