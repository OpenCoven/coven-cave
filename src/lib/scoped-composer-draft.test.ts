// @ts-nocheck
import assert from "node:assert/strict";
import { initialComposerDraftDecision } from "./use-composer-draft.ts";
import { test } from "node:test";

test("an onboarding starter is an editable draft only in its new conversation and project", () => {
  const input = { incoming: "Explain the project", current: "", sessionId: null, expectedProject: "/work/a", project: "/work/a", ready: true };
  assert.equal(initialComposerDraftDecision(input), "apply");
  assert.equal(initialComposerDraftDecision({ ...input, current: "My existing draft" }), "review");
  assert.equal(initialComposerDraftDecision({ ...input, sessionId: "existing-session" }), "wait");
  assert.equal(initialComposerDraftDecision({ ...input, project: "/work/b" }), "wait");
  assert.equal(initialComposerDraftDecision({ ...input, ready: false }), "wait");
  assert.equal(initialComposerDraftDecision({ ...input, current: input.incoming }), "keep");
});
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
      addEventListener() {},
      removeEventListener() {},
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

for (const followUp of ["", "Newest follow-up"]) {
  test(`promotion before effects preserves ${followUp ? "the newest follow-up" : "a cleared draft"}`, async () => {
    const originalWindow = globalThis.window;
    const storage = new Map([["compose", "Already sent prompt"]]);
    globalThis.window = {
      addEventListener() {},
      removeEventListener() {},
      localStorage: {
        getItem: (key) => storage.get(key) ?? null,
        setItem: (key, value) => storage.set(key, value),
        removeItem: (key) => storage.delete(key),
      },
      setTimeout: () => 1,
      clearTimeout: () => {},
    };
    let current;
    let renderer;
    function Probe() {
      current = useComposerDraft("compose");
      return null;
    }
    try {
      await act(async () => { renderer = create(createElement(StrictMode, null, createElement(Probe))); });
      await act(async () => {
        current.setValue("");
        current.clearNow();
        if (followUp) current.setValue((value) => value + followUp);
        // A session response can arrive before the batched render/effects.
        await Promise.resolve();
        current.transferTo("session");
        assert.equal(storage.get("session") ?? "", followUp);
      });
    } finally {
      await act(async () => { renderer?.unmount(); });
      globalThis.window = originalWindow;
    }
  });
}

for (const eventName of ["beforeunload", "pagehide"]) {
  test(`${eventName} flushes the latest draft without waiting for debounce or resurrecting a sent prompt`, async () => {
    const originalWindow = globalThis.window;
    const storage = new Map();
    const lifecycle = new EventTarget();
    globalThis.window = Object.assign(lifecycle, {
      localStorage: {
        getItem: key => storage.get(key) ?? null,
        setItem: (key, value) => storage.set(key, value),
        removeItem: key => storage.delete(key),
      },
      setTimeout: () => 1,
      clearTimeout() {},
    });
    let current, renderer;
    function Probe({ draftKey }) { current = useComposerDraft(draftKey, 60_000); return null; }
    try {
      await act(async () => { renderer = create(createElement(StrictMode, null, createElement(Probe, { draftKey: "A" }))); });
      await act(async () => current.setValue("Newest A tail"));
      assert.equal(storage.has("A"), false, "ordinary typing remains debounced");
      lifecycle.dispatchEvent(new Event(eventName));
      assert.equal(storage.get("A"), "Newest A tail");
      await act(async () => renderer.update(createElement(StrictMode, null, createElement(Probe, { draftKey: "B" }))));
      await act(async () => current.setValue("Newest B tail"));
      lifecycle.dispatchEvent(new Event(eventName));
      assert.equal(storage.get("A"), "Newest A tail", "exit cannot write another scope's text into A");
      assert.equal(storage.get("B"), "Newest B tail");
      await act(async () => current.clearNow());
      lifecycle.dispatchEvent(new Event(eventName));
      assert.equal(storage.has("B"), false, "an explicit send/clear stays cleared on exit");
    } finally {
      await act(async () => renderer?.unmount());
      globalThis.window = originalWindow;
    }
  });
}
