// @ts-nocheck
import assert from "node:assert/strict";

globalThis.window = {
  localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  addEventListener: () => {},
  removeEventListener: () => {},
};

// Map-backed fake IndexedDB driver with a write-failure toggle (simulates the
// browser refusing a write — quota, private mode, etc.). Both active stores are
// present because importing the project store transitively hydrates the
// familiar store (shared size-cap constant).
const idb = { projectAvatars: new Map(), familiarImages: new Map() };
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

const mod = await import("./cave-project-images.ts");
await mod.whenProjectImagesHydrated();

const png = (fill) => "data:image/png;base64," + fill.repeat(1000);

// Set + read, and roots are normalized: a trailing slash buckets to the same
// key, so every surface (picker, sidebar, comux) reads the same record.
{
  const res = await mod.setProjectImage("/Users/x/app/", { dataUrl: png("A"), mime: "image/png" });
  assert.equal(res.ok, true);
  const got = mod.readProjectImagesSnapshot();
  assert.ok(got["/Users/x/app"], "stored under the normalized root");
  assert.equal(got["/Users/x/app"].mime, "image/png");
  assert.ok(Number.isFinite(Date.parse(got["/Users/x/app"].updatedAt)));
  assert.ok(idb.projectAvatars.has("/Users/x/app"), "write reached IndexedDB");
}

// Refused write (quota/private mode): the store reports the friendly
// storage-full reason and the snapshot stays unchanged — no phantom avatar.
{
  denyWrites = true;
  const res = await mod.setProjectImage("/Users/x/other", { dataUrl: png("B"), mime: "image/png" });
  assert.equal(res.ok, false);
  assert.match(res.reason, /storage full/i);
  assert.equal(mod.readProjectImagesSnapshot()["/Users/x/other"], undefined);
  denyWrites = false;
}

// Per-image size cap and disallowed mime mirror the familiar store.
{
  const huge = "data:image/png;base64," + "A".repeat(3 * 1024 * 1024);
  const res = await mod.setProjectImage("/Users/x/app", { dataUrl: huge, mime: "image/png" });
  assert.equal(res.ok, false);
  assert.match(res.reason, /too large/i);
  const bad = await mod.setProjectImage("/Users/x/app", { dataUrl: "data:image/gif;base64,AAA", mime: "image/gif" });
  assert.equal(bad.ok, false);
  assert.match(bad.reason, /unsupported|format/i);
}

// moveProjectImage follows a root edit: the record lands under the new key,
// the old key is gone, and a move to the same normalized root is a no-op.
{
  await mod.moveProjectImage("/Users/x/app", "/Users/x/renamed");
  const got = mod.readProjectImagesSnapshot();
  assert.equal(got["/Users/x/app"], undefined);
  assert.ok(got["/Users/x/renamed"]);
  assert.ok(idb.projectAvatars.has("/Users/x/renamed"));
  assert.equal(idb.projectAvatars.has("/Users/x/app"), false);
  await mod.moveProjectImage("/Users/x/renamed/", "/Users/x/renamed");
  assert.ok(mod.readProjectImagesSnapshot()["/Users/x/renamed"], "same-key move is a no-op");
}

// Clear
{
  await mod.clearProjectImage("/Users/x/renamed");
  assert.equal(mod.readProjectImagesSnapshot()["/Users/x/renamed"], undefined);
  assert.equal(idb.projectAvatars.has("/Users/x/renamed"), false);
}

console.log("cave-project-images.test.ts: ok");
