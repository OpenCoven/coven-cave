// @ts-nocheck
import { act, create } from "react-test-renderer";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const native = vi.hoisted(() => ({ desktop: false, check: vi.fn(), invoke: vi.fn(), relaunch: vi.fn(), order: [] }));
vi.mock("@/lib/tauri-platform", () => ({
  isTauri: () => native.desktop, useIsTauriDesktop: () => native.desktop,
}));
vi.mock("@tauri-apps/plugin-os", () => ({ platform: () => "windows", arch: () => "x86_64" }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: () => native.relaunch() }));
vi.mock("@/lib/icon", () => ({ Icon: () => null }));

import { UpdateBannerTrigger, UpdateInstalledRelaunchError, UpdateSettingsRow, installPreparedUpdate } from "./update-available";
import { ShellBannersProvider, useShellBanners } from "@/lib/shell-banners";
import { LiveRegionProvider } from "@/components/ui/live-region";
import { nativeUpdateCoordinator } from "@/lib/native-update-coordinator";

await import("@tauri-apps/plugin-updater");
await import("@tauri-apps/api/core");
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let tree;
let banners;
let release;
let popup;
let beginAction;
function Probe() { banners = useShellBanners().banners; return null; }
async function mount(child) {
  await act(async () => {
    tree = create(<LiveRegionProvider><ShellBannersProvider>{child}<Probe /></ShellBannersProvider></LiveRegionProvider>);
  });
}
function text() { return JSON.stringify(tree.toJSON()); }
function button(label) {
  return tree.root.findAllByType("button").find(b => b.children.filter(c => typeof c === "string").join("").trim().toLowerCase().replace("system browser", "browser") === label.toLowerCase().replace("system browser", "browser"));
}
beforeEach(() => {
  native.desktop = false;
  native.check.mockReset(); native.invoke.mockReset(); native.relaunch.mockReset();
  beginAction = vi.spyOn(nativeUpdateCoordinator, "beginAction");
  popup = { opener: {}, location: { replace: vi.fn() }, close: vi.fn() };
  vi.stubGlobal("window", {
    open: vi.fn(() => popup), dispatchEvent: vi.fn(),
    localStorage: { getItem: () => null, setItem: vi.fn() },
    sessionStorage: { setItem: vi.fn() },
    location: { pathname: "/", assign: vi.fn() },
    setInterval, clearInterval,
  });
  release = { current: "1.0.0", latest: "9.9.9", available: true,
    notes: "## Notes\nRésumé <script>text only</script>",
    url: "https://github.com/OpenCoven/coven-cave/releases/tag/v9.9.9",
    downloads: { "windows-x86_64": "https://example.com/Cave.msi" },
    checkedAt: "2026-10-20T00:00:00.000Z" };
  vi.stubGlobal("fetch", vi.fn(async () => Response.json(release)));
});
afterEach(async () => {
  if (tree) await act(async () => tree.unmount());
  tree = null;
  // An installed update keeps its action; release it so the next test starts clean.
  for (const [, update] of beginAction.mock.calls) await nativeUpdateCoordinator.invalidate(update);
  beginAction.mockRestore();
  await nativeUpdateCoordinator.reportCurrent();
  vi.unstubAllGlobals();
});

test("fallback notes render as text in a labelled disclosure", async () => {
  await mount(<UpdateSettingsRow />);
  expect(text()).toContain("Release notes");
  expect(text()).toContain("Résumé <script>text only</script>");
  expect(tree.root.findAllByType("script")).toHaveLength(0);
  expect(tree.root.findAllByType("details")).toHaveLength(1);
});

test("missing notes do not create an empty disclosure", async () => {
  delete release.notes;
  await mount(<UpdateSettingsRow />);
  expect(tree.root.findAllByType("details")).toHaveLength(0);
  expect(button("Open installer in system browser")).toBeDefined();
});

