import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import {
  adapterManifestScaffoldForHarness,
  isLegacyWindowsHermesManifest,
} from "@/lib/harness-adapters";
import { isManifestShadowedByBuiltin } from "./adapter-conflict-heal";

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
export async function ensureAdapterManifestScaffold(harness: string): Promise<boolean> {
  const scaffold = adapterManifestScaffoldForHarness(harness);
  if (!scaffold) return false;

  const adaptersDir = path.join(homedir(), ".coven", "adapters");
  const manifestPath = path.join(adaptersDir, scaffold.filename);
  if (await isManifestShadowedByBuiltin(manifestPath)) return false;

  const exists = await pathExists(manifestPath);
  const shouldRepair = exists && isLegacyWindowsHermesManifest(await readFile(manifestPath, "utf8"));
  if (!exists || shouldRepair) {
    await mkdir(adaptersDir, { recursive: true });
    await writeFile(manifestPath, scaffold.contents, "utf8");
    return true;
  }
  return false;
}
