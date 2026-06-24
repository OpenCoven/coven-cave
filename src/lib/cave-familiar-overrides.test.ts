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
async function waitForPatchBody(
  calls: Array<{ input: string; init: { method?: string; body?: string } }>,
  predicate: (body: unknown) => boolean,
) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const match = calls.find((call) => {
      try {
        return predicate(JSON.parse(call.init.body ?? "{}"));
      } catch {
        return false;
      }
    });
    if (match) return match;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return null;
}

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

// Browser-side overrides also sync into Cave config so server-side familiar
// settings (voice calls, chat identity hydration, /api/familiars reloads) see them.
{
  const calls: Array<{ input: string; init: { method?: string; body?: string } }> = [];
  globalThis.fetch = async (input, init = {}) => {
    calls.push({ input: String(input), init });
    return { ok: true, status: 200 };
  };

  mod.setFamiliarOverride("milo", { display_name: "Milo Prime", color: "#123456" });
  const setCall = await waitForPatchBody(
    calls,
    (body) =>
      body?.familiars?.milo?.display_name === "Milo Prime" &&
      body?.familiars?.milo?.color === "#123456",
  );
  assert.equal(setCall?.input, "/api/config");
  assert.equal(setCall?.init.method, "PATCH");
  assert.deepEqual(JSON.parse(setCall?.init.body ?? "{}"), {
    familiars: {
      milo: {
        display_name: "Milo Prime",
        color: "#123456",
      },
    },
  });

  mod.clearFamiliarOverrideField("milo", "display_name");
  const clearCall = await waitForPatchBody(
    calls,
    (body) => body?.familiars?.milo?.display_name === null,
  );
  assert.deepEqual(JSON.parse(clearCall?.init.body ?? "{}"), {
    familiars: {
      milo: {
        display_name: null,
      },
    },
  });
}

console.log("cave-familiar-overrides.test.ts: ok");
