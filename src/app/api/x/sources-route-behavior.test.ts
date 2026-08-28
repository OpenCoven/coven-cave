// cave-1tu16: BEHAVIOURAL tests for /api/x/sources, covering the two cache
// lifecycle duties that shipped implemented-but-uncalled at 63f140139.
//
// x-sources.ts owns three correct, well-tested exports that no production code
// reached: sweepExpiredXCache, purgeXSourceCache and markXPostAvailability.
// research-routes.test.ts next door scans route SOURCE TEXT, so a call that
// was never written is invisible to it — which is exactly how both of these
// survived a green suite.
//
//  1. "Every X route entry, Research Desk load, and application startup
//     performs an expired-entry sweep." Nothing swept. Expiry was purely lazy
//     and per-post-id, so a cached post nobody looked up again kept its text,
//     author id and handle on disk indefinitely — the opposite of the bounded
//     cache the design promises.
//  2. "A not-found or deleted response immediately removes cached and
//     temporary content and marks the durable source record accordingly."
//     A 404 from refresh was mapped to an error response and dropped there.
//     The deletion mark existed only as React state in research-x-sources.tsx,
//     so it vanished on reload and the cached body was never purged.
//
// No network and no X credentials: fetch is stubbed for the one upstream read
// under test, and every durable path is redirected into a temp directory.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";

import type { NormalizedXPost } from "@/lib/x-api";

const root = await mkdtemp(path.join(tmpdir(), "x-sources-route-"));
const caveHome = path.join(root, "cave");
const cacheDir = path.join(root, "x-cache");
await mkdir(caveHome, { recursive: true });
// The familiar must hold the research capability server-side; the client
// cannot assert it, so the grant has to exist in config.json.
await writeFile(
  path.join(caveHome, "config.json"),
  JSON.stringify({ familiars: { nova: { xResearchEnabled: true } } }),
  "utf8",
);
process.env.COVEN_CAVE_HOME = caveHome;
process.env.COVEN_X_SOURCES_DIR = path.join(root, "x-sources");
process.env.COVEN_X_CACHE_DIR = cacheDir;
process.env.COVEN_CAVE_LOCAL_VAULT_FILE = path.join(root, "local-vault.enc.json");
process.env.COVEN_CAVE_LOCAL_VAULT_KEY_FILE = path.join(root, "local-vault.key");
// The development client-ID override the design documents. No packaged client
// ID exists in a checkout, and without one the X client refuses to construct
// at all — which would mask the not-found mapping under test behind
// `not-configured`. This is a public client ID field, never a secret.
process.env.COVEN_CAVE_X_CLIENT_ID = "synthetic-client-id";

const { GET, POST } = await import("./sources/route.ts");
const { xCredentialService } = await import("@/lib/server/x-credentials");
const {
  cacheNormalizedXPosts,
  listSavedXSources,
  upsertSavedXSource,
} = await import("@/lib/server/x-sources");
const {
  createResearchMissionWorkspace,
  loadResearchMission,
} = await import("@/lib/server/research-mission-store");

const realFetch = globalThis.fetch;
after(async () => {
  globalThis.fetch = realFetch;
  await rm(root, { recursive: true, force: true });
});

const post = (postId: string): NormalizedXPost => ({
  id: postId,
  canonicalUrl: `https://x.com/opencoven/status/${postId}`,
  text: `post ${postId}`,
  author: { id: "42", username: "opencoven", name: "Open Coven" },
  createdAt: "2026-07-31T12:00:00.000Z",
});

function listRequest(familiarId: string): Request {
  return new Request(
    `http://127.0.0.1:3000/api/x/sources?familiarId=${familiarId}`,
    { headers: { host: "127.0.0.1:3000" } },
  );
}

