import fs from "node:fs";
import path from "node:path";
import { homedir } from "node:os";
import { covenHome, covenWorkspaceRoot } from "@/lib/coven-paths";

function realpathOrResolve(value: string): string {
  const resolved = path.resolve(value);
  try {
    return fs.realpathSync(resolved);
  } catch {
    return resolved;
  }
}

function normalizeLegacyCovenWorkspacePath(value: string): string {
  const resolved = path.resolve(value);
  const legacyRoot = path.resolve(path.join(covenHome(), "workspace"));
  if (resolved !== legacyRoot && !resolved.startsWith(legacyRoot + path.sep)) {
    return value;
  }

  return path.join(path.resolve(path.join(covenHome(), "workspaces")), path.relative(legacyRoot, resolved));
}

function caveProjectsFilePath(): string {
  return process.env.CAVE_PROJECTS_PATH_OVERRIDE ?? path.join(homedir(), ".coven", "cave-projects.json");
}

function savedCaveProjectRoots(): string[] {
  try {
    const parsed = JSON.parse(fs.readFileSync(caveProjectsFilePath(), "utf8")) as {
      projects?: Array<{ root?: unknown }>;
    };
    if (!Array.isArray(parsed.projects)) return [];
    return parsed.projects
      .map((project) => project.root)
      .filter((root): root is string => typeof root === "string" && path.isAbsolute(root.trim()))
      .map((root) => root.trim());
  } catch {
    return [];
  }
}

const ALLOWED_ROOTS = Array.from(
  new Set(
    [
      process.env.WORKSPACE_ROOT,
      process.env.NEXT_PUBLIC_WORKSPACE_ROOT,
      covenWorkspaceRoot(),
      // Allow openclaw workspace roots so the Library can read familiar research dirs
      process.env.OPENCLAW_WORKSPACE_ROOT,
      path.join(homedir(), ".openclaw", "workspace"),
      process.cwd(),
      ...savedCaveProjectRoots(),
    ]
      .filter((value): value is string => Boolean(value))
      .map(realpathOrResolve),
  ),
);

function isWithinRoot(candidate: string, root: string): boolean {
  return candidate === root || candidate.startsWith(root + path.sep);
}

function relativeWithinRoot(candidate: string, root: string): string | null {
  const relativePath = path.relative(root, candidate);
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
  for (const root of ALLOWED_ROOTS) {
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
  return subpath ? path.join(subpath.root, subpath.relativePath) : null;
}
