import fs from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

export function covenHome(): string {
  return process.env.COVEN_HOME || path.join(homedir(), ".coven");
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
  return process.env.COVEN_CAVE_HOME || path.join(covenHome(), "cave");
}

export function covenWorkspacesRoot(): string {
  return process.env.COVEN_WORKSPACES_ROOT || path.join(covenHome(), "workspaces");
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
  return path.join(caveHome(), "workspace-root.json");
}

/**
 * Accept a stored workspace root only if it still looks like one.
 *
 * The write path (workspace-root-store's `saveWorkspaceRoot`) already refuses
 * relative paths and bare volume roots, but this file is plain JSON in the
 * user's Cave home and a hand-edit must not be able to widen anything. That
 * matters because `covenWorkspaceRoot()` feeds project-paths' allowed-root
 * list: a stored `"C:\\"` would otherwise turn a whole drive into an allowed
 * project root, silently bypassing the guard the writer enforces.
 */
function acceptStoredWorkspaceRoot(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const resolved = path.resolve(/* turbopackIgnore: true */ value.trim());
  // Mirror saveWorkspaceRoot's "unbounded" rejection.
  return resolved === path.parse(resolved).root ? null : resolved;
}

/**
 * Cached parse of the override file, keyed on the stat that produced it.
 *
 * `covenWorkspaceRoot()` is sync and sits on hot paths — project-paths'
 * allowed-root list recomputes it for every path it checks, and fs-browse
 * checks one path per directory entry, so an uncached read cost ~110 ms of
 * blocking I/O on a 500-entry folder. A `statSync` is ~35x cheaper than
 * read+parse and still invalidates the moment a save rewrites the file.
 *
 * Staleness bound: mtime *and* size must both be unchanged to reuse the cache,
 * so serving a stale root would take two writes inside the same filesystem
 * mtime tick that also produce identical file sizes. `saveWorkspaceRoot` writes
 * once per user action, so that does not arise in practice — and the stale
 * value would be a root the same user chose moments earlier, not a widening.
 */
let overrideCache: { mtimeMs: number; size: number; value: string | null } | null = null;

/**
 * The workspace root chosen in Settings, or null when none has been saved.
 * Missing, unreadable, malformed, and no-longer-valid files all read as null so
 * a bad file degrades to the default instead of failing every path resolution.
 */
export function readWorkspaceRootOverride(): string | null {
  const file = workspaceRootOverrideFile();
  try {
    const stat = fs.statSync(/* turbopackIgnore: true */ file);
    if (
      overrideCache &&
      overrideCache.mtimeMs === stat.mtimeMs &&
      overrideCache.size === stat.size
    ) {
      return overrideCache.value;
    }
    const parsed: unknown = JSON.parse(
      fs.readFileSync(/* turbopackIgnore: true */ file, "utf8"),
    );
    const value =
      parsed && typeof parsed === "object"
        ? acceptStoredWorkspaceRoot((parsed as { workspacePath?: unknown }).workspacePath)
        : null;
    overrideCache = { mtimeMs: stat.mtimeMs, size: stat.size, value };
    return value;
  } catch {
    // Absent (the common case), unreadable, or malformed. Drop any cache so a
    // deleted file stops resolving to the root it used to name.
    overrideCache = null;
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
  return path.join(covenWorkspacesRoot(), "familiars");
}

function expandHome(value: string): string {
  if (value === "~") return homedir();
  if (value.startsWith("~/")) return path.join(homedir(), value.slice(2));
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
