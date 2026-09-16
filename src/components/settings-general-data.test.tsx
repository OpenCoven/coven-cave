// @ts-nocheck
import { act, create } from "react-test-renderer";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { GeneralSettingsDataProvider, useGeneralSettingsData } from "./settings-general-data";

vi.mock("@/lib/use-pausable-poll", () => ({ usePausablePoll: vi.fn() }));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root;
let data;
let calls;
function Consumer() { data = useGeneralSettingsData(); return null; }
const workspace = { ok: true, workspacePath: "/old", envPin: null };
const sync = { ok: true, config: { enabled: false }, status: {} };
async function mount() {
  await act(async () => { root = create(<GeneralSettingsDataProvider><Consumer /><Consumer /></GeneralSettingsDataProvider>); });
}
async function respond(index, value, status = 200) {
  await act(async () => { calls[index].resolve(new Response(JSON.stringify(value), { status })); });
}
beforeEach(() => {
  calls = [];
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal("fetch", vi.fn((url, init) => new Promise((resolve) => { calls.push({ url, signal: init.signal, resolve }); })));
});
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  root = null;
  vi.unstubAllGlobals();
});

test("two consumers share one narrow workspace read and one backup read", async () => {
  await mount();
  expect(calls.map(c => c.url)).toEqual(["/api/config/workspace-path", "/api/backup/sync"]);
  await respond(0, workspace); await respond(1, sync);
  expect(data.workspace.value.workspacePath).toBe("/old");
  expect(data.sync.value.config.enabled).toBe(false);
});

test("a published save cancels an older read and cannot be reverted by its response", async () => {
  await mount();
  await act(async () => data.workspace.publish({ workspacePath: "/saved" }));
  expect(calls[0].signal.aborted).toBe(true);
  await respond(0, workspace);
  expect(data.workspace.value.workspacePath).toBe("/saved");
  expect(data.workspace.status).toBe("ready");
});

test("background refresh retains values and exposes partial failure independently", async () => {
  await mount(); await respond(0, workspace); await respond(1, sync);
  await act(async () => data.refresh());
  expect(data.sync.value).toEqual(sync);
  await respond(2, { ...workspace, workspacePath: "/fresh" });
  await respond(3, { ok: false }, 503);
  expect(data.workspace.value.workspacePath).toBe("/fresh");
  expect(data.workspace.status).toBe("ready");
  expect(data.sync.status).toBe("error");
  expect(data.sync.value).toEqual(sync);
});

test("backup refresh events only reload backup state", async () => {
  await mount(); await respond(0, workspace); await respond(1, sync);
  await act(async () => window.dispatchEvent(new Event("cave:backup-sync-refresh")));
  expect(calls.map(c => c.url)).toEqual(["/api/config/workspace-path", "/api/backup/sync", "/api/backup/sync"]);
});

test("leaving General aborts both pending reads", async () => {
  await mount();
  await act(async () => root.unmount()); root = null;
  expect(calls.every(c => c.signal.aborted)).toBe(true);
});

test("a save from an unmounted provider refreshes a newly opened General instance", async () => {
  await mount(); await respond(0, workspace); await respond(1, sync);
  const finishedSave = data.sync.publish;
  const oldRefresh = data.refresh;
  await act(async () => root.unmount()); root = null;
  await act(async () => oldRefresh());
  expect(calls).toHaveLength(2);
  await mount(); await respond(2, workspace); await respond(3, sync);
  await act(async () => finishedSave({ ...sync, config: { enabled: true } }));
  expect(calls).toHaveLength(5);
  expect(calls[4].url).toBe("/api/backup/sync");
  await respond(4, { ...sync, config: { enabled: true } });
  expect(data.sync.value.config.enabled).toBe(true);
});
