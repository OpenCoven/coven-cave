import fs from "node:fs";
import path from "node:path";
import { homedir } from "node:os";
import { covenHome, caveHome, covenWorkspaceRoot } from "@/lib/coven-paths";
import { realpathOrResolve } from "@/lib/server/canonical-path";
import { researchMissionsRoot } from "@/lib/server/research-mission-store";

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
  if (uniqueRoots(builtInProjectRoots()).some((root) => isWithinRoot(candidate, root))) {
    return true;
  }
  // The "New project" folder picker (fs-browse) can navigate anywhere on the
  // machine — up to volume roots and across drives — matching the desktop
  // build's native OS dialog, so registration accepts the same boundary or
  // the picker offers folders it then rejects with a 403. This widening is
  // safe only because the projects POST route is loopback-only (see
  // rejectNonLocalRequest there): a phone on the tailnet cannot register
  // arbitrary host paths. Containment is realpath-based, so a symlink is
  // judged by its target. Two unbounded roots stay excluded: $HOME itself and
  // bare volume roots (`/`, `C:\`) — registering an entire home directory or
  // drive as one project is never intended.
  const home = realpathOrResolve(homedir());
  if (candidate === home) return false;
  return candidate !== path.parse(candidate).root;
}
