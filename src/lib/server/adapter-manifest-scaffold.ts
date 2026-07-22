import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  adapterManifestScaffoldForHarness,
  isLegacyWindowsHermesManifest,
} from "../harness-adapters.ts";
import { covenAdaptersDir, isManifestShadowedByBuiltin } from "./adapter-conflict-heal.ts";

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await stat(targetPath);
    return true;
  } catch {
    return false;
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

  const exists = await pathExists(manifestPath);
  const shouldRepair = exists && isLegacyWindowsHermesManifest(
    await readFile(manifestPath, "utf8"),
    platform,
  );
  if (!exists || shouldRepair) {
    await mkdir(adaptersDir, { recursive: true });
    await writeFile(manifestPath, scaffold.contents, "utf8");
    return true;
  }
  return false;
}
