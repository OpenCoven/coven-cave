// @ts-nocheck
import assert from "node:assert/strict";

import {
  applyPreferencesPatch,
  createDefaultPreferences,
  validatePreferencesPatch,
} from "./preferences-schema.ts";

class MemoryStorage {
  values = new Map();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key) { return this.values.get(key) ?? null; }
  key(index) { return [...this.values.keys()][index] ?? null; }
  removeItem(key) { this.values.delete(key); }
  setItem(key, value) { this.values.set(key, String(value)); }
}

class TestBroadcastChannel {
  onmessage = null;
  postMessage() {}
  close() {}
  unref() {}
}

const storage = new MemoryStorage();
storage.setItem("cave:font:sans", "source-sans-3");
storage.setItem("cave:home-news-enabled", "false");

let server = createDefaultPreferences(false);
let firstResponse = null;
let failNext = false;
let terminalNext = false;
const sent = [];

function preferenceResponse(ok = true, status = ok ? 200 : 503) {
  return {
    ok,
    status,
    json: async () => ok
      ? { ok: true, preferences: server }
      : { ok: false, error: "temporary failure" },
  };
}

globalThis.window = {
  localStorage: storage,
  __COVEN_CAVE_PREFERENCES__: server,
};
globalThis.localStorage = storage;
globalThis.document = { getElementById: () => null };
globalThis.BroadcastChannel = TestBroadcastChannel;
globalThis.fetch = async (url, init = {}) => {
  if (url === "/api/preferences" && init.method === "PATCH") {
    const patch = JSON.parse(String(init.body));
    sent.push(patch);
    if (terminalNext) {
      terminalNext = false;
      return preferenceResponse(false, 400);
    }
    if (failNext) {
      failNext = false;
      return preferenceResponse(false);
    }
    if (sent.length === 1) {
      return await new Promise((resolve) => {
        firstResponse = () => {
          server = applyPreferencesPatch(server, validatePreferencesPatch(patch));
          resolve(preferenceResponse(true));
        };
      });
    }
    server = applyPreferencesPatch(server, validatePreferencesPatch(patch));
    return preferenceResponse(true);
  }
  if (url === "/api/preferences") return preferenceResponse(true);
  throw new Error(`unexpected fetch ${String(url)}`);
};

const preferences = await import(`./app-preferences.ts?runtime-race=${Date.now()}`);
assert.strictEqual(
  preferences.readAppPreferences(),
  preferences.readAppPreferences(),
  "the external-store getter must keep a stable object identity between writes",
);

// A same-launch choice made before initialization must win over migrated data.
preferences.updateAppPreferences({ appearance: { cornerRadius: "round" } });
const initializing = preferences.initializeAppPreferences();
assert.ok(firstResponse, "initialization should detach and send its first payload immediately");

// A second choice arriving while that request is in flight must remain queued.
preferences.updateAppPreferences({ appearance: { screenScale: 125 } });
firstResponse();
await initializing;
assert.equal(await preferences.flushAppPreferences(), true);

assert.equal(sent.length, 2, "the in-flight write is followed by one serialized patch");
assert.equal(sent[0].appearance.fonts.sans, "source-sans-3", "legacy font migration is retained");
assert.equal(sent[0].general.newsHeadlines, false, "legacy news migration is retained");
assert.equal(sent[0].appearance.cornerRadius, "round", "pre-init user choice joins migration");
assert.deepEqual(sent[1], { appearance: { screenScale: 125 } }, "in-flight user choice is not cleared");
assert.equal(server.appearance.fonts.sans, "source-sans-3");
assert.equal(server.appearance.cornerRadius, "round");
assert.equal(server.appearance.screenScale, 125);
assert.equal(server.general.newsHeadlines, false);
assert.equal(preferences.readAppPreferences().initialized, true);

// Same-tick independent writes coalesce, and a failed write remains retryable.
const beforeCoalesce = sent.length;
preferences.updateAppPreferences({ general: { newsHeadlines: true } });
preferences.updateAppPreferences({ phone: { mobileMode: false } });
assert.equal(await preferences.flushAppPreferences(), true);
assert.equal(sent.length, beforeCoalesce + 1);
assert.deepEqual(sent.at(-1), {
  general: { newsHeadlines: true },
  phone: { mobileMode: false },
});

failNext = true;
preferences.updateAppPreferences({ appearance: { reading: { hyphens: "on" } } });
assert.equal(await preferences.flushAppPreferences(), false, "transient failure is surfaced");
for (let attempt = 0; attempt < 20 && server.appearance.reading.hyphens !== "on"; attempt += 1) {
  await new Promise((resolve) => setTimeout(resolve, 50));
}
assert.equal(server.appearance.reading.hyphens, "on");
assert.equal(await preferences.flushAppPreferences(), true, "automatic retry drains the failed patch");

terminalNext = true;
const beforeTerminal = sent.length;
preferences.updateAppPreferences({ appearance: { datetime: { density: "verbose" } } });
assert.equal(await preferences.flushAppPreferences(), false, "terminal HTTP failures are surfaced");
await new Promise((resolve) => setTimeout(resolve, 650));
assert.equal(
  sent.length,
  beforeTerminal + 1,
  "a terminal 4xx must not create a background retry loop",
);

// A transient failure during the very first migration also retries without a
// second edit, an online event, or a reload.
const secondStorage = new MemoryStorage();
secondStorage.setItem("cave:mobile-mode-enabled", "false");
let secondServer = createDefaultPreferences(false);
let secondCalls = 0;
globalThis.window = {
  localStorage: secondStorage,
  __COVEN_CAVE_PREFERENCES__: secondServer,
};
globalThis.localStorage = secondStorage;
globalThis.fetch = async (url, init = {}) => {
  if (url !== "/api/preferences" || init.method !== "PATCH") {
    throw new Error(`unexpected second fetch ${String(url)}`);
  }
  secondCalls += 1;
  if (secondCalls === 1) return {
    ok: false,
    status: 503,
    json: async () => ({ ok: false, error: "warming up" }),
  };
  const patch = JSON.parse(String(init.body));
  secondServer = applyPreferencesPatch(secondServer, validatePreferencesPatch(patch));
  return {
    ok: true,
    status: 200,
    json: async () => ({ ok: true, preferences: secondServer }),
  };
};
const secondClient = await import(`./app-preferences.ts?initial-retry=${Date.now()}`);
await secondClient.initializeAppPreferences();
for (let attempt = 0; attempt < 20 && !secondServer.initialized; attempt += 1) {
  await new Promise((resolve) => setTimeout(resolve, 50));
}
assert.equal(secondServer.initialized, true, "first-time initialization is retried automatically");
assert.equal(secondServer.phone.mobileMode, false, "the migration payload survives its retry");
assert.equal(secondClient.readAppPreferences().initialized, true);

console.log("app-preferences-runtime.test.ts: ok");
