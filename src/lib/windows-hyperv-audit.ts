import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

import { activeHostCapabilities } from "./host-capabilities.ts";

const execFileAsync = promisify(execFile);

/** The broker has one operation. There is intentionally no command, script, or
 * PowerShell input in this contract. The signed helper owns the constrained
 * Windows implementation and may request UAC only while it performs this audit. */
export const WINDOWS_HYPERV_AUDIT_OPERATION = "inventory" as const;
export const WINDOWS_HYPERV_AUDIT_CAPABILITY = "windows.hyperv.audit.read" as const;
const HELPER_ARGS = ["hyperv-inventory", "--format", "json"] as const;
const AUDIT_TIMEOUT_MS = 15_000;
const MAX_RESULT_BYTES = 512 * 1024;
const MAX_ROWS = 512;
const MAX_STRING_LENGTH = 4_096;
const EXPECTED_PUBLISHER = "CompleteTech";
const VM_STATES = new Set(["Off", "Running", "Paused", "Saved", "Starting", "Stopping", "Resetting", "Pausing", "Resuming", "Saving"]);
const SWITCH_TYPES = new Set(["External", "Internal", "Private"]);
const INTEGRATION_STATUSES = new Set(["OK", "Error", "No Contact", "Lost Communication", "Unknown"]);

declare const runtimeAuthorityBrand: unique symbol;
/** Opaque proof produced only after a trusted server runtime has bound the
 * capability to its selected conversation. It cannot be serialized or forged
 * by a browser request. */
export type WindowsHypervAuditRuntimeAuthority = { readonly [runtimeAuthorityBrand]: true; readonly familiarId: string; readonly sessionId: string };
const runtimeAuthorities = new WeakSet<object>();

export type HypervInventory = {
  host: { name: string; version: string; hypervAvailable: boolean };
  vms: Array<{ id: string; name: string; state: string; generation: number | null }>;
  switches: Array<{ id: string; name: string; type: string }>;
  checkpoints: Array<{ id: string; vmId: string; name: string; createdAt: string | null }>;
  vhdChains: Array<{ path: string; parentPath: string | null; sizeBytes: number | null }>;
  integrationServices: Array<{ vmId: string; name: string; enabled: boolean; primaryStatus: string }>;
};

export class WindowsHypervAuditError extends Error {
  readonly code: "unsupported_platform" | "capability_required" | "broker_failed" | "invalid_broker_response" | "signature_rejected";
  constructor(code: "unsupported_platform" | "capability_required" | "broker_failed" | "invalid_broker_response" | "signature_rejected", message: string) {
    super(message);
    this.name = "WindowsHypervAuditError";
    this.code = code;
  }
}

export type HypervAuditRunner = (command: string, args: readonly string[]) => Promise<string>;
export type WindowsHypervAuditTestDependencies = {
  /** Test seam only. Production always uses the system process runner. */
  run?: HypervAuditRunner;
};

async function systemRunner(command: string, args: readonly string[]): Promise<string> {
  const { stdout } = await execFileAsync(command, [...args], {
    timeout: AUDIT_TIMEOUT_MS,
    maxBuffer: MAX_RESULT_BYTES,
    windowsHide: true,
    // Never use a shell. In particular, no user supplied content reaches argv.
    shell: false,
  });
  return stdout;
}

function installManagedHelperPath(): string {
  // The directory comes from Windows itself; callers cannot supply this path.
  return path.win32.join(process.env.ProgramW6432 ?? process.env.ProgramFiles ?? "C:\\Program Files", "CompleteTech", "Coven Cave", "coven-host-audit.exe");
}

function windowsPowerShellPath(): string {
  return path.win32.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
}

