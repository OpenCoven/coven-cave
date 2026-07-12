import { mkdir, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { homedir } from "node:os";
import { writeJsonAtomic } from "./atomic-write.ts";
import type { CraftDraft } from "../craft-draft.ts";

const DRAFTS_DIR = "craft-drafts";

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
  return draft.schemaVersion === "opencoven.craft-draft.v1"
    && typeof draft.id === "string"
    && Boolean(draft.plugin?.draft)
    && draft.plugin.kind === "craft";
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
