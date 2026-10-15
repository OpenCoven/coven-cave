// @ts-nocheck
import { createElement } from "react";
import { act, create } from "react-test-renderer";
import { afterEach, expect, test, vi } from "vitest";
import { useRuntimeModelInventory } from "./use-runtime-model-options";
import { runtimeModelInventoryScope } from "./runtime-models";

vi.mock("@/lib/use-pausable-poll", () => ({ usePausablePoll: () => {} }));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let renderer;
let inventory;
function Probe({ runtime = "codex", familiar = "cody", executionRuntime, pendingHost }) {
  inventory = useRuntimeModelInventory(runtime, familiar, executionRuntime, pendingHost);
  return null;
}
afterEach(async () => {
  if (renderer) await act(async () => renderer.unmount());
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
function response(runtime, models) {
  return { ok: true, json: async () => ({ ok: true, runtime, models,
    provenance: "live", freshness: "fresh", refreshState: "ready", availability: "available",
    defaultOwner: "runtime", allowCustom: true, scope: runtimeModelInventoryScope(runtime, "cody") }) };
}

test.each(["codex", "claude", "copilot", "opencode", "grok", "hermes"])(
  "%s can immediately recover discovery without changing the draft or runtime", async (runtime) => {
    const models = [{ id: `${runtime}/future-model`, label: "Runtime's latest model" }];
    const fetch = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(response(runtime, models));
    vi.stubGlobal("fetch", fetch);
    await act(async () => { renderer = create(createElement(Probe, { runtime })); });
    expect(inventory.models).toEqual([]);
    expect(inventory.loading).toBe(false);
    expect(typeof inventory.refresh).toBe("function");
    await act(async () => inventory.refresh());
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(inventory.models).toEqual(models);
    expect(inventory.loading).toBe(false);
  },
);

test("a retired request cannot populate another runtime's menu", async () => {
  let resolveOld;
  vi.stubGlobal("fetch", vi.fn()
    .mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; }))
    .mockResolvedValueOnce(response("claude", [{ id: "anthropic/future", label: "Future Claude" }])));
  await act(async () => { renderer = create(createElement(Probe)); });
  await act(async () => renderer.update(createElement(Probe, { runtime: "claude" })));
  await act(async () => resolveOld(response("codex", [{ id: "openai/old", label: "Old scope" }])));
  expect(inventory.models.map(model => model.id)).toEqual(["anthropic/future"]);
});

test("a stalled connection times out and leaves an immediately retryable menu", async () => {
  vi.useFakeTimers();
  let signal;
  vi.stubGlobal("fetch", vi.fn((_url, options) => {
    signal = options.signal;
    return new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new Error("aborted"))));
  }));
  await act(async () => { renderer = create(createElement(Probe)); });
  expect(inventory.loading).toBe(true);
  await act(async () => vi.advanceTimersByTimeAsync(15_000));
  expect(signal.aborted).toBe(true);
  expect(inventory.loading).toBe(false);
  expect(inventory.discoveryIssue).toBe("discovery-failed");
});

test("historical remote execution is included in discovery scope", async () => {
  const fetch = vi.fn().mockResolvedValue(response("codex", [{ id: "openai/latest", label: "Latest" }]));
  vi.stubGlobal("fetch", fetch);
  await act(async () => { renderer = create(createElement(Probe, { executionRuntime: "ssh:remote:/workspace" })); });
  expect(fetch.mock.calls[0][0]).toContain("remote=true");
});


test("a pending SSH host immediately masks the local catalog", async () => {
  let finishRemote;
  const fetch = vi.fn().mockResolvedValueOnce(response("codex", [{ id: "openai/local", label: "Local" }]))
    .mockImplementationOnce(() => new Promise(resolve => { finishRemote = resolve; }));
  vi.stubGlobal("fetch", fetch);
  await act(async () => { renderer = create(createElement(Probe, { executionRuntime: "local:/workspace" })); });
  expect(inventory.models).toHaveLength(1);
  await act(async () => renderer.update(createElement(Probe, { executionRuntime: "local:/workspace", pendingHost: "remote" })));
  expect(inventory.models).toEqual([]);
  expect(fetch.mock.calls[1][0]).toContain("remote=true");
  await act(async () => finishRemote(response("codex", [])));
});

test("an explicit Local pick overrides a historical SSH discovery scope", async () => {
  const fetch = vi.fn().mockResolvedValueOnce(response("codex", []))
    .mockResolvedValueOnce(response("codex", [{ id: "openai/local", label: "Local" }]));
  vi.stubGlobal("fetch", fetch);
  await act(async () => { renderer = create(createElement(Probe, { executionRuntime: "ssh:remote:/workspace" })); });
  expect(fetch.mock.calls[0][0]).toContain("remote=true");
  await act(async () => renderer.update(createElement(Probe, { executionRuntime: "ssh:remote:/workspace", pendingHost: "local" })));
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(fetch.mock.calls[1][0]).not.toContain("remote=true");
  expect(inventory.models.map(model => model.id)).toEqual(["openai/local"]);
});
