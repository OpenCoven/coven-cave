// @ts-nocheck — react-test-renderer has no bundled declarations.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { createElement } from "react";
import { act, create } from "react-test-renderer";
import { useChatSessionList } from "./use-chat-session-list.ts";
import { useFamiliarRoster } from "./use-familiar-roster.ts";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

async function withLoader(t, kind, run) {
  const original = { fetch: globalThis.fetch, window: globalThis.window, document: globalThis.document };
  const pending = [];
  const window = Object.assign(new EventTarget(), { matchMedia: () => ({ matches: false }) });
  const document = Object.assign(new EventTarget(), { hidden: false, visibilityState: "visible" });
  globalThis.window = window;
  globalThis.document = document;
  globalThis.fetch = (url, init) => new Promise((resolve, reject) => pending.push({ url: String(url), init, resolve, reject }));
  t.mock.timers.enable({ apis: ["setInterval"] });
  let latest;
  let renderer;
  const Probe = kind === "chats" ? function ChatProbe({ familiar = "sage", enabled = true }) {
    latest = useChatSessionList(familiar, { enabled });
    return null;
  } : function FamiliarProbe() {
    latest = useFamiliarRoster();
    return null;
  };
  const api = {
    pending,
    get state() { return latest; },
    async render(props = {}) { await act(async () => { if (renderer) renderer.update(createElement(Probe, props)); else renderer = create(createElement(Probe, props)); }); },
    async tick(ms) { await act(async () => t.mock.timers.tick(ms)); },
    async focus() { await act(async () => window.dispatchEvent(new Event("focus"))); },
    refresh(options) { return kind === "chats" ? latest.refresh(options) : latest.reload(); },
    async resolve(index, ids, status = 200, etag = '"one"') {
      const key = kind === "chats" ? "sessions" : "familiars";
      await act(async () => pending[index].resolve(new Response(status === 304 ? null : JSON.stringify({ ok: status === 200, [key]: ids.map(id => ({ id })) }), { status, headers: { ETag: etag } })));
    },
    async reject(index) { await act(async () => pending[index].reject(new DOMException("signal timed out", "TimeoutError"))); },
  };
  try { await api.render(); await run(api); }
  finally {
    await act(async () => renderer?.unmount());
    t.mock.timers.reset();
    for (const [name, value] of Object.entries(original)) {
      if (value === undefined) delete globalThis[name]; else globalThis[name] = value;
    }
  }
}

for (const kind of ["chats", "familiars"]) {
  test(`${kind}: a slow initial read remains usable when focus and refresh arrive`, async t => {
    await withLoader(t, kind, async api => {
      await api.focus();
      await act(async () => { void api.refresh(); });
      await api.tick(4_000);
      await api.resolve(0, ["first"]);
      assert.equal(api.state.loaded, true, "the successful initial response must not be superseded by duplicate reads");
      assert.deepEqual(api.state[kind === "chats" ? "sessions" : "familiars"].map(x => x.id), ["first"]);
      assert.equal(api.pending.length, 1, "mount, focus, manual refresh and poll share the pending read");
    });
  });

  test(`${kind}: a timeout retries and a later failure retains the last good data`, async t => {
    await withLoader(t, kind, async api => {
      await api.reject(0);
      assert.ok(api.state.error);
      await api.tick(4_000);
      await api.resolve(1, ["saved"]);
      assert.ok(!api.state.error);
      await act(async () => { void api.refresh(); });
      await api.reject(2);
      assert.deepEqual(api.state[kind === "chats" ? "sessions" : "familiars"].map(x => x.id), ["saved"]);
      await api.tick(4_000);
      await api.resolve(3, ["recovered"]);
      assert.ok(!api.state.error);
    });
  });
}

test("chats: switching familiar starts a fresh read and ignores the outgoing response", async t => {
  await withLoader(t, "chats", async api => {
    await api.render({ familiar: "nova" });
    assert.equal(api.pending.length, 2);
    assert.equal(new URL(api.pending[1].url, "https://cave.invalid").searchParams.get("familiarId"), "nova");
    await api.resolve(0, ["sage-private"]);
    assert.deepEqual(api.state.sessions, []);
    await api.resolve(1, ["nova-thread"]);
    assert.deepEqual(api.state.sessions.map(x => x.id), ["nova-thread"]);
  });
});

test("chats: retiring a pending read permits a new read on re-enable", async t => {
  await withLoader(t, "chats", async api => {
    await api.render({ enabled: false });
    await api.render({ enabled: true });
    assert.equal(api.pending.length, 2);
    await api.resolve(0, ["retired"]);
    assert.equal(api.state.loaded, false);
    await api.resolve(1, ["current"]);
    assert.deepEqual(api.state.sessions.map(x => x.id), ["current"]);
  });
});

test("chats: deletion retires an old read and its ETag without replaying deleted rows", async t => {
  await withLoader(t, "chats", async api => {
    await api.resolve(0, ["keep", "deleted"]);
    await act(async () => { void api.refresh(); });
    await act(async () => api.state.removeSessions(["deleted"]));
    await act(async () => { void api.refresh(); });
    assert.equal(api.pending.length, 3, "an invalidated read must not swallow the post-deletion refresh");
    assert.equal(api.pending[2].init.headers, undefined);
    await api.resolve(1, ["keep", "deleted"], 200, '"stale"');
    assert.deepEqual(api.state.sessions.map(x => x.id), ["keep"]);
    await api.resolve(2, ["keep"], 200, '"fresh"');
    await act(async () => { void api.refresh(); });
    assert.equal(api.pending[3].init.headers["If-None-Match"], '"fresh"');
    await api.resolve(3, [], 304);
    assert.deepEqual(api.state.sessions.map(x => x.id), ["keep"]);
  });
});

// A creation/settings event is different from polling: it needs a read begun
// after the change, even when an earlier read has not settled yet.
test("chats: a post-mutation refresh supersedes an earlier read", async t => {
  await withLoader(t, "chats", async api => {
    await act(async () => { void api.refresh({ fresh: true }); });
    assert.equal(api.pending.length, 2);
    await api.resolve(0, ["old"]);
    assert.equal(api.state.loaded, false);
    await api.resolve(1, ["old", "created"]);
    assert.deepEqual(api.state.sessions.map(x => x.id), ["old", "created"]);
  });
});

test("activity: a chat mutation replaces an outstanding unscoped read", async t => {
  await withLoader(t, "chats", async api => {
    await api.render({ familiar: null });
    assert.equal(new URL(api.pending[1].url, "https://cave.invalid").searchParams.has("familiarId"), false);
    // Exercise the window's actual mutation callback with the real loader,
    // without mounting unrelated desktop, settings and transcript surfaces.
    const source = readFileSync(new URL("../components/detached-chat-window.tsx", import.meta.url), "utf8");
    const declaration = source.match(/const refreshActivity = ([\s\S]*?);\n/)[1];
    const refresh = api.state.refresh;
    const mutation = new Function("useCallback", "refreshEveryone", "everyone", `return ${declaration};`)(callback => callback, refresh, { refresh });
    await act(async () => { void mutation(); });
    assert.equal(api.pending.length, 3, "activity must read after the mutation instead of joining its earlier snapshot");
    await api.resolve(1, ["before-mutation"]);
    assert.equal(api.state.loaded, false);
    await api.resolve(2, ["after-mutation"]);
    assert.deepEqual(api.state.sessions.map(x => x.id), ["after-mutation"]);
  });
});
