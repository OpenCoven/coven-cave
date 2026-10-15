import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, rename, rm, lstat, readdir } from "node:fs/promises";
import path from "node:path";
import { caveHome } from "../coven-paths.ts";
import { ensureMarketplacePlugin } from "./marketplace-payload.ts";
import { writeFileAtomic } from "./atomic-write.ts";

/** Codex gets a command-local registry; existing user registrations are untouched. */
export async function prepareMarketplaceRegistry(pluginId?: string): Promise<string> {
  const manifest = await readFile(path.join(process.cwd(), "marketplace", "exports", "codex", "marketplace.json"), "utf8");
  const pins = await readFile(path.join(process.cwd(), "marketplace", "payloads.json"), "utf8");
  const revision = createHash("sha256").update(manifest).update(pins).digest("hex");
  const root = path.join(/* turbopackIgnore: true */ caveHome(), "marketplace", "registries", revision);
  await mkdir(path.join(root, ".claude-plugin"), { recursive: true, mode: 0o700 });
  await writeFileAtomic(path.join(root, ".claude-plugin", "marketplace.json"), manifest);
  if (pluginId) {
    const source = await ensureMarketplacePlugin(pluginId);
    const plugins = path.join(root, "plugins");
    await mkdir(plugins, { recursive: true, mode: 0o700 });
    const destination = path.join(plugins, path.basename(pluginId));
    let exists = false;
    try { exists = (await lstat(destination)).isDirectory(); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    if (exists) {
      async function compare(left: string, right: string): Promise<void> {
        const entries = await readdir(left, { withFileTypes: true });
        const actual = await readdir(right);
        if (entries.length !== actual.length) throw new Error("Marketplace registry cache is modified");
        for (const entry of entries) {
          const sourceFile = path.join(left, entry.name);
          const targetFile = path.join(right, entry.name);
          const info = await lstat(targetFile);
          if (entry.isDirectory() && info.isDirectory() && !info.isSymbolicLink()) await compare(sourceFile, targetFile);
          else if (!entry.isFile() || !info.isFile() || !(await readFile(sourceFile)).equals(await readFile(targetFile))) throw new Error("Marketplace registry cache is modified");
        }
      }
      await compare(source, destination);
    } else {
      const temporary = await mkdtemp(path.join(plugins, ".install-"));
      try {
        await cp(source, path.join(temporary, "payload"), { recursive: true, force: false, errorOnExist: true });
        try { await rename(path.join(temporary, "payload"), destination); }
        catch (error) { if (!["EEXIST", "ENOTEMPTY"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error; }
      } finally { await rm(temporary, { recursive: true, force: true }); }
    }
  }
  return root;
}

export function marketplaceRegistryOverrides(root: string): string[] {
  // JSON strings are valid TOML basic strings here; these are argv entries,
  // never shell interpolation.
  return [
    "-c", 'marketplaces.opencoven-first-party.source_type="local"',
    "-c", "marketplaces.opencoven-first-party.source=" + JSON.stringify(root),
  ];
}
