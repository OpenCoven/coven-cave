// @ts-nocheck
import { act, create } from "react-test-renderer";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const native = vi.hoisted(() => ({ tauri: true, platform: vi.fn(), setTheme: vi.fn() }));
vi.mock("@/lib/tauri-platform", () => ({ isTauri: () => native.tauri }));
vi.mock("@tauri-apps/plugin-os", () => ({ platform: native.platform }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ setTheme: native.setTheme }) }));
import { TauriWindowsTheme } from "./tauri-windows-theme";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let tree;
let mode;
let observer;
beforeEach(() => {
  mode = "dark";
  native.tauri = true;
  native.platform.mockReset().mockReturnValue("windows");
  native.setTheme.mockReset().mockResolvedValue(undefined);
  observer = undefined;
  vi.stubGlobal("document", { documentElement: { getAttribute: () => mode } });
  vi.stubGlobal("MutationObserver", class {
    constructor(callback) { this.callback = callback; this.disconnect = vi.fn(); observer = this; }
    observe() {}
  });
});
afterEach(async () => {
  if (tree) await act(async () => { tree.unmount(); });
  tree = undefined;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
async function mount() { await act(async () => { tree = create(<TauriWindowsTheme />); }); }
async function change(value) { mode = value; await act(async () => { observer.callback([]); }); }

test("synchronizes resolved initial mode and changes without repeated same-mode writes", async () => {
  await mount();
  expect(native.setTheme.mock.calls).toEqual([["dark"]]);
  await change("light");
  await change("light");
  await change("invalid");
  expect(native.setTheme.mock.calls).toEqual([["dark"], ["light"]]);
});

test.each(["macos", "linux", "ios", "android"])("does not alter %s native appearance", async platform => {
  native.platform.mockReturnValue(platform);
  await mount();
  expect(native.setTheme).not.toHaveBeenCalled();
  expect(observer).toBeUndefined();
});

test("browser never loads the native platform", async () => {
  native.tauri = false;
  await mount();
  expect(native.platform).not.toHaveBeenCalled();
  expect(native.setTheme).not.toHaveBeenCalled();
});

test("unmount before platform resolution prevents observation and native writes", async () => {
  let resolve;
  native.platform.mockReturnValue(new Promise(r => { resolve = r; }));
  await mount();
  await act(async () => { tree.unmount(); tree = undefined; });
  await act(async () => { resolve("windows"); });
  expect(native.setTheme).not.toHaveBeenCalled();
  expect(observer).toBeUndefined();
});

test("serializes native writes and applies the latest mode after a pending write", async () => {
  let release;
  native.setTheme.mockImplementationOnce(() => new Promise(r => { release = r; }));
  await mount();
  await change("light");
  expect(native.setTheme.mock.calls).toEqual([["dark"]]);
  await act(async () => { release(); });
  expect(native.setTheme.mock.calls).toEqual([["dark"], ["light"]]);
  await act(async () => { tree.unmount(); tree = undefined; });
  expect(observer.disconnect).toHaveBeenCalledOnce();
  await change("dark");
  expect(native.setTheme).toHaveBeenCalledTimes(2);
});

test("native failure leaves page mode intact and later changes can recover", async () => {
  const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
  native.setTheme.mockRejectedValueOnce(new Error("native unavailable"));
  await mount();
  expect(mode).toBe("dark");
  expect(warning).toHaveBeenCalled();
  await change("light");
  expect(native.setTheme.mock.calls).toEqual([["dark"], ["light"]]);
});
