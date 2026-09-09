// @ts-nocheck
import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement, StrictMode } from "react";
import { act, create } from "react-test-renderer";
import { chatComposerDraftKey, useComposerDraft } from "./use-composer-draft.ts";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

test("draft keys distinguish threads, familiars, projects, hosts and surfaces", () => {
  const base = { familiarId: "cody", sessionId: null, project: "/alpha", host: "local" };
  const key = (changes = {}, namespace = "main") => chatComposerDraftKey(namespace, { ...base, ...changes });
  assert.equal(new Set([
    key(), key({ familiarId: "sage" }), key({ project: "/beta" }),
    key({ host: "remote" }), key({ sessionId: "one" }), key({ sessionId: "two" }), key({}, "panel"),
  ]).size, 7);
  assert.equal(key({ sessionId: "one" }), key({ sessionId: "one", project: "/renamed", host: "ssh" }),
    "a persisted conversation owns its draft independently of browse context");
});

test("reused composer restores only its own draft, flushes rapid switches and ignores stale writers", async () => {
  const originalWindow = globalThis.window;
  const storage = new Map();
  const timers = new Map();
  globalThis.window = {
    localStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
      removeItem: (key) => storage.delete(key),
    },
    setTimeout: (callback) => {
      const id = Symbol("timer");
      timers.set(id, callback);
      return id;
    },
    clearTimeout: (id) => timers.delete(id),
  };
  let current;
  let renderer;
  function Probe({ draftKey }) {
    current = useComposerDraft(draftKey, 60_000);
    return createElement("input", { value: current.value });
  }
  const render = (draftKey) => createElement(StrictMode, null, createElement(Probe, { draftKey }));
  try {
    await act(async () => { renderer = create(render("A")); });
    await act(async () => { current.setValue("Only A"); });
    const staleWriter = current.setValue;
    const staleClear = current.clearNow;
    await act(async () => { renderer.update(render("B")); });
    assert.equal(current.value, "");
    assert.equal(storage.get("A"), "Only A", "scope cleanup flushes before the debounce expires");
    await act(async () => { current.setValue("Only B"); });
    await act(async () => { staleWriter("Late completion from A"); staleClear(); });
    assert.equal(current.value, "Only B");
    await act(async () => { renderer.update(render("A")); });
    assert.equal(current.value, "Only A");
    assert.equal(storage.get("B"), "Only B");
    await act(async () => {
      current.clearNow();
      for (const callback of timers.values()) callback();
      assert.equal(storage.has("A"), false, "pending debounce cannot resurrect explicitly cleared text");
      renderer.unmount();
    });
    assert.equal(storage.has("A"), false, "sending then unmounting cannot resurrect a draft");
    await act(async () => { renderer = create(render("B")); });
    assert.equal(current.value, "Only B");
    await act(async () => {
      current.transferTo("new-session");
      renderer.update(render("new-session"));
    });
    assert.equal(current.value, "Only B", "own session promotion preserves a queued follow-up draft");
    assert.equal(storage.has("B"), false);
    await act(async () => { current.setValue((value) => value + " updated"); });
    await act(async () => { renderer.unmount(); });
    assert.equal(storage.get("new-session"), "Only B updated");
  } finally {
    await act(async () => { renderer?.unmount(); });
    globalThis.window = originalWindow;
  }
});
