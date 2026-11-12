// @ts-nocheck
import assert from "node:assert/strict";

// history-url keeps history entries restorable by Next's app router (#6442).
// A fake History stands in for the browser's native methods, and `wrapLikeNext`
// installs a wrapper that mirrors Next 16's AppRouter patch: a state carrying
// `__NA` is written as-is; any other state gets the current entry's markers
// copied in and Next's router URL synced.

class FakeHistory {
  state = null;
  writes = [];
  replaceState(state, _title, url) {
    this.state = state === null ? null : structuredClone(state);
    window.location.href = new URL(url, window.location.href).href;
    this.writes.push({ kind: "replace", state: this.state, url });
  }
  pushState(state, _title, url) {
    this.state = state === null ? null : structuredClone(state);
    window.location.href = new URL(url, window.location.href).href;
    this.writes.push({ kind: "push", state: this.state, url });
  }
}

const MARKERS = { __NA: true, __PRIVATE_NEXTJS_INTERNALS_TREE: { tree: "home" } };

function freshWindow(state, href = "http://127.0.0.1:3100/?mode=home") {
  const history = new FakeHistory();
  history.state = state;
  globalThis.History = FakeHistory;
  globalThis.window = { history, location: { href } };
  return history;
}

/** Install a wrapper shaped like Next's; returns the URLs it synced. */
function wrapLikeNext(history) {
  const synced = [];
  const received = [];
  for (const method of ["replaceState", "pushState"]) {
    const original = FakeHistory.prototype[method].bind(history);
    history[method] = (data, title, url) => {
      received.push({ method, data: data === null ? null : structuredClone(data) });
      if (data?.__NA || data?._N) return original(data, title, url);
      const copy = data == null ? {} : { ...data };
      const current = history.state;
      if (current?.__NA) copy.__NA = current.__NA;
      if (current?.__PRIVATE_NEXTJS_INTERNALS_TREE) copy.__PRIVATE_NEXTJS_INTERNALS_TREE = current.__PRIVATE_NEXTJS_INTERNALS_TREE;
      if (url) synced.push(url);
      return original(copy, title, url);
    };
  }
  return { synced, received };
}

const flushMicrotasks = () => new Promise((resolve) => setTimeout(resolve, 0));

const { replaceHistoryUrl, pushHistoryUrl, NEXT_HISTORY_ENTRY_KEYS } = await import("./history-url.ts");

assert.deepEqual([...NEXT_HISTORY_ENTRY_KEYS], ["__NA", "__PRIVATE_NEXTJS_INTERNALS_TREE"]);

// Native methods (the first effect pass of a document): the markers Next has
// already written survive, alongside the entry's own keys.
{
  const history = freshWindow({ ...MARKERS, keep: 1 });
  replaceHistoryUrl("/");
  assert.deepEqual(history.state, { keep: 1, ...MARKERS }, "a native replace keeps Next's markers and the entry's own keys");
  assert.equal(window.location.href, "http://127.0.0.1:3100/");
  await flushMicrotasks();
  assert.equal(history.writes.length, 1, "with no Next wrapper installed there is nothing to sync");
}

// Next wraps history later in the same effect pass: the deferred sync hands
// Next the entry's own keys so it updates its router URL.
{
  const history = freshWindow({ ...MARKERS, keep: 1 });
  replaceHistoryUrl("/");
  const next = wrapLikeNext(history);
  await flushMicrotasks();
  assert.deepEqual(next.synced, ["/"], "Next's router URL follows the stripped address");
  assert.deepEqual(next.received, [{ method: "replaceState", data: { keep: 1 } }], "the sync omits Next's markers so Next's wrapper does not skip it");
  assert.deepEqual(history.state, { keep: 1, ...MARKERS }, "the entry is still restorable after the sync");
}

// A later write moved the address on before the microtask: no stale sync.
{
  const history = freshWindow({ ...MARKERS });
  replaceHistoryUrl("/a");
  FakeHistory.prototype.replaceState.call(history, { ...MARKERS }, "", "/b");
  const next = wrapLikeNext(history);
  await flushMicrotasks();
  assert.deepEqual(next.synced, [], "the deferred sync never rewrites a newer address");
  assert.equal(window.location.href, "http://127.0.0.1:3100/b");
}

// Next's wrapper already installed (any write after mount): pass only the
// entry's own keys so Next adds its markers and syncs, exactly as it did for
// the old `null` writes.
{
  const history = freshWindow({ ...MARKERS, keep: 1 });
  const next = wrapLikeNext(history);
  replaceHistoryUrl("/settings#general");
  assert.deepEqual(next.received, [{ method: "replaceState", data: { keep: 1 } }]);
  assert.deepEqual(next.synced, ["/settings#general"]);
  assert.deepEqual(history.state, { keep: 1, ...MARKERS });
  await flushMicrotasks();
  assert.equal(next.synced.length, 1, "no second sync once Next owns the write");
}

// Push, native: the new entry inherits Next's markers but not the previous
// entry's own keys, matching Next's wrapper.
{
  const history = freshWindow({ ...MARKERS, keep: 1 });
  pushHistoryUrl("#chat-s1");
  assert.equal(history.writes.at(-1).kind, "push");
  assert.deepEqual(history.state, MARKERS);
}

// Push, wrapped: Next receives an empty state and fills in its markers.
{
  const history = freshWindow({ ...MARKERS, keep: 1 });
  const next = wrapLikeNext(history);
  pushHistoryUrl("#chat-s1");
  assert.deepEqual(next.received, [{ method: "pushState", data: {} }]);
  assert.deepEqual(next.synced, ["#chat-s1"]);
  assert.deepEqual(history.state, MARKERS);
}

// A null or non-object state never becomes `null` again and never throws.
{
  const history = freshWindow(null);
  replaceHistoryUrl("/");
  assert.deepEqual(history.state, {});
  freshWindow("legacy-string");
  replaceHistoryUrl("/x");
  assert.deepEqual(window.history.state, {});
}

// Server render: no window, no write, no throw.
{
  await flushMicrotasks();
  delete globalThis.window;
  replaceHistoryUrl("/");
  pushHistoryUrl("/");
}

console.log("history-url: native, wrapped, deferred-sync and push writes keep entries restorable");
