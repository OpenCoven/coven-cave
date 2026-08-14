// @ts-nocheck
import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { act, create } from "react-test-renderer";
import { useHomeModelState } from "./use-home-model-state.ts";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function state(familiarId, harness, effectiveModel) {
  return {
    familiarId,
    harness,
    runtime: null,
    effectiveModel,
    source: effectiveModel ? "familiar-default" : "runtime-default",
    applicationState: "saved",
  };
}

function response(payload, ok = true) {
  return { ok, json: async () => payload };
}

function requestUrl(input) {
  return typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
}

test("Home serializes model and runtime writes so the newer runtime binding wins", async () => {
  const originalFetch = globalThis.fetch;
  const pending = [];
  const calls = [];
  globalThis.fetch = ((input, init) => new Promise((resolve, reject) => {
    const request = { url: requestUrl(input), init, resolve, reject };
    pending.push(request);
    calls.push(request);
  })) as typeof fetch;

  let controls;
  function Probe() {
    controls = useHomeModelState("milo");
    return createElement("home-model-probe");
  }

  let renderer;
  try {
    await act(async () => { renderer = create(createElement(Probe)); });
    assert.equal(pending.shift().url, "/api/chat/model-state?familiarId=milo");
    // Resolve the initial read so subsequent PATCHes are the only requests in
    // flight and the ordering assertion cannot pass accidentally on the GET.
    await act(async () => {
      calls[0].resolve(response({ ok: true, state: state("milo", "claude", "anthropic/claude-opus-4-6") }));
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      controls.selectModel("anthropic/claude-sonnet-5");
      await Promise.resolve();
    });
    assert.equal(
      controls.pendingModelOverride,
      "anthropic/claude-sonnet-5",
      "Home retains the selected model for the first chat handoff while its PATCH is queued",
    );
    await act(async () => {
      controls.selectRuntime("codex");
      await Promise.resolve();
    });
    assert.equal(
      controls.pendingModelOverride,
      "",
      "switching runtimes stages the runtime-default intent for the first chat handoff",
    );
    assert.equal(calls[1].url, "/api/chat/model-state");
    assert.equal(calls[1].init.method, "PATCH");
    assert.equal(pending.length, 1, "the runtime write is queued behind the model write");
    assert.equal(calls[2], undefined, "no overlapping config write was started");

    await act(async () => {
      calls[1].resolve(response({ ok: true, state: state("milo", "claude", "anthropic/claude-sonnet-5") }));
      await Promise.resolve();
      await Promise.resolve();
    });
    assert.equal(calls[2].url, "/api/config", "the runtime write starts after the model write settles");
    const configBody = JSON.parse(calls[2].init.body);
    assert.deepEqual(configBody.familiars.milo, { harness: "codex", model: "" });
    let runtimeWriteSettled = false;
    const runtimeWrite = controls.waitForRuntimeWrite().then((ok) => {
      runtimeWriteSettled = true;
      return ok;
    });
    await Promise.resolve();
    assert.equal(runtimeWriteSettled, false, "Home waits for the runtime binding before handing off the first send");

    await act(async () => {
      calls[2].resolve(response({ ok: false }, false));
      await Promise.resolve();
      await Promise.resolve();
    });
    assert.equal(await runtimeWrite, false, "a failed runtime write blocks an unsafe first send");
  } finally {
    await act(async () => { renderer?.unmount(); });
    globalThis.fetch = originalFetch;
  }
});

test("Home masks the previous familiar while the replacement model state loads", async () => {
  const originalFetch = globalThis.fetch;
  const pending = [];
  globalThis.fetch = ((input, init) => new Promise((resolve, reject) => {
    pending.push({ url: requestUrl(input), init, resolve, reject });
  })) as typeof fetch;

  const snapshots = [];
  function Probe({ familiarId }) {
    const modelState = useHomeModelState(familiarId).modelState;
    snapshots.push(modelState);
    return createElement("home-model-probe");
  }

  let renderer;
  try {
    await act(async () => {
      renderer = create(createElement(Probe, { familiarId: "milo" }));
    });
    assert.equal(pending.length, 1);
    await act(async () => {
      renderer.update(createElement(Probe, { familiarId: "nova" }));
    });
    assert.equal(snapshots.at(-1), null, "the old familiar is masked immediately");
    pending[0].resolve(response({ ok: true, state: state("milo", "claude", "anthropic/claude-opus-4-6") }));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    assert.equal(snapshots.at(-1), null, "a stale familiar response cannot repopulate the new familiar");
    assert.equal(pending.length, 2, "the replacement familiar has its own read in flight");
  } finally {
    await act(async () => { renderer?.unmount(); });
    globalThis.fetch = originalFetch;
  }
});

console.log("use-home-model-state.test.ts: ok");