test("native metadata reaches both notes surfaces without installing", async () => {
  native.desktop = true;
  window.__TAURI_INTERNALS__ = { invoke: (command, args) => command === "plugin:updater|check" ? native.check() : command === "plugin:resources|close" ? Promise.resolve() : native.invoke(command, args) };
  const update = { rid: 7, currentVersion: "1.0.0", version: "9.9.9", body: "Native release text" };
  native.check.mockImplementation(async () => ({ ...update }));
  await mount(<><UpdateSettingsRow /><UpdateBannerTrigger /></>);
  expect(text()).toContain("Native release text");
  expect(banners.find(b => b.id === "update-available").releaseNotes).toBe("Native release text");
  // Only the read-only Windows install-outcome lookup; nothing installs.
  expect(native.invoke.mock.calls.map(([command]) => command)).toEqual(["update_install_outcome"]);
});

function nativeIpc() {
  native.desktop = true;
  window.__TAURI_INTERNALS__ = { invoke: (command, args) => command === "plugin:updater|check" ? native.check() : command === "plugin:resources|close" ? Promise.resolve() : native.invoke(command, args) };
}

test("a declined Windows install relaunch explains the outcome and retries the update", async () => {
  nativeIpc();
  native.check.mockImplementation(async () => ({ rid: 8, currentVersion: "1.0.0", version: "9.9.9", body: "Notes" }));
  native.invoke.mockImplementation(async (command) =>
    command === "update_install_outcome"
      ? { kind: "cancelled", exitCode: 1602, logPath: "C:\\logs\\msi.log" }
      : undefined);
  await mount(<UpdateBannerTrigger />);
  const outcome = banners.find(b => b.id === "update-install-outcome");
  expect(outcome.severity).toBe("warning");
  expect(outcome.title).toBe("Update wasn't installed: the Windows permission prompt was declined or cancelled");
  expect(outcome.detail).toContain("Installer log: C:\\logs\\msi.log");
  expect(outcome.cta.label).toBe("Retry update");
  expect(native.invoke).not.toHaveBeenCalledWith("clear_update_install_outcome", expect.anything());
  const checks = native.check.mock.calls.length;
  await act(async () => outcome.cta.onClick());
  expect(banners.find(b => b.id === "update-install-outcome")).toBeUndefined();
  expect(native.invoke.mock.calls.map(([command]) => command)).toContain("clear_update_install_outcome");
  expect(native.check.mock.calls.length).toBe(checks + 1);
  expect(banners.find(b => b.id === "update-available").cta.label).toBe("Download update");
});

test("dismissing the install outcome clears it; no outcome shows no banner", async () => {
  nativeIpc();
  native.check.mockImplementation(async () => null);
  native.invoke.mockImplementation(async (command) =>
    command === "update_install_outcome" ? { kind: "failed", exitCode: 1603, logPath: null } : undefined);
  await mount(<UpdateBannerTrigger />);
  await act(async () => banners.find(b => b.id === "update-install-outcome").onDismiss());
  expect(native.invoke.mock.calls.map(([command]) => command)).toContain("clear_update_install_outcome");
  await act(async () => tree.unmount());
  native.invoke.mockReset();
  native.invoke.mockImplementation(async () => null);
  await mount(<UpdateBannerTrigger />);
  expect(banners.find(b => b.id === "update-install-outcome")).toBeUndefined();
});

test("Windows install recovery is armed before install and disarmed when install fails", async () => {
  nativeIpc();
  const order = [];
  native.invoke.mockImplementation(async (command) => { order.push(command); });
  const failing = { install: vi.fn(async () => { order.push("install"); throw new Error("extract failed"); }) };
  await expect(installPreparedUpdate(failing)).rejects.toThrow("extract failed");
  expect(order).toEqual(["arm_update_install_recovery", "install", "disarm_update_install_recovery"]);
});

test("an unarmable Windows install refuses to start rather than risk a closed app", async () => {
  nativeIpc();
  native.invoke.mockImplementation(async (command) => {
    if (command === "arm_update_install_recovery") throw new Error("disk full");
  });
  const update = { install: vi.fn() };
  await expect(installPreparedUpdate(update)).rejects.toThrow("couldn't prepare install recovery: disk full");
  expect(update.install).not.toHaveBeenCalled();
});

