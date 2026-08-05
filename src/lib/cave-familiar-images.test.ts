// @ts-nocheck
import assert from "node:assert/strict";

const storage = new Map();
const legacyImage = {
  dataUrl: "data:image/png;base64," + "L".repeat(500),
  mime: "image/png",
  updatedAt: "2026-01-01T00:00:00.000Z",
};
storage.set("cave:familiar-images:v1", JSON.stringify({ legacyfam: legacyImage }));
globalThis.window = {
  localStorage: {
    getItem: (key) => (storage.has(key) ? storage.get(key) : null),
    setItem: (key, value) => storage.set(key, value),
    removeItem: (key) => storage.delete(key),
  },
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => true,
};

const hostConflict = {
  dataUrl: "data:image/png;base64," + "H".repeat(500),
  mime: "image/png",
  updatedAt: "2026-01-02T00:00:00.000Z",
};
const idb = { familiarImages: new Map([["hostwins", hostConflict]]) };
const fakeDriver = {
  async getAll(store) {
    return Object.fromEntries(idb[store]);
  },
  async getAllStrict(store) {
    return Object.fromEntries(idb[store]);
  },
  async put(store, key, value) {
    idb[store].set(key, value);
  },
  async delete(store, key) {
    idb[store].delete(key);
  },
};

const requests = [];
let failNextPost = false;
let failNextDelete = false;
globalThis.fetch = async (input, init = {}) => {
  const url = String(input);
  const method = init.method ?? "GET";
  requests.push({ url, method, body: init.body });

  if (url === "/api/familiars") {
    return Response.json({
      ok: true,
      familiars: [
        {
          id: "hostwins",
          avatarUrl: "/api/familiars/hostwins/avatar?v=11&format=png",
        },
      ],
    });
  }
  if (method === "POST") {
    if (failNextPost) {
      failNextPost = false;
      return Response.json({ ok: false, error: "Could not save avatar." }, { status: 500 });
    }
    const id = decodeURIComponent(url.split("/").at(-2));
    return Response.json({
      ok: true,
      avatarUrl: `/api/familiars/${id}/avatar?v=22&format=png`,
      revision: 22,
    });
  }
  if (method === "DELETE") {
    if (failNextDelete) {
      failNextDelete = false;
      return Response.json({ ok: false, error: "Could not remove avatar." }, { status: 500 });
    }
    return Response.json({ ok: true, avatarUrl: null, revision: null, removed: true });
  }
  throw new Error(`Unexpected request: ${method} ${url}`);
};

const { setAvatarStorageForTests } = await import("./avatar-idb.ts");
setAvatarStorageForTests(fakeDriver);

const mod = await import("./cave-familiar-images.ts");
await mod.whenFamiliarImagesHydrated();

assert.equal(
  typeof mod.MAX_FAMILIAR_IMAGE_DATAURL_BYTES,
  "number",
  "store should expose the cap so upload UI can downsize before saving",
);

{
  const got = mod.readFamiliarImagesSnapshot();
  assert.equal(
    got.hostwins.dataUrl,
    "/api/familiars/hostwins/avatar?v=11&format=png",
    "a host avatar wins without uploading the stale browser copy",
  );
  assert.equal(
    got.legacyfam.dataUrl,
    "/api/familiars/legacyfam/avatar?v=22&format=png",
    "a browser-only avatar migrates to the host and adopts its revision URL",
  );
  assert.equal(idb.familiarImages.size, 0, "host-confirmed images are removed from IndexedDB");
  assert.equal(storage.has("cave:familiar-images:v1"), false, "legacy storage clears after host persistence");
  assert.equal(
    requests.filter((request) => request.method === "POST").length,
    1,
    "only the browser-only image is uploaded",
  );
}

{
  const dataUrl = "data:image/png;base64," + "A".repeat(1000);
  const result = await mod.setFamiliarImage("cody", { dataUrl, mime: "image/png" });
  assert.equal(result.ok, true);
  assert.equal(
    mod.readFamiliarImagesSnapshot().cody.dataUrl,
    "/api/familiars/cody/avatar?v=22&format=png",
  );
  assert.equal(idb.familiarImages.has("cody"), false, "new uploads do not return to IndexedDB");
}

{
  const before = mod.readFamiliarImagesSnapshot().cody;
  failNextPost = true;
  const result = await mod.setFamiliarImage("cody", {
    dataUrl: "data:image/png;base64," + "B".repeat(1000),
    mime: "image/png",
  });
  assert.equal(result.ok, false);
  assert.match(result.reason, /could not save avatar/i);
  assert.deepEqual(
    mod.readFamiliarImagesSnapshot().cody,
    before,
    "a failed host write must preserve the prior avatar",
  );
}

{
  failNextDelete = true;
  const failed = await mod.clearFamiliarImage("cody");
  assert.equal(failed.ok, false);
  assert.ok(mod.readFamiliarImagesSnapshot().cody, "a failed delete must preserve the prior avatar");

  const removed = await mod.clearFamiliarImage("cody");
  assert.equal(removed.ok, true);
  assert.equal(mod.readFamiliarImagesSnapshot().cody, undefined);
}

{
  const huge = "data:image/png;base64," + "A".repeat(3 * 1024 * 1024);
  const result = await mod.setFamiliarImage("nova", { dataUrl: huge, mime: "image/png" });
  assert.equal(result.ok, false);
  assert.match(result.reason, /too large/i);
}

{
  const result = await mod.setFamiliarImage("nova", {
    dataUrl: "data:image/gif;base64,AAA",
    mime: "image/gif",
  });
  assert.equal(result.ok, false);
  assert.match(result.reason, /unsupported|format/i);
}

console.log("cave-familiar-images.test.ts: ok");
