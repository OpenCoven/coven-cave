import fs from "node:fs";
import path from "node:path";
import { homedir } from "node:os";
import { covenHome, familiarWorkspacesRoot } from "./coven-paths.ts";

export type FamiliarLibraryWorkspace = {
  id: string;
  name: string;
  icon: string;
  root: string;
};

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

function cleanIcon(value: string | null): string {
  return value?.startsWith("ph:") ? value : "ph:robot";
}

export function parseFamiliarLibraryWorkspaces(
  raw: string,
  options: { workspacesRoot?: string } = {},
): FamiliarLibraryWorkspace[] {
  const root = options.workspacesRoot ?? familiarWorkspacesRoot();
  const blocks = raw.split(/^\s*\[\[familiar\]\]\s*$/m).slice(1);
  return blocks.flatMap((block) => {
    const id = readTomlString(block, "id");
    if (!id) return [];
    const displayName = readTomlString(block, "display_name") ?? readTomlString(block, "name") ?? id;
    const workspace = readTomlString(block, "workspace");
    return [{
      id,
      name: displayName,
      icon: cleanIcon(readTomlString(block, "icon")),
      root: workspace ? path.resolve(expandHome(workspace)) : path.join(root, id),
    }];
  });
}

export function readFamiliarLibraryWorkspaces(): FamiliarLibraryWorkspace[] {
  try {
    const raw = fs.readFileSync(path.join(covenHome(), "familiars.toml"), "utf8");
    return parseFamiliarLibraryWorkspaces(raw);
  } catch {
    return [];
  }
}

export function researchRootFor(familiar: FamiliarLibraryWorkspace): string {
  return path.join(familiar.root, "research");
}
