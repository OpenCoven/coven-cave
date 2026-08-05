import assert from "node:assert/strict";
import test from "node:test";

type StoredAvatar = { dataUrl: string; mime: string; updatedAt: string };

test("move resolves both avatar conflicts atomically and observes failed transactions", async () => {
  const originalIndexedDb = Object.getOwnPropertyDescriptor(globalThis, "indexedDB");
  const records = new Map<string, StoredAvatar>();
  const mutations: Array<{ tx: number; operation: "put" | "delete"; key: string }> = [];
  const unhandled: unknown[] = [];
  let transactionId = 0;
  let failNextGet: Error | null = null;
  let aborts = 0;

  const db = {
    onversionchange: null as (() => void) | null,
    close() {},
    transaction() {
      const id = ++transactionId;
      let pending = 0;
      let revision = 0;
      let aborted = false;
      const tx = {
        error: null as Error | null,
        oncomplete: null as (() => void) | null,
        onerror: null as (() => void) | null,
        onabort: null as (() => void) | null,
        objectStore() {
          const request = <T>(work: () => T) => {
            const currentRevision = ++revision;
            pending += 1;
            const result = {
              error: null as Error | null,
              result: undefined as T | undefined,
              onsuccess: null as (() => void) | null,
              onerror: null as (() => void) | null,
            };
            queueMicrotask(() => {
              if (aborted) return;
              try {
                result.result = work();
                result.onsuccess?.();
              } catch (error) {
                aborted = true;
                result.error = error as Error;
                result.onerror?.();
                queueMicrotask(() => {
                  aborts += 1;
                  tx.error = error as Error;
                  tx.onabort?.();
                });
                return;
              } finally {
                pending -= 1;
              }
              queueMicrotask(() => {
                if (!aborted && pending === 0 && revision === currentRevision) {
                  tx.oncomplete?.();
                }
              });
            });
            return result;
          };
          return {
            get(key: string) {
              return request(() => {
                if (failNextGet) {
                  const error = failNextGet;
                  failNextGet = null;
                  throw error;
                }
                return records.get(key);
              });
            },
            put(value: StoredAvatar, key: string) {
              return request(() => {
                records.set(key, value);
                mutations.push({ tx: id, operation: "put", key });
                return key;
              });
            },
            delete(key: string) {
              return request(() => {
                records.delete(key);
                mutations.push({ tx: id, operation: "delete", key });
              });
            },
          };
        },
      };
      return tx;
    },
  };
  const indexedDb = {
    open() {
      const request = {
        error: null as Error | null,
        result: db,
        onupgradeneeded: null as (() => void) | null,
        onsuccess: null as (() => void) | null,
        onerror: null as (() => void) | null,
        onblocked: null as (() => void) | null,
      };
      queueMicrotask(() => request.onsuccess?.());
      return request;
    },
  };
  const onUnhandled = (reason: unknown) => unhandled.push(reason);

  Object.defineProperty(globalThis, "indexedDB", {
    configurable: true,
    value: indexedDb,
  });
  process.on("unhandledRejection", onUnhandled);

  try {
    const { avatarStorage } = await import("./avatar-idb.ts");
    const older: StoredAvatar = {
      dataUrl: "data:image/png;base64,older",
      mime: "image/png",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    const newer: StoredAvatar = {
      dataUrl: "data:image/png;base64,newer",
      mime: "image/png",
      updatedAt: "2026-01-02T00:00:00.000Z",
    };

    records.set("legacy", older);
    records.set("canonical", newer);
    mutations.length = 0;
    assert.deepEqual(
      await avatarStorage().move("projectAvatars", "legacy", "canonical"),
      { source: null, destination: newer },
    );
    assert.equal(records.has("legacy"), false, "newer canonical data consumes the legacy source");
    assert.deepEqual(records.get("canonical"), newer);
    assert.deepEqual(
      mutations.map(({ operation, key }) => ({ operation, key })),
      [{ operation: "delete", key: "legacy" }],
      "destination-newer conflict only deletes the source",
    );

    records.set("legacy", newer);
    records.set("canonical", older);
    mutations.length = 0;
    assert.deepEqual(
      await avatarStorage().move("projectAvatars", "legacy", "canonical"),
      { source: null, destination: newer },
    );
    assert.equal(records.has("legacy"), false, "newer legacy data is consumed after promotion");
    assert.deepEqual(records.get("canonical"), newer, "newer legacy data overwrites canonical data");
    assert.deepEqual(
      mutations.map(({ operation, key }) => ({ operation, key })),
      [
        { operation: "put", key: "canonical" },
        { operation: "delete", key: "legacy" },
      ],
    );
    assert.equal(
      new Set(mutations.map(({ tx }) => tx)).size,
      1,
      "the overwrite and source deletion share one transaction",
    );

    const requestError = new Error("deterministic source get failure");
    failNextGet = requestError;
    await assert.rejects(
      avatarStorage().move("projectAvatars", "legacy", "canonical"),
      (error) => error === requestError,
    );
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(aborts, 1, "the failed request aborts its transaction");
    assert.deepEqual(unhandled, [], "the transaction rejection is always observed");
  } finally {
    process.off("unhandledRejection", onUnhandled);
    if (originalIndexedDb) {
      Object.defineProperty(globalThis, "indexedDB", originalIndexedDb);
    } else {
      delete (globalThis as { indexedDB?: unknown }).indexedDB;
    }
  }
});
