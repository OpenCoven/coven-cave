import assert from "node:assert/strict";
import {
  clearDemoModeData,
  DEMO_MODE_EVENT,
  DEMO_MODE_HEADER,
  DEMO_MODE_STORAGE_KEY,
  isDemoModeEnabled,
  isDemoModeRequest,
  setDemoModeEnabled,
} from "./demo-mode.ts";

type Listener = (event: Event) => void;

const storage = new Map<string, string>();
const events: string[] = [];
const listeners = new Map<string, Listener[]>();

Object.defineProperty(globalThis, "window", {
  configurable: true,
  value: {
    location: new URL("https://cave.local/?demo=1"),
    history: {
      replaceState(_state: unknown, _title: string, url: string) {
        const fakeWindow = window as unknown as { location: URL };
        fakeWindow.location = new URL(url, "https://cave.local/");
      },
    },
    localStorage: {
      getItem(key: string) {
        return storage.get(key) ?? null;
      },
      setItem(key: string, value: string) {
        storage.set(key, value);
      },
      removeItem(key: string) {
        storage.delete(key);
      },
    },
    addEventListener(type: string, listener: Listener) {
      listeners.set(type, [...(listeners.get(type) ?? []), listener]);
    },
    dispatchEvent(event: Event) {
      events.push(event.type);
      for (const listener of listeners.get(event.type) ?? []) listener(event);
      return true;
    },
  },
});

assert.equal(DEMO_MODE_STORAGE_KEY, "cave:demo-mode");
assert.equal(DEMO_MODE_EVENT, "cave:demo-mode-change");
assert.equal(DEMO_MODE_HEADER, "x-cave-demo-mode");

assert.equal(
  isDemoModeEnabled(),
  true,
  "demo=1 in the launch URL should activate demo mode for first-run/screenshots",
);

setDemoModeEnabled(true);
assert.equal(storage.get(DEMO_MODE_STORAGE_KEY), "1");
assert.equal(events.at(-1), DEMO_MODE_EVENT);
assert.equal(isDemoModeEnabled(), true);

setDemoModeEnabled(false);
assert.equal(storage.has(DEMO_MODE_STORAGE_KEY), false);
assert.equal(isDemoModeEnabled(), true, "demo=1 still enables the current launch");

clearDemoModeData();
assert.equal(storage.has(DEMO_MODE_STORAGE_KEY), false);
assert.equal(new URL(window.location.href).searchParams.has("demo"), false);
assert.equal(isDemoModeEnabled(), false);

assert.equal(
  isDemoModeRequest(new Request("https://cave.local/api/coven-status?demo=1")),
  true,
  "server routes should support query activation for screenshots",
);
assert.equal(
  isDemoModeRequest(
    new Request("https://cave.local/api/coven-status", {
      headers: { [DEMO_MODE_HEADER]: "1" },
    }),
  ),
  true,
  "server routes should support explicit demo headers from the client",
);
assert.equal(isDemoModeRequest(new Request("https://cave.local/api/coven-status")), false);

console.log("demo-mode.test.ts OK");
