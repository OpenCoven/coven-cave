// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { needsAuthedImageFetch } from "./authed-image.ts";

// --- needsAuthedImageFetch --------------------------------------------------
// This predicate decides which sources must go through the authenticated fetch
// (→ blob URL) to survive the packaged app's `/api/` auth gate. It MUST agree
// with the sidecar auth bridge's own "is this an /api request" condition:
// same-origin + pathname starts with `/api/`. Everything else renders directly.

// Empty inputs never need a fetch.
{
  assert.equal(needsAuthedImageFetch(null), false, "null → false");
  assert.equal(needsAuthedImageFetch(undefined), false, "undefined → false");
  assert.equal(needsAuthedImageFetch(""), false, "empty string → false");
}

// data:/blob: payloads carry their own bytes and are checked before window, so
// they classify correctly even under SSR (no window).
{
  assert.equal(
    needsAuthedImageFetch("data:image/png;base64,AAAA"),
    false,
    "data: URL → false (self-contained)",
  );
  assert.equal(
    needsAuthedImageFetch("blob:https://app.local/abc"),
    false,
    "blob: URL → false (already an object URL)",
  );
}

// No window (SSR/node): still treat a relative `/api/...` path as needing an
// authed fetch so server-rendered HTML never emits a raw <img src="/api/...">
// that will 401 before hydration.
{
  assert.equal(
    needsAuthedImageFetch("/api/familiars/x/avatar"),
    true,
    "no window + relative /api/* → true (avoid SSR broken-image fetch)",
  );
}

// In a browser window the same-origin /api rule kicks in.
{
  const had = "window" in globalThis;
  const prev = globalThis.window;
  try {
    globalThis.window = { location: { href: "https://app.local/home", origin: "https://app.local" } };

    assert.equal(
      needsAuthedImageFetch("/api/familiars/cody/avatar?v=1&format=png"),
      true,
      "same-origin relative /api/* → true",
    );
    assert.equal(
      needsAuthedImageFetch("https://app.local/api/profile/avatar"),
      true,
      "same-origin absolute /api/* → true",
    );
    assert.equal(
      needsAuthedImageFetch("/_next/static/media/x.png"),
      false,
      "same-origin non-/api asset → false",
    );
    assert.equal(
      needsAuthedImageFetch("https://avatars.githubusercontent.com/u/1"),
      false,
      "cross-origin (GitHub avatar) → false",
    );
  } finally {
    if (had) globalThis.window = prev;
    else delete globalThis.window;
  }
}

// --- source invariants ------------------------------------------------------
// The stateful hook + cache are awkward to exercise without a DOM, so pin their
// load-bearing behaviors against the source the way user-profile.test.ts does.
const source = readFileSync(
  fileURLToPath(new URL("./authed-image.ts", import.meta.url)),
  "utf8",
);

// The whole point: fetch bytes (through the patched window.fetch) and hand back
// a blob object URL, never the raw /api URL.
assert.match(source, /await fetch\(src\)/, "fetches the source via window.fetch");
assert.match(source, /URL\.createObjectURL\(blob\)/, "creates a blob object URL");

// A failed fetch must surface as an "error" status so fallback chains advance,
// and must not poison the cache (so a later mount can retry).
assert.match(
  source,
  /commit\(resolved, resolved \? "ready" : "error"\)/,
  "reports an error status on failure",
);
assert.match(source, /cache\.delete\(src\)/, "drops the failed entry for retry");

// The state a consumer observes must always describe the CURRENT src: the hook
// resets synchronously on a src change (render-phase derived-state pattern), so
// a fallback-chain consumer can never misread the previous src's "error" and
// double-advance past a loadable source (cave-x63e).
assert.match(source, /if \(prevSrc !== src\) \{/, "state is keyed to its src");
assert.match(
  source,
  /setPrevSrc\(src\);\s*\n\s*setState\(seedAuthedImageState\(src\)\)/,
  "src change reseeds state synchronously during render",
);

// Mounted consumers hold a ref on their entry so eviction never revokes an
// object URL something is still displaying, and render-time cache reads refresh
// LRU recency so live images don't age to the front of the eviction queue
// (cave-fea6).
assert.match(source, /const release = retainAuthedImage\(src\)/, "hook retains its entry while mounted");
assert.match(source, /release\(\);/, "hook releases its entry on cleanup");
assert.match(
  source,
  /entry\.refs > 0 \|\| entry === protect/,
  "eviction skips in-use and just-resolved entries",
);
assert.match(
  source,
  /const cached = readCachedAuthedImageUrl\(src\)/,
  "effect cache reads refresh recency",
);
assert.match(
  source,
  /const cached = readCachedAuthedImageUrl\(src\);\s*\n\s*return cached \? \{ url: cached, status: "ready" \}/,
  "seed cache reads refresh recency",
);

// The shared cache is bounded and revokes object URLs on eviction (no leaks) and
// must NOT revoke on unmount (that races other live consumers of the blob).
assert.match(source, /URL\.revokeObjectURL/, "revokes object URLs on eviction");
assert.match(source, /MAX_CACHE_ENTRIES/, "bounds the cache with an LRU cap");
assert.doesNotMatch(
  source,
  /revokeObjectURL[\s\S]{0,120}unmount/i,
  "does not revoke on unmount",
);

// --- call-site wiring -------------------------------------------------------
// The central familiar avatar and every direct render site must route their
// /api-backed source through the primitive, not a raw <img src="/api/...">.
function read(rel) {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
}

const familiarAvatar = read("../components/familiar-avatar.tsx");
assert.match(familiarAvatar, /useAuthedImageState/, "FamiliarAvatar uses the authed hook");
assert.match(
  familiarAvatar,
  /status === "error"/,
  "FamiliarAvatar advances its fallback chain on a fetch error",
);
assert.doesNotMatch(
  familiarAvatar,
  /src=\{currentSrc\}/,
  "FamiliarAvatar no longer renders the raw source directly",
);

for (const rel of [
  "../components/quick-chat-primitives.tsx",
  "../components/familiar-growth-view.tsx",
  "../components/familiar-analytics-view.tsx",
  "../components/familiars-view.tsx",
  // The bento dashboard renders familiar avatars in its roster, board and
  // footer-collaborator rows.
  "../components/dashboard/bento-dashboard.tsx",
]) {
  const src = read(rel);
  assert.match(src, /AuthedImage/, `${rel} renders avatars via <AuthedImage>`);
  assert.doesNotMatch(
    src,
    /<img[^>]*src=\{[^}]*avatarUrl\}/,
    `${rel} has no raw <img src={...avatarUrl}>`,
  );
}

console.log("authed-image.test.ts: ok");
