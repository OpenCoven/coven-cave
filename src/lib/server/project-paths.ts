import fs from "node:fs";
import path from "node:path";
import { homedir } from "node:os";
import { covenHome, caveHome, covenWorkspaceRoot } from "@/lib/coven-paths";
import { researchMissionsRoot } from "@/lib/server/research-mission-store";

function realpathOrResolve(value: string): string {
  const resolved = path.resolve(/* turbopackIgnore: true */ value);
  try {
    return fs.realpathSync(/* turbopackIgnore: true */ resolved);
  } catch {
    return resolved;
  }
}

function expandHomeShortcut(value: string): string {
  const trimmed = value.trim();
  if (trimmed === "~") return homedir();
  if (trimmed.startsWith("~/") || trimmed.startsWith("~\\")) {
    return path.join(homedir(), trimmed.slice(2));
  }
  return value;
}

function normalizeNewProjectRootCandidate(value: string): string {
  return normalizeLegacyCovenWorkspacePath(expandHomeShortcut(value));
}

function normalizeLegacyCovenWorkspacePath(value: string): string {
  const resolved = path.resolve(/* turbopackIgnore: true */ value);
  const legacyRoot = path.resolve(path.join(/* turbopackIgnore: true */ covenHome(), "workspace"));
  if (resolved !== legacyRoot && !resolved.startsWith(legacyRoot + path.sep)) {
    return value;
  }

  return path.join(
    /* turbopackIgnore: true */ path.resolve(path.join(/* turbopackIgnore: true */ covenHome(), "workspaces")),
    path.relative(/* turbopackIgnore: true */ legacyRoot, resolved),
  );
}

function caveProjectsFilePath(): string {
  return process.env.CAVE_PROJECTS_PATH_OVERRIDE ?? path.join(/* turbopackIgnore: true */ caveHome(), "projects.json");
}

export function validateCaveProjectRoot(value: string): { ok: true; root: string } | { ok: false; error: string } {
  // Expand ~ first (matching isAllowedNewProjectRoot and cave-projects'
  // normalizeRoot) so manually-typed ~/code/app roots stay accepted.
  const root = expandHomeShortcut(value).trim();
  if (!root) return { ok: false, error: "root is required" };
  if (!path.isAbsolute(root)) return { ok: false, error: "root must be an absolute path" };

  let stat: fs.Stats;
  try {
    stat = fs.statSync(/* turbopackIgnore: true */ root);
  } catch {
    return { ok: false, error: "root does not exist" };
  }
  if (!stat.isDirectory()) return { ok: false, error: "root must be a directory" };

  return { ok: true, root: realpathOrResolve(root) };
}

function savedCaveProjectRoots(): string[] {
  try {
    const parsed = JSON.parse(fs.readFileSync(/* turbopackIgnore: true */ caveProjectsFilePath(), "utf8")) as {
      projects?: Array<{ root?: unknown }>;
    };
    if (!Array.isArray(parsed.projects)) return [];
    return parsed.projects
      .map((project) => project.root)
      .filter((root): root is string => typeof root === "string")
      .map((root) => validateCaveProjectRoot(root))
      .filter((result): result is { ok: true; root: string } => result.ok)
      .map((result) => result.root);
  } catch {
    return [];
  }
}

// Computed per call, never cached at module load: saved Cave projects and
// research mission workspaces are created at runtime, and a snapshot taken at
// import time silently rejected them ("invalid project root") until the next
// server restart.
function builtInProjectRoots(): string[] {
  return [
    process.env.WORKSPACE_ROOT,
    process.env.NEXT_PUBLIC_WORKSPACE_ROOT,
    covenWorkspaceRoot(),
    // Allow openclaw workspace roots so workspace readers can load familiar research dirs.
    process.env.OPENCLAW_WORKSPACE_ROOT,
    path.join(/* turbopackIgnore: true */ homedir(), ".openclaw", "workspace"),
    process.cwd(),
    // Research mission workspaces host bounded research sessions and live
    // under cave state rather than a registered project root.
    researchMissionsRoot(),
  ]
    .filter((value): value is string => Boolean(value))
    .map(realpathOrResolve);
}

function uniqueRoots(roots: string[]): string[] {
  return Array.from(new Set(roots));
}

function allowedProjectRoots(): string[] {
  return uniqueRoots([...builtInProjectRoots(), ...savedCaveProjectRoots().map(realpathOrResolve)]);
}

function isWithinRoot(candidate: string, root: string): boolean {
  return candidate === root || candidate.startsWith(root + path.sep);
}

function relativeWithinRoot(candidate: string, root: string): string | null {
  const relativePath = path.relative(/* turbopackIgnore: true */ root, candidate);
  if (
    relativePath.startsWith("..") ||
    path.isAbsolute(relativePath) ||
    relativePath.split(path.sep).includes("..")
  ) {
    return null;
  }
  return relativePath;
}

export function resolveAllowedProjectSubpath(value: string): { root: string; relativePath: string } | null {
  const candidate = realpathOrResolve(normalizeLegacyCovenWorkspacePath(value));
  for (const root of allowedProjectRoots()) {
    if (isWithinRoot(candidate, root)) {
      const relativePath = relativeWithinRoot(candidate, root);
      if (relativePath !== null) {
        return { root, relativePath };
      }
    }
  }

  return null;
}

export function resolveAllowedProjectPath(value: string): string | null {
  const subpath = resolveAllowedProjectSubpath(value);
  return subpath ? path.join(/* turbopackIgnore: true */ subpath.root, subpath.relativePath) : null;
}

export function isAllowedNewProjectRoot(value: string): boolean {
  const candidate = realpathOrResolve(normalizeNewProjectRootCandidate(value));
  return uniqueRoots(builtInProjectRoots()).some((root) => isWithinRoot(candidate, root));
}
