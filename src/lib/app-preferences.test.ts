// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  isCanonicalPreferencesPayload,
  mergePreferencesPatches,
  queueAppPreferencesPatch,
  readBootstrap,
} from "./app-preferences-core.ts";
import { applyPreferencesPatch, createDefaultPreferences } from "./preferences-schema.ts";

const clientStore = await readFile(new URL("./app-preferences.ts", import.meta.url), "utf8");
const clientCore = await readFile(new URL("./app-preferences-core.ts", import.meta.url), "utf8");
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
  clientCore,
  /__COVEN_CAVE_PREFERENCES_AUTHORITATIVE__[\s\S]*getAttribute\("data-authoritative"\)/,
  "the client store should reject paint-only bootstrap data as canonical",
);
assert.match(
  clientStore,
  /let authoritativeBootstrap = readBootstrap\(\{[\s\S]*let snapshot = authoritativeBootstrap \?\? createDefaultPreferences\(false\)/,
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
assert.match(
  clientStore,
  /isCanonicalPreferencesPayload[\s\S]*readBootstrap/,
  "bootstrap and network commits share the dependency-light canonical payload guard",
);
const currentAuthoritativePayload = createDefaultPreferences(true);
assert.equal(
  isCanonicalPreferencesPayload(currentAuthoritativePayload),
  true,
  "a current authoritative payload with voice passes the canonical gate",
);
const { voice: _missingVoice, ...incompleteAuthoritativePayload } = currentAuthoritativePayload;
assert.equal(
  isCanonicalPreferencesPayload(incompleteAuthoritativePayload),
  false,
  "an incomplete network payload missing voice is not canonical",
);
for (const voice of [
  [],
  {},
  { defaultProvider: "gemini", defaultModel: "gemini-live", defaultVoice: "Aoede" },
  { defaultProvider: "openai", defaultModel: 42, defaultVoice: "marin" },
  { defaultProvider: "openai", defaultModel: "gpt-realtime", defaultVoice: "x".repeat(129) },
  { defaultProvider: "openai", defaultModel: " gpt-realtime ", defaultVoice: "marin" },
  { ...currentAuthoritativePayload.voice, apiKey: "secret" },
  { defaultProvider: "", defaultModel: "stale-model", defaultVoice: "stale-voice" },
]) {
  assert.equal(
    isCanonicalPreferencesPayload({ ...currentAuthoritativePayload, voice }),
    false,
    `malformed canonical voice payload is rejected: ${JSON.stringify(voice)}`,
  );
}
assert.equal(
  readBootstrap({
    window: {
      __COVEN_CAVE_PREFERENCES__: incompleteAuthoritativePayload,
      __COVEN_CAVE_PREFERENCES_AUTHORITATIVE__: true,
    },
  }),
  null,
  "a direct-window authoritative bootstrap missing voice is rejected before normalization",
);
assert.equal(
  readBootstrap({
    window: {},
    document: {
      getElementById: () => ({
        textContent: JSON.stringify(incompleteAuthoritativePayload),
        getAttribute: () => null,
      }),
    },
  }),
  null,
  "a DOM authoritative bootstrap missing voice is rejected before normalization",
);
assert.deepEqual(
  readBootstrap({
    window: {
      __COVEN_CAVE_PREFERENCES__: currentAuthoritativePayload,
      __COVEN_CAVE_PREFERENCES_AUTHORITATIVE__: true,
    },
  })?.voice,
  currentAuthoritativePayload.voice,
  "a complete direct-window canonical bootstrap is accepted",
);
assert.match(
  clientStore,
  /if \(!authoritativeBootstrap\) await refreshAppPreferences\(\)/,
  "a rejected bootstrap triggers a canonical GET during initialization",
);
assert.match(
  clientStore,
  /if \(!isCanonicalPreferencesPayload\(preferences\)\) return false;[\s\S]*snapshot = [\s\S]*canonical/,
  "a current authoritative payload with voice is accepted and committed to the client snapshot",
);
assert.match(
  clientStore,
  /data\?\.ok && isCanonicalPreferencesPayload\(data\.preferences\)[\s\S]*commitCanonical/,
  "malformed network payloads, including incomplete payloads missing voice, are not committed",
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
  "cave:mobile-mode-enabled",
]) {
  assert.ok(legacyBlock.includes(`"${representative}"`), `migration allowlist includes ${representative}`);
}

const elevenLabsCanonical = applyPreferencesPatch(createDefaultPreferences(true), {
  voice: {
    defaultProvider: "elevenlabs",
    defaultModel: "eleven_turbo_v2_5",
    defaultVoice: "21m00Tcm4TlvDq8ikWAM",
  },
});
const rapidModelWrite = queueAppPreferencesPatch(
  elevenLabsCanonical,
  {},
  { voice: { defaultModel: "eleven_multilingual_v2" } },
);
const rapidModelSnapshot = applyPreferencesPatch(elevenLabsCanonical, rapidModelWrite.patch);
const rapidProviderWrite = queueAppPreferencesPatch(
  rapidModelSnapshot,
  rapidModelWrite.pendingPatch,
  { voice: { defaultProvider: "openai" } },
);
assert.deepEqual(
  rapidProviderWrite.pendingPatch.voice,
  { defaultProvider: "openai", defaultModel: "", defaultVoice: "" },
  "rapid model then provider writes persist explicit clears instead of a stale ElevenLabs model",
);
assert.deepEqual(
  applyPreferencesPatch(elevenLabsCanonical, rapidProviderWrite.pendingPatch).voice,
  { defaultProvider: "openai", defaultModel: "", defaultVoice: "" },
  "the coalesced PATCH produces the same canonical voice state as the optimistic writes",
);

const sameProvider = queueAppPreferencesPatch(
  elevenLabsCanonical,
  {},
  { voice: { defaultProvider: "elevenlabs" } },
);
const sameProviderSnapshot = applyPreferencesPatch(elevenLabsCanonical, sameProvider.patch);
assert.deepEqual(sameProviderSnapshot.voice, elevenLabsCanonical.voice);
assert.equal(
  sameProviderSnapshot.revision,
  elevenLabsCanonical.revision,
  "same-provider reassertion preserves ids and remains a revision no-op",
);

const newerOpenAiModel = { voice: { defaultModel: "gpt-realtime" } };
const reinsertedAfterFailure = mergePreferencesPatches(
  rapidProviderWrite.pendingPatch,
  newerOpenAiModel,
);
assert.deepEqual(
  reinsertedAfterFailure.voice,
  { defaultProvider: "openai", defaultModel: "gpt-realtime", defaultVoice: "" },
  "failed-patch reinsertion preserves materialized clears while newer writes win",
);
const providerWriteWhileModelPatchIsInFlight = queueAppPreferencesPatch(
  rapidModelSnapshot,
  {},
  { voice: { defaultProvider: "openai" } },
);
assert.deepEqual(
  mergePreferencesPatches(
    rapidModelWrite.pendingPatch,
    providerWriteWhileModelPatchIsInFlight.pendingPatch,
  ).voice,
  { defaultProvider: "openai", defaultModel: "", defaultVoice: "" },
  "reinserting a failed older model patch cannot overwrite a newer provider transition",
);
const initializationPatch = mergePreferencesPatches(
  { phone: { mobileMode: false } },
  rapidProviderWrite.pendingPatch,
);
assert.deepEqual(
  initializationPatch.voice,
  { defaultProvider: "openai", defaultModel: "", defaultVoice: "" },
  "initialization migration composition preserves provider-transition clears",
);

assert.match(
  clientStore,
  /queueAppPreferencesPatch\(snapshot, pendingPatch, patch\)/,
  "preference setters should preserve provider-transition clears while coalescing rapid writes",
);
assert.match(
  clientStore,
  /fetch\("\/api\/preferences", \{\s*method: "PATCH"[\s\S]*options\.keepalive \? \{ keepalive: true \} : \{\}/,
  "coalesced writes should persist to the port-independent sidecar store",
);
assert.match(
  clientStore,
  /pendingPatch = mergePreferencesPatches\(patch, pendingPatch\)[\s\S]*ok = false/,
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
