// @ts-nocheck
import { act, create } from "react-test-renderer";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const native = vi.hoisted(() => ({ desktop: false, check: vi.fn(), invoke: vi.fn() }));
vi.mock("@/lib/tauri-platform", () => ({
  isTauri: () => native.desktop, useIsTauriDesktop: () => native.desktop,
}));
vi.mock("@tauri-apps/plugin-os", () => ({ platform: () => "windows", arch: () => "x86_64" }));
vi.mock("@/lib/icon", () => ({ Icon: () => null }));

import { UpdateBannerTrigger, UpdateSettingsRow } from "./update-available";
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
  native.check.mockReset(); native.invoke.mockReset();
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
  expect(native.invoke).not.toHaveBeenCalled();
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
