/**
 * Pure decision helpers for resolving a familiar's avatar `<img src>`.
 *
 * The actual resolution lives in the `FamiliarAvatar` component, but the rules
 * below are subtle enough — and high-impact enough (every familiar avatar in the
 * app) — to be worth isolating as pure functions so they can be unit-tested
 * without a React runtime.
 */

/**
 * Structural shape of the avatar fields these helpers read. Kept independent
 * of the `Familiar`/`ResolvedFamiliar` types so the helpers stay testable with
 * minimal fixtures and so future avatar fields don't drag the whole familiar
 * type into this leaf module.
 *
 * - `avatarPath`: absolute on-disk workspace file path (Tauri-resolved at runtime)
 * - `avatarImage`: SSR-safe data URL or fully-resolved http(s) URL
 * - `avatarVersion`: optional mtime/version used to cache-bust the asset URL
 */
export type AvatarFields = {
  avatarPath?: string;
  avatarImage?: string;
  avatarVersion?: number;
};

/**
 * The `<img src>` to use before any client-side asset resolution runs.
 *
 * A workspace `avatarPath` is an absolute `.coven` file path that only loads via
 * Tauri's asset protocol inside the webview — it resolves client-side, post-mount.
 * On the server (and the first client render, before the effect runs) we must NOT
 * emit it: an absolute file path is not a loadable `<img src>` there and would
 * both render broken and cause a hydration mismatch once the effect swaps it.
 *
 * So when a workspace avatar exists we start with `undefined` (the glyph renders)
 * and let the effect upgrade to the resolved asset URL. Otherwise the Cave-local
 * upload (`avatarImage`, a data URL) is SSR-safe and used directly; `undefined`
 * when neither exists, leaving the glyph.
 */
export function initialAvatarSrc(familiar: AvatarFields): string | undefined {
  return familiar.avatarPath ? undefined : familiar.avatarImage;
}

/**
 * Cache-bust a resolved Tauri asset URL with the avatar file's mtime.
 *
 * Without `?v=<mtime>` the webview serves a stale cached copy after the user
 * replaces the avatar on disk. A falsy/missing version (no mtime available)
 * leaves the URL untouched rather than appending `?v=undefined`.
 */
export function avatarAssetUrl(base: string, version: number | undefined): string {
  return version ? `${base}?v=${version}` : base;
}

/**
 * Whether `convertFileSrc` can run. It needs the Tauri webview runtime; outside
 * it (a plain browser, SSR) the workspace file isn't loadable, so callers must
 * degrade to the upload / glyph.
 */
export function canResolveWorkspaceAvatar(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}
