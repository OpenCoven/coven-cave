import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const root = await mkdtemp(path.join(tmpdir(), "cave-host-capabilities-"));
process.env.CAVE_HOST_CAPABILITY_GRANTS_PATH_OVERRIDE = path.join(root, "grants.json");
const capabilities = await import("./host-capabilities.ts");

assert.deepEqual(
  capabilities.hostCapabilitiesForPlatform("win32").map((entry) => entry.id),
  ["windows.hyperv.audit.read"],
  "the Windows catalog exposes only the explicit read-only Hyper-V audit capability",
);
assert.equal(capabilities.hostCapabilitiesForPlatform("linux").length, 2, "Linux entries stay platform-gated");
assert.equal(capabilities.hostCapabilitiesForPlatform("darwin").length, 2, "macOS entries stay platform-gated");
assert.equal(capabilities.hostCapabilityById("windows.hyperv.audit.write"), null, "write authority is absent from the initial catalog");

if (process.platform === "win32") {
  const now = Date.now();
  const grant = await capabilities.grantHostCapability({ familiarId: "clove", sessionId: "session-1", capability: "windows.hyperv.audit.read", actor: "loopback", now });
  assert.equal((await capabilities.activeHostCapabilities({ familiarId: "clove", sessionId: "session-1" }))[0], "windows.hyperv.audit.read");
  assert.equal((await capabilities.activeHostCapabilities({ familiarId: "other", sessionId: "session-1" })).length, 0, "grants cannot cross familiar boundaries");
  assert.equal(await capabilities.revokeHostCapability({ familiarId: "clove", sessionId: "session-1", capability: grant.capability, actor: "loopback" }), true);
  assert.equal((await capabilities.activeHostCapabilities({ familiarId: "clove", sessionId: "session-1" })).length, 0, "revocation fails closed immediately");
  await assert.rejects(() => capabilities.grantHostCapability({ familiarId: "clove", sessionId: "session-1", capability: "windows.hyperv.audit.read", actor: "loopback", expiresAt: new Date(now - 1).toISOString() }), /expiry/);
}
