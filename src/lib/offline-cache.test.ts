// @ts-nocheck
import assert from "node:assert/strict";
import test from "node:test";

import {
  OFFLINE_CACHE_MAX_ENTRY_BYTES,
  clearOfflineCache,
  isOfflineCacheSupported,
  readOfflineCache,
  readOfflineCacheStatus,
  sanitizeForOfflineCache,
  writeOfflineCache,
} from "./offline-cache.ts";

/** Records every native call so a test can assert what reached the disk. */
function recorder(result) {
  const calls = [];
  return {
    calls,
    dependencies: {
      supported: () => true,
      invoke: (command, args) => {
        calls.push({ command, args });
        return Promise.resolve(typeof result === "function" ? result(command, args) : result);
      },
    },
  };
}

function hit(payload, overrides = {}) {
  return {
    purged: false,
    entry: {
      payload,
      revision: "rev-1",
      updatedAtUnixMs: 1_700_000_000_000,
      readOnly: true,
      ...overrides,
    },
  };
}

test("credential-shaped keys never reach the payload", () => {
  const { value, dropped } = sanitizeForOfflineCache({
    title: "Standup notes",
    token: "sk-live-abc",
    apiKey: "secret",
    API_KEY: "secret",
    Authorization: "Bearer abc",
    "session-key": "abc",
    nested: { refreshToken: "abc", privateKey: "abc", body: "keep me" },
  });

  assert.deepEqual(value, { title: "Standup notes", nested: { body: "keep me" } });
  assert.deepEqual(dropped.sort(), [
    "API_KEY",
    "Authorization",
    "apiKey",
    "nested.privateKey",
    "nested.refreshToken",
    "session-key",
    "token",
  ]);
});

test("attachment bytes are dropped while ordinary prose survives", () => {
  const long = "A".repeat(9000);
  const { value, dropped } = sanitizeForOfflineCache({
    text: "Here is the diagram we discussed.",
    attachment: {
      name: "diagram.png",
      mimeType: "image/png",
      bytes: "iVBORw0KGgo=",
      base64: "iVBORw0KGgo=",
    },
    avatar: "data:image/png;base64,iVBORw0KGgo=",
    transcript: long,
  });

  assert.deepEqual(value, {
    text: "Here is the diagram we discussed.",
    attachment: { name: "diagram.png", mimeType: "image/png" },
  });
  assert.deepEqual(dropped.sort(), [
    "attachment.base64",
    "attachment.bytes",
    "avatar",
    "transcript",
  ]);
});

test("long prose is kept even though a long base64 run is not", () => {
  const prose = "The quick brown fox. ".repeat(600);
  const { value, dropped } = sanitizeForOfflineCache({ prose });
  assert.equal(value.prose, prose);
  assert.deepEqual(dropped, []);
});

test("values that are not plain JSON data are dropped rather than serialized", () => {
  class Message {
    constructor() {
      this.role = "user";
    }
  }
  const { value, dropped } = sanitizeForOfflineCache({
    turns: [{ id: "t1", text: "hi", when: new Date(0) }],
    raw: new Uint8Array([1, 2, 3]),
    typed: new Message(),
    missing: undefined,
    count: 3,
    done: false,
    empty: null,
  });

  assert.deepEqual(value, {
    turns: [{ id: "t1", text: "hi" }],
    count: 3,
    done: false,
    empty: null,
  });
  assert.deepEqual(dropped.sort(), ["raw", "turns.0.when", "typed"]);
});

test("prototype-polluting keys are refused", () => {
  const { value, dropped } = sanitizeForOfflineCache(
    JSON.parse('{"ok":true,"__proto__":{"polluted":true},"constructor":1}'),
  );
  assert.deepEqual(Object.keys(value), ["ok"]);
  assert.deepEqual(dropped.sort(), ["__proto__", "constructor"]);
  assert.equal({}.polluted, undefined);
});

test("a write sanitizes before it invokes and forwards the entry identity", async () => {
  const { calls, dependencies } = recorder(null);
  const stored = await writeOfflineCache(
    "conversation",
    "session-4775",
    { title: "Standup", token: "sk-live-abc" },
    "rev-9",
    dependencies,
  );

  assert.equal(stored, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, "offline_cache_write");
  assert.deepEqual(calls[0].args, {
    scope: "conversation",
    key: "session-4775",
    payload: '{"title":"Standup"}',
    revision: "rev-9",
  });
  assert.ok(!calls[0].args.payload.includes("sk-live-abc"), "the secret must not be serialized");
});

