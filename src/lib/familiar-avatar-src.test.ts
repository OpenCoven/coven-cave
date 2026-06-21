// @ts-nocheck
import assert from "node:assert/strict";
import {
  avatarAssetUrl,
  canResolveWorkspaceAvatar,
  initialAvatarSrc,
} from "./familiar-avatar-src.ts";

// --- initialAvatarSrc -------------------------------------------------------
// A workspace avatar must NOT be the initial src: it only resolves client-side
// via Tauri, so emitting the raw path on the server renders broken and
// hydration-mismatches. The glyph (undefined src) shows until the effect runs.
{
  assert.equal(
    initialAvatarSrc({ avatarPath: "/ws/cody/avatars/cody.png" }),
    undefined,
    "workspace avatarPath alone → undefined (glyph) on initial/SSR render",
  );
}

// Workspace avatar wins even when a Cave-local upload also exists — the upload
// must not flash on the server before the workspace asset resolves client-side.
{
  assert.equal(
    initialAvatarSrc({
      avatarPath: "/ws/cody/avatars/cody.png",
      avatarImage: "data:image/png;base64,AAA",
    }),
    undefined,
    "avatarPath present → initial src is undefined even with an upload",
  );
}

// No workspace avatar: the upload data URL is SSR-safe, so use it directly.
{
  assert.equal(
    initialAvatarSrc({ avatarImage: "data:image/png;base64,BBB" }),
    "data:image/png;base64,BBB",
    "upload-only → avatarImage is the initial src",
  );
}

// Neither → undefined → glyph.
{
  assert.equal(initialAvatarSrc({}), undefined, "no avatar fields → undefined");
}

// --- avatarAssetUrl ---------------------------------------------------------
// The mtime cache-buster forces a refetch after the file changes on disk.
{
  assert.equal(
    avatarAssetUrl("asset://localhost/cody.png", 1234),
    "asset://localhost/cody.png?v=1234",
    "version present → appended as ?v=<mtime>",
  );
}

// No version available → URL untouched (never append `?v=undefined`).
{
  assert.equal(
    avatarAssetUrl("asset://localhost/cody.png", undefined),
    "asset://localhost/cody.png",
    "missing version → URL unchanged",
  );
  assert.equal(
    avatarAssetUrl("asset://localhost/cody.png", 0),
    "asset://localhost/cody.png",
    "falsy version (0) → URL unchanged, no ?v=0",
  );
}

// --- canResolveWorkspaceAvatar ---------------------------------------------
// Default node/SSR environment: no window → cannot resolve.
{
  assert.equal(
    canResolveWorkspaceAvatar(),
    false,
    "no window (SSR/node) → cannot resolve workspace avatar",
  );
}

// A browser window without the Tauri runtime marker → cannot resolve.
{
  const had = "window" in globalThis;
  const prev = globalThis.window;
  try {
    globalThis.window = {};
    assert.equal(
      canResolveWorkspaceAvatar(),
      false,
      "plain browser window (no __TAURI_INTERNALS__) → cannot resolve",
    );
    globalThis.window = { __TAURI_INTERNALS__: {} };
    assert.equal(
      canResolveWorkspaceAvatar(),
      true,
      "Tauri webview (window.__TAURI_INTERNALS__) → can resolve",
    );
  } finally {
    if (had) globalThis.window = prev;
    else delete globalThis.window;
  }
}

console.log("familiar-avatar-src.test.ts: ok");
