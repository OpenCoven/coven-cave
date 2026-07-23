/**
 * MCP doctor — diagnoses every server in the marketplace MCP registry
 * (`marketplace/exports/mcp/mcp.json`) so the cave can show which listed
 * servers are actually usable, not merely listed.
 *
 * Three honest verdicts per entry:
 *   - "ready"        a remote endpoint answered the MCP `initialize` probe, or
 *                    the stdio launcher (npx/uvx/docker/…) is installed and the
 *                    entry needs no user-supplied configuration
 *   - "needs-config" the entry references `${PLACEHOLDER}` values the user must
 *                    supply before it can run, so nothing can be probed yet
 *   - "unavailable"  the endpoint did not respond, or the launcher is not
 *                    installed on this machine
 *
 * Only requirement *names* are ever reported — never values. The endpoint
 * probe and PATH lookup are injectable so tests touch neither network nor
 * filesystem.
 */

import { access } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { checkMcpEndpoint, type EndpointCheck } from "./endpoint-validators.ts";

export type RegistryServerEntry = {
  type?: string;
  url?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
};

export type McpHealthStatus = "ready" | "needs-config" | "unavailable";

export type McpServerHealth = {
  id: string;
  transport: string;
  status: McpHealthStatus;
  detail: string;
  /** Names of `${PLACEHOLDER}` values the user must supply. Never values. */
  requires: string[];
};

export type DoctorDeps = {
  probe: (url: string) => Promise<EndpointCheck>;
  commandExists: (command: string) => Promise<boolean>;
};

/** Collect `${PLACEHOLDER}` names from an entry's url, command, args, and env values. */
export function extractPlaceholders(entry: RegistryServerEntry): string[] {
  const names = new Set<string>();
  const scan = (value: unknown) => {
    if (typeof value !== "string") return;
    for (const match of value.matchAll(/\$\{([A-Za-z0-9_]+)\}/g)) names.add(match[1]);
  };
  scan(entry.url);
  scan(entry.command);
  for (const arg of Array.isArray(entry.args) ? entry.args : []) scan(arg);
  for (const value of Object.values(entry.env ?? {})) scan(value);
  return [...names].sort();
}

export async function diagnoseEntry(id: string, entry: RegistryServerEntry, deps: DoctorDeps): Promise<McpServerHealth> {
  const transport = typeof entry.type === "string" && entry.type ? entry.type : "stdio";
  const requires = extractPlaceholders(entry);
  const base = { id, transport, requires };

  if (transport === "http" || transport === "sse") {
    const url = typeof entry.url === "string" ? entry.url : "";
    if (!url) return { ...base, status: "needs-config", detail: "registry entry has no url" };
    if (requires.length > 0) {
      return { ...base, status: "needs-config", detail: `set ${requires.join(", ")} to enable this endpoint` };
    }
    const check = await deps.probe(url);
    if (!check.reachable) return { ...base, status: "unavailable", detail: check.error ?? "could not reach endpoint" };
    return { ...base, status: "ready", detail: check.detail ?? "endpoint live" };
  }

  const command = typeof entry.command === "string" ? entry.command : "";
  if (!command) return { ...base, status: "needs-config", detail: "registry entry has no command" };
  const installed = await deps.commandExists(command);
  if (!installed) return { ...base, status: "unavailable", detail: `launcher "${command}" is not installed` };
  if (requires.length > 0) {
    return { ...base, status: "needs-config", detail: `"${command}" installed — set ${requires.join(", ")} to run` };
  }
  return { ...base, status: "ready", detail: `launcher "${command}" installed — package resolves on launch` };
}

/** Diagnose a parsed registry document (`{ mcpServers: { id: entry } }`), sorted by id. */
export async function diagnoseRegistry(registry: unknown, deps: DoctorDeps): Promise<McpServerHealth[]> {
  const obj = (registry && typeof registry === "object" ? registry : {}) as Record<string, unknown>;
  const servers = (obj.mcpServers && typeof obj.mcpServers === "object" ? obj.mcpServers : {}) as Record<
    string,
    RegistryServerEntry
  >;
  const results = await Promise.all(Object.entries(servers).map(([id, entry]) => diagnoseEntry(id, entry ?? {}, deps)));
  return results.sort((a, b) => a.id.localeCompare(b.id));
}

/** Real PATH lookup for stdio launchers. Never spawns anything. */
export async function systemCommandExists(command: string): Promise<boolean> {
  if (!command) return false;
  const extensions =
    process.platform === "win32" ? (process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean) : [""];
  const runnable = async (candidate: string) => {
    try {
      await access(candidate, process.platform === "win32" ? constants.F_OK : constants.X_OK);
      return true;
    } catch {
      return false;
    }
  };
  const candidates = command.includes(path.sep)
    ? [command]
    : (process.env.PATH ?? "").split(path.delimiter).filter(Boolean).map((dir) => path.join(dir, command));
  for (const candidate of candidates) {
    for (const ext of extensions) {
      if (await runnable(candidate + ext.toLowerCase()) || (ext && (await runnable(candidate + ext)))) return true;
    }
  }
  return false;
}

/** Default deps: real MCP initialize probe + real PATH lookup. */
export const systemDoctorDeps: DoctorDeps = {
  probe: checkMcpEndpoint,
  commandExists: systemCommandExists,
};
