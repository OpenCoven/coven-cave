// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { prepareNativeUpdate } from "../lib/native-update-preparation.ts";
import {
  adoptNativeUpdateResult,
  NativeUpdateCoordinator,
} from "../lib/native-update-coordinator.ts";

const [src, preparationSrc] = await Promise.all([
  readFile(new URL("./update-available.tsx", import.meta.url), "utf8"),
  readFile(new URL("../lib/native-update-preparation.ts", import.meta.url), "utf8"),
]);

// Desktop-only: both surfaces gate on the Tauri desktop hook.
assert.match(src, /useIsTauriDesktop/, "gates the update UI to the Tauri desktop build");
assert.match(src, /import \{ Button \}/, "update row actions use the shared Button primitive");
assert.doesNotMatch(src, /<button\b/, "update row should not hand-roll button controls");
assert.doesNotMatch(
  src,
  /rounded-md|rounded-lg|rounded(?=\s|")|rounded-\[4px\]/,
  "update row controls should use tokenized radii instead of hard-coded rounded classes",
);

// Native updater path: check() → download/signature verification → explicit
// install/relaunch. The old app remains usable until restart is chosen.
assert.match(src, /@tauri-apps\/plugin-updater/, "uses the native Tauri updater plugin");
assert.match(preparationSrc, /update\.download\(/, "downloads through the native updater");
assert.match(src, /update\.install\(\)/, "installs the prepared native update");
assert.doesNotMatch(src, /downloadAndInstall/, "does not combine download with immediate process exit");
assert.match(src, /@tauri-apps\/plugin-process/, "relaunches via the process plugin");
assert.match(src, /relaunch\(\)/, "relaunches the app after install");
assert.match(preparationSrc, /phase: "verifying"/, "shows signature verification as a distinct phase");
assert.match(preparationSrc, /update\.close\(\)/, "releases cancelled or discarded update resources");

// Graceful fallback when no updater-enabled release exists yet.
assert.match(src, /\/api\/app\/latest-release/, "falls back to the server release check");
assert.match(
  src,
  /import \{ openInAppBrowserUrl \} from "@\/lib\/open-external"/,
  "update fallback should use the explicit Cave Browser URL handoff",
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
  /async function checkNativeUpdate\([\s\S]*?catch\s*\{\s*return null;[\s\S]*?async function prepareNativeUpdate/,
  "native updater check failures must not be silently collapsed into the browser fallback path",
);

// Banner: long-running desktops re-check periodically — a mount-only check
// would leave always-on instances permanently unaware of new releases.
assert.match(src, /setInterval\(runCheck, RECHECK_INTERVAL_MS\)/, "banner re-checks for updates on an interval");
assert.match(src, /clearInterval\(interval\)/, "banner re-check interval is torn down on unmount");
assert.match(
  src,
  /if \(busy\) return;/,
  "a periodic re-check must not clobber an in-flight install's progress banner",
);

// Banner: dismissible CTA, persisted per version.
assert.match(src, /pushBanner\(/, "pushes a shell banner when an update is available");
assert.match(src, /cave:update:dismissed:/, "persists dismissal keyed by version");
assert.match(src, /onDismiss:\s*\(\)\s*=>\s*markDismissed/, "dismissing the banner records it for that version");
assert.match(
  src,
  /prepareNativeUpdate\([\s\S]*Downloading update v\$\{r\.version\}… \$\{pct\}%/,
  "banner native preparation should surface download progress instead of a static loading state",
);
assert.match(src, /label: "Cancel"/, "banner exposes cooperative cancellation");
assert.match(src, /Update v\$\{r\.version\} is verified and ready/, "banner waits for verification before install");

// Settings row exposes install / in-app fallback / progress / manual recheck.
assert.match(src, /Download update/, "native path prepares the update without exiting the app");
assert.match(src, /Downloading…/, "shows download progress");
assert.match(src, /Verifying signature…/, "shows signature verification progress");
assert.match(src, /Restart &amp; install/, "prepared update offers an explicit restart action");
assert.match(src, />\s*Cancel\s*</, "settings row allows preparation cancellation");
assert.match(src, /Check for updates/, "settings row offers a manual re-check");
assert.match(src, /Open installer in Browser/, "fallback keeps installer recovery inside Cave's Browser surface");
assert.match(src, /Native updater unavailable/, "settings row distinguishes native updater failure from a normal installer fallback");
assert.match(src, /Retry native update/, "settings row makes retrying native update the primary recovery action");

// A failed native install must not bypass the signed updater by resolving a
// direct installer asset from release metadata. It captures the reason, keeps
// recovery inside Cave, and sends users to the canonical release page instead.
assert.match(src, /phase: "failed"/, "tracks a dedicated failed state for a thrown install");
assert.match(src, /message: err instanceof Error \? err\.message/, "captures the real failure reason instead of swallowing it");
assert.match(src, /function openReleasePageInBrowser/, "centralizes failed-updater recovery");
assert.match(src, /openInAppBrowserUrl\(RELEASES_PAGE\)/, "failed updater recovery opens the canonical release page");
assert.doesNotMatch(src, /openFallbackUpdateInBrowser/, "updater recovery must not resolve direct installer assets");
assert.doesNotMatch(src, /fetchFallbackStatus\(\)[\s\S]*resolveDownloadUrl[\s\S]*openInAppBrowserUrl\(url\)/, "updater recovery must not open metadata-derived direct installer URLs");
assert.match(src, /Open release page in Browser/, "updater recovery labels the destination as the release page");
assert.match(
  src,
  /state\.phase === "native-unavailable"[\s\S]{0,900}?onClick=\{openReleasePageInBrowser\}/,
  "native-unavailable settings row opens the canonical release page",
);
assert.doesNotMatch(
  src,
  /state\.phase === "native-unavailable"[\s\S]{0,900}?openInAppBrowserUrl\(r\.url\)/,
  "native-unavailable settings row must not reuse a stale installer URL from the initial check",
);
assert.doesNotMatch(src, /download manually/i, "failed updater copy should not imply leaving the app for manual recovery");
assert.match(src, />\s*Retry\s*</, "failed state offers a retry");

{
  const progress = [];
  let closeCalls = 0;
  let installCalls = 0;
  const update = {
    version: "9.9.9",
    async download(onEvent) {
      onEvent?.({ event: "Started", data: { contentLength: 100 } });
      onEvent?.({ event: "Progress", data: { chunkLength: 50 } });
      onEvent?.({ event: "Finished" });
    },
    async install() {
      installCalls += 1;
    },
    async close() {
      closeCalls += 1;
    },
  };

  const result = await prepareNativeUpdate(update, (event) => progress.push(event), {
    cancelled: false,
  });
  assert.equal(result, "ready", "a verified download becomes ready without installing");
  assert.deepEqual(
    progress,
    [
      { phase: "downloading", pct: 0 },
      { phase: "downloading", pct: 50 },
      { phase: "verifying", pct: 99 },
    ],
    "download and signature verification progress stay distinct",
  );
  assert.equal(installCalls, 0, "preparation must not install or exit the running app");
  assert.equal(closeCalls, 0, "ready bytes remain available for explicit install");
}

{
  const cancellation = { cancelled: false };
  let closeCalls = 0;
  const update = {
    version: "9.9.9",
    async download(onEvent) {
      onEvent?.({ event: "Started", data: { contentLength: 10 } });
      cancellation.cancelled = true;
      onEvent?.({ event: "Finished" });
    },
    async install() {},
    async close() {
      closeCalls += 1;
    },
  };

  const result = await prepareNativeUpdate(update, () => undefined, cancellation);
  assert.equal(result, "cancelled", "cooperative cancellation settles deterministically");
  assert.equal(closeCalls, 1, "cancelled verified bytes are released exactly once");
}

{
  let closeCalls = 0;
  const update = {
    version: "9.9.9",
    async download() {
      throw new Error("network interrupted");
    },
    async install() {},
    async close() {
      closeCalls += 1;
    },
  };

  await assert.rejects(
    prepareNativeUpdate(update, () => undefined, { cancelled: false }),
    /network interrupted/,
    "real download failures remain actionable errors",
  );
  assert.equal(closeCalls, 0, "the caller owns cleanup for a non-cancellation failure");
}

function mockUpdate(version = "9.9.9") {
  let closeCalls = 0;
  return {
    handle: {
      version,
      async download() {},
      async install() {},
      async close() {
        closeCalls += 1;
      },
    },
    closeCalls: () => closeCalls,
  };
}

{
  const coordinator = new NativeUpdateCoordinator();
  const banner = Symbol("dismissed-banner");
  const update = mockUpdate();
  await coordinator.adopt(banner, update.handle);
  await coordinator.release(banner);
  await coordinator.release(banner);
  assert.equal(update.closeCalls(), 1, "a dismissed banner releases its native handle exactly once");
}

{
  const coordinator = new NativeUpdateCoordinator();
  const settings = Symbol("available-settings-row");
  const update = mockUpdate();
  await coordinator.adopt(settings, update.handle);
  await coordinator.release(settings);
  assert.equal(update.closeCalls(), 1, "unmounting an available Settings row releases its native handle");
}

{
  const coordinator = new NativeUpdateCoordinator();
  const banner = Symbol("banner");
  const settings = Symbol("settings");
  const primary = mockUpdate();
  const duplicate = mockUpdate();
  const bannerHandle = await coordinator.adopt(banner, primary.handle);
  const settingsHandle = await coordinator.adopt(settings, duplicate.handle);

  assert.equal(settingsHandle, bannerHandle, "both surfaces share one retained native update");
  assert.equal(duplicate.closeCalls(), 1, "the redundant native check resource is closed immediately");
  assert.equal(coordinator.beginAction(banner, bannerHandle), true);
  assert.equal(
    coordinator.beginAction(settings, settingsHandle),
    false,
    "only one surface may prepare or install the shared update",
  );
  await coordinator.release(settings);
  assert.equal(primary.closeCalls(), 0, "a participating surface cannot close another surface's action");
  await coordinator.finishAction(banner);
  await coordinator.release(banner);
  assert.equal(primary.closeCalls(), 1, "the shared handle closes when its final owner releases it");
  await coordinator.invalidate(primary.handle);
  assert.equal(primary.closeCalls(), 1, "invalidation remains close-once after release");
}

{
  const coordinator = new NativeUpdateCoordinator();
  const banner = Symbol("racing-banner");
  const settings = Symbol("racing-settings");
  const primary = mockUpdate();
  let finishDuplicateClose;
  const duplicate = {
    version: "9.9.9",
    async download() {},
    async install() {},
    async close() {
      await new Promise((resolve) => {
        finishDuplicateClose = resolve;
      });
    },
  };
  await coordinator.adopt(banner, primary.handle);
  const adoptingSettings = coordinator.adopt(settings, duplicate);
  await Promise.resolve();
  await coordinator.release(banner);
  finishDuplicateClose();
  assert.equal(
    await adoptingSettings,
    primary.handle,
    "a lease acquired during redundant-resource disposal keeps the shared handle alive",
  );
  assert.equal(primary.closeCalls(), 0);
  await coordinator.release(settings);
  assert.equal(primary.closeCalls(), 1);
}

{
  const coordinator = new NativeUpdateCoordinator();
  const banner = Symbol("version-banner");
  const settings = Symbol("version-settings");
  const v1 = mockUpdate("1.0.0");
  const duplicateV1 = mockUpdate("1.0.0");
  const v2 = mockUpdate("2.0.0");
  const snapshots = [];
  coordinator.subscribe((snapshot) => snapshots.push(snapshot.update?.version ?? null));
  await coordinator.adopt(banner, v1.handle);
  await coordinator.adopt(settings, duplicateV1.handle);

  assert.equal(await coordinator.adopt(settings, v2.handle), v2.handle);
  assert.equal(v1.closeCalls(), 1, "replacing v1 closes the retained old handle once");
  assert.equal(duplicateV1.closeCalls(), 1, "the redundant v1 check also closes once");
  assert.deepEqual(snapshots, ["2.0.0"], "both surfaces are notified to replace stale v1 CTAs");
  await coordinator.release(banner);
  assert.equal(v2.closeCalls(), 0, "v2 remains while Settings still owns it");
  await coordinator.release(settings);
  assert.equal(v2.closeCalls(), 1);
}

{
  const coordinator = new NativeUpdateCoordinator();
  const fastSurface = Symbol("fast-newer-check");
  const slowSurface = Symbol("slow-stale-check");
  const v2 = mockUpdate("2.0.0");
  const staleV1 = mockUpdate("1.0.0");
  await coordinator.adopt(fastSurface, v2.handle);
  assert.equal(
    await coordinator.adopt(slowSurface, staleV1.handle),
    v2.handle,
    "a slower stale check cannot replace a newer retained release",
  );
  assert.equal(staleV1.closeCalls(), 1);
  assert.equal(v2.closeCalls(), 0);
  await coordinator.release(fastSurface);
  await coordinator.release(slowSurface);
  assert.equal(v2.closeCalls(), 1);
}

{
  const coordinator = new NativeUpdateCoordinator();
  const banner = Symbol("current-banner");
  const settings = Symbol("current-settings");
  const v1 = mockUpdate("1.0.0");
  const duplicateV1 = mockUpdate("1.0.0");
  const snapshots = [];
  coordinator.subscribe((snapshot) => snapshots.push(snapshot.update?.version ?? null));
  await coordinator.adopt(banner, v1.handle);
  await coordinator.adopt(settings, duplicateV1.handle);
  await coordinator.reportCurrent();

  assert.equal(v1.closeCalls(), 1, "a no-update recheck releases the formerly available handle");
  assert.equal(duplicateV1.closeCalls(), 1);
  assert.deepEqual(snapshots, [null], "all mounted surfaces are told to remove stale update CTAs");
  await coordinator.release(banner);
  await coordinator.release(settings);
  assert.equal(v1.closeCalls(), 1, "later surface cleanup does not double-close v1");
}

{
  const coordinator = new NativeUpdateCoordinator();
  const banner = Symbol("active-banner");
  const settings = Symbol("active-settings");
  const v1 = mockUpdate("1.0.0");
  const duplicateV1 = mockUpdate("1.0.0");
  const v2 = mockUpdate("2.0.0");
  const snapshots = [];
  coordinator.subscribe((snapshot) => snapshots.push(snapshot.update?.version ?? null));
  const retainedV1 = await coordinator.adopt(banner, v1.handle);
  await coordinator.adopt(settings, duplicateV1.handle);
  assert.equal(coordinator.beginAction(banner, retainedV1), true);

  assert.equal(
    await coordinator.adopt(settings, v2.handle),
    retainedV1,
    "a newer candidate is deferred while v1 preparation/install owns the action",
  );
  assert.equal(v1.closeCalls(), 0);
  assert.equal(v2.closeCalls(), 0, "the deferred v2 resource remains available for promotion");
  assert.deepEqual(snapshots, []);

  await coordinator.finishAction(banner);
  assert.equal(v1.closeCalls(), 1);
  assert.equal(v2.closeCalls(), 0);
  assert.deepEqual(snapshots, ["2.0.0"], "v2 promotion invalidates stale v1 CTAs after the action");
  await coordinator.release(banner);
  await coordinator.release(settings);
  assert.equal(v1.closeCalls(), 1);
  assert.equal(v2.closeCalls(), 1, "the promoted handle closes exactly once after final release");
}

{
  const coordinator = new NativeUpdateCoordinator();
  const staleCurrentSurface = Symbol("slow-current-check");
  const newerSurface = Symbol("fast-newer-check");
  const staleCurrentEpoch = coordinator.beginCheck();
  const newerEpoch = coordinator.beginCheck();
  const v2 = mockUpdate("2.0.0");

  await coordinator.adopt(newerSurface, v2.handle, newerEpoch);
  await coordinator.reportCurrent(staleCurrentEpoch);

  assert.equal(v2.closeCalls(), 0, "a stale no-update result cannot clear a newer adopted release");
  assert.equal(
    coordinator.beginAction(newerSurface, v2.handle),
    true,
    "the newer release remains actionable after the stale result settles",
  );
  await coordinator.finishAction(newerSurface);
  await coordinator.release(newerSurface);
  await coordinator.release(staleCurrentSurface);
  assert.equal(v2.closeCalls(), 1);
}

{
  const coordinator = new NativeUpdateCoordinator();
  const staleAvailableSurface = Symbol("slow-available-check");
  const staleAvailableEpoch = coordinator.beginCheck();
  const newerCurrentEpoch = coordinator.beginCheck();
  const staleV2 = mockUpdate("2.0.0");

  await coordinator.reportCurrent(newerCurrentEpoch);
  assert.equal(
    await coordinator.adopt(staleAvailableSurface, staleV2.handle, staleAvailableEpoch),
    null,
    "an older available result is rejected after a newer no-update result settles",
  );
  assert.equal(staleV2.closeCalls(), 1, "the rejected native handle closes exactly once");
  await coordinator.invalidate(staleV2.handle);
  assert.equal(staleV2.closeCalls(), 1, "later invalidation cannot double-close the stale handle");
  assert.equal(
    coordinator.beginAction(staleAvailableSurface, staleV2.handle),
    false,
    "the stale available result never becomes actionable",
  );
}

{
  const coordinator = new NativeUpdateCoordinator();
  const staleBanner = Symbol("stale-banner-result");
  const newerSettings = Symbol("newer-settings-result");
  const staleEpoch = coordinator.beginCheck();
  const newerEpoch = coordinator.beginCheck();
  const staleV1 = mockUpdate("1.0.0");
  const v2 = mockUpdate("2.0.0");
  await coordinator.adopt(newerSettings, v2.handle, newerEpoch);

  const uiResult = await adoptNativeUpdateResult(
    coordinator,
    staleBanner,
    staleV1.handle,
    staleEpoch,
  );

  assert.equal(uiResult.kind, "available", "the stale UI check still observes retained availability");
  assert.equal(
    uiResult.update,
    v2.handle,
    "the component receives the retained newer handle instead of rendering Up to date",
  );
  assert.equal(staleV1.closeCalls(), 1, "the rejected stale candidate closes exactly once");
  await coordinator.release(newerSettings);
  assert.equal(v2.closeCalls(), 0, "the stale caller owns the retained newer handle it observes");
  await coordinator.release(staleBanner);
  assert.equal(v2.closeCalls(), 1, "the retained handle closes after the UI caller releases ownership");
}

{
  const coordinator = new NativeUpdateCoordinator();
  const activeSurface = Symbol("active-v1-surface");
  const newerSurface = Symbol("pending-v2-surface");
  const v1 = mockUpdate("1.0.0");
  const v2 = mockUpdate("2.0.0");
  const retainedV1 = await coordinator.adopt(activeSurface, v1.handle);
  assert.equal(coordinator.beginAction(activeSurface, retainedV1), true);
  const staleCurrentEpoch = coordinator.beginCheck();
  const newerEpoch = coordinator.beginCheck();

  await coordinator.adopt(newerSurface, v2.handle, newerEpoch);
  await coordinator.reportCurrent(staleCurrentEpoch);
  await coordinator.finishAction(activeSurface);

  assert.equal(v1.closeCalls(), 1, "finishing the active action retires v1 once");
  assert.equal(v2.closeCalls(), 0, "a stale no-update result cannot discard deferred v2");
  assert.equal(
    coordinator.beginAction(newerSurface, v2.handle),
    true,
    "the deferred newer release is promoted after the active action",
  );
  await coordinator.finishAction(newerSurface);
  await coordinator.release(activeSurface);
  await coordinator.release(newerSurface);
  assert.equal(v2.closeCalls(), 1);
}

{
  const coordinator = new NativeUpdateCoordinator();
  const activeSurface = Symbol("active-current-wins");
  const staleAvailableSurface = Symbol("stale-pending-available");
  const v1 = mockUpdate("1.0.0");
  const staleV2 = mockUpdate("2.0.0");
  const retainedV1 = await coordinator.adopt(activeSurface, v1.handle);
  assert.equal(coordinator.beginAction(activeSurface, retainedV1), true);
  const staleAvailableEpoch = coordinator.beginCheck();
  const newerCurrentEpoch = coordinator.beginCheck();

  await coordinator.reportCurrent(newerCurrentEpoch);
  assert.equal(
    await coordinator.adopt(staleAvailableSurface, staleV2.handle, staleAvailableEpoch),
    null,
    "an older available result cannot override a newer deferred no-update result",
  );
  assert.equal(staleV2.closeCalls(), 1, "the stale deferred candidate closes exactly once");
  await coordinator.finishAction(activeSurface);
  assert.equal(v1.closeCalls(), 1, "the newer no-update result clears v1 after its action finishes");
  assert.equal(
    coordinator.beginAction(staleAvailableSurface, staleV2.handle),
    false,
    "the rejected candidate is never promoted after the action",
  );
  await coordinator.release(activeSurface);
  await coordinator.release(staleAvailableSurface);
  assert.equal(staleV2.closeCalls(), 1);
}

console.log("update-available.test.ts: ok");
