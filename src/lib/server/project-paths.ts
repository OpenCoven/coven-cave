import fs from "node:fs";
import path from "node:path";
import { homedir } from "node:os";
import { covenWorkspaceRoot } from "@/lib/coven-paths";

function realpathOrResolve(value: string): string {
  const resolved = path.resolve(value);
  try {
    return fs.realpathSync(resolved);
  } catch {
    return resolved;
  }
}

function normalizeRelativeProjectPath(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed || path.isAbsolute(trimmed)) {
    return null;
  }
  return trimmed.replace(/^[\\/]+/, "");
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
    ]
      .filter((value): value is string => Boolean(value))
      .map(realpathOrResolve),
  ),
);

function isWithinRoot(candidate: string, root: string): boolean {
  return candidate === root || candidate.startsWith(root + path.sep);
}

export function resolveAllowedProjectPath(value: string): string | null {
  const relativePath = normalizeRelativeProjectPath(value);
  if (!relativePath) {
    return null;
  }

  for (const root of ALLOWED_ROOTS) {
    const candidate = realpathOrResolve(path.join(root, relativePath));
    if (isWithinRoot(candidate, root)) {
      return candidate;
    }
  }

  return null;
}
