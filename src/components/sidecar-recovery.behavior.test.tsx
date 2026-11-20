// @ts-nocheck
import { act, create } from "react-test-renderer";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
const os = vi.hoisted(() => ({ value: "windows", fail: false }));
vi.mock("@tauri-apps/plugin-os", () => ({ platform: () => { if (os.fail) throw new Error("OS discovery failed"); return os.value; } }));
import { SidecarRecoveryTrigger } from "./sidecar-recovery";
import { ShellBannersProvider, useShellBanners } from "@/lib/shell-banners";
import { LiveRegionProvider } from "@/components/ui/live-region";
await import("@tauri-apps/api/core");
await import("@tauri-apps/api/event");
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let tree, banners, handler, snapshot, retry, subscription;
let calls, removed;
const ready = { phase: "ready", progress: 100, message: "CovenCave is ready", canRetry: false, canCancel: false };
const failed = { phase: "failed", progress: 0, message: "Could not start local services", canRetry: true, canCancel: false };
const starting = { phase: "starting", progress: 70, message: "Starting local services", canRetry: false, canCancel: true };
function deferred() { let resolve, reject; const promise = new Promise((a,b) => {resolve=a; reject=b;}); return {promise,resolve,reject}; }
function Probe() { banners = useShellBanners().banners; return null; }
function banner() { return banners.find(b => b.id === "sidecar-recovery"); }
async function mount() { await act(async () => { tree = create(<LiveRegionProvider><ShellBannersProvider><SidecarRecoveryTrigger /><Probe /></ShellBannersProvider></LiveRegionProvider>); }); }
async function emit(payload) { await act(async () => handler({ event: "sidecar-startup-progress", id: 17, payload })); }
beforeEach(() => {
  os.value = "windows"; os.fail = false; calls = []; removed = []; handler = undefined;
  snapshot = async () => ready; retry = async () => {}; subscription = async () => 17;
  vi.stubGlobal("window", {
    __TAURI_INTERNALS__: {
      transformCallback: callback => { handler = callback; return 23; },
      invoke: async (command, args) => {
        calls.push([command,args]);
        if (command === "plugin:event|listen") { expect(args.event).toBe("sidecar-startup-progress"); return subscription(); }
        if (command === "plugin:event|unlisten") { removed.push(args.eventId); return; }
        if (command === "sidecar_startup_status") return snapshot();
        if (command === "retry_sidecar_startup") return retry();
        throw new Error("Unexpected IPC: " + command);
      },
    },
    __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener: vi.fn() },
  });
});
afterEach(async () => { if (tree) await act(async () => tree.unmount()); tree = null; vi.unstubAllGlobals(); });

