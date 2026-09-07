import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { marketplacePluginsRoot } from "./knowledge-packs.ts";

const SAFE_PLUGIN_ID = /^[a-z0-9][a-z0-9._-]{0,79}$/i;

type BundledPluginOptions = {
  pluginsRoot?: string;
};

function isInside(candidate: string, root: string): boolean {
  const relative = path.relative(root, candidate);
  return relative !== "" &&
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative);
}

function isSkillOnlyManifest(value: unknown, expectedName: string): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const manifest = value as Record<string, unknown>;
  if (manifest.name !== expectedName) return false;
  if (["agents", "hooks", "mcpServers"].some((key) => key in manifest)) return false;
  const skills = Array.isArray(manifest.skills) ? manifest.skills : [manifest.skills];
  return skills.length > 0 &&
    skills.every((entry) => entry === "skills/" || entry === "./skills/");
}

/**
 * Resolve app-bundled, skill-only Copilot plugins without trusting a familiar
 * workspace's writable plugin manifest. Invalid or missing bundles are omitted
 * so chat remains available without silently loading hooks, agents, or MCPs.
 *
 * The result is memoized per process because the bundled plugins are part of
 * the packaged app and immutable for a process lifetime (they change only on
 * app update/restart, which reloads this module). The chat send route calls
 * this on every Copilot turn to assemble the `--plugin-dir` startup args, so
 * without the cache each turn repeats realpath/stat/readFile work for startup
 * context that cannot have changed.
 */
async function resolveUncached(
  pluginIds: readonly string[],
  requestedRoot: string,
): Promise<string[]> {
  let root: string;
  try {
    root = await realpath(requestedRoot);
    if (!(await stat(root)).isDirectory()) return [];
  } catch {
    return [];
  }

  const resolved: string[] = [];
  for (const id of pluginIds) {
    if (!SAFE_PLUGIN_ID.test(id)) continue;
    try {
      const pluginDir = await realpath(path.join(root, id));
      if (!isInside(pluginDir, root) || !(await stat(pluginDir)).isDirectory()) continue;
      const manifest = JSON.parse(await readFile(path.join(pluginDir, "plugin.json"), "utf8"));
      if (!isSkillOnlyManifest(manifest, id)) continue;
      resolved.push(pluginDir);
    } catch {
      // Missing, malformed, or escaping bundles provide no runtime capability.
    }
  }
  return resolved;
}

const resolvedCache = new Map<string, string[]>();

/** Test seam: reset the process-local bundled plugin resolution cache. */
export function clearBundledCopilotPluginDirsCache(): void {
  resolvedCache.clear();
}

export async function resolveBundledCopilotPluginDirs(
  pluginIds: readonly string[] = ["coven-memory"],
  options: BundledPluginOptions = {},
): Promise<string[]> {
  const requestedRoot = options.pluginsRoot ?? marketplacePluginsRoot();
  const cacheKey = `${requestedRoot}\u0000${pluginIds.join("\u0000")}`;
  const cached = resolvedCache.get(cacheKey);
  if (cached) return [...cached];
  const resolved = await resolveUncached(pluginIds, requestedRoot);
  resolvedCache.set(cacheKey, resolved);
  return [...resolved];
}
