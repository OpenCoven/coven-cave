import assert from "node:assert/strict";
import test from "node:test";

type StoredAvatar = { dataUrl: string; mime: string; updatedAt: string };

test("move resolves both avatar conflicts atomically and observes failed transactions", async () => {
  const originalIndexedDb = Object.getOwnPropertyDescriptor(globalThis, "indexedDB");
  const records = new Map<string, StoredAvatar>();
  const aliases = new Map<string, string>();
  const mutations: Array<{ tx: number; operation: "put" | "delete"; key: string }> = [];
  const unhandled: unknown[] = [];
  let transactionId = 0;
  let failNextGet: Error | null = null;
  let failNextOpen: Error | null = null;
  let failNextRead: Error | null = null;
  let failNextTransaction: Error | null = null;
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
        objectStore(name = "projectAvatars") {
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
                  if (failNextTransaction) {
                    const error = failNextTransaction;
                    failNextTransaction = null;
                    aborted = true;
                    tx.error = error;
                    tx.onerror?.();
                  } else {
                    tx.oncomplete?.();
                  }
                }
              });
            });
            return result;
          };
          if (name === "projectAvatarAliases") {
            return {
              get(key: string) {
                return request(() => aliases.get(key));
              },
              put(value: string, key: string) {
                return request(() => {
                  aliases.set(key, value);
                  return key;
                });
              },
              delete(key: string) {
                return request(() => aliases.delete(key));
              },
            };
          }
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
            getAllKeys() {
              return request(() => {
                if (failNextRead) {
                  const error = failNextRead;
                  failNextRead = null;
                  throw error;
                }
                return [...records.keys()];
              });
            },
            getAll() {
              return request(() => [...records.values()]);
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
      queueMicrotask(() => {
        if (failNextOpen) {
          request.error = failNextOpen;
          failNextOpen = null;
          request.onerror?.();
        } else {
          request.onsuccess?.();
        }
      });
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
    const openError = new Error("transient IndexedDB open failure");
    failNextOpen = openError;
    await assert.rejects(
      () => avatarStorage().getAllStrict("projectAvatars"),
      (error) => error === openError,
      "strict hydration surfaces open errors",
    );

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
    assert.deepEqual(
      await avatarStorage().getAllStrict("projectAvatars"),
      { legacy: older, canonical: newer },
      "a failed open does not poison the next strict hydration",
    );

    const readError = new Error("transient IndexedDB read failure");
    failNextRead = readError;
    await assert.rejects(
      () => avatarStorage().getAllStrict("projectAvatars"),
      (error) => error === readError,
      "strict hydration surfaces request errors",
    );
    failNextRead = readError;
    assert.deepEqual(
      await avatarStorage().getAll("projectAvatars"),
      {},
      "ordinary non-critical hydration remains tolerant",
    );

    const transactionError = new Error("transient IndexedDB transaction failure");
    failNextTransaction = transactionError;
    await assert.rejects(
      () => avatarStorage().getAllStrict("projectAvatars"),
      (error) => error === transactionError,
      "strict hydration waits for and surfaces transaction failure",
    );
    failNextTransaction = transactionError;
    assert.deepEqual(
      await avatarStorage().getAll("projectAvatars"),
      {},
      "ordinary hydration also tolerates transaction completion failure",
    );

    mutations.length = 0;
    assert.deepEqual(
      await avatarStorage().move("projectAvatars", "legacy", "canonical"),
      {
        source: null,
        sourceKey: "legacy",
        destination: newer,
        destinationKey: "canonical",
      },
    );
    assert.equal(records.has("legacy"), false, "newer canonical data consumes the legacy source");
    assert.deepEqual(records.get("canonical"), newer);
    assert.deepEqual(
      mutations.map(({ operation, key }) => ({ operation, key })),
      [{ operation: "delete", key: "legacy" }],
      "destination-newer conflict only deletes the source",
    );

    aliases.clear();
    records.set("legacy", newer);
    records.set("canonical", older);
    mutations.length = 0;
    assert.deepEqual(
      await avatarStorage().move("projectAvatars", "legacy", "canonical"),
      {
        source: null,
        sourceKey: "legacy",
        destination: newer,
        destinationKey: "canonical",
      },
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

    aborts = 0;
    const requestError = new Error("deterministic source get failure");
    failNextGet = requestError;
    await assert.rejects(
      avatarStorage().move("projectAvatars", "legacy", "canonical"),
      (error) => error === requestError,
    );
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(aborts, 1, "the failed request aborts its transaction");
    assert.deepEqual(unhandled, [], "the transaction rejection is always observed");

    records.clear();
    aliases.clear();
    assert.deepEqual(
      await avatarStorage().move("projectAvatars", "late-legacy", "late-canonical"),
      {
        source: null,
        sourceKey: "late-legacy",
        destination: null,
        destinationKey: "late-canonical",
      },
      "migration persists a redirect even when no avatar exists yet",
    );
    const late: StoredAvatar = {
      dataUrl: "data:image/png;base64,late",
      mime: "image/png",
      updatedAt: "2026-08-05T21:00:00.000Z",
    };
    assert.equal(
      await avatarStorage().put("projectAvatars", "late-legacy", late),
      "late-canonical",
      "a stale cross-window writer resolves the durable redirect transactionally",
    );
    assert.equal(records.has("late-legacy"), false);
    assert.deepEqual(records.get("late-canonical"), late);

    records.clear();
    aliases.clear();
    records.set("root-a", older);
    await avatarStorage().move("projectAvatars", "root-a", "root-b");
    assert.deepEqual(records.get("root-b"), older);
    assert.equal(aliases.get("root-a"), "root-b");
    assert.deepEqual(
      await avatarStorage().move("projectAvatars", "root-b", "root-a"),
      {
        source: null,
        sourceKey: "root-b",
        destination: older,
        destinationKey: "root-a",
      },
      "a reverse migration re-roots the alias instead of resolving the destination back to the source",
    );
    assert.deepEqual(records.get("root-a"), older);
    assert.equal(records.has("root-b"), false);
    assert.equal(aliases.has("root-a"), false, "the new canonical root retires its stale alias");
    assert.equal(aliases.get("root-b"), "root-a", "the prior canonical root redirects late writers");
    assert.equal(
      await avatarStorage().put("projectAvatars", "root-b", newer),
      "root-a",
    );
    assert.deepEqual(records.get("root-a"), newer);

    records.clear();
    aliases.clear();
    records.set("chain-a", older);
    await avatarStorage().move("projectAvatars", "chain-a", "chain-b");
    await avatarStorage().move("projectAvatars", "chain-b", "chain-c");
    await avatarStorage().move("projectAvatars", "chain-c", "chain-a");
    assert.deepEqual(records.get("chain-a"), older, "a longer remigration chain lands at its latest root");
    assert.equal(records.has("chain-b"), false);
    assert.equal(records.has("chain-c"), false);
    assert.equal(aliases.has("chain-a"), false);
    assert.equal(aliases.get("chain-b"), "chain-c");
    assert.equal(aliases.get("chain-c"), "chain-a");
    await avatarStorage().put("projectAvatars", "chain-b", newer);
    assert.deepEqual(
      records.get("chain-a"),
      newer,
      "late writes follow the full retired-root chain to the current canonical root",
    );

    aliases.set("cycle-a", "cycle-b");
    aliases.set("cycle-b", "cycle-a");
    const beforeCycleAttempt = new Map(records);
    await assert.rejects(
      avatarStorage().move("projectAvatars", "cycle-a", "cycle-c"),
      /project avatar alias cycle/,
    );
    assert.deepEqual(
      records,
      beforeCycleAttempt,
      "a pre-existing alias cycle aborts migration before avatar mutation",
    );
  } finally {
    process.off("unhandledRejection", onUnhandled);
    if (originalIndexedDb) {
      Object.defineProperty(globalThis, "indexedDB", originalIndexedDb);
    } else {
      delete (globalThis as { indexedDB?: unknown }).indexedDB;
    }
  }
});
