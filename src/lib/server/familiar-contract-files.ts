import { mkdir, readFile, writeFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { access } from "node:fs/promises";
import path from "node:path";
import { familiarWorkspace } from "@/lib/coven-paths";
import { isValidFamiliarId } from "@/lib/server/familiar-id";
import type { ContractFiles } from "@/lib/familiar-contract";
import {
  buildFamiliarContractFiles,
  type IdentityScaffoldInput,
} from "@/lib/familiar-identity-scaffold";

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

async function fileExists(p: string): Promise<boolean> {
  try {
    await access(p, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Scaffold a new familiar's Familiar Contract files (SOUL.md / IDENTITY.md /
 * ward.toml / MEMORY.md) into its workspace so it is contract-compliant from
 * birth. Purely ADDITIVE: a file that already exists is left untouched, so this
 * can never clobber identity a familiar (or its person) has already authored.
 *
 * The `id` is slug-guarded inline before any path is built. Returns the list of
 * files actually written (empty when they all already existed).
 */
export async function scaffoldFamiliarContractFiles(
  input: IdentityScaffoldInput,
): Promise<string[]> {
  // Pull the id into a guarded local before it touches the filesystem. The
  // barrier must gate the SAME value used to build the path — re-reading
  // `input.id` after the check defeats taint-tracking (CodeQL js/path-injection)
  // and mirrors the plain-string param the reader above uses.
  const id = input.id;
  if (!isValidFamiliarId(id)) {
    throw new Error("invalid familiar id");
  }
  const workspace = await familiarWorkspace(id);
  await mkdir(workspace, { recursive: true });

  const generated = buildFamiliarContractFiles(input);
  const byFile: Array<[string, string]> = [
    [CONTRACT_FILE_NAMES.soul, generated.soul],
    [CONTRACT_FILE_NAMES.identity, generated.identity],
    [CONTRACT_FILE_NAMES.ward, generated.ward],
    [CONTRACT_FILE_NAMES.memory, generated.memory],
  ];

  const wrote: string[] = [];
  for (const [name, contents] of byFile) {
    const target = path.join(workspace, path.basename(name));
    if (await fileExists(target)) continue;
    await writeFile(target, contents, "utf8");
    wrote.push(name);
  }
  return wrote;
}