test("an over-budget payload is refused without touching the native side", async () => {
  const { calls, dependencies } = recorder(null);
  // Prose rather than a filler run of one character: the sanitizer would drop
  // the latter as embedded bytes and the budget check would never be reached.
  const prose = "The quick brown fox. ".repeat(Math.ceil(OFFLINE_CACHE_MAX_ENTRY_BYTES / 21));
  const stored = await writeOfflineCache(
    "conversation",
    "session-4775",
    { text: prose },
    "rev-9",
    dependencies,
  );

  assert.equal(stored, false);
  assert.deepEqual(calls, []);
});

test("an unusable entry name is refused without touching the native side", async () => {
  const { calls, dependencies } = recorder(hit("{}"));
  assert.equal(await readOfflineCache("conversation", "", dependencies), null);
  assert.equal(await readOfflineCache("conversation", "x".repeat(129), dependencies), null);
  assert.equal(await writeOfflineCache("conversation", "a\nb", {}, "r", dependencies), false);
  assert.deepEqual(calls, []);
});

test("nothing is read or written outside the desktop shell", async () => {
  const calls = [];
  const dependencies = {
    supported: () => false,
    invoke: (command) => {
      calls.push(command);
      return Promise.resolve(null);
    },
  };

  assert.equal(isOfflineCacheSupported(dependencies), false);
  assert.equal(await readOfflineCache("conversation", "abc", dependencies), null);
  assert.equal(await writeOfflineCache("conversation", "abc", {}, "r", dependencies), false);
  assert.equal(await clearOfflineCache("conversation", dependencies), false);
  assert.equal(await readOfflineCacheStatus(dependencies), null);
  assert.deepEqual(calls, []);
});

test("a hit is parsed and labelled read-only", async () => {
  const { calls, dependencies } = recorder(hit('{"turns":[{"id":"t1"}]}'));
  const read = await readOfflineCache("conversation", "session-4775", dependencies);

  assert.deepEqual(read, {
    data: { turns: [{ id: "t1" }] },
    revision: "rev-1",
    updatedAtUnixMs: 1_700_000_000_000,
    readOnly: true,
  });
  assert.deepEqual(calls[0], {
    command: "offline_cache_read",
    args: { scope: "conversation", key: "session-4775" },
  });
});

test("a miss, a purge, and unparsable bytes are all a plain null", async () => {
  for (const result of [
    { purged: false },
    { purged: true, fault: { kind: "undecryptable", detail: "…" } },
    hit("{not json"),
  ]) {
    const { dependencies } = recorder(result);
    assert.equal(await readOfflineCache("conversation", "abc", dependencies), null);
  }
});

test("an entry the native side did not mark read-only is not served", async () => {
  const { dependencies } = recorder(hit('{"a":1}', { readOnly: false }));
  assert.equal(await readOfflineCache("conversation", "abc", dependencies), null);
});

test("a native failure is absorbed rather than surfaced", async () => {
  const warnings = [];
  const dependencies = {
    supported: () => true,
    warn: (message) => warnings.push(message),
    invoke: () => Promise.reject(new Error("keychain is locked")),
  };

  assert.equal(await readOfflineCache("conversation", "abc", dependencies), null);
  assert.equal(await writeOfflineCache("conversation", "abc", { a: 1 }, "r", dependencies), false);
  assert.equal(await clearOfflineCache(undefined, dependencies), false);
  assert.equal(await readOfflineCacheStatus(dependencies), null);
  assert.deepEqual(warnings, ["[cave] offline cache write is unavailable"]);
});

test("clearing targets one scope or the whole instance", async () => {
  const { calls, dependencies } = recorder(null);
  await clearOfflineCache("conversation", dependencies);
  await clearOfflineCache(undefined, dependencies);

  assert.deepEqual(
    calls.map((call) => call.args),
    [{ scope: "conversation" }, { scope: null }],
  );
});

test("status reports occupancy and the classified faults", async () => {
  const status = {
    schemaVersion: 2,
    instanceId: "0123456789abcdef0123456789abcdef",
    entries: 2,
    bytes: 4096,
    maxEntries: 256,
    maxEntryBytes: 1024 * 1024,
    maxTotalBytes: 32 * 1024 * 1024,
    faults: [{ kind: "schema_mismatch", detail: "entry was written by a different cache generation" }],
  };
  const { dependencies } = recorder(status);
  assert.deepEqual(await readOfflineCacheStatus(dependencies), status);
});
