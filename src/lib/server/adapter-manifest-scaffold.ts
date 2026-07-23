import { lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  adapterManifestScaffoldForHarness,
  isLegacyWindowsHermesManifest,
} from "../harness-adapters.ts";
import { covenAdaptersDir, isManifestShadowedByBuiltin } from "./adapter-conflict-heal.ts";

type ManifestPathKind = "missing" | "file" | "other";

async function manifestPathKind(targetPath: string): Promise<ManifestPathKind> {
  try {
    return (await lstat(targetPath)).isFile() ? "file" : "other";
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "missing";
    throw error;
  }
}

/**
 * Ensure Cave's trusted adapter scaffold exists. On Windows this also repairs
 * only the previous Hermes shim manifest, whose executable can never spawn
 * there. User-authored manifests are deliberately left untouched.
 */
export async function ensureAdapterManifestScaffold(
  harness: string,
  options: { adaptersDir?: string; platform?: NodeJS.Platform } = {},
): Promise<boolean> {
  const platform = options.platform ?? process.platform;
  const scaffold = adapterManifestScaffoldForHarness(harness, platform);
  if (!scaffold) return false;

  const adaptersDir = options.adaptersDir ?? covenAdaptersDir();
  const manifestPath = path.join(adaptersDir, scaffold.filename);
  if (await isManifestShadowedByBuiltin(manifestPath)) return false;

  // A directory or symlink is an intentional user-owned setup, not a Cave
  // scaffold. Do not follow it or replace its target while repairing Hermes.
  const kind = await manifestPathKind(manifestPath);
  if (kind === "other") return false;

  const shouldRepair = kind === "file" && isLegacyWindowsHermesManifest(
    await readFile(manifestPath, "utf8"),
    platform,
  );
  if (kind === "missing" || shouldRepair) {
    await mkdir(adaptersDir, { recursive: true });
    await writeFile(manifestPath, scaffold.contents, "utf8");
    return true;
  }
  return false;
}
