import fs from "node:fs";
import path from "node:path";
import { mkdir } from "node:fs/promises";
import {
  caveHome,
  covenWorkspaceRoot,
  readWorkspaceRootOverride,
  workspaceRootEnvPin,
  workspaceRootOverrideFile,
} from "@/lib/coven-paths";
import { resolveBrowsableDir } from "@/lib/server/home-browse";
import { writeJsonAtomic } from "@/lib/server/atomic-write";

/**
 * Persistence for the workspace root chosen in Settings → General → Workspace.
 *
 * Kept in its own tiny file (`<caveHome>/workspace-root.json`) rather than in
 * cave-config.json: `covenWorkspaceRoot()` is synchronous and is consulted by
 * sync callers (project-paths' allowed-root list), while the config store is
 * async and imports this module's dependencies — routing the read through it
 * would mean an import cycle and an async ripple through every path helper.
 *
 * The read half lives in coven-paths.ts (no cycle, sync); this module owns
 * validation and the write.
 */

export type SaveWorkspaceRootResult =
  | { ok: true; workspacePath: string }
  | { ok: false; reason: "env-pinned" | "invalid-path" | "unbounded" | "write-failed" };

/** True for a bare volume root: "/" or a Windows drive root like "C:\". */
function isVolumeRoot(value: string): boolean {
  return value === path.parse(value).root;
}

/**
 * Validate a requested workspace root.
 *
 * Reuses `resolveBrowsableDir` so the accepted path is re-derived from its
 * volume root by the same trusted directory walk the folder browser uses — the
 * request string is never handed to the filesystem as a path. A bare volume
 * root or `$HOME` itself is refused for the same reason the picker won't let
 * you select one: pointing workspace storage at an entire drive or home
 * directory is always a mistake.
 */
export function validateWorkspaceRoot(requested: string): SaveWorkspaceRootResult {
  const raw = (requested ?? "").trim();
  if (!raw || !path.isAbsolute(raw)) return { ok: false, reason: "invalid-path" };
  const resolved = resolveBrowsableDir(raw);
  if (!resolved) return { ok: false, reason: "invalid-path" };
  if (isVolumeRoot(resolved)) return { ok: false, reason: "unbounded" };
  return { ok: true, workspacePath: resolved };
}

/**
 * Persist the chosen workspace root. Refuses while an env var pins the value —
 * saving under a pin would write a preference the app then ignores.
 */
export async function saveWorkspaceRoot(requested: string): Promise<SaveWorkspaceRootResult> {
  if (workspaceRootEnvPin()) return { ok: false, reason: "env-pinned" };

  const validated = validateWorkspaceRoot(requested);
  if (!validated.ok) return validated;

  try {
    await mkdir(/* turbopackIgnore: true */ caveHome(), { recursive: true });
    await writeJsonAtomic(workspaceRootOverrideFile(), {
      workspacePath: validated.workspacePath,
      savedAt: new Date().toISOString(),
    });
  } catch {
    return { ok: false, reason: "write-failed" };
  }
  return validated;
}

/** Drop the saved choice and fall back to the default root. */
export async function clearWorkspaceRoot(): Promise<void> {
  await fs.promises.rm(workspaceRootOverrideFile(), { force: true });
}

export type WorkspaceRootStatus = {
  workspacePath: string;
  /** The env var pinning the value, when one is set (the field goes read-only). */
  envPin: string | null;
  /** True once the user has picked a root rather than inheriting the default. */
  chosen: boolean;
};

export function workspaceRootStatus(): WorkspaceRootStatus {
  const pin = workspaceRootEnvPin();
  return {
    workspacePath: covenWorkspaceRoot(),
    envPin: pin?.name ?? null,
    chosen: !pin && readWorkspaceRootOverride() !== null,
  };
}
