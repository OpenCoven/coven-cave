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

const mod = await import("./cave-familiar-archive.ts");

// Archive then check
{
  mod.archiveFamiliar("cody");
  const snap = mod.readArchivedFamiliarsSnapshot();
  assert.ok(snap.cody);
  assert.ok(Number.isFinite(Date.parse(snap.cody)));
  assert.equal(mod.isFamiliarArchived("cody", snap), true);
  assert.equal(mod.isFamiliarArchived("nova", snap), false);
}

// Archiving twice is idempotent (last write wins, no error)
{
  const first = mod.readArchivedFamiliarsSnapshot().cody;
  mod.archiveFamiliar("cody");
  const second = mod.readArchivedFamiliarsSnapshot().cody;
  assert.ok(second >= first);
}

// Unarchive
{
  mod.unarchiveFamiliar("cody");
  const snap = mod.readArchivedFamiliarsSnapshot();
  assert.equal(snap.cody, undefined);
  assert.equal(mod.isFamiliarArchived("cody", snap), false);
}

// Unarchive on never-archived id is a no-op
{
  mod.unarchiveFamiliar("ghost");
  assert.deepEqual(mod.readArchivedFamiliarsSnapshot(), {});
}

console.log("cave-familiar-archive.test.ts: ok");
