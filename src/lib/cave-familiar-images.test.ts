// @ts-nocheck
import assert from "node:assert/strict";

// Legacy localStorage payload pre-seeded so the import exercises the one-time
// migration into IndexedDB.
const storage = new Map();
const legacyImage = {
  dataUrl: "data:image/png;base64," + "L".repeat(500),
  mime: "image/png",
  updatedAt: "2026-01-01T00:00:00.000Z",
};
storage.set("cave:familiar-images:v1", JSON.stringify({ legacyfam: legacyImage }));
globalThis.window = {
  localStorage: {
    getItem: (k) => (storage.has(k) ? storage.get(k) : null),
    setItem: (k, v) => storage.set(k, v),
    removeItem: (k) => storage.delete(k),
  },
  addEventListener: () => {},
  removeEventListener: () => {},
};

// Map-backed fake IndexedDB driver with a write-failure toggle (simulates the
// browser refusing a write — quota, private mode, etc.).
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

const mod = await import("./cave-familiar-images.ts");
await mod.whenFamiliarImagesHydrated();

assert.equal(
  typeof mod.MAX_FAMILIAR_IMAGE_DATAURL_BYTES,
  "number",
  "store should expose the cap so upload UI can downsize before saving",
);

// Migration: the legacy localStorage image lands in IndexedDB and in the
// snapshot, and the legacy key is removed (freeing the shared origin quota).
{
  const got = mod.readFamiliarImagesSnapshot();
  assert.ok(got.legacyfam, "legacy image is available after hydration");
  assert.equal(got.legacyfam.dataUrl, legacyImage.dataUrl);
  assert.ok(idb.familiarImages.has("legacyfam"), "legacy image persisted to IndexedDB");
  assert.equal(storage.has("cave:familiar-images:v1"), false, "legacy localStorage key removed after migration");
}

// Set + read
{
  const dataUrl = "data:image/png;base64," + "A".repeat(1000);
  const res = await mod.setFamiliarImage("cody", { dataUrl, mime: "image/png" });
  assert.equal(res.ok, true);
  const got = mod.readFamiliarImagesSnapshot();
  assert.ok(got.cody);
  assert.equal(got.cody.mime, "image/png");
  assert.equal(got.cody.dataUrl, dataUrl);
  assert.ok(Number.isFinite(Date.parse(got.cody.updatedAt)));
  assert.ok(idb.familiarImages.has("cody"), "write reached IndexedDB");
}

// Refused write (quota/private mode): the store reports the friendly
// storage-full reason (never the raw browser message), and the snapshot stays
// unchanged — no phantom avatar that vanishes on reload.
{
  denyWrites = true;
  const dataUrl = "data:image/png;base64," + "B".repeat(1000);
  const res = await mod.setFamiliarImage("astra", { dataUrl, mime: "image/png" });
  assert.equal(res.ok, false);
  assert.match(res.reason, /storage full/i);
  const got = mod.readFamiliarImagesSnapshot();
  assert.equal(got.astra, undefined, "a refused write must not land in the in-memory cache");
  denyWrites = false;
}

// Per-image size cap (2MB pre-encode ≈ 2*1024*1024 bytes ≈ ~2.8MB base64)
{
  const huge = "data:image/png;base64," + "A".repeat(3 * 1024 * 1024);
  const res = await mod.setFamiliarImage("nova", { dataUrl: huge, mime: "image/png" });
  assert.equal(res.ok, false);
  assert.match(res.reason, /too large/i);
}

// Disallowed mime
{
  const dataUrl = "data:image/gif;base64,AAA";
  const res = await mod.setFamiliarImage("nova", { dataUrl, mime: "image/gif" });
  assert.equal(res.ok, false);
  assert.match(res.reason, /unsupported|format/i);
}

// Clear
{
  await mod.clearFamiliarImage("cody");
  const got = mod.readFamiliarImagesSnapshot();
  assert.equal(got.cody, undefined);
  assert.equal(idb.familiarImages.has("cody"), false, "clear reached IndexedDB");
}

console.log("cave-familiar-images.test.ts: ok");
