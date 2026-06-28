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
assert.match(src, /openExternalUrl/, "fallback opens the download in the system browser");

// Fallback "Download" resolves a direct platform installer (DMG/MSI/AppImage)
// via the OS plugin instead of dead-ending on the release page.
assert.match(src, /pickDownloadUrl/, "fallback resolves a direct platform installer download");
assert.match(src, /@tauri-apps\/plugin-os/, "resolves the running platform/arch to pick an installer");
assert.match(src, /resolveDownloadUrl\(fb\)/, "fallback download URL is the resolved installer, not the release page");

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

// A failed native install must not dead-end: it captures the reason and offers
// a working manual download plus a retry, so the update is always reachable
// even when downloadAndInstall/relaunch throws. The manual path should resolve
// the platform installer through the same fallback route instead of hardcoding
// the releases page.
assert.match(src, /phase: "failed"/, "tracks a dedicated failed state for a thrown install");
assert.match(src, /message: err instanceof Error \? err\.message/, "captures the real failure reason instead of swallowing it");
assert.match(src, /async function openManualDownload/, "centralizes manual-download fallback resolution");
assert.match(src, /fetchFallbackStatus\(\)[\s\S]*resolveDownloadUrl/, "manual download resolves a direct platform installer when release metadata is reachable");
assert.match(src, /onClick=\{\(\) => void openManualDownload\(\)\}/, "failed state offers the same direct manual download path as fallback updates");
assert.doesNotMatch(src, /onClick=\{\(\) => void openExternalUrl\(RELEASES_PAGE\)\}/, "failed state must not dead-end on the generic release page when a direct installer can be resolved");
assert.match(src, />\s*Retry\s*</, "failed state offers a retry");

console.log("update-available.test.ts: ok");
