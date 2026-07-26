import { mkdir, readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { homedir } from "node:os";
import { writeJsonAtomic } from "./atomic-write.ts";
import type { CraftDraft } from "../craft-draft.ts";

const DRAFTS_DIR = "craft-drafts";

/** Same shape the reader accepts as a draft filename stem. */
const DRAFT_ID_RE = /^[a-z0-9][a-z0-9.-]*$/;

export function isValidCraftDraftId(id: unknown): id is string {
  return typeof id === "string" && DRAFT_ID_RE.test(id);
}

export type CraftDraftStoreOptions = {
  covenHome?: string;
};

function covenHome(opts: CraftDraftStoreOptions = {}): string {
  return opts.covenHome ?? process.env.COVEN_HOME ?? path.join(homedir(), ".coven");
}

function draftDir(opts: CraftDraftStoreOptions = {}): string {
  return path.join(covenHome(opts), DRAFTS_DIR);
}

function draftPath(id: string, opts: CraftDraftStoreOptions = {}): string {
  return path.join(draftDir(opts), `${id}.json`);
}

function isCraftDraft(value: unknown): value is CraftDraft {
  if (!value || typeof value !== "object") return false;
  const draft = value as CraftDraft;
  const plugin = draft.plugin;
  const extraction = draft.extraction;
  const extractionRoles = extraction?.roles;
  return draft.schemaVersion === "opencoven.craft-draft.v1"
    && typeof draft.id === "string"
    && typeof plugin === "object"
    && plugin !== null
    && plugin.draft === true
    && plugin.kind === "craft"
    && plugin.id === draft.id
    && typeof plugin.draftId === "string"
    && plugin.draftId === draft.id
    && typeof plugin.displayName === "string"
    && plugin.displayName.trim().length > 0
    && typeof plugin.description === "string"
    && typeof extraction === "object"
    && extraction !== null
    && typeof extraction.familiar === "string"
    && extraction.familiar.trim().length > 0
    && typeof extraction.generatedAt === "string"
    && Array.isArray(extractionRoles)
    && extractionRoles.every((role) => (
      typeof role === "object"
      && role !== null
      && typeof role.id === "string"
      && role.id.trim().length > 0
      && typeof role.name === "string"
      && role.name.trim().length > 0
      && (role.description === undefined || typeof role.description === "string")
    ));
}

export async function readCraftDrafts(opts: CraftDraftStoreOptions = {}): Promise<CraftDraft[]> {
  let names: string[];
  try {
    names = await readdir(draftDir(opts));
  } catch {
    return [];
  }
  const drafts = await Promise.all(
    names
      .filter((name) => /^[a-z0-9][a-z0-9.-]*\.json$/.test(name))
      .map(async (name) => {
        try {
          const parsed = JSON.parse(await readFile(path.join(draftDir(opts), name), "utf8")) as unknown;
          return isCraftDraft(parsed) ? parsed : null;
        } catch {
          return null;
        }
      }),
  );
  return drafts
    .filter((draft): draft is CraftDraft => draft !== null)
    .sort((a, b) => a.plugin.displayName.localeCompare(b.plugin.displayName));
}

export async function saveCraftDraft(
  draft: CraftDraft,
  opts: CraftDraftStoreOptions = {},
): Promise<CraftDraft> {
  await mkdir(draftDir(opts), { recursive: true });
  await writeJsonAtomic(draftPath(draft.id, opts), draft);
  return draft;
}

/** Delete a local draft (the refine loop's recreate-and-replace, cave-46wg).
 *  The id is slug-guarded before any path is built; missing drafts are a
 *  quiet false, never a throw. */
export async function deleteCraftDraft(id: string, opts: CraftDraftStoreOptions = {}): Promise<boolean> {
  if (!isValidCraftDraftId(id)) return false;
  const target = draftPath(id, opts);
  const dir = path.resolve(draftDir(opts));
  const resolved = path.resolve(target);
  if (!resolved.startsWith(dir + path.sep) || path.dirname(resolved) !== dir) return false;
  try {
    await rm(resolved);
    return true;
  } catch {
    return false;
  }
}
