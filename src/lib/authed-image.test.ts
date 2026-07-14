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
assert.match(source, /status: "error"/, "reports an error status on failure");
assert.match(source, /cache\.delete\(src\)/, "drops the failed entry for retry");

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
  "../components/quick-chat-controls.tsx",
  "../components/familiar-growth-view.tsx",
  "../components/familiar-analytics-view.tsx",
  "../components/familiars-view.tsx",
  "../components/dashboard/dashboard-cockpit.tsx",
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
