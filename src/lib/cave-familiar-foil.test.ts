// @ts-nocheck
//
// The persisted foil-plate store (cave-3rz.2). What matters here is which
// stored plate is TRUSTED: a plate cut from a portrait that has since been
// replaced must not be shown, and a plate the summoning rite wrote before the
// avatar had a URL to key on must not be thrown away for want of that key.
import { test } from "node:test";
import assert from "node:assert/strict";

import { setAvatarStorageForTests } from "./avatar-idb.ts";
import {
  clearFamiliarFoil,
  foilSourceKey,
  readFamiliarFoilSnapshot,
  resetFamiliarFoilForTests,
  setFamiliarFoil,
  usableFamiliarFoil,
  whenFamiliarFoilHydrated,
} from "./cave-familiar-foil.ts";

function fakeStorage() {
  const stores = new Map();
  const of = (name) => {
    if (!stores.has(name)) stores.set(name, new Map());
    return stores.get(name);
  };
  return {
    stores,
    driver: {
      async getAll(store) {
        return Object.fromEntries(of(store));
      },
      async put(store, key, value) {
        of(store).set(key, value);
      },
      async delete(store, key) {
        of(store).delete(key);
      },
    },
  };
}

test("a plate is keyed to the avatar it was cut from", async () => {
  const fake = fakeStorage();
  setAvatarStorageForTests(fake.driver);
  resetFamiliarFoilForTests();
  await whenFamiliarFoilHydrated();

  const key = foilSourceKey("/api/familiars/thistle/avatar?v=111&format=png");
  await setFamiliarFoil("thistle", { dataUrl: "data:image/png;base64,AAA", sourceKey: key });

  assert.deepEqual(usableFamiliarFoil("thistle", key), {
    dataUrl: "data:image/png;base64,AAA",
    adopted: false,
  });
  assert.equal(fake.stores.get("familiarFoil").get("thistle").sourceKey, key);

  // The portrait changed on disk, so the URL's mtime changed with it.
  const moved = foilSourceKey("/api/familiars/thistle/avatar?v=222&format=png");
  assert.equal(usableFamiliarFoil("thistle", moved), null, "a stale plate is refused");
  assert.equal(usableFamiliarFoil("nobody", key), null, "an unknown familiar has no plate");

  setAvatarStorageForTests(null);
});

test("a plate stored without a key is trusted once, and flagged for stamping", async () => {
  const fake = fakeStorage();
  setAvatarStorageForTests(fake.driver);
  resetFamiliarFoilForTests();
  await whenFamiliarFoilHydrated();

  // What the summoning rite writes: it has the plate, but the daemon has not
  // yet said what the new avatar's URL will be.
  await setFamiliarFoil("wren", { dataUrl: "data:image/png;base64,BBB" });
  assert.equal(readFamiliarFoilSnapshot().wren.sourceKey, undefined);

  const key = foilSourceKey("/api/familiars/wren/avatar?v=333&format=png");
  const hit = usableFamiliarFoil("wren", key);
  assert.deepEqual(hit, { dataUrl: "data:image/png;base64,BBB", adopted: true });

  // The reader stamps it, and it is an ordinary keyed plate from then on.
  await setFamiliarFoil("wren", { dataUrl: hit.dataUrl, sourceKey: key });
  assert.deepEqual(usableFamiliarFoil("wren", key), { dataUrl: hit.dataUrl, adopted: false });
  assert.equal(usableFamiliarFoil("wren", foilSourceKey("something-else")), null);

  setAvatarStorageForTests(null);
});

test("clearing retires the plate from memory and from storage", async () => {
  const fake = fakeStorage();
  setAvatarStorageForTests(fake.driver);
  resetFamiliarFoilForTests();
  await whenFamiliarFoilHydrated();

  await setFamiliarFoil("mote", { dataUrl: "data:image/png;base64,CCC", sourceKey: "k" });
  await clearFamiliarFoil("mote");
  assert.equal(usableFamiliarFoil("mote", "k"), null);
  assert.equal(fake.stores.get("familiarFoil").has("mote"), false);

  setAvatarStorageForTests(null);
});

test("the source key is stable, and separates different sources", () => {
  assert.equal(foilSourceKey("a"), foilSourceKey("a"));
  assert.notEqual(foilSourceKey("a"), foilSourceKey("b"));
  assert.equal(foilSourceKey(null), null);
  assert.equal(foilSourceKey(""), null);
});

console.log("cave-familiar-foil.test.ts: ok");
