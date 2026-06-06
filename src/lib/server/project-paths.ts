import fs from "node:fs";
import path from "node:path";
import { covenWorkspaceRoot } from "@/lib/coven-paths";

function realpathOrResolve(value: string): string {
  const resolved = path.resolve(value);
  try {
    return fs.realpathSync(resolved);
  } catch {
    return resolved;
  }
}

const ALLOWED_ROOTS = Array.from(
  new Set(
    [
      process.env.WORKSPACE_ROOT,
      process.env.NEXT_PUBLIC_WORKSPACE_ROOT,
      covenWorkspaceRoot(),
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
  const candidate = realpathOrResolve(value);
  return ALLOWED_ROOTS.some((root) => isWithinRoot(candidate, root))
    ? candidate
    : null;
}
