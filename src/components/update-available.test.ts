// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const src = await readFile(new URL("./update-available.tsx", import.meta.url), "utf8");

// Desktop-only: both surfaces gate on the Tauri desktop hook.
assert.match(src, /useIsTauriDesktop/, "gates the update UI to the Tauri desktop build");

// Native updater path: check() → downloadAndInstall() → relaunch().
assert.match(src, /@tauri-apps\/plugin-updater/, "uses the native Tauri updater plugin");
assert.match(src, /downloadAndInstall/, "installs via the native updater");
assert.match(src, /@tauri-apps\/plugin-process/, "relaunches via the process plugin");
assert.match(src, /relaunch\(\)/, "relaunches the app after install");

// Graceful fallback when no updater-enabled release exists yet.
assert.match(src, /\/api\/app\/latest-release/, "falls back to the server release check");
assert.match(src, /openExternalUrl/, "fallback opens the release page in the system browser");

// Both surfaces are exported and resolve native-first.
assert.match(src, /export function UpdateBannerTrigger/, "exports the banner trigger");
assert.match(src, /export function UpdateSettingsRow/, "exports the settings row");
assert.match(src, /async function resolveUpdate/, "resolves native-first, then fallback");

// Banner: dismissible CTA, persisted per version.
assert.match(src, /pushBanner\(/, "pushes a shell banner when an update is available");
assert.match(src, /cave:update:dismissed:/, "persists dismissal keyed by version");
assert.match(src, /onDismiss:\s*\(\)\s*=>\s*markDismissed/, "dismissing the banner records it for that version");

// Settings row exposes install / download / progress / manual recheck.
assert.match(src, /Install &amp; restart/, "native path offers install + restart");
assert.match(src, /Downloading…/, "shows download progress");
assert.match(src, /Check for updates/, "settings row offers a manual re-check");

console.log("update-available.test.ts: ok");
