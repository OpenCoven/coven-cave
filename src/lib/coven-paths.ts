import fs from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

export function covenHome(): string {
  return process.env.COVEN_HOME || path.join(/* turbopackIgnore: true */ homedir(), ".coven");
}

/**
 * Dedicated home for Coven Cave's own state: `<covenHome>/cave/`.
 *
 * All cave-owned files live here with standardized names (config.json,
 * state.json, board.json, conversations/, …) instead of the legacy scattered
 * `~/.coven/cave-*.json` top-level files. Legacy files are moved in at startup
 * by `migrateCaveHome()` (src/lib/server/cave-home-migration.ts). Bundle-mode
 * writables (.env.local, vault.yaml, workflows/) already lived here.
 */
export function caveHome(): string {
  return process.env.COVEN_CAVE_HOME || path.join(/* turbopackIgnore: true */ covenHome(), "cave");
}

export function covenWorkspacesRoot(): string {
  return process.env.COVEN_WORKSPACES_ROOT || path.join(/* turbopackIgnore: true */ covenHome(), "workspaces");
}

/**
 * Env vars that pin the workspace root outright, in precedence order. These are
 * deployment configuration — when one is set, Settings shows the value as
 * read-only rather than letting a pick silently lose to the environment.
 */
export const WORKSPACE_ROOT_ENV_VARS = [
  "COVEN_WORKSPACE_ROOT",
  "WORKSPACE_ROOT",
  "NEXT_PUBLIC_WORKSPACE_ROOT",
] as const;

/** The env var currently pinning the workspace root, if any. */
export function workspaceRootEnvPin(): { name: string; value: string } | null {
  for (const name of WORKSPACE_ROOT_ENV_VARS) {
    const value = process.env[name];
    if (value) return { name, value };
  }
  return null;
}

/** File holding the workspace root the user chose in Settings. */
export function workspaceRootOverrideFile(): string {
  return path.join(/* turbopackIgnore: true */ caveHome(), "workspace-root.json");
}

/**
 * The workspace root chosen in Settings, or null when none has been saved.
 *
 * Read synchronously (and uncached) on purpose: `covenWorkspaceRoot()` is a
 * sync API called from sync callers like project-paths' allowed-root list, and
 * a cache here would keep serving the old root to in-flight requests right
 * after the user picks a new one. The file is a few dozen bytes.
 */
export function readWorkspaceRootOverride(): string | null {
  try {
    const raw = fs.readFileSync(/* turbopackIgnore: true */ workspaceRootOverrideFile(), "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const value = (parsed as { workspacePath?: unknown }).workspacePath;
    return typeof value === "string" && value.trim() ? value : null;
  } catch {
    // Absent (the common case), unreadable, or malformed — fall through to the
    // env pin / default rather than failing every path resolution.
    return null;
  }
}

/**
 * Where familiar workspaces live. An env pin wins (deployment config), then the
 * root chosen in Settings, then the default beneath `~/.coven`.
 */
export function covenWorkspaceRoot(): string {
  return workspaceRootEnvPin()?.value || readWorkspaceRootOverride() || covenWorkspacesRoot();
}

export function familiarWorkspacesRoot(): string {
  return path.join(/* turbopackIgnore: true */ covenWorkspacesRoot(), "familiars");
}

function expandHome(value: string): string {
  if (value === "~") return homedir();
  if (value.startsWith("~/")) return path.join(/* turbopackIgnore: true */ homedir(), value.slice(2));
  return value;
}

function readTomlString(block: string, key: string): string | null {
  const quoted = block.match(new RegExp(`^\\s*${key}\\s*=\\s*(['"])(.*?)\\1\\s*(?:#.*)?$`, "m"));
  if (quoted) return quoted[2];
  const bare = block.match(new RegExp(`^\\s*${key}\\s*=\\s*([^\\s#]+)\\s*(?:#.*)?$`, "m"));
  return bare?.[1] ?? null;
}

export function parseFamiliarWorkspaces(raw: string): Map<string, string> {
  const workspaces = new Map<string, string>();
  const blocks = raw.split(/^\s*\[\[familiar\]\]\s*$/m).slice(1);
  for (const block of blocks) {
    const id = readTomlString(block, "id");
    const workspace = readTomlString(block, "workspace");
    if (!id || !workspace) continue;
    workspaces.set(id, path.resolve(/* turbopackIgnore: true */ expandHome(workspace)));
  }
  return workspaces;
}

export async function readFamiliarWorkspaces(): Promise<Map<string, string>> {
  try {
    const raw = await readFile(path.join(/* turbopackIgnore: true */ covenHome(), "familiars.toml"), "utf8");
    return parseFamiliarWorkspaces(raw);
  } catch {
    return new Map();
  }
}

export async function familiarWorkspace(familiarId: string): Promise<string> {
  const declared = await readFamiliarWorkspaces();
  return declared.get(familiarId) ?? path.join(/* turbopackIgnore: true */ familiarWorkspacesRoot(), familiarId);
}

export async function familiarIds(): Promise<string[]> {
  const declared = await readFamiliarWorkspaces();
  return Array.from(declared.keys());
}
