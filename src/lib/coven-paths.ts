import fs from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { covenHomePath } from "./coven-home.ts";

export function covenHome(): string {
  return covenHomePath(process.env, homedir(), process.platform);
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

function parseStrictTomlAssignment(line: string, key: "id" | "workspace"): string | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;
  if (!trimmed.startsWith(key)) return null;
  const next = trimmed[key.length];
  if (next && /[A-Za-z0-9_]/.test(next)) return null;
  let cursor = key.length;
  while (cursor < trimmed.length && /\s/.test(trimmed[cursor]!)) cursor++;
  if (trimmed[cursor] !== "=") {
    throw new Error(`invalid assignment syntax for familiar ${key}`);
  }
  cursor++;
  while (cursor < trimmed.length && /\s/.test(trimmed[cursor]!)) cursor++;
  if (cursor >= trimmed.length) {
    throw new Error(`missing familiar ${key} value`);
  }

  const start = trimmed[cursor]!;
  if (start === '"' || start === "'") {
    const quote = start;
    cursor++;
    let value = "";
    while (cursor < trimmed.length) {
      const char = trimmed[cursor]!;
      if (quote === '"' && char === "\\" && cursor + 1 < trimmed.length) {
        value += char + trimmed[cursor + 1]!;
        cursor += 2;
        continue;
      }
      if (char === quote) {
        cursor++;
        while (cursor < trimmed.length && /\s/.test(trimmed[cursor]!)) cursor++;
        if (cursor < trimmed.length && trimmed[cursor] !== "#") {
          throw new Error(`invalid assignment syntax for familiar ${key}`);
        }
        return value;
      }
      value += char;
      cursor++;
    }
    throw new Error(`unterminated quoted familiar ${key}`);
  }

  const valueStart = cursor;
  while (cursor < trimmed.length && !/\s|#/.test(trimmed[cursor]!)) cursor++;
  const value = trimmed.slice(valueStart, cursor);
  while (cursor < trimmed.length && /\s/.test(trimmed[cursor]!)) cursor++;
  if (cursor < trimmed.length && trimmed[cursor] !== "#") {
    throw new Error(`invalid assignment syntax for familiar ${key}`);
  }
  return value;
}

function parseFamiliarWorkspacesStrict(raw: string): Map<string, string> {
  const workspaces = new Map<string, string>();
  let inFamiliar = false;
  let familiarId: string | null = null;
  let workspace: string | null = null;
  let workspaceLine = 0;

  const flush = () => {
    if (!inFamiliar) return;
    if (workspace !== null) {
      if (!familiarId) {
        throw new Error(
          `workspace assignment in familiar block whose id cannot be parsed (line ${workspaceLine})`,
        );
      }
      workspaces.set(
        familiarId,
        path.resolve(/* turbopackIgnore: true */ expandHome(workspace)),
      );
    }
    inFamiliar = false;
    familiarId = null;
    workspace = null;
    workspaceLine = 0;
  };

  for (const [index, rawLine] of raw.split(/\r?\n/).entries()) {
    const lineNumber = index + 1;
    const line = rawLine.trim();
    if (line === "[[familiar]]") {
      flush();
      inFamiliar = true;
      continue;
    }
    if (line.startsWith("[")) {
      flush();
      continue;
    }
    if (!inFamiliar) continue;
    try {
      const parsedId = parseStrictTomlAssignment(rawLine, "id");
      if (parsedId !== null && familiarId === null) {
        familiarId = parsedId;
      }
      const parsedWorkspace = parseStrictTomlAssignment(rawLine, "workspace");
      if (parsedWorkspace !== null && workspace === null) {
        workspace = parsedWorkspace;
        workspaceLine = lineNumber;
      }
    } catch (error) {
      const reason =
        error instanceof Error ? error.message : "invalid familiar workspace assignment";
      throw new Error(`Malformed familiars.toml at line ${lineNumber}: ${reason}`);
    }
  }
  flush();
  return workspaces;
}

function familiarWorkspacesFile(): string {
  return path.join(/* turbopackIgnore: true */ covenHome(), "familiars.toml");
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

export async function readFamiliarWorkspacesStrict(): Promise<Map<string, string>> {
  try {
    const raw = await readFile(familiarWorkspacesFile(), "utf8");
    return parseFamiliarWorkspacesStrict(raw);
  } catch (error) {
    if ((error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") return new Map();
    throw error;
  }
}

export async function readFamiliarWorkspaces(): Promise<Map<string, string>> {
  try {
    const raw = await readFile(familiarWorkspacesFile(), "utf8");
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
