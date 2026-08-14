import assert from "node:assert/strict";
import { test } from "node:test";

const bridge = await import("./windows-hyperv-audit-runtime.ts");

test("server runtime bridge owns the conversation binding before invoking the audit", async () => {
  let authorized = false;
  let invoked = false;
  const inventory = { host: { name: "CAVE", version: "1", hypervAvailable: true }, vms: [], switches: [], checkpoints: [], vhdChains: [], integrationServices: [] };
  const result = await bridge.invokeWindowsHypervAuditForServerRuntimeFixture(
    { familiarId: "clove", sessionId: "session-1" },
    {
      loadConversation: async () => ({ familiarId: "clove" }) as never,
      authorize: async ({ familiarId, sessionId }) => { authorized = familiarId === "clove" && sessionId === "session-1"; return {} as never; },
      invoke: async () => { invoked = true; return inventory; },
    },
  );
  assert.equal(authorized, true);
  assert.equal(invoked, true);
  assert.equal(result.host.name, "CAVE");
});

test("server runtime bridge rejects absent and mismatched owned sessions before authority", async () => {
  for (const conversation of [null, { familiarId: "other" }]) {
    let invoked = false;
    await assert.rejects(
      () => bridge.invokeWindowsHypervAuditForServerRuntimeFixture(
        { familiarId: "clove", sessionId: "session-1" },
        { loadConversation: async () => conversation as never, authorize: async () => { throw new Error("must not authorize"); }, invoke: async () => { invoked = true; throw new Error("must not invoke"); } },
      ),
      /active session owned/,
    );
    assert.equal(invoked, false);
  }
});
