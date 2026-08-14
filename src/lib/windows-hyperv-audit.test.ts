import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

const root = await mkdtemp(path.join(tmpdir(), "cave-hyperv-audit-"));
process.env.CAVE_HOST_CAPABILITY_GRANTS_PATH_OVERRIDE = path.join(root, "grants.json");
const { grantHostCapability, revokeHostCapability } = await import("./host-capabilities.ts");
const { authorizeWindowsHypervAuditRuntime, parseHypervInventory, runWindowsHypervAudit, runWindowsHypervAuditFixture, WindowsHypervAuditError, WINDOWS_HYPERV_AUDIT_ADAPTER_ID } = await import("./windows-hyperv-audit.ts");
const { hostCapabilityById } = await import("./host-capabilities.ts");

const fixture = JSON.stringify({
  host: { name: "CAVE-WIN", version: "10.0", hypervAvailable: true },
  vms: [{ id: "vm-1", name: "Coven", state: "Running", generation: 2 }],
  switches: [{ id: "switch-1", name: "Default Switch", type: "Internal" }],
  checkpoints: [{ id: "checkpoint-1", vmId: "vm-1", name: "Before update", createdAt: "2026-08-13T00:00:00.000Z" }],
  vhdChains: [{ path: "D:\\\\VMs\\\\coven.vhdx", parentPath: null, sizeBytes: 4096 }],
  integrationServices: [{ vmId: "vm-1", name: "Heartbeat", enabled: true, primaryStatus: "OK" }],
});
const TEST_PATHS = { helperPath: "D:\\Apps\\CompleteTech\\Coven Cave\\coven-host-audit.exe", powerShellPath: "E:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" };
const testPaths = async () => TEST_PATHS;

assert.equal(hostCapabilityById("windows.hyperv.audit.read")?.adapter, null, "the broker remains unavailable until packaged helper integrity is release-verified");

test("production authorization fails closed while packaged helper integrity is unavailable", async () => {
  await assert.rejects(() => authorizeWindowsHypervAuditRuntime({ familiarId: "clove", sessionId: "session-1", platform: "linux" }), (error: unknown) => error instanceof WindowsHypervAuditError && error.code === "unsupported_platform");
  await assert.rejects(() => authorizeWindowsHypervAuditRuntime({ familiarId: "clove", sessionId: "session-1", platform: "win32" }), /registered Windows Hyper-V audit adapter/);
});

test("unsigned helpers and forged browser-shaped authority fail before the audit process", { skip: "requires release-verified adapter registration" }, async () => {
  await assert.rejects(() => runWindowsHypervAuditFixture({ familiarId: "clove", sessionId: "session-1" } as never, { resolvePaths: testPaths, run: async () => { throw new Error("must not run"); } }), /trusted runtime session authority/);
  const authority = await authorizeWindowsHypervAuditRuntime({ familiarId: "clove", sessionId: "session-1", platform: "win32" });
  let auditSpawned = false;
  await assert.rejects(() => runWindowsHypervAuditFixture(authority, { resolvePaths: testPaths, run: async (command) => {
    if (command === TEST_PATHS.powerShellPath) throw new Error("untrusted signer");
    auditSpawned = true;
    return fixture;
  } }), (error: unknown) => error instanceof WindowsHypervAuditError && error.code === "signature_rejected");
  assert.equal(auditSpawned, false, "signature rejection must prevent the helper process");
});

test("a grant revoked after runtime authorization cannot reach signature or helper execution", { skip: "requires release-verified adapter registration" }, async () => {
  const authority = await authorizeWindowsHypervAuditRuntime({ familiarId: "clove", sessionId: "session-1", platform: "win32" });
  await revokeHostCapability({ familiarId: "clove", sessionId: "session-1", capability: "windows.hyperv.audit.read", actor: "loopback" });
  let spawned = false;
  await assert.rejects(() => runWindowsHypervAuditFixture(authority, { resolvePaths: testPaths, run: async () => { spawned = true; return fixture; } }), (error: unknown) => error instanceof WindowsHypervAuditError && error.code === "capability_required");
  assert.equal(spawned, false);
});

test("malformed broker output fails closed", () => {
  assert.throws(() => parseHypervInventory("{}"), /incomplete inventory/);
  assert.throws(() => parseHypervInventory("not json"), /invalid JSON/);
  assert.throws(() => parseHypervInventory(fixture.replace('"enabled":true', '"enabled":"yes"')), /incomplete inventory/);
  assert.throws(() => parseHypervInventory(fixture.replace('"Running"', '"Unknown state"')), /incomplete inventory/);
  assert.throws(() => parseHypervInventory(fixture.replace('"sizeBytes":4096', '"sizeBytes":-1')), /incomplete inventory/);
});

test("non-C installer/system roots and supplied runners cannot alter production identity checks", { skip: "requires release-verified adapter registration" }, async () => {
  const saved = { ProgramFiles: process.env.ProgramFiles, ProgramW6432: process.env.ProgramW6432, SystemRoot: process.env.SystemRoot };
  process.env.ProgramFiles = "C:\\attacker";
  process.env.ProgramW6432 = "C:\\attacker";
  process.env.SystemRoot = "C:\\attacker";
  try {
    await grantHostCapability({ familiarId: "clove", sessionId: "session-production", capability: "windows.hyperv.audit.read", actor: "loopback", platform: "win32" });
    const authority = await authorizeWindowsHypervAuditRuntime({ familiarId: "clove", sessionId: "session-production", platform: "win32" });
    let injectedRunnerCalled = false;
    await assert.rejects(
      () => (runWindowsHypervAudit as unknown as (value: unknown, ignored: unknown) => Promise<unknown>)(authority, { run: async () => { injectedRunnerCalled = true; return fixture; } }),
      (error: unknown) => error instanceof WindowsHypervAuditError && error.code === "broker_failed",
    );
    assert.equal(injectedRunnerCalled, false, "production ignores injected process runners");
    const seen: string[] = [];
    const fixtureAuthority = await authorizeWindowsHypervAuditRuntime({ familiarId: "clove", sessionId: "session-production", platform: "win32" });
    await runWindowsHypervAuditFixture(fixtureAuthority, { resolvePaths: testPaths, run: async (command) => { seen.push(command); return command === TEST_PATHS.powerShellPath ? "" : fixture; } });
    assert.deepEqual(seen, [TEST_PATHS.powerShellPath, TEST_PATHS.helperPath]);
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

await rm(root, { recursive: true, force: true });
