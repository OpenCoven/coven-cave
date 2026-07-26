// @ts-nocheck
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CHAT_SIDEBAR_VIEW_KEY,
  PINNED_SESSIONS_KEY,
  getPinnedSessionsSnapshot,
  normalizeChatSidebarView,
  readChatSidebarView,
  subscribePinnedSessions,
  toggleStoredPinnedSession,
  writeChatSidebarView,
  writePinnedSessions,
} from "./chat-session-prefs.ts";

test("normalize: only 'projects' opts out of the recent default", () => {
  assert.equal(normalizeChatSidebarView("projects"), "projects");
  assert.equal(normalizeChatSidebarView("recent"), "recent");
  assert.equal(normalizeChatSidebarView(null), "recent");
  assert.equal(normalizeChatSidebarView("garbage"), "recent");
  assert.equal(normalizeChatSidebarView(42), "recent");
});

test("read is SSR-safe: no window → default 'recent'", () => {
  assert.equal(typeof window, "undefined");
  assert.equal(readChatSidebarView(), "recent");
});

test("storage key is stable (persisted user data)", () => {
  assert.equal(CHAT_SIDEBAR_VIEW_KEY, "cave:chat:sidebar-view");
});

test("read/write round-trip through a stubbed localStorage", () => {
  const store = new Map();
  globalThis.window = {
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => void store.set(k, String(v)),
    },
  };
  try {
    assert.equal(readChatSidebarView(), "recent"); // nothing stored yet
    writeChatSidebarView("projects");
    assert.equal(store.get(CHAT_SIDEBAR_VIEW_KEY), "projects");
    assert.equal(readChatSidebarView(), "projects");
    writeChatSidebarView("recent");
    assert.equal(readChatSidebarView(), "recent");
  } finally {
    delete globalThis.window;
  }
});

// ── Shared pin store ─────────────────────────────────────────────────────────

function withStubbedStorage(fn) {
  const store = new Map();
  globalThis.window = {
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => void store.set(k, String(v)),
    },
    addEventListener: () => {},
  };
  try {
    fn(store);
  } finally {
    delete globalThis.window;
    // Reset the module-level snapshot cache for the next test by writing a
    // fresh empty list (window is gone, so this only touches the cache).
    writePinnedSessions([]);
  }
}

test("pin snapshot is SSR-safe and referentially stable", () => {
  assert.equal(typeof window, "undefined");
  assert.deepEqual(getPinnedSessionsSnapshot(), []);
  withStubbedStorage(() => {
    writePinnedSessions(["s1", "s2"]);
    const a = getPinnedSessionsSnapshot();
    const b = getPinnedSessionsSnapshot();
    assert.equal(a, b, "unchanged store returns the same array reference");
    assert.deepEqual(a, ["s1", "s2"]);
  });
});

test("writes persist under the stable key, dedupe, and notify subscribers", () => {
  withStubbedStorage((store) => {
    let notified = 0;
    const unsubscribe = subscribePinnedSessions(() => {
      notified += 1;
    });
    writePinnedSessions(["s1", "s1", "", "s2"]);
    assert.equal(store.get(PINNED_SESSIONS_KEY), JSON.stringify(["s1", "s2"]));
    assert.equal(notified, 1, "each write notifies once");
    unsubscribe();
    writePinnedSessions(["s1"]);
    assert.equal(notified, 1, "unsubscribed listeners stop firing");
  });
});

test("two surfaces toggling through the store cannot clobber each other", () => {
  // Regression: chat list, thread rail and workspace sidebar each held a
  // private useState copy of the pin list and wrote the whole key on change.
  // Pin in surface A, then pin in surface B → B persisted its stale copy and
  // A's pin vanished. Through the shared store, sequential toggles from
  // different surfaces accumulate.
  withStubbedStorage((store) => {
    toggleStoredPinnedSession("from-thread-rail");
    toggleStoredPinnedSession("from-chat-list");
    assert.deepEqual(
      JSON.parse(store.get(PINNED_SESSIONS_KEY)),
      ["from-thread-rail", "from-chat-list"],
      "both surfaces' pins survive",
    );
    toggleStoredPinnedSession("from-thread-rail");
    assert.deepEqual(
      JSON.parse(store.get(PINNED_SESSIONS_KEY)),
      ["from-chat-list"],
      "unpin removes only the toggled id",
    );
  });
});

test("snapshot survives a localStorage write failure (in-memory fallback)", () => {
  const store = new Map();
  globalThis.window = {
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: () => {
        throw new Error("quota exceeded");
      },
    },
    addEventListener: () => {},
  };
  try {
    writePinnedSessions(["s9"]);
    assert.deepEqual(getPinnedSessionsSnapshot(), ["s9"], "pins stay live for this page");
  } finally {
    delete globalThis.window;
    writePinnedSessions([]);
  }
});
