// cave-lsj8u: /api/x/posts/lookup, /api/x/posts/search and /api/x/sources.
//
// These three were unrecoverable — present on no ref, stash or dangling blob —
// so they are written fresh against the lib layer that did land, not restored.
// What is pinned here is the handful of properties that would break the two
// live surfaces (ResearchXSources, FamiliarXSection) or leak credentials if a
// later edit drifted.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const lookup = readFileSync(new URL("./posts/lookup/route.ts", import.meta.url), "utf8");
const search = readFileSync(new URL("./posts/search/route.ts", import.meta.url), "utf8");
const sources = readFileSync(new URL("./sources/route.ts", import.meta.url), "utf8");
const all = [
  ["lookup", lookup],
  ["search", search],
  ["sources", sources],
] as const;

// --- shared guarantees -----------------------------------------------------

for (const [name, source] of all) {
  assert.match(source, /rejectNonLocalRequest\(req\)/, `${name} must guard non-local requests`);
  assert.match(source, /toXErrorResponse\(error\)/, `${name} must map XApiError to its response`);
  // Routes must never read or forward tokens themselves — withXAuthenticatedRead
  // owns retrieval and the one refresh-and-retry on 401.
  assert.doesNotMatch(
    source,
    /refreshToken|getAccessToken/,
    `${name} must not handle credentials directly`,
  );
}

// --- reads go through the capability + token wrapper -----------------------

for (const [name, source] of [["lookup", lookup], ["search", search]] as const) {
  assert.match(
    source,
    /withXAuthenticatedRead\(familiarId, READ_SCOPES/,
    `${name} must go through the capability-checked read wrapper`,
  );
  assert.match(
    source,
    /READ_SCOPES: XScope\[\] = \["tweet\.read", "users\.read"\]/,
    `${name} must request exactly the scopes it needs`,
  );
  // Saving reads the post back out of the cache. Without this, every save
  // from a preview fails with "Look up or search for this X post before
  // saving it" — the preview → save flow depends on it.
  assert.match(
    source,
    /cacheNormalizedXPosts\(/,
    `${name} must cache results or saving a previewed post breaks`,
  );
}

// The post id is re-derived from the URL server-side rather than trusted from
// the client, because it goes straight into an upstream path segment.
assert.match(lookup, /parseXPostUrl\(url\)/);
assert.match(lookup, /lookupXPost\(accessToken, postId\)/);
assert.match(search, /searchRecentXPosts\(accessToken, query\)/);

// --- /api/x/sources --------------------------------------------------------

assert.match(sources, /export async function GET\(req: Request\)/);
assert.match(sources, /export async function POST\(req: Request\)/);

// The caller requires `{ ok: true, sources: [...] }` and rejects anything else.
assert.match(sources, /NextResponse\.json\(\{ ok: true, sources \}\)/);

// Listing is capability-gated but deliberately NOT connection-gated: saved
// sources stay readable after a disconnect so the surface can show them next
// to a reconnect prompt.
assert.match(sources, /requireXCapability\(familiarId, "research"\)/);

for (const action of ["save", "attach", "refresh"]) {
  assert.match(sources, new RegExp(`case "${action}"`), `sources must handle ${action}`);
}
assert.match(sources, /action must be save, attach or refresh/, "unknown actions are rejected");

// save reads the cached post rather than re-fetching, so it cannot silently
// store something other than what the user previewed.
assert.match(sources, /saveCachedXPostAsSource\(/);
assert.match(sources, /created: result\.created/);

// attach re-reads the mission from the store instead of echoing the request —
// the caller rejects a mission whose id/familiarId do not match.
assert.match(sources, /setXSourceMissionAttached\(familiarId, sourceId, missionId\)/);
assert.match(sources, /loadResearchMission\(missionId\)/);

// refresh is the one source action that must hit upstream; its purpose is to
// re-read the post and re-derive availability.
assert.match(sources, /refreshSavedXSourceFromPost\(familiarId, sourceId, post\)/);
assert.match(sources, /withXAuthenticatedRead\(familiarId, READ_SCOPES/);

console.log("research-routes.test.ts: ok");