test("healthy snapshot stays quiet; recovery events show progress, Retry and then clear", async () => {
  await mount(); expect(banner()).toBeUndefined();
  expect(handler).toBeTypeOf("function");
  await emit(starting); expect(banner().title).toContain("Starting"); expect(banner().cta).toBeUndefined();
  await emit(failed); expect(banner().cta.label).toBe("Retry");
  // Native status remains failed while the supervisor waits through cooldown.
  expect(banner().detail).toContain(failed.message);
  await emit(ready); expect(banner()).toBeUndefined();
});
test("late mount restores native failure and Retry instead of requiring another event", async () => {
  snapshot = async () => failed; await mount(); expect(banner().cta.label).toBe("Retry");
  expect(calls.map(c=>c[0])).toEqual(["plugin:event|listen", "sidecar_startup_status"]);
});
test("a late initial snapshot cannot overwrite a newer recovery event", async () => {
  const pending = deferred(); snapshot = () => pending.promise; await mount();
  await emit(failed); await act(async () => pending.resolve(ready));
  expect(banner().cta.label).toBe("Retry");
});
test("Retry admits one command and command acceptance is not readiness", async () => {
  snapshot = async () => failed; await mount(); const click = banner().cta.onClick;
  const pending = deferred(); retry = () => pending.promise;
  await act(async () => { click(); click(); });
  expect(calls.filter(c=>c[0] === "retry_sidecar_startup")).toHaveLength(1);
  expect(banner().cta).toBeUndefined();
  await emit(starting); snapshot = async () => starting;
  await act(async () => pending.resolve());
  expect(banner()).toBeDefined(); expect(banner().cta).toBeUndefined();
  await emit(ready); expect(banner()).toBeUndefined();
});
test("command rejection restores actionable failure, while newer native state wins", async () => {
  snapshot = async () => failed; retry = async () => { throw new Error("Startup busy"); };
  await mount(); await act(async () => banner().cta.onClick());
  expect(banner().detail).toContain("Startup busy"); expect(banner().cta.label).toBe("Retry");
  const pending = deferred(); retry = () => pending.promise;
  await act(async () => { banner().cta.onClick(); }); await emit(ready);
  await act(async () => pending.reject(new Error("old command failure")));
  expect(banner()).toBeUndefined();
});
test("malformed events cannot enable Retry or erase a current failure", async () => {
  snapshot = async () => failed; await mount();
  await emit({ ...ready, canRetry: "true" });
  await emit({ ...failed, phase: "unexpected" });
  expect(banner().detail).toContain(failed.message);
});
test.each(["macos", "linux", "ios", "android"])("%s never subscribes or calls Windows commands", async value => {
  os.value = value; await mount(); expect(calls).toEqual([]); expect(banner()).toBeUndefined();
});
test("a browser never loads native recovery", async () => {
  delete window.__TAURI_INTERNALS__; await mount(); expect(calls).toEqual([]);
});
test("late subscription and snapshot are disposed after unmount", async () => {
  const pending = deferred(); subscription = () => pending.promise; await mount();
  await act(async () => tree.unmount()); tree = null;
  await act(async () => pending.resolve(17));
  expect(removed).toEqual([17]); expect(calls.filter(c=>c[0] === "sidecar_startup_status")).toEqual([]);
});
test("leaving the shell clears its banner and makes retained Retry callbacks inert", async () => {
  snapshot = async () => failed; await mount(); const click = banner().cta.onClick;
  await act(async () => tree.update(<LiveRegionProvider><ShellBannersProvider><Probe /></ShellBannersProvider></LiveRegionProvider>));
  await act(async () => click()); expect(banner()).toBeUndefined();
  expect(removed).toEqual([17]); expect(calls.filter(c=>c[0] === "retry_sidecar_startup")).toEqual([]);
});

test("an unused native control in Windows dev mode stays quiet until startup actually begins", async () => {
  snapshot = async () => ({ phase: "idle", progress: 0, message: "Local services are not managed by this window", canRetry: false, canCancel: false });
  await mount(); expect(banner()).toBeUndefined();
  await emit(starting); expect(banner().title).toContain("Starting");
});
test("unknown platform does not offer Windows recovery guidance", async () => {
  os.fail = true; await mount(); expect(banner()).toBeUndefined(); expect(calls).toEqual([]);
});
test("failed monitoring on known Windows gives recovery guidance without starting services", async () => {
  subscription = async () => { throw new Error("IPC unavailable"); };
  await mount(); expect(banner().title).toContain("Reopen Cave");
  expect(calls.filter(c=>c[0] === "retry_sidecar_startup")).toEqual([]);
});

test("native teardown rejection does not escape shell disposal", async () => {
  const invoke = window.__TAURI_INTERNALS__.invoke;
  window.__TAURI_INTERNALS__.invoke = (command, args) => command === "plugin:event|unlisten"
    ? Promise.reject(new Error("native host already closed")) : invoke(command, args);
  await mount(); await act(async () => tree.unmount()); tree = null;
  // Flush the native adapter's async disposal. Vitest fails on escaped rejections.
  await new Promise(resolve => setTimeout(resolve, 0));
});