// install() replaces the app bundle, and with it every chunk the running build
// can still fetch from its own server. A relaunch loaded afterwards fails with
// "Failed to load chunk", which v0.5.20 reported as a failed update although
// the new version was on disk.
test("the relaunch code is loaded before install() replaces the app bundle", async () => {
  nativeIpc();
  // A fresh module graph whose relaunch module records when it is first
  // evaluated, as a chunk fetch would in the packaged app.
  native.order.length = 0;
  vi.resetModules();
  vi.doMock("@tauri-apps/plugin-process", () => {
    native.order.push("load relaunch code");
    return { relaunch: async () => { native.order.push("relaunch"); } };
  });
  try {
    const fresh = await import("./update-available");
    expect(native.order).toEqual([]);
    const update = { install: vi.fn(async () => { native.order.push("install"); }) };
    await fresh.installPreparedUpdate(update);
    expect(native.order).toEqual(["load relaunch code", "install", "relaunch"]);
  } finally {
    vi.doMock("@tauri-apps/plugin-process", () => ({ relaunch: () => native.relaunch() }));
    vi.resetModules();
  }
});

test("a relaunch that fails after install() reports an installed update, not a failed one", async () => {
  nativeIpc();
  native.relaunch.mockRejectedValue(new Error("restart refused"));
  const update = { install: vi.fn(async () => {}) };
  const failure = await installPreparedUpdate(update).catch((error) => error);
  expect(update.install).toHaveBeenCalledTimes(1);
  expect(failure).toBeInstanceOf(UpdateInstalledRelaunchError);
  expect(failure.message).toContain("restart refused");
  // Nothing was rolled back: Windows recovery stays armed for the installer.
  expect(native.invoke.mock.calls.map(([command]) => command)).not.toContain("disarm_update_install_recovery");
});

function installableIpc() {
  native.desktop = true;
  window.__TAURI_INTERNALS__ = {
    transformCallback: () => 1,
    invoke: (command, args) =>
      command === "plugin:updater|check" ? native.check()
        : command === "plugin:updater|download" ? Promise.resolve(41)
        : command === "plugin:updater|install" ? Promise.resolve()
        : command === "plugin:resources|close" ? Promise.resolve()
        : native.invoke(command, args),
  };
  native.check.mockImplementation(async () => ({ rid: 9, currentVersion: "1.0.0", version: "9.9.9", body: "Notes" }));
  native.invoke.mockImplementation(async () => undefined);
  native.relaunch.mockRejectedValue(new Error("restart refused"));
}

test("Settings says the update is installed and asks for a reopen when the relaunch fails", async () => {
  installableIpc();
  await mount(<UpdateSettingsRow />);
  await act(async () => button("Download update").props.onClick());
  await act(async () => button("Restart & install").props.onClick());
  expect(text()).toContain("v9.9.9 installed");
  expect(text()).toContain("Quit and reopen CovenCave to finish updating.");
  expect(text()).not.toContain("Update failed");
  expect(button("Open release page in system browser")).toBeUndefined();
});

test("the banner says the update is installed and offers no release-page detour when the relaunch fails", async () => {
  installableIpc();
  await mount(<UpdateBannerTrigger />);
  await act(async () => banners.find(b => b.id === "update-available").cta.onClick());
  expect(banners.find(b => b.id === "update-available").cta.label).toBe("Restart & install");
  await act(async () => banners.find(b => b.id === "update-available").cta.onClick());
  const banner = banners.find(b => b.id === "update-available");
  expect(banner.title).toBe("CovenCave v9.9.9 is installed. Quit and reopen CovenCave to finish updating.");
  expect(banner.cta).toBeUndefined();
  expect(banners.some(b => b.id.startsWith("update-browser-handoff"))).toBe(false);
});

