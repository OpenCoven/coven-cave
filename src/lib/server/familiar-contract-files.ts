import { mkdir, readFile, writeFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { access } from "node:fs/promises";
import path from "node:path";
import { familiarWorkspace, familiarWorkspacesRoot } from "@/lib/coven-paths";
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
  // Keep declared-workspace lookup behavior while making the path barrier
  // recognizable to CodeQL. The slug guard rejects separators and dots;
  // basename is therefore behavior-preserving for every accepted id.
  const safeId = path.basename(id);
  const workspace = await familiarWorkspace(safeId);

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
  if (!isValidFamiliarId(input.id)) {
    throw new Error("invalid familiar id");
  }
  // Build the workspace path from a FIXED root plus a basename-sanitized id.
  // `path.basename` is the recognized js/path-injection sanitizer; combined with
  // the slug guard above it keeps the id from escaping the familiars root. A
  // brand-new familiar (the only caller — POST 409s on a dup id) has no declared
  // workspace, so this resolves to the same dir the reader/contract route use.
  const safeId = path.basename(input.id);
  const workspace = path.join(familiarWorkspacesRoot(), safeId);
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