async function verifyAuthenticode(helperPath: string, run: HypervAuditRunner = systemRunner): Promise<void> {
  // This immutable script asks Windows to validate the chain and authenticode
  // status. It has no user-provided arguments or shell interpolation.
  const script = "$s=Get-AuthenticodeSignature -LiteralPath $args[0]; if($s.Status -ne 'Valid' -or $s.SignerCertificate.Subject -notmatch 'CompleteTech'){exit 1}";
  try {
    await run(windowsPowerShellPath(), ["-NoProfile", "-NonInteractive", "-Command", script, helperPath]);
  } catch {
    throw new WindowsHypervAuditError("signature_rejected", `Windows Host Audit rejected the helper because its Authenticode chain or ${EXPECTED_PUBLISHER} publisher could not be verified.`);
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function string(value: unknown, maxLength = MAX_STRING_LENGTH): string | null { return typeof value === "string" && value.length > 0 && value.length <= maxLength ? value : null; }
function nullableNumber(value: unknown): number | null | undefined {
  if (value === null) return null;
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}
function nullableString(value: unknown): string | null | undefined { return value === null ? null : string(value) ?? undefined; }
function array(value: unknown): unknown[] | null { return Array.isArray(value) ? value : null; }

function parseRows<T>(value: unknown, parse: (row: Record<string, unknown>) => T | null): T[] | null {
  const rows = array(value);
  if (!rows || rows.length > MAX_ROWS) return null;
  const parsed = rows.map((row) => {
    const item = record(row);
    return item ? parse(item) : null;
  });
  return parsed.every((row): row is T => row !== null) ? parsed : null;
}

/** Validate every field crossing the privilege boundary. A malformed helper
 * response is rejected rather than being partially interpreted as inventory. */
export function parseHypervInventory(raw: string): HypervInventory {
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new WindowsHypervAuditError("invalid_broker_response", "Windows Host Audit returned invalid JSON."); }
  const root = record(value);
  const host = root && record(root.host);
  const hostName = host && string(host.name);
  const hostVersion = host && string(host.version);
  const available = host?.hypervAvailable;
  const vms = root && parseRows(root.vms, (row) => {
    const id = string(row.id, 256), name = string(row.name, 512), state = string(row.state, 32), generation = nullableNumber(row.generation);
    return id && name && state && VM_STATES.has(state) && (generation === null || generation === 1 || generation === 2) ? { id, name, state, generation } : null;
  });
  const switches = root && parseRows(root.switches, (row) => {
    const id = string(row.id, 256), name = string(row.name, 512), type = string(row.type, 32);
    return id && name && type && SWITCH_TYPES.has(type) ? { id, name, type } : null;
  });
  const checkpoints = root && parseRows(root.checkpoints, (row) => {
    const id = string(row.id, 256), vmId = string(row.vmId, 256), name = string(row.name, 512), createdAt = nullableString(row.createdAt);
    return id && vmId && name && createdAt !== undefined && (createdAt === null || !Number.isNaN(Date.parse(createdAt))) ? { id, vmId, name, createdAt } : null;
  });
  const vhdChains = root && parseRows(root.vhdChains, (row) => {
    const vhdPath = string(row.path), parentPath = nullableString(row.parentPath), sizeBytes = nullableNumber(row.sizeBytes);
    return vhdPath && parentPath !== undefined && sizeBytes !== undefined ? { path: vhdPath, parentPath, sizeBytes } : null;
  });
  const integrationServices = root && parseRows(root.integrationServices, (row) => {
    const vmId = string(row.vmId, 256), name = string(row.name, 512), primaryStatus = string(row.primaryStatus, 32);
    return vmId && name && primaryStatus && INTEGRATION_STATUSES.has(primaryStatus) && typeof row.enabled === "boolean" ? { vmId, name, enabled: row.enabled, primaryStatus } : null;
  });
  if (!hostName || !hostVersion || typeof available !== "boolean" || !vms || !switches || !checkpoints || !vhdChains || !integrationServices) {
    throw new WindowsHypervAuditError("invalid_broker_response", "Windows Host Audit returned an incomplete inventory.");
  }
  return { host: { name: hostName, version: hostVersion, hypervAvailable: available }, vms, switches, checkpoints, vhdChains, integrationServices };
}

/** Server runtime entrypoint. Browser routes must not expose this operation:
 * callers first obtain authority from the active runtime/session binding. */
export async function authorizeWindowsHypervAuditRuntime(input: { familiarId: string; sessionId: string; platform?: NodeJS.Platform }): Promise<WindowsHypervAuditRuntimeAuthority> {
  const platform = input.platform ?? process.platform;
  if (platform !== "win32") throw new WindowsHypervAuditError("unsupported_platform", "Windows Host Audit is available only on Windows.");
  const grants = await activeHostCapabilities({ familiarId: input.familiarId, sessionId: input.sessionId, platform });
  if (!grants.includes(WINDOWS_HYPERV_AUDIT_CAPABILITY)) {
    throw new WindowsHypervAuditError("capability_required", "An active Hyper-V audit approval is required for this session.");
  }
  const authority = { familiarId: input.familiarId, sessionId: input.sessionId } as WindowsHypervAuditRuntimeAuthority;
  runtimeAuthorities.add(authority);
  return authority;
}

export async function runWindowsHypervAudit(authority: WindowsHypervAuditRuntimeAuthority, dependencies: WindowsHypervAuditTestDependencies = {}): Promise<HypervInventory> {
  if (!runtimeAuthorities.has(authority)) throw new WindowsHypervAuditError("capability_required", "Windows Host Audit requires trusted runtime session authority.");
  // Recheck immediately before crossing the privilege boundary: a grant can
  // expire or be revoked after the runtime created its opaque authority.
  const grants = await activeHostCapabilities({ familiarId: authority.familiarId, sessionId: authority.sessionId, platform: "win32" });
  if (!grants.includes(WINDOWS_HYPERV_AUDIT_CAPABILITY)) {
    throw new WindowsHypervAuditError("capability_required", "The Hyper-V audit approval expired or was revoked before the helper started.");
  }
  const helperPath = installManagedHelperPath();
  try {
    const run = dependencies.run ?? systemRunner;
    await verifyAuthenticode(helperPath, run);
    // Tests inject a runner; production cannot choose the binary or argv, and
    // the auth check is always completed before the helper can execute.
    const raw = await run(helperPath, HELPER_ARGS);
    return parseHypervInventory(raw);
  } catch (error) {
    if (error instanceof WindowsHypervAuditError) throw error;
    throw new WindowsHypervAuditError("broker_failed", "Windows Host Audit could not complete. Check the signed helper and UAC approval.");
  }
}