test("blocked browser handoff has retry and never opens the embedded Browser", async () => {
  window.open.mockReturnValue(null);
  await mount(<UpdateSettingsRow />);
  await act(async () => button("Open installer in system browser").props.onClick());
  const failure = banners.find(b => b.id === "update-browser-handoff-settings");
  expect(failure.title).toContain("Couldn't open");
  expect(failure.detail).toBe("https://example.com/Cave.msi");
  expect(window.dispatchEvent).not.toHaveBeenCalled();
  expect(window.sessionStorage.setItem).not.toHaveBeenCalled();
  window.open.mockReturnValue(popup);
  await act(async () => failure.cta.onClick());
  expect(popup.location.replace).toHaveBeenCalledWith("https://example.com/Cave.msi");
  expect(popup.opener).toBe(null);
  expect(banners.find(b => b.id === "update-browser-handoff-settings")).toBeUndefined();
});

test("native failure uses the canonical release page, with failed shell handoff retry", async () => {
  native.desktop = true;
  window.__TAURI_INTERNALS__ = { invoke: (command, args) => command === "plugin:updater|check" ? native.check() : command === "plugin:resources|close" ? Promise.resolve() : native.invoke(command, args) };
  native.check.mockRejectedValue(new Error("signature unavailable"));
  native.invoke.mockRejectedValue(new Error("shell unavailable"));
  await mount(<UpdateSettingsRow />);
  await act(async () => button("Open release page in system browser").props.onClick());
  expect(native.invoke).toHaveBeenCalledWith("shell_open", { url: "https://github.com/OpenCoven/coven-cave/releases/latest" });
  expect(window.dispatchEvent).not.toHaveBeenCalled();
  expect(banners.find(b => b.id === "update-browser-handoff-settings")).toBeDefined();
  native.invoke.mockResolvedValue(undefined);
  await act(async () => banners.find(b => b.id === "update-browser-handoff-settings").cta.onClick());
  expect(banners.find(b => b.id === "update-browser-handoff-settings")).toBeUndefined();
});

test("a successful recheck replaces notes with the newly reported version", async () => {
  const actionRef = { current: null };
  await mount(<UpdateSettingsRow actionRef={actionRef} />);
  expect(text()).toContain("Résumé");
  release = { ...release, latest: "10.0.0", notes: "Only the new release notes" };
  await act(async () => actionRef.current.check());
  expect(text()).toContain("Only the new release notes");
  expect(text()).not.toContain("Résumé");
  release = { ...release, available: false, current: "10.0.0" };
  await act(async () => actionRef.current.check());
  expect(tree.root.findAllByType("details")).toHaveLength(0);
});

test("leaving About removes its handoff warning while the shell stays mounted", async () => {
  window.open.mockReturnValue(null);
  await mount(<UpdateSettingsRow />);
  await act(async () => button("Open installer in system browser").props.onClick());
  expect(banners.some(b => b.id.startsWith("update-browser-handoff"))).toBe(true);
  await act(async () => {
    tree.update(<LiveRegionProvider><ShellBannersProvider><Probe /></ShellBannersProvider></LiveRegionProvider>);
  });
  expect(banners.some(b => b.id.startsWith("update-browser-handoff"))).toBe(false);
});

// A debug shell registers no updater (tauri_setup.rs), and Tauri rejects the
// call with this exact string. That is "updates off", not a failure: no banner,
// and no fall-through to the browser installer, which a dev build must not
// offer either. Settings says why.
test("a debug shell without the updater offers no update anywhere", async () => {
  nativeIpc();
  native.check.mockImplementation(async () => {
    throw "plugin updater not found";
  });
  await mount(<><UpdateSettingsRow /><UpdateBannerTrigger /></>);
  expect(banners.find(b => b.id === "update-available")).toBeUndefined();
  expect(fetch.mock.calls.some(([url]) => String(url).includes("/api/app/latest-release"))).toBe(false);
  expect(text()).toContain("Development builds don't install updates.");
  expect(button("Open installer in system browser")).toBeUndefined();
});
