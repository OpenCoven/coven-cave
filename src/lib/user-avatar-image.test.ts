// @ts-nocheck
import assert from "node:assert/strict";

// Legacy localStorage record pre-seeded so the import exercises the one-time
// migration into IndexedDB.
const storage = new Map();
const legacyAvatar = {
  dataUrl: "data:image/png;base64," + "L".repeat(500),
  mime: "image/png",
  updatedAt: "2026-01-01T00:00:00.000Z",
};
storage.set("cave:user-avatar-image:v1", JSON.stringify(legacyAvatar));
globalThis.window = {
  localStorage: {
    getItem: (k) => (storage.has(k) ? storage.get(k) : null),
    setItem: (k, v) => storage.set(k, v),
    removeItem: (k) => storage.delete(k),
  },
  addEventListener: () => {},
  removeEventListener: () => {},
};

// Map-backed fake IndexedDB driver with a write-failure toggle.
const idb = { familiarImages: new Map(), userAvatar: new Map() };
let denyWrites = false;
const fakeDriver = {
  async getAll(store) {
    return Object.fromEntries(idb[store]);
  },
  async put(store, key, value) {
    if (denyWrites) throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
    idb[store].set(key, value);
  },
  async delete(store, key) {
    idb[store].delete(key);
  },
};

// Inject the fake BEFORE the store module loads — its import-time hydration
// must already go through the driver seam.
const { setAvatarStorageForTests } = await import("./avatar-idb.ts");
setAvatarStorageForTests(fakeDriver);

const mod = await import("./user-avatar-image.ts");
await mod.whenUserAvatarHydrated();

// Migration: the legacy record lands in IndexedDB and in the snapshot, and
// the legacy key is removed.
{
  const got = mod.readUserAvatarImageSnapshot();
  assert.ok(got, "legacy avatar is available after hydration");
  assert.equal(got.dataUrl, legacyAvatar.dataUrl);
  assert.ok(idb.userAvatar.has("user"), "legacy avatar persisted to IndexedDB");
  assert.equal(storage.has("cave:user-avatar-image:v1"), false, "legacy localStorage key removed after migration");
}

// Set + read
{
  const dataUrl = "data:image/png;base64," + "A".repeat(1000);
  const res = await mod.setUserAvatarImage({ dataUrl, mime: "image/png" });
  assert.equal(res.ok, true);
  const got = mod.readUserAvatarImageSnapshot();
  assert.equal(got.mime, "image/png");
  assert.equal(got.dataUrl, dataUrl);
  assert.ok(Number.isFinite(Date.parse(got.updatedAt)));
}

// Disallowed mime
{
  const res = await mod.setUserAvatarImage({ dataUrl: "data:image/gif;base64,AAA", mime: "image/gif" });
  assert.equal(res.ok, false);
  assert.match(res.reason, /unsupported|format/i);
}

// Refused write: friendly storage-full reason, snapshot unchanged.
{
  const before = mod.readUserAvatarImageSnapshot();
  denyWrites = true;
  const res = await mod.setUserAvatarImage({ dataUrl: "data:image/png;base64," + "B".repeat(1000), mime: "image/png" });
  assert.equal(res.ok, false);
  assert.match(res.reason, /storage full/i);
  assert.deepEqual(mod.readUserAvatarImageSnapshot(), before, "a refused write must not land in the cache");
  denyWrites = false;
}

// Clear
{
  await mod.clearUserAvatarImage();
  assert.equal(mod.readUserAvatarImageSnapshot(), null);
  assert.equal(idb.userAvatar.has("user"), false, "clear reached IndexedDB");
}

console.log("user-avatar-image.test.ts: ok");
