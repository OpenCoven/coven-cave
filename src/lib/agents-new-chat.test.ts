import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AGENTS_NEW_CHAT_EVENT,
  publishRightChatFailure,
  subscribeRightChatFailures,
  AGENTS_NEW_RIGHT_CHAT_EVENT,
  PENDING_AGENTS_NEW_CHAT_KEY,
  clearPendingAgentsNewChat,
  consumePendingAgentsNewChat,
  hasIndependentRightChatProject,
  readPendingAgentsNewChat,
  resolveRightChatProjectRoot,
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
  open?: (url: string, target: string) => unknown;
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

  it("uses an acknowledged side-panel event, never the main-chat event", () => {
    const { win, assigned, store } = makeWindow("/");
    const events: Event[] = [];
    win.dispatchEvent = (event) => {
      events.push(event);
      event.preventDefault();
      return false;
    };
    const request = { destination: "right-panel" as const, familiarId: "sage", initialPrompt: "fix it", projectRoot: "/work" };
    const result = withWindow(win, () => requestAgentsNewChat(request));
    assert.equal(result.ok, true);
    assert.equal(events.length, 1);
    assert.equal(events[0].type, AGENTS_NEW_RIGHT_CHAT_EVENT);
    assert.deepEqual((events[0] as CustomEvent).detail, request);
    assert.deepEqual(assigned, []);
    assert.equal(store.size, 0);
  });

  it("reports an unavailable side-panel listener without navigating", () => {
    const { win, assigned } = makeWindow("/");
    const result = withWindow(win, () => requestAgentsNewChat({ destination: "right-panel" }));
    assert.equal(result.ok, false);
    assert.deepEqual(assigned, []);
  });

  it("stages a standalone fix before loading a new tab and preserves its source page", () => {
    const { win, store, assigned } = makeWindow("/dashboard/familiars/sage/analytics");
    const handoffs = new Map<string, string>();
    const navigations: string[] = [];
    const target = {
      opener: win as unknown,
      sessionStorage: { setItem: (key: string, value: string) => handoffs.set(key, value) },
      location: { replace: (url: string) => { assert.equal(handoffs.size, 1); navigations.push(url); } },
    };
    win.open = (url, name) => {
      assert.equal(url, "about:blank");
      assert.equal(name, "_blank");
      return target;
    };
    const request = { destination: "right-panel" as const, familiarId: "sage", initialPrompt: "repair" };
    assert.deepEqual(withWindow(win, () => requestAgentsNewChat(request)), { ok: true, destination: "new-window" });
    assert.deepEqual(JSON.parse(handoffs.get(PENDING_AGENTS_NEW_CHAT_KEY)!), request);
    assert.equal(target.opener, null);
    assert.deepEqual(navigations, ["/"]);
    assert.deepEqual(assigned, []);
    assert.equal(store.size, 0, "the analytics page cannot replay the child's request");
  });

  it("reports popup and storage failures rather than opening an unprimed chat", () => {
    const { win, assigned } = makeWindow("/familiars/cody/analytics");
    win.open = () => null;
    assert.equal(withWindow(win, () => requestAgentsNewChat({ destination: "right-panel" })).ok, false);
    let closed = false;
    win.open = () => ({
      sessionStorage: { setItem: () => { throw new Error("storage denied"); } },
      close: () => { closed = true; },
    });
    assert.equal(withWindow(win, () => requestAgentsNewChat({ destination: "right-panel" })).ok, false);
    assert.equal(closed, true);
    assert.deepEqual(assigned, []);
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

  describe("independent fix-thread projects", () => {
    it("routes explicit and source-thread targets independently, not ordinary main launches", () => {
      assert.equal(hasIndependentRightChatProject({ destination: "right-panel", projectRoot: "/repo/alpha" }), true);
      assert.equal(hasIndependentRightChatProject({ destination: "right-panel", sourceSessionId: "source" }), true);
      assert.equal(hasIndependentRightChatProject({ destination: "right-panel" }), false);
      assert.equal(hasIndependentRightChatProject({ projectRoot: "/repo/alpha" }), false);
    });

    it("keeps an explicit project root without resolving a different source", async () => {
      assert.equal(await resolveRightChatProjectRoot({ projectRoot: "/repo/alpha", sourceSessionId: "old" }), "/repo/alpha");
    });

    it("resolves the popup's actual source project through the actor-scoped session list", async () => {
      const previous = globalThis.fetch;
      globalThis.fetch = async (url) => {
        assert.equal(new URL(String(url), "http://localhost").searchParams.get("familiarId"), "cody");
        assert.equal(new URL(String(url), "http://localhost").searchParams.get("includeArchived"), "1");
        return Response.json({ ok: true, sessions: [{ id: "source", familiarId: "cody", project_root: "/repo/alpha", archived_at: "2026-09-01" }] });
      };
      try {
        assert.equal(await resolveRightChatProjectRoot({ familiarId: "cody", sourceSessionId: "source" }), "/repo/alpha");
      } finally {
        globalThis.fetch = previous;
      }
    });

    it("does not substitute the current project for unavailable or wrong-actor source evidence", async () => {
      const previous = globalThis.fetch;
      try {
        for (const sessions of [[], [{ id: "source", familiarId: "nova", project_root: "/repo/alpha" }], [{ id: "source", familiarId: "cody", project_root: null }]]) {
          globalThis.fetch = async () => Response.json({ ok: true, sessions });
          await assert.rejects(resolveRightChatProjectRoot({ familiarId: "cody", sourceSessionId: "source" }), /source thread's project is unavailable/);
        }
        globalThis.fetch = async () => Response.json({ ok: false }, { status: 503 });
        await assert.rejects(resolveRightChatProjectRoot({ familiarId: "cody", sourceSessionId: "source" }), /Couldn't load/);
      } finally {
        globalThis.fetch = previous;
      }
    });
  });

  describe("readPendingAgentsNewChat", () => {
    it("retains a valid request until launch or explicit cancellation clears it", () => {
      const { win, store } = makeWindow("/");
      store.set(PENDING_AGENTS_NEW_CHAT_KEY, JSON.stringify({ initialPrompt: "go" }));

      const got = withWindow(win, () => readPendingAgentsNewChat());
      assert.deepEqual(got, { initialPrompt: "go" });
      assert.equal(store.has(PENDING_AGENTS_NEW_CHAT_KEY), true, "read does not discard a deferred launch");

      withWindow(win, () => clearPendingAgentsNewChat());
      assert.equal(store.has(PENDING_AGENTS_NEW_CHAT_KEY), false);
    });
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

  it("clears and ignores structurally invalid payloads", () => {
    const { win, store } = makeWindow("/");
    store.set(PENDING_AGENTS_NEW_CHAT_KEY, JSON.stringify({ projectRoot: { path: "/code/cave" } }));
    assert.equal(withWindow(win, () => readPendingAgentsNewChat()), null);
    assert.equal(store.has(PENDING_AGENTS_NEW_CHAT_KEY), false, "invalid field types cannot crash cold boot");
  });

  it("validates the destination and preserves a pending side-panel prompt until consumption", () => {
    const { win, store } = makeWindow("/");
    const request = { familiarId: "cody", destination: "right-panel", initialPrompt: "fix it" };
    store.set(PENDING_AGENTS_NEW_CHAT_KEY, JSON.stringify(request));
    assert.deepEqual(withWindow(win, () => readPendingAgentsNewChat()), request);
    assert.deepEqual(withWindow(win, () => consumePendingAgentsNewChat()), request);
    assert.equal(withWindow(win, () => consumePendingAgentsNewChat()), null);
    store.set(PENDING_AGENTS_NEW_CHAT_KEY, JSON.stringify({ destination: "unknown" }));
    assert.equal(withWindow(win, () => readPendingAgentsNewChat()), null);
    assert.equal(store.size, 0);
  });
});


describe("right chat failure acknowledgements", () => {
  it("delivers failures across windows and removes a disposed subscription", () => {
    const channels = new Set<FakeChannel>();
    class FakeChannel extends EventTarget {
      readonly name: string;
      constructor(name: string) { super(); this.name = name; channels.add(this); }
      postMessage(data: unknown) {
        for (const channel of channels) {
          if (channel !== this && channel.name === this.name) {
            channel.dispatchEvent(new MessageEvent("message", { data }));
          }
        }
      }
      close() { channels.delete(this); }
    }
    function context() {
      const events = new EventTarget();
      return Object.assign(makeWindow("/").win, {
        BroadcastChannel: FakeChannel,
        addEventListener: events.addEventListener.bind(events),
        removeEventListener: events.removeEventListener.bind(events),
        dispatchEvent: events.dispatchEvent.bind(events),
      });
    }
    const source = context();
    const target = new FakeChannel("cave:agents-right-chat-failed");
    const failures: unknown[] = [];
    const unsubscribe = withWindow(source, () => subscribeRightChatFailures((detail) => failures.push(detail)));
    target.postMessage({ requestId: "first", error: "Superseded. Retry." });
    assert.deepEqual(failures, [{ requestId: "first", error: "Superseded. Retry." }]);
    withWindow(source, () => publishRightChatFailure({ requestId: "second", destination: "right-panel" }, "Unavailable"));
    assert.equal(failures.length, 2, "same-window failure is delivered once");
    unsubscribe();
    target.postMessage({ requestId: "third", error: "Unavailable" });
    target.close();
    assert.equal(failures.length, 2);
    assert.equal(channels.size, 0, "no channels survive unsubscribe/publish");
  });
});
