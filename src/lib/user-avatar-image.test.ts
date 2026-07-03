// @ts-nocheck
import assert from "node:assert/strict";

const storage = new Map();
// Simulates the browser refusing the write (QuotaExceededError) — localStorage
// is shared across all cave:* keys, so the write can fail even under our caps.
let denyWrites = false;
globalThis.window = {
  localStorage: {
    getItem: (k) => (storage.has(k) ? storage.get(k) : null),
    setItem: (k, v) => {
      if (denyWrites) throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
      storage.set(k, v);
    },
    removeItem: (k) => storage.delete(k),
  },
  addEventListener: () => {},
  removeEventListener: () => {},
};

const mod = await import("./user-avatar-image.ts");

{
  const dataUrl = "data:image/png;base64," + "A".repeat(1000);
  const res = mod.setUserAvatarImage({ dataUrl, mime: "image/png" });
  assert.equal(res.ok, true);
  const got = mod.readUserAvatarImageSnapshot();
  assert.equal(got.mime, "image/png");
  assert.equal(got.dataUrl, dataUrl);
  assert.ok(Number.isFinite(Date.parse(got.updatedAt)));
}

{
  const res = mod.setUserAvatarImage({ dataUrl: "data:image/gif;base64,AAA", mime: "image/gif" });
  assert.equal(res.ok, false);
  assert.match(res.reason, /unsupported|format/i);
}

// Quota-refused write: friendly storage-full reason, snapshot unchanged.
{
  const before = mod.readUserAvatarImageSnapshot();
  denyWrites = true;
  const res = mod.setUserAvatarImage({ dataUrl: "data:image/png;base64," + "B".repeat(1000), mime: "image/png" });
  assert.equal(res.ok, false);
  assert.match(res.reason, /storage full/i);
  assert.deepEqual(mod.readUserAvatarImageSnapshot(), before, "a refused write must not land in the cache");
  denyWrites = false;
}

{
  mod.clearUserAvatarImage();
  assert.equal(mod.readUserAvatarImageSnapshot(), null);
}

console.log("user-avatar-image.test.ts: ok");
