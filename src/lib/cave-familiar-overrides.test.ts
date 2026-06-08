// @ts-nocheck
import assert from "node:assert/strict";

// Minimal localStorage + window mock so the store can run under Node.
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

const mod = await import("./cave-familiar-overrides.ts");

// setFamiliarOverride writes a partial patch
{
  mod.setFamiliarOverride("cody", { display_name: "Cody the Brave" });
  const snap = mod.readFamiliarOverridesSnapshot();
  assert.deepEqual(snap, { cody: { display_name: "Cody the Brave" } });
}

// Subsequent patches merge, not replace
{
  mod.setFamiliarOverride("cody", { role: "Code Reviewer" });
  const snap = mod.readFamiliarOverridesSnapshot();
  assert.deepEqual(snap, {
    cody: { display_name: "Cody the Brave", role: "Code Reviewer" },
  });
}

// clearFamiliarOverrideField removes a single field
{
  mod.clearFamiliarOverrideField("cody", "display_name");
  const snap = mod.readFamiliarOverridesSnapshot();
  assert.deepEqual(snap, { cody: { role: "Code Reviewer" } });
}

// clearFamiliarOverrideField removes the id entry entirely when last field clears
{
  mod.clearFamiliarOverrideField("cody", "role");
  const snap = mod.readFamiliarOverridesSnapshot();
  assert.deepEqual(snap, {});
}

// clearAllFamiliarOverrides drops the whole id entry
{
  mod.setFamiliarOverride("nova", { description: "test", color: "#abc" });
  mod.clearAllFamiliarOverrides("nova");
  const snap = mod.readFamiliarOverridesSnapshot();
  assert.deepEqual(snap, {});
}

// Empty-string patches clear that field (matches "blur with blank input ⇒ clear")
{
  mod.setFamiliarOverride("ember", { display_name: "Ember" });
  mod.setFamiliarOverride("ember", { display_name: "" });
  const snap = mod.readFamiliarOverridesSnapshot();
  assert.deepEqual(snap, {});
}

console.log("cave-familiar-overrides.test.ts: ok");
