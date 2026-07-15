import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AGENTS_NEW_CHAT_EVENT,
  PENDING_AGENTS_NEW_CHAT_KEY,
  consumePendingAgentsNewChat,
  requestAgentsNewChat,
} from "./agents-new-chat.ts";

type FakeWindow = {
  location: { pathname: string; assign: (url: string) => void };
  sessionStorage: {
    getItem: (k: string) => string | null;
    setItem: (k: string, v: string) => void;
    removeItem: (k: string) => void;
  };
  dispatchEvent: (e: Event) => boolean;
};

function makeWindow(pathname: string) {
  const store = new Map<string, string>();
  const dispatched: Array<{ type: string; detail: unknown }> = [];
  const assigned: string[] = [];
  const win: FakeWindow = {
    location: { pathname, assign: (url) => assigned.push(url) },
    sessionStorage: {
      getItem: (k) => (store.has(k) ? store.get(k)! : null),
      setItem: (k, v) => void store.set(k, v),
      removeItem: (k) => void store.delete(k),
    },
    dispatchEvent: (e) => {
      dispatched.push({ type: e.type, detail: (e as CustomEvent).detail });
      return true;
    },
  };
  return { win, store, dispatched, assigned };
}

function withWindow<T>(win: FakeWindow, fn: () => T): T {
  const g = globalThis as { window?: unknown };
  const had = "window" in g;
  const prev = g.window;
  g.window = win;
  try {
    return fn();
  } finally {
    if (had) g.window = prev;
    else delete g.window;
  }
}

describe("requestAgentsNewChat", () => {
  it("dispatches the live event on the main workspace page", () => {
    const { win, store, dispatched, assigned } = makeWindow("/");
    withWindow(win, () => requestAgentsNewChat({ familiarId: "cody", initialPrompt: "fix it" }));
    assert.equal(dispatched.length, 1, "one event dispatched");
    assert.equal(dispatched[0].type, AGENTS_NEW_CHAT_EVENT);
    assert.deepEqual(dispatched[0].detail, { familiarId: "cody", initialPrompt: "fix it" });
    assert.equal(assigned.length, 0, "no navigation on the main page");
    assert.equal(store.size, 0, "nothing persisted on the main page");
  });

  it("persists the request and navigates home from a standalone route", () => {
    const { win, store, dispatched, assigned } = makeWindow("/familiars/cody/analytics");
    withWindow(win, () =>
      requestAgentsNewChat({ familiarId: "cody", initialPrompt: "resolve the blocker", origin: "chat" }),
    );
    assert.equal(dispatched.length, 0, "no dead-end dispatch off the main page");
    assert.deepEqual(assigned, ["/"], "navigates to the workspace");
    assert.deepEqual(JSON.parse(store.get(PENDING_AGENTS_NEW_CHAT_KEY)!), {
      familiarId: "cody",
      initialPrompt: "resolve the blocker",
      origin: "chat",
    });
  });

  it("still navigates when sessionStorage writes throw", () => {
    const { win, assigned } = makeWindow("/dashboard/familiars/cody/analytics");
    win.sessionStorage.setItem = () => {
      throw new Error("quota");
    };
    withWindow(win, () => requestAgentsNewChat({ familiarId: "cody" }));
    assert.deepEqual(assigned, ["/"], "chat opens unprimed rather than not at all");
  });
});

describe("consumePendingAgentsNewChat", () => {
  it("returns and clears a pending request", () => {
    const { win, store } = makeWindow("/");
    store.set(PENDING_AGENTS_NEW_CHAT_KEY, JSON.stringify({ familiarId: "cody", initialPrompt: "go" }));
    const got = withWindow(win, () => consumePendingAgentsNewChat());
    assert.deepEqual(got, { familiarId: "cody", initialPrompt: "go" });
    assert.equal(store.has(PENDING_AGENTS_NEW_CHAT_KEY), false, "consumed exactly once");
  });

  it("returns null when nothing is pending", () => {
    const { win } = makeWindow("/");
    assert.equal(withWindow(win, () => consumePendingAgentsNewChat()), null);
  });

  it("clears and ignores malformed payloads", () => {
    const { win, store } = makeWindow("/");
    store.set(PENDING_AGENTS_NEW_CHAT_KEY, "{not json");
    assert.equal(withWindow(win, () => consumePendingAgentsNewChat()), null);
    assert.equal(store.has(PENDING_AGENTS_NEW_CHAT_KEY), false, "bad payloads do not wedge future boots");
  });
});
