import { execFile } from "node:child_process";
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

export type HypervInventory = {
  host: { name: string; version: string; hypervAvailable: boolean };
  vms: Array<{ id: string; name: string; state: string; generation: number | null }>;
  switches: Array<{ id: string; name: string; type: string }>;
  checkpoints: Array<{ id: string; vmId: string; name: string; createdAt: string | null }>;
  vhdChains: Array<{ path: string; parentPath: string | null; sizeBytes: number | null }>;
  integrationServices: Array<{ vmId: string; name: string; enabled: boolean; primaryStatus: string }>;
};

export class WindowsHypervAuditError extends Error {
  readonly code: "unsupported_platform" | "capability_required" | "broker_failed" | "invalid_broker_response";
  constructor(code: "unsupported_platform" | "capability_required" | "broker_failed" | "invalid_broker_response", message: string) {
    super(message);
    this.name = "WindowsHypervAuditError";
    this.code = code;
  }
}

export type HypervAuditRunner = (command: string, args: readonly string[]) => Promise<string>;

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

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function string(value: unknown): string | null { return typeof value === "string" ? value : null; }
function nullableNumber(value: unknown): number | null { return typeof value === "number" && Number.isFinite(value) ? value : null; }
function nullableString(value: unknown): string | null { return value === null ? null : string(value); }
function array(value: unknown): unknown[] | null { return Array.isArray(value) ? value : null; }

function parseRows<T>(value: unknown, parse: (row: Record<string, unknown>) => T | null): T[] | null {
  const rows = array(value);
  if (!rows) return null;
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
    const id = string(row.id), name = string(row.name), state = string(row.state), generation = nullableNumber(row.generation);
    return id && name && state && (generation === null || Number.isInteger(generation)) ? { id, name, state, generation } : null;
  });
  const switches = root && parseRows(root.switches, (row) => {
    const id = string(row.id), name = string(row.name), type = string(row.type);
    return id && name && type ? { id, name, type } : null;
  });
  const checkpoints = root && parseRows(root.checkpoints, (row) => {
    const id = string(row.id), vmId = string(row.vmId), name = string(row.name), createdAt = nullableString(row.createdAt);
    return id && vmId && name && createdAt !== undefined ? { id, vmId, name, createdAt } : null;
  });
  const vhdChains = root && parseRows(root.vhdChains, (row) => {
    const path = string(row.path), parentPath = nullableString(row.parentPath), sizeBytes = nullableNumber(row.sizeBytes);
    return path && parentPath !== undefined && sizeBytes !== undefined ? { path, parentPath, sizeBytes } : null;
  });
  const integrationServices = root && parseRows(root.integrationServices, (row) => {
    const vmId = string(row.vmId), name = string(row.name), primaryStatus = string(row.primaryStatus);
    return vmId && name && primaryStatus && typeof row.enabled === "boolean" ? { vmId, name, enabled: row.enabled, primaryStatus } : null;
  });
  if (!hostName || !hostVersion || typeof available !== "boolean" || !vms || !switches || !checkpoints || !vhdChains || !integrationServices) {
    throw new WindowsHypervAuditError("invalid_broker_response", "Windows Host Audit returned an incomplete inventory.");
  }
  return { host: { name: hostName, version: hostVersion, hypervAvailable: available }, vms, switches, checkpoints, vhdChains, integrationServices };
}

export async function runWindowsHypervAudit(input: {
  familiarId: string;
  sessionId: string;
  platform?: NodeJS.Platform;
  helperPath?: string;
  run?: HypervAuditRunner;
}): Promise<HypervInventory> {
  const platform = input.platform ?? process.platform;
  if (platform !== "win32") throw new WindowsHypervAuditError("unsupported_platform", "Windows Host Audit is available only on Windows.");
  const grants = await activeHostCapabilities({ familiarId: input.familiarId, sessionId: input.sessionId, platform });
  if (!grants.includes(WINDOWS_HYPERV_AUDIT_CAPABILITY)) {
    throw new WindowsHypervAuditError("capability_required", "An active Hyper-V audit approval is required for this session.");
  }
  try {
    // The helper path is deployment-controlled. Tests inject a runner; no test
    // executes host commands, and clients cannot choose either argument.
    const raw = await (input.run ?? systemRunner)(input.helperPath ?? "coven-host-audit.exe", HELPER_ARGS);
    return parseHypervInventory(raw);
  } catch (error) {
    if (error instanceof WindowsHypervAuditError) throw error;
    throw new WindowsHypervAuditError("broker_failed", "Windows Host Audit could not complete. Check the signed helper and UAC approval.");
  }
}
