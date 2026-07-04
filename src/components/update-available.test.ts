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
assert.match(
  src,
  /import \{ openInAppBrowserUrl \} from "@\/lib\/open-external"/,
  "update fallback retains the explicit Cave Browser URL handoff as last-resort recovery",
);
assert.doesNotMatch(
  src,
  /openExternalUrl/,
  "update fallback must not use the legacy external-browser name",
);

// Fallback "Download" resolves a direct platform installer (DMG/MSI/AppImage)
// via the OS plugin instead of dead-ending on the release page.
assert.match(src, /pickDownloadUrl/, "fallback resolves a direct platform installer download");
assert.match(src, /@tauri-apps\/plugin-os/, "resolves the running platform/arch to pick an installer");
assert.match(src, /resolveDownloadUrl\(fb\)/, "fallback download URL is the resolved installer, not the release page");

// Both surfaces are exported and resolve native-first.
assert.match(src, /export function UpdateBannerTrigger/, "exports the banner trigger");
assert.match(src, /export function UpdateSettingsRow/, "exports the settings row");
assert.match(src, /async function resolveUpdate/, "resolves native-first, then fallback");
assert.match(src, /kind:\s*"native-unavailable"/, "preserves native updater check failures as a distinct update state");
assert.match(src, /message:\s*native\.message/, "native updater check failures carry the underlying error message");
assert.doesNotMatch(
  src,
  /async function checkNativeUpdate\([\s\S]*?catch\s*\{\s*return null;[\s\S]*?async function installNativeUpdate/,
  "native updater check failures must not be silently collapsed into the browser fallback path",
);

// Banner: dismissible CTA, persisted per version.
assert.match(src, /pushBanner\(/, "pushes a shell banner when an update is available");
assert.match(src, /cave:update:dismissed:/, "persists dismissal keyed by version");
assert.match(src, /onDismiss:\s*\(\)\s*=>\s*markDismissed/, "dismissing the banner records it for that version");
assert.match(
  src,
  /installNativeUpdate\(r\.update,\s*\(pct\) => \{[\s\S]*Downloading update v\$\{r\.version\}… \$\{pct\}%/,
  "banner native install should surface download progress instead of a static loading state",
);

// Settings row exposes install / installer fallback / progress / manual recheck.
assert.match(src, /Install &amp; restart/, "native path offers install + restart");
assert.match(src, /Downloading…/, "shows download progress");
assert.match(src, /Check for updates/, "settings row offers a manual re-check");
assert.match(src, /Open installer/, "fallback exposes a clear installer recovery action");
assert.match(src, /shell_open/, "fallback installer URLs open through the OS browser/download handler");
assert.match(src, /Native updater unavailable/, "settings row distinguishes native updater failure from a normal installer fallback");
assert.match(src, /Retry native update/, "settings row makes retrying native update the primary recovery action");

// A failed native install must not dead-end: it captures the reason and offers
// installer recovery plus a retry, so the update is always reachable even when
// downloadAndInstall/relaunch throws. The recovery path should resolve the
// platform installer through the same fallback route instead of hardcoding the
// releases page.
assert.match(src, /phase: "failed"/, "tracks a dedicated failed state for a thrown install");
assert.match(src, /message: err instanceof Error \? err\.message/, "captures the real failure reason instead of swallowing it");
assert.match(src, /async function openFallbackInstaller/, "centralizes fallback installer recovery resolution");
assert.match(src, /fetchFallbackStatus\(\)[\s\S]*resolveDownloadUrl/, "fallback recovery resolves a direct platform installer when release metadata is reachable");
assert.match(src, /onClick=\{\(\) => void openFallbackInstaller\(\)\}/, "failed state offers the same installer recovery path as fallback updates");
assert.match(src, /window\.open\(url, "_blank", "noopener"\)/, "non-Tauri fallback opens the installer in a normal browser tab");
assert.match(src, /openInAppBrowserUrl\(url\)/, "Cave Browser remains a final fallback when shell/browser opening fails");
assert.doesNotMatch(src, /download manually/i, "failed updater copy should not imply leaving the app for manual recovery");
assert.doesNotMatch(src, /onClick=\{\(\) => void openInAppBrowserUrl\(RELEASES_PAGE\)\}/, "failed state must not dead-end on the generic release page when a direct installer can be resolved");
assert.match(src, />\s*Retry\s*</, "failed state offers a retry");

console.log("update-available.test.ts: ok");
