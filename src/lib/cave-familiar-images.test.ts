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

const mod = await import("./cave-familiar-images.ts");

assert.equal(
  typeof mod.MAX_FAMILIAR_IMAGE_DATAURL_BYTES,
  "number",
  "store should expose the cap so upload UI can downsize before saving",
);

// Set + read
{
  const dataUrl = "data:image/png;base64," + "A".repeat(1000);
  const res = mod.setFamiliarImage("cody", { dataUrl, mime: "image/png" });
  assert.equal(res.ok, true);
  const got = mod.readFamiliarImagesSnapshot();
  assert.ok(got.cody);
  assert.equal(got.cody.mime, "image/png");
  assert.equal(got.cody.dataUrl, dataUrl);
  assert.ok(Number.isFinite(Date.parse(got.cody.updatedAt)));
}

// Per-image size cap (2MB pre-encode ≈ 2*1024*1024 bytes ≈ ~2.8MB base64)
{
  const huge = "data:image/png;base64," + "A".repeat(3 * 1024 * 1024);
  const res = mod.setFamiliarImage("nova", { dataUrl: huge, mime: "image/png" });
  assert.equal(res.ok, false);
  assert.match(res.reason, /too large/i);
}

// Disallowed mime
{
  const dataUrl = "data:image/gif;base64,AAA";
  const res = mod.setFamiliarImage("nova", { dataUrl, mime: "image/gif" });
  assert.equal(res.ok, false);
  assert.match(res.reason, /unsupported|format/i);
}

// Clear
{
  mod.clearFamiliarImage("cody");
  const got = mod.readFamiliarImagesSnapshot();
  assert.equal(got.cody, undefined);
}

console.log("cave-familiar-images.test.ts: ok");
