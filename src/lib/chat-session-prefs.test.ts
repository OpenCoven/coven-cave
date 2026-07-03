// @ts-nocheck
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CHAT_SIDEBAR_VIEW_KEY,
  normalizeChatSidebarView,
  readChatSidebarView,
  writeChatSidebarView,
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
