// @ts-nocheck
import assert from "node:assert/strict";

const storage = new Map();
globalThis.window = {
  localStorage: {
    getItem: (k) => (storage.has(k) ? storage.get(k) : null),
    setItem: (k, v) => storage.set(k, v),
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

{
  mod.clearUserAvatarImage();
  assert.equal(mod.readUserAvatarImageSnapshot(), null);
}

console.log("user-avatar-image.test.ts: ok");
