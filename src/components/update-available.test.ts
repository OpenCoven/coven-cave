// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const src = await readFile(new URL("./update-available.tsx", import.meta.url), "utf8");

// Desktop-only: both surfaces gate on the Tauri desktop hook.
assert.match(src, /useIsTauriDesktop/, "gates the update UI to the Tauri desktop build");

// Pulls status from the server route (avoids client CORS / rate limits).
assert.match(src, /\/api\/app\/latest-release/, "fetches update status from the API route");

// Banner trigger pushes a dismissible shell banner with a Download CTA.
assert.match(src, /export function UpdateBannerTrigger/, "exports the banner trigger");
assert.match(src, /pushBanner\(/, "pushes a shell banner when an update is available");
assert.match(src, /label: "Download"[\s\S]*openExternalUrl/, "banner Download CTA opens the release URL");

// Per-version dismissal persists across launches.
assert.match(src, /cave:update:dismissed:/, "persists dismissal keyed by version");
assert.match(src, /onDismiss:\s*\(\)\s*=>\s*markDismissed/, "dismissing the banner records it for that version");

// Settings row exposes Download (when newer) and a manual Check action.
assert.match(src, /export function UpdateSettingsRow/, "exports the settings row");
assert.match(src, /Check for updates/, "settings row offers a manual re-check");

console.log("update-available.test.ts: ok");
