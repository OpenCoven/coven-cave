import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

export const DEFAULT_FAMILIAR_IDS = ["sage", "echo", "charm", "astra", "cody", "kitty", "nova"];

export function covenHome(): string {
  return process.env.COVEN_HOME || path.join(homedir(), ".coven");
}

export function covenWorkspaceRoot(): string {
  return (
    process.env.COVEN_WORKSPACE_ROOT ||
    process.env.WORKSPACE_ROOT ||
    process.env.NEXT_PUBLIC_WORKSPACE_ROOT ||
    covenHome()
  );
}

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

export function parseFamiliarWorkspaces(raw: string): Map<string, string> {
  const workspaces = new Map<string, string>();
  const blocks = raw.split(/^\s*\[\[familiar\]\]\s*$/m).slice(1);
  for (const block of blocks) {
    const id = readTomlString(block, "id");
    const workspace = readTomlString(block, "workspace");
    if (!id || !workspace) continue;
    workspaces.set(id, path.resolve(expandHome(workspace)));
  }
  return workspaces;
}

export async function readFamiliarWorkspaces(): Promise<Map<string, string>> {
  try {
    const raw = await readFile(path.join(covenHome(), "familiars.toml"), "utf8");
    return parseFamiliarWorkspaces(raw);
  } catch {
    return new Map();
  }
}

export async function familiarWorkspace(familiarId: string): Promise<string> {
  const declared = await readFamiliarWorkspaces();
  return declared.get(familiarId) ?? path.join(covenHome(), "familiars", familiarId);
}

export async function familiarIds(): Promise<string[]> {
  const declared = await readFamiliarWorkspaces();
  return Array.from(new Set([...DEFAULT_FAMILIAR_IDS, ...declared.keys()]));
}
