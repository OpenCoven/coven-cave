// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const clientStore = await readFile(new URL("./app-preferences.ts", import.meta.url), "utf8");
const controller = await readFile(
  new URL("../components/preferences-bootstrap-controller.tsx", import.meta.url),
  "utf8",
);
const layout = await readFile(new URL("../app/layout.tsx", import.meta.url), "utf8");
const preferencesRoute = await readFile(
  new URL("../app/api/preferences/route.ts", import.meta.url),
  "utf8",
);
const backdropRoute = await readFile(
  new URL("../app/api/preferences/backdrop/route.ts", import.meta.url),
  "utf8",
);

assert.match(
  clientStore,
  /__COVEN_CAVE_PREFERENCES_AUTHORITATIVE__[\s\S]*getAttribute\("data-authoritative"\)/,
  "the client store should reject paint-only bootstrap data as canonical",
);
assert.match(
  clientStore,
  /let authoritativeBootstrap = readBootstrap\(\)[\s\S]*let snapshot = authoritativeBootstrap \?\? createDefaultPreferences\(false\)/,
  "canonical bootstrap state should be the synchronous client snapshot",
);
assert.match(
  clientStore,
  /if \(activeStorage\(\) && !snapshot\.initialized\)[\s\S]*legacyStorageToPreferencesPatch\(readLegacyValues\(\)\)/,
  "legacy localStorage should be consulted only while the central profile is uninitialized",
);
assert.match(
  clientStore,
  /let canonicalInitialized = authoritativeBootstrap\?\.initialized === true/,
  "optimistic legacy overlays must not be mistaken for a canonical server acknowledgement",
);
assert.doesNotMatch(
  clientStore,
  /localStorage\.removeItem|indexedDB\.deleteDatabase/,
  "migration must remain non-destructive so another origin can be recovered safely",
);

const legacyBlock = clientStore.match(/const LEGACY_KEYS = \[([\s\S]*?)\] as const;/)?.[1] ?? "";
assert.ok(legacyBlock, "the current-origin migration should have an explicit allowlist");
assert.doesNotMatch(
  legacyBlock,
  /token|secret|credential|password|api[-_]?key/i,
  "credentials and authentication material must never enter the preference migration payload",
);
for (const representative of [
  "coven-theme",
  "cave:font:sans",
  "cave:screen-scale",
  "cave:reading-width",
  "cave:datetime-clock",
  "cave:corner-radius",
  "cave:backdrop:v1",
  "cave:home-news-enabled",
  "cave:mobile-mode-enabled",
]) {
  assert.ok(legacyBlock.includes(`"${representative}"`), `migration allowlist includes ${representative}`);
}

assert.match(
  clientStore,
  /pendingPatch = mergePatch\(pendingPatch, patch\)[\s\S]*snapshot = applyPreferencesPatch\(snapshot, patch\)/,
  "preference setters should optimistically merge typed patches",
);
assert.match(
  clientStore,
  /fetch\("\/api\/preferences", \{\s*method: "PATCH"[\s\S]*options\.keepalive \? \{ keepalive: true \} : \{\}/,
  "coalesced writes should persist to the port-independent sidecar store",
);
assert.match(
  clientStore,
  /pendingPatch = mergePatch\(patch, pendingPatch\)[\s\S]*ok = false/,
  "a transient write failure should preserve its patch for retry",
);
assert.match(
  clientStore,
  /retryableStatus\(status[\s\S]*status === 408[\s\S]*status === 429[\s\S]*status >= 500/,
  "only network, throttling, and server failures should enter automatic retry",
);
assert.match(
  clientStore,
  /RETRY_MAX_ATTEMPTS = 6[\s\S]*retryBlocked = "exhausted"/,
  "background retries should stop after a bounded number of attempts",
);
assert.match(
  clientStore,
  /fetch\("\/api\/preferences", \{ cache: "no-store" \}\)/,
  "cross-client refresh should bypass HTTP caches",
);
assert.match(
  clientStore,
  /if \(!canonicalLoaded\) return snapshot/,
  "failed or malformed canonical reads must fail closed before any PATCH",
);
assert.match(
  clientStore,
  /new BroadcastChannel\(CHANNEL_NAME\)[\s\S]*channel\.onmessage = \(\) => void refreshAppPreferences\(\)/,
  "same-origin tabs should converge on the server snapshot",
);

assert.match(
  controller,
  /await initializeAppPreferences\(\)[\s\S]*migrateLegacyBackdropImage\(\)/,
  "preference and legacy backdrop migration should run after hydration/auth bootstrap",
);
assert.match(
  controller,
  /PREFERENCES_AUTO_RETRY_MS = \[5_000, 10_000, 20_000\]/,
  "failed bootstrap retries silently with bounded backoff",
);
assert.match(
  controller,
  /attempt >= PREFERENCES_AUTO_RETRY_MS\.length\) return;/,
  "silent auto-retry gives up after three attempts",
);
assert.doesNotMatch(controller, /pushBanner|useShellBanners|dismissBanner/, "reconciliation never surfaces a banner");
for (const timing of ["response-commit", "shell-visible", "reconciliation-settled"]) {
  assert.ok(controller.includes(`\"${timing}\"`), `bootstrap controller records ${timing}`);
}
assert.match(controller, /window\.addEventListener\("pagehide", flush\)/, "pending writes flush on page exit");
assert.match(
  controller,
  /flushAppPreferences\(\{ keepalive: true \}\)/,
  "lifecycle flushes opt into keepalive without constraining ordinary large preference writes",
);
assert.match(
  controller,
  /document\.visibilityState === "hidden"[\s\S]*flush\(\)/,
  "pending writes flush when the app becomes hidden",
);
assert.match(
  layout,
  /<PreferencesBootstrapController \/>[\s\S]*<ScreenMagnificationController \/>[\s\S]*<CornerRadiusController \/>/,
  "canonical initialization should mount before post-hydration appearance controllers",
);

for (const route of [preferencesRoute, backdropRoute]) {
  const guards = [...route.matchAll(/rejectNonLocalRequest\(req\)/g)];
  assert.ok(guards.length >= 2, "personal preference APIs should reject non-local requests in every handler");
  assert.match(route, /[Cc]ache-[Cc]ontrol["']?:?\s*["']no-store|"cache-control": "no-store"/, "preference API responses should not be cached");
}
assert.match(
  preferencesRoute,
  /readJsonBody<unknown>\(req, MAX_PREFERENCES_PATCH_BYTES\)[\s\S]*validatePreferencesPatch\(parsed\.body\)/,
  "canonical PATCH should be size-bounded and validated against the closed schema",
);
assert.match(
  preferencesRoute,
  /export async function GET\(req: Request\)[\s\S]*export async function PATCH\(req: Request\)/,
  "canonical preferences expose local-only GET and PATCH handlers",
);
assert.match(
  backdropRoute,
  /SAFE_BACKDROP_MIME_TYPES[\s\S]*readBoundedBody\(req\)[\s\S]*patchPreferences\(/,
  "backdrop bytes should be bounded, type-checked, and reflected in canonical metadata",
);
assert.match(
  backdropRoute,
  /export async function GET\(req: Request\)[\s\S]*export async function PUT\(req: Request\)[\s\S]*export async function DELETE\(req: Request\)/,
  "the local-only backdrop API supports durable read, replace, and delete",
);

console.log("app-preferences.test.ts: ok");
