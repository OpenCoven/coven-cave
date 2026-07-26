// @ts-nocheck
import assert from "node:assert/strict";

import {
  applyPreferencesPatch,
  createDefaultPreferences,
  validatePreferencesPatch,
} from "./preferences-schema.ts";

class MemoryStorage {
  values = new Map();
  get length() {
    return this.values.size;
  }
  clear() {
    this.values.clear();
  }
  getItem(key) {
    return this.values.get(key) ?? null;
  }
  key(index) {
    return [...this.values.keys()][index] ?? null;
  }
  removeItem(key) {
    this.values.delete(key);
  }
  setItem(key, value) {
    this.values.set(key, String(value));
  }
}

class TestBroadcastChannel {
  onmessage = null;
  postMessage() {}
  close() {}
  unref() {}
}

function installPaintBootstrap(storage) {
  const paint = createDefaultPreferences(false);
  globalThis.window = {
    localStorage: storage,
    __COVEN_CAVE_PREFERENCES__: paint,
    __COVEN_CAVE_PREFERENCES_AUTHORITATIVE__: false,
    addEventListener() {},
  };
  globalThis.localStorage = storage;
  globalThis.document = { getElementById: () => null };
  globalThis.BroadcastChannel = TestBroadcastChannel;
}

function response(preferences, ok = true, status = ok ? 200 : 503) {
  return {
    ok,
    status,
    json: async () =>
      ok
        ? { ok: true, preferences }
        : { ok: false, error: "temporary failure" },
  };
}

// A delayed canonical GET leaves paint-only defaults and the origin cache
// usable, but never PATCHes until the authoritative response arrives.
{
  const storage = new MemoryStorage();
  storage.setItem("coven-theme", "ember");
  installPaintBootstrap(storage);
  let canonical = createDefaultPreferences(true);
  canonical.appearance.theme.id = "grove";
  let finishGet;
  let getCalls = 0;
  let patchCalls = 0;
  globalThis.fetch = async (_url, init = {}) => {
    if (init.method === "PATCH") {
      patchCalls += 1;
      throw new Error(
        "paint-only state must not be written over canonical preferences",
      );
    }
    getCalls += 1;
    return await new Promise((resolve) => {
      finishGet = () => resolve(response(canonical));
    });
  };
  const client = await import(`./app-preferences.ts?paint-valid=${Date.now()}`);
  assert.equal(client.readAppPreferences().appearance.theme.id, "ember");
  const initializing = client.initializeAppPreferences();
  assert.equal(getCalls, 1);
  assert.equal(patchCalls, 0);
  finishGet();
  const loaded = await initializing;
  assert.equal(loaded.initialized, true);
  assert.equal(loaded.appearance.theme.id, "grove");
  assert.equal(
    patchCalls,
    0,
    "valid canonical state is never replaced by paint defaults",
  );
}

// A genuinely missing/uninitialized canonical store is fetched first, then the
// allowlisted legacy snapshot is initialized exactly once.
{
  const storage = new MemoryStorage();
  storage.setItem("cave:font:sans", "source-sans-3");
  installPaintBootstrap(storage);
  let server = createDefaultPreferences(false);
  let getCalls = 0;
  let patchCalls = 0;
  globalThis.fetch = async (_url, init = {}) => {
    if (init.method === "PATCH") {
      patchCalls += 1;
      server = applyPreferencesPatch(
        server,
        validatePreferencesPatch(JSON.parse(String(init.body))),
      );
      return response(server);
    }
    getCalls += 1;
    return response(server);
  };
  const client = await import(
    `./app-preferences.ts?paint-missing=${Date.now()}`
  );
  const loaded = await client.initializeAppPreferences();
  assert.equal(getCalls, 1);
  assert.equal(patchCalls, 1);
  assert.equal(loaded.initialized, true);
  assert.equal(loaded.appearance.fonts.sans, "source-sans-3");
}

// Failed and malformed canonical reads fail closed. A later explicit retry can
// recover and apply canonical state without losing or transmitting local edits.
for (const failure of ["network", "malformed"]) {
  const storage = new MemoryStorage();
  installPaintBootstrap(storage);
  let canonical = createDefaultPreferences(true);
  canonical.appearance.cornerRadius = "round";
  let recovered = false;
  let patchCalls = 0;
  globalThis.fetch = async (_url, init = {}) => {
    if (init.method === "PATCH") {
      patchCalls += 1;
      if (!recovered)
        throw new Error("unknown canonical state must never be patched");
      canonical = applyPreferencesPatch(
        canonical,
        validatePreferencesPatch(JSON.parse(String(init.body))),
      );
      return response(canonical);
    }
    if (!recovered) {
      if (failure === "network") throw new Error("offline");
      return response({ version: 1, initialized: true });
    }
    return response(canonical);
  };
  const client = await import(
    `./app-preferences.ts?paint-${failure}=${Date.now()}`
  );
  client.updateAppPreferences({ appearance: { screenScale: 125 } });
  const failed = await client.initializeAppPreferences();
  assert.equal(failed.initialized, false);
  assert.equal(failed.appearance.screenScale, 125);
  assert.equal(patchCalls, 0);
  recovered = true;
  await Promise.resolve();
  const loaded = await client.initializeAppPreferences();
  assert.equal(loaded.initialized, true);
  assert.equal(loaded.appearance.cornerRadius, "round");
  assert.equal(
    loaded.appearance.screenScale,
    125,
    "queued local edits survive canonical recovery",
  );
  assert.equal(await client.flushAppPreferences(), true);
  assert.equal(
    patchCalls,
    1,
    "the queued edit is sent only after canonical recovery",
  );
}

console.log("app-preferences-paint-bootstrap.test.ts: ok");
