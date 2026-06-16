import { readFile } from "node:fs/promises";
import path from "node:path";
import { familiarWorkspace } from "@/lib/coven-paths";
import { isValidFamiliarId } from "@/lib/server/familiar-id";
import type { ContractFiles } from "@/lib/familiar-contract";

/**
 * Loader for a familiar's Familiar Contract files, used by
 * /api/familiars/[id]/contract to run the adherence check server-side.
 *
 * The only user-controlled input is the familiar `id`, which is interpolated
 * into a filesystem path via `familiarWorkspace(id)`. The id is constrained to
 * a strict slug allow-list (see `isValidFamiliarId`) that cannot contain a path
 * separator or `..`, so this can't become an arbitrary-directory-read
 * primitive. Callers MUST gate on `isValidFamiliarId` first; the loader
 * re-asserts it as an inline barrier.
 */
// Re-exported for back-compat with existing imports from this module.
export { isValidFamiliarId };

/** The four files the Familiar Contract validator inspects, by report key. */
const CONTRACT_FILE_NAMES: Record<keyof ContractFiles, string> = {
  soul: "SOUL.md",
  identity: "IDENTITY.md",
  ward: "ward.toml",
  memory: "MEMORY.md",
};

export type LoadedContractFiles = {
  workspace: string;
  files: ContractFiles;
};

/**
 * Read SOUL.md / IDENTITY.md / ward.toml / MEMORY.md from a familiar's
 * workspace. A missing file resolves to `null` (the validator treats `null` as
 * "absent"), so the route never errors just because a familiar hasn't authored
 * every file yet.
 */
export async function readFamiliarContractFiles(id: string): Promise<LoadedContractFiles> {
  if (!isValidFamiliarId(id)) {
    throw new Error("invalid familiar id");
  }
  const workspace = await familiarWorkspace(id);

  const readContractFile = async (name: string): Promise<string | null> => {
    try {
      return await readFile(path.join(workspace, name), "utf8");
    } catch {
      return null;
    }
  };

  const [soul, identity, ward, memory] = await Promise.all([
    readContractFile(CONTRACT_FILE_NAMES.soul),
    readContractFile(CONTRACT_FILE_NAMES.identity),
    readContractFile(CONTRACT_FILE_NAMES.ward),
    readContractFile(CONTRACT_FILE_NAMES.memory),
  ]);

  return { workspace, files: { soul, identity, ward, memory } };
}
