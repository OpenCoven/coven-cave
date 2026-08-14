import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

const root = await mkdtemp(path.join(tmpdir(), "cave-hyperv-audit-"));
process.env.CAVE_HOST_CAPABILITY_GRANTS_PATH_OVERRIDE = path.join(root, "grants.json");
const { grantHostCapability } = await import("./host-capabilities.ts");
const { parseHypervInventory, runWindowsHypervAudit, WindowsHypervAuditError } = await import("./windows-hyperv-audit.ts");

const fixture = JSON.stringify({
  host: { name: "CAVE-WIN", version: "10.0", hypervAvailable: true },
  vms: [{ id: "vm-1", name: "Coven", state: "Running", generation: 2 }],
  switches: [{ id: "switch-1", name: "Default Switch", type: "Internal" }],
  checkpoints: [{ id: "checkpoint-1", vmId: "vm-1", name: "Before update", createdAt: "2026-08-13T00:00:00.000Z" }],
  vhdChains: [{ path: "D:\\\\VMs\\\\coven.vhdx", parentPath: null, sizeBytes: 4096 }],
  integrationServices: [{ vmId: "vm-1", name: "Heartbeat", enabled: true, primaryStatus: "OK" }],
});

test("Windows audit is Windows-only and requires the exact unexpired session capability", async () => {
  let called = false;
  await assert.rejects(() => runWindowsHypervAudit({ familiarId: "clove", sessionId: "session-1", platform: "linux", run: async () => { called = true; return fixture; } }), (error: unknown) => error instanceof WindowsHypervAuditError && error.code === "unsupported_platform");
  await assert.rejects(() => runWindowsHypervAudit({ familiarId: "clove", sessionId: "session-1", platform: "win32", run: async () => { called = true; return fixture; } }), (error: unknown) => error instanceof WindowsHypervAuditError && error.code === "capability_required");
  assert.equal(called, false, "rejected requests never invoke a host helper");
  await grantHostCapability({ familiarId: "clove", sessionId: "session-1", capability: "windows.hyperv.audit.read", actor: "loopback", platform: "win32" });
  const inventory = await runWindowsHypervAudit({ familiarId: "clove", sessionId: "session-1", platform: "win32", run: async (command, args) => {
    assert.equal(command, "coven-host-audit.exe");
    assert.deepEqual(args, ["hyperv-inventory", "--format", "json"]);
    return fixture;
  } });
  assert.equal(inventory.vms[0]?.name, "Coven");
  assert.equal(inventory.integrationServices[0]?.primaryStatus, "OK");
});

test("malformed broker output fails closed", () => {
  assert.throws(() => parseHypervInventory("{}"), /incomplete inventory/);
  assert.throws(() => parseHypervInventory("not json"), /invalid JSON/);
  assert.throws(() => parseHypervInventory(fixture.replace('"enabled":true', '"enabled":"yes"')), /incomplete inventory/);
});

await rm(root, { recursive: true, force: true });
