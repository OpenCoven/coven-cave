import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { covenHome, familiarIds, familiarWorkspace } from "./coven-paths.ts";
import { parseRoleListField } from "./role-manifest.ts";

export type RoleFile = {
  id: string;
  familiar: string;
  path: string;
};

export function parseRoleFrontmatter(text: string): Record<string, string> {
  const fm: Record<string, string> = {};
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return fm;
  for (const line of match[1].split("\n")) {
    const m = line.match(/^(\w[\w-]*):\s+"?([^"]*)"?\s*$/);
    if (m) fm[m[1]] = m[2];
  }
  return fm;
}

async function roleDirs(root: string): Promise<string[]> {
  try {
    const entries = await readdir(root, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch {
    return [];
  }
}

async function addRoleFile(
  files: RoleFile[],
  seen: Set<string>,
  seenKeys: Set<string>,
  rolePath: string,
  fallback: { id: string; familiar: string },
) {
  try {
    await stat(rolePath);
  } catch {
    return;
  }

  const resolved = path.resolve(rolePath);
  if (seen.has(resolved)) return;
  seen.add(resolved);

  let id = fallback.id;
  let familiar = fallback.familiar;
  try {
    const text = await readFile(resolved, "utf8");
    const fm = parseRoleFrontmatter(text);
    id = fm.id ?? id;
    familiar = fm.familiar ?? familiar;
  } catch {
    // Keep the file discoverable with path-derived identifiers.
  }

  const key = `${familiar}:${id}`;
  if (seenKeys.has(key)) return;
  seenKeys.add(key);
  files.push({ id, familiar, path: resolved });
}

export async function discoverRoleFiles(): Promise<RoleFile[]> {
  const files: RoleFile[] = [];
  const seen = new Set<string>();
  const seenKeys = new Set<string>();

  for (const familiar of await familiarIds()) {
    const rolesDir = path.join(await familiarWorkspace(familiar), "roles");
    for (const roleName of await roleDirs(rolesDir)) {
      await addRoleFile(files, seen, seenKeys, path.join(rolesDir, roleName, "ROLE.md"), {
        id: roleName,
        familiar,
      });
    }
  }

  const globalRolesDir = path.join(covenHome(), "roles");
  for (const roleName of await roleDirs(globalRolesDir)) {
    await addRoleFile(files, seen, seenKeys, path.join(globalRolesDir, roleName, "ROLE.md"), {
      id: roleName,
      familiar: "global",
    });
  }

  const exportedFamiliarsDir = path.join(globalRolesDir, "familiars");
  for (const familiar of await roleDirs(exportedFamiliarsDir)) {
    const rolesDir = path.join(exportedFamiliarsDir, familiar);
    for (const roleName of await roleDirs(rolesDir)) {
      await addRoleFile(files, seen, seenKeys, path.join(rolesDir, roleName, "ROLE.md"), {
        id: roleName,
        familiar,
      });
    }
  }

  return files;
}

export async function listRoleWorkflowIds(): Promise<string[]> {
  const ids = new Set<string>();
  for (const role of await discoverRoleFiles()) {
    try {
      const text = await readFile(role.path, "utf8");
      for (const id of parseRoleListField(text, "workflows")) {
        ids.add(id);
      }
    } catch {
      // Ignore unreadable roles; role loading is best-effort.
    }
  }
  return [...ids].sort((a, b) => a.localeCompare(b));
}
