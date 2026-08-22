// cave-1tu16: BEHAVIOURAL tests for /api/x/connection, deliberately not more
// source-text pins.
//
// account-routes.test.ts next door asserts against the route's *source*, which
// is why two wiring gaps shipped green: a regex can confirm the calls a file
// makes, never the call it forgot. Both properties below were broken at
// 63f140139 and neither was visible to any existing gate.
//
//  1. GET reported `activeFlow` only. familiar-x-section.tsx polls this route
//     after opening the system browser and settles on `oauthFlowId` +
//     `oauthOutcome`; with those absent, the poll fell through to its
//     `!next.activeFlow` branch and told the user "X authorization didn't
//     grant the requested permission" for a flow that had SUCCEEDED, then
//     skipped saving the familiar grant. Connecting an X account could not
//     complete.
//  2. DELETE dropped the token bundle but left ~/.coven/cave/x-cache intact,
//     so normalized post text outlived the disconnect that was supposed to
//     remove it.
//
// Everything here runs without network, X credentials, or a client ID: the
// OAuth flow is settled through the service's own cancellation path, which
// records an outcome before it ever reaches getXClientId().
import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";

import type { NormalizedXPost } from "@/lib/x-api";

// Point every durable X path and the local vault at a throwaway directory
// BEFORE the route pulls in the credential/oauth/source singletons. DELETE
// really does delete, so an unisolated run would clear the developer's own
// vault entry.
const root = await mkdtemp(path.join(tmpdir(), "x-connection-route-"));
const cacheDir = path.join(root, "x-cache");
process.env.COVEN_X_SOURCES_DIR = path.join(root, "x-sources");
process.env.COVEN_X_CACHE_DIR = cacheDir;
process.env.COVEN_CAVE_LOCAL_VAULT_FILE = path.join(root, "local-vault.enc.json");
process.env.COVEN_CAVE_LOCAL_VAULT_KEY_FILE = path.join(root, "local-vault.key");

const { GET, DELETE } = await import("./connection/route.ts");
const { xOAuthService } = await import("@/lib/server/x-oauth");
const {
  cacheNormalizedXPosts,
  listSavedXSources,
  upsertSavedXSource,
} = await import("@/lib/server/x-sources");

after(async () => {
  await rm(root, { recursive: true, force: true });
});

/** The route family accepts a loopback Host and no cross-origin Origin. */
function localRequest(method: "GET" | "DELETE" = "GET"): Request {
  return new Request("http://127.0.0.1:3000/api/x/connection", {
    method,
    headers: { host: "127.0.0.1:3000" },
  });
}

const post = (postId: string): NormalizedXPost => ({
  id: postId,
  canonicalUrl: `https://x.com/opencoven/status/${postId}`,
  text: `post ${postId}`,
  author: { id: "42", username: "opencoven", name: "Open Coven" },
  createdAt: "2026-07-31T12:00:00.000Z",
});

test("GET reports the settled OAuth flow the connect UI waits on", async () => {
  // 43 chars, matching the service's FLOW_ID_PATTERN.
  const flowId = "a".repeat(43);
  // cancel() before start() makes start() consume the cancellation and record
  // a terminal outcome without opening a listener or reading a client ID —
  // the one way to settle a flow with no network and no credentials.
  xOAuthService.cancel(flowId);
  await assert.rejects(
    () => xOAuthService.start({ capability: "research", flowId }),
    "a cancelled flow must not start",
  );

  const response = await GET(localRequest());
  assert.equal(response.status, 200);
  const body = await response.json() as Record<string, unknown>;

  // Without these two the poller cannot tell success from failure and reports
  // every completed authorization as a refused permission.
  assert.equal(body.oauthFlowId, flowId, "GET must report which flow settled");
  assert.equal(body.oauthOutcome, "failed", "GET must report how it settled");
  assert.equal(body.activeFlow, false);
  assert.equal(body.connected, false);
});

test("GET still exposes no token, refresh token, state or verifier", async () => {
  const response = await GET(localRequest());
  const serialized = JSON.stringify(await response.json());
  for (const forbidden of ["accessToken", "refreshToken", "verifier", "codeVerifier", "state"]) {
    assert.doesNotMatch(
      serialized,
      new RegExp(forbidden, "i"),
      `connection status must not carry ${forbidden}`,
    );
  }
});

test("DELETE purges normalized post content and keeps the saved identity", async () => {
  await cacheNormalizedXPosts([post("100")]);
  await upsertSavedXSource({
    familiarId: "nova",
    postId: "100",
    canonicalUrl: "https://x.com/opencoven/status/100",
    originalUrl: "https://twitter.com/opencoven/status/100",
    note: "user-authored note",
    tags: ["research"],
  });
  assert.deepEqual(
    (await readdir(cacheDir)).sort(),
    ["100.json"],
    "the cache entry must exist before the disconnect under test",
  );

  const response = await DELETE(localRequest("DELETE"));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });

  // "Disconnect removes the bundle, in-memory OAuth state, normalized caches,
  // and temporary runtime source files." Post text must not survive it.
  let remaining: string[] = [];
  try {
    remaining = await readdir(cacheDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  assert.deepEqual(remaining, [], "disconnect must leave no cached post content");

  // "It retains saved source identities, user notes, mission links, and
  // publish receipts." Purging must not take the durable record with it.
  const sources = await listSavedXSources("nova");
  assert.equal(sources.length, 1, "the saved source identity must survive a disconnect");
  assert.equal(sources[0]!.postId, "100");
  assert.equal(sources[0]!.note, "user-authored note");
  assert.deepEqual(sources[0]!.tags, ["research"]);
});
