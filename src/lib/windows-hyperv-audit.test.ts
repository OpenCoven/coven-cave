import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

const root = await mkdtemp(path.join(tmpdir(), "cave-hyperv-audit-"));
process.env.CAVE_HOST_CAPABILITY_GRANTS_PATH_OVERRIDE = path.join(root, "grants.json");
const { grantHostCapability, revokeHostCapability } = await import("./host-capabilities.ts");
const { authorizeWindowsHypervAuditRuntime, parseHypervInventory, runWindowsHypervAudit, WindowsHypervAuditError, WINDOWS_HYPERV_AUDIT_ADAPTER_ID } = await import("./windows-hyperv-audit.ts");
const { hostCapabilityById } = await import("./host-capabilities.ts");

const fixture = JSON.stringify({
  host: { name: "CAVE-WIN", version: "10.0", hypervAvailable: true },
  vms: [{ id: "vm-1", name: "Coven", state: "Running", generation: 2 }],
  switches: [{ id: "switch-1", name: "Default Switch", type: "Internal" }],
  checkpoints: [{ id: "checkpoint-1", vmId: "vm-1", name: "Before update", createdAt: "2026-08-13T00:00:00.000Z" }],
  vhdChains: [{ path: "D:\\\\VMs\\\\coven.vhdx", parentPath: null, sizeBytes: 4096 }],
  integrationServices: [{ vmId: "vm-1", name: "Heartbeat", enabled: true, primaryStatus: "OK" }],
});

assert.equal(hostCapabilityById("windows.hyperv.audit.read")?.adapter, WINDOWS_HYPERV_AUDIT_ADAPTER_ID, "the concrete Windows broker is the catalog's registered adapter");

test("Windows audit is Windows-only and requires the exact unexpired session capability", async () => {
  let called = false;
  await assert.rejects(() => authorizeWindowsHypervAuditRuntime({ familiarId: "clove", sessionId: "session-1", platform: "linux" }), (error: unknown) => error instanceof WindowsHypervAuditError && error.code === "unsupported_platform");
  await assert.rejects(() => authorizeWindowsHypervAuditRuntime({ familiarId: "clove", sessionId: "session-1", platform: "win32" }), (error: unknown) => error instanceof WindowsHypervAuditError && error.code === "capability_required");
  assert.equal(called, false, "rejected requests never invoke a host helper");
  await grantHostCapability({ familiarId: "clove", sessionId: "session-1", capability: "windows.hyperv.audit.read", actor: "loopback", platform: "win32" });
  const authority = await authorizeWindowsHypervAuditRuntime({ familiarId: "clove", sessionId: "session-1", platform: "win32" });
  const inventory = await runWindowsHypervAudit(authority, { run: async (command, args) => {
    if (command.endsWith("\\WindowsPowerShell\\v1.0\\powershell.exe")) {
      assert.match(args[3] ?? "", /Get-AuthenticodeSignature/);
      assert.match(args[3] ?? "", /CN=CompleteTech/);
      assert.match(args.at(-1) ?? "", /CompleteTech\\Coven Cave\\coven-host-audit\.exe$/);
      return "";
    }
    assert.match(command, /CompleteTech\\Coven Cave\\coven-host-audit\.exe$/);
    assert.deepEqual(args, ["hyperv-inventory", "--format", "json"]);
    return fixture;
  } });
  assert.equal(inventory.vms[0]?.name, "Coven");
  assert.equal(inventory.integrationServices[0]?.primaryStatus, "OK");
});

test("unsigned helpers and forged browser-shaped authority fail before the audit process", async () => {
  await assert.rejects(() => runWindowsHypervAudit({ familiarId: "clove", sessionId: "session-1" } as never, { run: async () => { throw new Error("must not run"); } }), /trusted runtime session authority/);
  const authority = await authorizeWindowsHypervAuditRuntime({ familiarId: "clove", sessionId: "session-1", platform: "win32" });
  let auditSpawned = false;
  await assert.rejects(() => runWindowsHypervAudit(authority, { run: async (command) => {
    if (command.endsWith("\\WindowsPowerShell\\v1.0\\powershell.exe")) throw new Error("untrusted signer");
    auditSpawned = true;
    return fixture;
  } }), (error: unknown) => error instanceof WindowsHypervAuditError && error.code === "signature_rejected");
  assert.equal(auditSpawned, false, "signature rejection must prevent the helper process");
});

test("a grant revoked after runtime authorization cannot reach signature or helper execution", async () => {
  const authority = await authorizeWindowsHypervAuditRuntime({ familiarId: "clove", sessionId: "session-1", platform: "win32" });
  await revokeHostCapability({ familiarId: "clove", sessionId: "session-1", capability: "windows.hyperv.audit.read", actor: "loopback" });
  let spawned = false;
  await assert.rejects(() => runWindowsHypervAudit(authority, { run: async () => { spawned = true; return fixture; } }), (error: unknown) => error instanceof WindowsHypervAuditError && error.code === "capability_required");
  assert.equal(spawned, false);
});

test("malformed broker output fails closed", () => {
  assert.throws(() => parseHypervInventory("{}"), /incomplete inventory/);
  assert.throws(() => parseHypervInventory("not json"), /invalid JSON/);
  assert.throws(() => parseHypervInventory(fixture.replace('"enabled":true', '"enabled":"yes"')), /incomplete inventory/);
  assert.throws(() => parseHypervInventory(fixture.replace('"Running"', '"Unknown state"')), /incomplete inventory/);
  assert.throws(() => parseHypervInventory(fixture.replace('"sizeBytes":4096', '"sizeBytes":-1')), /incomplete inventory/);
});

await rm(root, { recursive: true, force: true });
