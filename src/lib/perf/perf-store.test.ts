import assert from "node:assert/strict";
import test from "node:test";

// A fake sessionStorage, because the point of this module is what happens at
// the storage boundary: quota rejection, a malformed payload from an older
// shape, and survival across a reload. jsdom would give a compliant store and
// hide exactly those cases.
type FakeStorage = Storage & { __throwOnSet?: boolean; __raw: Map<string, string> };

function fakeStorage(): FakeStorage {
  const raw = new Map<string, string>();
  const store = {
    __raw: raw,
    __throwOnSet: false,
    get length() {
      return raw.size;
    },
    clear: () => raw.clear(),
    getItem: (key: string) => raw.get(key) ?? null,
    key: (index: number) => [...raw.keys()][index] ?? null,
    removeItem: (key: string) => {
      raw.delete(key);
    },
    setItem(key: string, value: string) {
      if ((this as FakeStorage).__throwOnSet) {
        const error = new Error("The quota has been exceeded.");
        error.name = "QuotaExceededError";
        throw error;
      }
      raw.set(key, value);
    },
  } as FakeStorage;
  return store;
}

function installWindow(store: FakeStorage): void {
  const listeners = new Map<string, Array<() => void>>();
  (globalThis as Record<string, unknown>).window = {
    sessionStorage: store,
    addEventListener: (type: string, fn: () => void) => {
      listeners.set(type, [...(listeners.get(type) ?? []), fn]);
    },
  };
  (globalThis as Record<string, unknown>).document = {
    visibilityState: "visible",
    addEventListener: () => {},
  };
}

/** Fresh module instance per test: the store keeps module-level buffer state. */
async function freshModule(store: FakeStorage) {
  installWindow(store);
  return import(`./perf-store.ts?case=${Math.random().toString(36).slice(2)}`);
}

test("a sample survives the page that produced it", async () => {
  // The entire reason this module exists. Before it, `marks.ts` kept durations
  // in a module array and vitals lived on `window` — a reload lost both, so a
  // client-side before/after could not be stated at all.
  const store = fakeStorage();
  const first = await freshModule(store);
  first.recordPerfSample({ kind: "mark", name: "chat:transcript-fetch", value: 42, at: 1 });
  first.flushPerfSamples();

  // A "reload": brand new module state, same storage.
  const second = await freshModule(store);
  const samples = second.getPerfSamples();
  assert.equal(samples.length, 1);
  assert.equal(samples[0].name, "chat:transcript-fetch");
  assert.equal(samples[0].value, 42);
});

test("a setItem that throws disables the store and never throws to the caller", async () => {
  // Cave has already shipped a store whose own cap exceeded the real origin
  // quota, and WebKit surfaced it as a raw "The quota has been exceeded."
  // error in the UI. A perf aid that can break the surface it measures is
  // worse than no perf aid.
  const store = fakeStorage();
  store.__throwOnSet = true;
  const mod = await freshModule(store);

  assert.doesNotThrow(() => {
    mod.recordPerfSample({ kind: "mark", name: "chat:transcript-fetch", value: 1, at: 1 });
    mod.flushPerfSamples();
  });
  // And it stays disabled rather than retrying into the same wall on every
  // subsequent sample.
  store.__throwOnSet = false;
  mod.recordPerfSample({ kind: "mark", name: "chat:transcript-fetch", value: 2, at: 2 });
  mod.flushPerfSamples();
  assert.equal(store.__raw.size, 0, "no write was attempted after the quota failure");
});

test("the count cap trims oldest-first", async () => {
  const store = fakeStorage();
  const mod = await freshModule(store);
  for (let i = 0; i < 400; i += 1) {
    mod.recordPerfSample({ kind: "mark", name: "s", value: i, at: i });
  }
  mod.flushPerfSamples();
  const values = mod.getPerfSamples().map((s: { value: number }) => s.value);
  assert.ok(values.length <= 300, `kept ${values.length}`);
  assert.equal(values.at(-1), 399, "the newest sample survived");
  assert.ok(!values.includes(0), "the oldest samples were dropped");
});

test("the byte cap trims even when the count cap is satisfied", async () => {
  // A long span name turns a modest sample count into a large payload; the
  // count cap alone would not notice.
  const store = fakeStorage();
  const mod = await freshModule(store);
  const longName = "chat:".concat("x".repeat(2_000));
  for (let i = 0; i < 200; i += 1) {
    mod.recordPerfSample({ kind: "mark", name: longName, value: i, at: i });
  }
  mod.flushPerfSamples();
  const raw = store.__raw.get("cave:perf:samples") ?? "";
  assert.ok(raw.length <= 128 * 1024, `serialized ${raw.length} bytes`);
  assert.ok(mod.getPerfSamples().length > 0, "it trimmed rather than emptying");
});

test("a malformed persisted payload is ignored, not thrown", async () => {
  const store = fakeStorage();
  store.__raw.set("cave:perf:samples", "{not json");
  const mod = await freshModule(store);
  assert.deepEqual(mod.getPerfSamples(), []);
  assert.doesNotThrow(() => mod.recordPerfSample({ kind: "mark", name: "s", value: 1, at: 1 }));
});

test("percentiles are computed per span name", async () => {
  // A single duration says nothing; percentiles across many opens are the
  // reason samples are kept at all.
  const store = fakeStorage();
  const mod = await freshModule(store);
  for (const value of [10, 20, 30, 40, 100]) {
    mod.recordPerfSample({ kind: "mark", name: "chat:transcript-fetch", value, at: value });
  }
  mod.recordPerfSample({ kind: "mark", name: "other", value: 9_999, at: 1 });
  mod.flushPerfSamples();

  const summary = mod.summarizePerfSamples("chat:transcript-fetch");
  assert.equal(summary.count, 5, "the unrelated span did not contribute");
  assert.equal(summary.p50, 30);
  assert.equal(summary.p95, 100);
  assert.equal(mod.summarizePerfSamples("missing"), null);
});

test("a single sample reports itself as both p50 and p95", async () => {
  const store = fakeStorage();
  const mod = await freshModule(store);
  mod.recordPerfSample({ kind: "mark", name: "s", value: 7, at: 1 });
  mod.flushPerfSamples();
  const summary = mod.summarizePerfSamples("s");
  assert.deepEqual(summary, { count: 1, p50: 7, p95: 7 });
});

test("clear empties both the buffer and the persisted key", async () => {
  const store = fakeStorage();
  const mod = await freshModule(store);
  mod.recordPerfSample({ kind: "mark", name: "s", value: 1, at: 1 });
  mod.flushPerfSamples();
  mod.recordPerfSample({ kind: "mark", name: "s", value: 2, at: 2 }); // still buffered
  mod.clearPerfSamples();
  assert.deepEqual(mod.getPerfSamples(), []);
  assert.equal(store.__raw.has("cave:perf:samples"), false);
});
