// @ts-nocheck
import assert from "node:assert/strict";
import { describe, it, afterEach } from "node:test";
import { hasLegacySvgUserAvatar } from "./legacy-svg-avatar-hint.ts";

const originalIndexedDB = globalThis.indexedDB;

afterEach(() => {
  globalThis.indexedDB = originalIndexedDB;
});

function installIndexedDb(record, storeExists = true) {
  globalThis.indexedDB = {
    open(name, version) {
      assert.equal(name, "cave-avatars");
      assert.equal(version, undefined, "legacy residue check must not request an IndexedDB upgrade");
      const openReq = {};
      queueMicrotask(() => {
        openReq.result = {
          objectStoreNames: { contains: (store) => store === "userAvatar" && storeExists },
          close() {},
          transaction(store, mode) {
            assert.equal(store, "userAvatar");
            assert.equal(mode, "readonly");
            return {
              objectStore() {
                return {
                  get(key) {
                    assert.equal(key, "user");
                    const getReq = {};
                    queueMicrotask(() => {
                      getReq.result = record;
                      getReq.onsuccess?.();
                    });
                    return getReq;
                  },
                };
              },
            };
          },
        };
        openReq.onsuccess?.();
      });
      return openReq;
    },
  };
}

describe("legacy SVG avatar hint", () => {
  it("detects only the retired userAvatar SVG record without upgrading the database", async () => {
    installIndexedDb({ mime: "image/svg+xml", dataUrl: "data:image/svg+xml;base64,AAA" });
    assert.equal(await hasLegacySvgUserAvatar(), true);

    installIndexedDb({ mime: "image/png", dataUrl: "data:image/png;base64,AAA" });
    assert.equal(await hasLegacySvgUserAvatar(), false);
  });

  it("swallows missing or unreadable legacy IndexedDB state", async () => {
    installIndexedDb({ mime: "image/svg+xml" }, false);
    assert.equal(await hasLegacySvgUserAvatar(), false);

    globalThis.indexedDB = undefined;
    assert.equal(await hasLegacySvgUserAvatar(), false);
  });
  it("aborts an unexpected upgrade path instead of creating the retired store", async () => {
    let aborted = false;
    globalThis.indexedDB = {
      open(name, version) {
        assert.equal(name, "cave-avatars");
        assert.equal(version, undefined);
        const openReq = {};
        queueMicrotask(() => {
          openReq.result = {
            objectStoreNames: { contains: () => true },
            close() {},
            transaction() {
              return { objectStore: () => ({ get: () => ({}) }) };
            },
          };
          openReq.transaction = {
            abort() {
              aborted = true;
              openReq.onerror?.();
            },
          };
          openReq.onupgradeneeded?.();
          if (!aborted) openReq.onsuccess?.();
        });
        return openReq;
      },
    };

    assert.equal(await hasLegacySvgUserAvatar(), false);
    assert.equal(aborted, true);
  });
});
