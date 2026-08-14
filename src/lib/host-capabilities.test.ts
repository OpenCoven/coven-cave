import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
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
assert.equal(capabilities.hostCapabilityHasAdapter("windows.hyperv.audit.read"), true, "only the broker-backed Windows capability is actionable");
assert.equal(capabilities.hostCapabilityHasAdapter("linux.system.audit.read"), false, "Linux capability placeholders cannot be approved before an adapter ships");

const now = Date.now();
const grant = await capabilities.grantHostCapability({ familiarId: "clove", sessionId: "session-1", capability: "windows.hyperv.audit.read", actor: "loopback", now, platform: "win32" });
assert.equal((await capabilities.activeHostCapabilities({ familiarId: "clove", sessionId: "session-1", platform: "win32" }))[0], "windows.hyperv.audit.read");
assert.equal((await capabilities.activeHostCapabilities({ familiarId: "other", sessionId: "session-1", platform: "win32" })).length, 0, "grants cannot cross familiar boundaries");
assert.equal(await capabilities.revokeHostCapability({ familiarId: "clove", sessionId: "session-1", capability: grant.capability, actor: "loopback" }), true);
assert.equal((await capabilities.activeHostCapabilities({ familiarId: "clove", sessionId: "session-1", platform: "win32" })).length, 0, "revocation fails closed immediately");
await assert.rejects(() => capabilities.grantHostCapability({ familiarId: "clove", sessionId: "session-1", capability: "windows.hyperv.audit.read", actor: "loopback", expiresAt: new Date(now - 1).toISOString(), platform: "win32" }), /expiry/);
const expiring = await capabilities.grantHostCapability({ familiarId: "clove", sessionId: "session-1", capability: "windows.hyperv.audit.read", actor: "loopback", expiresAt: new Date(Date.now() + 50).toISOString(), platform: "win32" });
await new Promise((resolve) => setTimeout(resolve, 75));
assert.equal((await capabilities.activeHostCapabilities({ familiarId: "clove", sessionId: "session-1", platform: "win32" })).length, 0, "expired grants fail closed");
assert.ok((await capabilities.listHostCapabilityAudit()).some((entry) => entry.capability === expiring.capability && entry.kind === "expired"), "expiry is auditable");
await writeFile(process.env.CAVE_HOST_CAPABILITY_GRANTS_PATH_OVERRIDE!, "{not-json", "utf8");
await assert.rejects(() => capabilities.listHostCapabilityGrants(), /unreadable/, "a corrupt authority store fails closed");
await assert.rejects(() => capabilities.grantHostCapability({ familiarId: "clove", sessionId: "session-1", capability: "windows.hyperv.audit.read", actor: "loopback", platform: "win32" }), /unreadable/, "a corrupt store cannot be overwritten by a grant");