function actionRequest(body: Record<string, unknown>): Request {
  return new Request("http://127.0.0.1:3000/api/x/sources", {
    method: "POST",
    headers: { host: "127.0.0.1:3000", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("loading Research Desk sources sweeps expired cached post content", async () => {
  // Fetched 25h ago, so the entry's own 24h expiry is already an hour past.
  // Nothing will ever look post 200 up again — which is precisely the case a
  // read-time filter cannot reach and a sweep exists for.
  const staleFetch = new Date(Date.now() - 25 * 60 * 60 * 1000);
  await cacheNormalizedXPosts([post("200")], staleFetch);
  assert.deepEqual(
    (await readdir(cacheDir)).sort(),
    ["200.json"],
    "the stale entry must be on disk before the load under test",
  );

  const response = await GET(listRequest("nova"));
  assert.equal(response.status, 200);

  assert.deepEqual(
    await readdir(cacheDir),
    [],
    "a Research Desk load must sweep expired post content off disk",
  );
});

test("an upstream not-found purges the cached body and marks the source deleted", async () => {
  await cacheNormalizedXPosts([post("300")]);
  const saved = await upsertSavedXSource({
    familiarId: "nova",
    postId: "300",
    canonicalUrl: "https://x.com/opencoven/status/300",
    originalUrl: "https://x.com/opencoven/status/300",
    note: "keep this note",
    tags: [],
  });
  assert.equal(saved.source.availability, "available");

  xCredentialService.replaceBundle({
    accessToken: "synthetic-access-token",
    refreshToken: "synthetic-refresh-token",
    expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    scopes: ["tweet.read", "users.read"],
    account: { id: "42", username: "opencoven", name: "Open Coven" },
  });
  // The one upstream read this test needs: X reports the post is gone.
  globalThis.fetch = (async () => new Response(
    JSON.stringify({ title: "Not Found Error" }),
    { status: 404, headers: { "content-type": "application/json" } },
  )) as typeof globalThis.fetch;

  const response = await POST(actionRequest({
    action: "refresh",
    familiarId: "nova",
    sourceId: saved.source.id,
  }));
  assert.equal(response.status, 404, "a deleted post must still surface as not-found");

  // Fail closed: the body must not outlive the post, and the durable record
  // must say so after a reload rather than only in component state.
  assert.ok(
    !(await readdir(cacheDir)).includes("300.json"),
    "a not-found response must purge the cached post body",
  );
  const [durable] = await listSavedXSources("nova");
  assert.equal(durable!.availability, "deleted", "the durable record must record the deletion");
  // Coven-owned data is retained even when the X post is gone.
  assert.equal(durable!.note, "keep this note");
  assert.equal(durable!.postId, "300");
});

// cave-v3ajh: attaching has to reach the MISSION, not only the X-side record.
// `setXSourceMissionAttached` writes `x-sources/<familiar>.json`; before this,
// the mission's own ledger was never touched and no `x-post` entry existed
// anywhere, so the user was told "X source attached to the mission" about a
// mission that had no idea.
test("attaching a saved X post records an identity-only x-post source on the mission", async () => {
  await createResearchMissionWorkspace({
    version: 1,
    id: "mission-attach",
    familiarId: "nova",
    title: "Attach target",
    intent: "Check the attach path",
    mode: "autoresearch",
    modeSource: "user",
    deliverable: "findings",
    constraints: [],
    bounds: {
      wallClockMinutes: 120,
      maxIterations: 3,
      sourceTarget: 5,
      checkpointEvery: 1,
      stopWhenCostUnavailable: false,
    },
    status: "checkpoint",
    createdAt: "2026-08-22T10:00:00.000Z",
    updatedAt: "2026-08-22T10:00:00.000Z",
    iterations: [],
    artifacts: [],
    sources: [],
  });

  await cacheNormalizedXPosts([post("400")]);
  const saved = await upsertSavedXSource({
    familiarId: "nova",
    postId: "400",
    canonicalUrl: "https://x.com/opencoven/status/400",
    originalUrl: "https://x.com/opencoven/status/400",
    note: "the claim to verify",
    tags: [],
  });

  const response = await POST(actionRequest({
    action: "attach",
    familiarId: "nova",
    sourceId: saved.source.id,
    missionId: "mission-attach",
  }));
  assert.equal(response.status, 200);

  const stored = await loadResearchMission("mission-attach");
  const ref = stored!.sources.find((source) => source.externalId === "400");
  assert.ok(ref, "the mission ledger must gain an entry for the attached post");
  assert.equal(ref!.sourceType, "x-post");
  assert.equal(ref!.provider, "x");
  assert.equal(ref!.availability, "available");
  assert.equal(ref!.url, "https://x.com/opencoven/status/400");
  assert.equal(ref!.note, "the claim to verify");
  // The exclusion the design is explicit about: identity and the user's own
  // note, never an archival copy of the post body.
  assert.ok(
    !JSON.stringify(stored!.sources).includes("post 400"),
    "the durable mission ledger must not embed the cached post text",
  );

  const body = await response.json() as { mission?: { sources?: unknown[] } };
  assert.equal(
    body.mission?.sources?.length,
    1,
    "the response must show the caller the mission it just changed, not the pre-attach copy",
  );
});

// cave-xl73s: housekeeping must not be able to fail a read. sweepExpiredXCache
// runs inside the route's try/catch, so a sweep failure — a lock timeout, a
// permissions problem — used to turn GET /api/x/sources into a 500 even
// though listing saved sources needs no cache at all. The startup sweep was
// already void-ed and .catch-ed so it cannot fail boot (instrumentation.ts);
// the load path now logs the failure instead of propagating it.
test("a failing expired-cache sweep cannot fail the Research Desk load", async () => {
  // A saved source the read must still return no matter what housekeeping does.
  await upsertSavedXSource({
    familiarId: "nova",
    postId: "901",
    canonicalUrl: "https://x.com/opencoven/status/901",
    originalUrl: "https://x.com/opencoven/status/901",
    note: "the read must survive a failing sweep",
    tags: [],
  });

  // The cache root becomes a SYMLINK — the exact condition the pre-fix code
  // deliberately surfaced as a read error ("Awaited rather than
  // fired-and-forgotten so a symlinked cache root surfaces as an error").
  // The stale entry is parked inside the real directory behind the link, so
  // a surviving 900.json proves the sweep genuinely FAILED rather than being
  // skipped, and the load must still succeed.
  const realCache = path.join(root, "x-cache-broken-real");
  const hiddenCache = path.join(root, "x-cache-broken-content");
  await mkdir(realCache, { recursive: true });
  const originalCacheDir = process.env.COVEN_X_CACHE_DIR;
  process.env.COVEN_X_CACHE_DIR = realCache;
  const originalWarn = console.warn;
  const warnings: string[] = [];
  console.warn = (...values: unknown[]) => {
    warnings.push(values.map(String).join(" "));
  };
  try {
    await cacheNormalizedXPosts(
      [post("900")],
      new Date(Date.now() - 25 * 60 * 60 * 1000),
    );
    await rename(realCache, hiddenCache);
    await symlink(hiddenCache, realCache, "dir");

    const response = await GET(listRequest("nova"));
    assert.equal(response.status, 200, "a sweep failure must not fail the load");
    const body = await response.json() as {
      ok: boolean;
      sources: Array<{ postId: string; note: string }>;
    };
    assert.equal(body.ok, true);
    assert.ok(
      body.sources.some((source) => source.postId === "901"),
      "the saved source must still be listed",
    );
    assert.ok(
      (await readdir(hiddenCache)).includes("900.json"),
      "the sweep must have failed before it could remove the stale entry",
    );
    assert.ok(
      warnings.some((line) => line.includes("X cache sweep failed")),
      "the sweep failure must be logged, not propagated to the caller",
    );
  } finally {
    process.env.COVEN_X_CACHE_DIR = originalCacheDir;
    console.warn = originalWarn;
  }
});
