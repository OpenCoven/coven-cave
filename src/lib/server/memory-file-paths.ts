import path from "node:path";
import { homedir } from "node:os";

const OPENCLAW_WORKSPACE_ROOT = path.join(homedir(), ".openclaw", "workspace");

const ALLOWED_ROOTS = [
  path.join(OPENCLAW_WORKSPACE_ROOT, "memory"),
  path.join(homedir(), ".coven", "memory"),
  path.join(OPENCLAW_WORKSPACE_ROOT, "MEMORY.md"),
];

function isWithinRoot(resolved: string, root: string): boolean {
  return resolved === root || resolved.startsWith(root + path.sep);
}

function isAllowedFamiliarMemoryPath(resolved: string): boolean {
  if (!isWithinRoot(resolved, OPENCLAW_WORKSPACE_ROOT)) return false;
  const rel = path.relative(OPENCLAW_WORKSPACE_ROOT, resolved);
  const parts = rel.split(path.sep);
  if (parts.length < 2 || parts[0] === ".." || parts[0] === "") return false;
  if (parts.length === 2 && parts[1] === "MEMORY.md") return true;
  return parts.length >= 3 && parts[1] === "memory";
}

export function isAllowedMemoryFilePath(fullPath: string): boolean {
  const resolved = path.resolve(fullPath);
  return (
    ALLOWED_ROOTS.some((root) => isWithinRoot(resolved, root)) ||
    isAllowedFamiliarMemoryPath(resolved)
  );
}
