/**
 * Durable store for the Research desk's saved links (cave-avrt).
 *
 * One JSON file beside Cave's other local state. Links arrive from the chat
 * `/save` (alias `/link`) command or the desk's Links shelf, get categorized
 * and titled by the pure link-organizer, and are deduped on a normalized URL
 * so re-saving the same page refreshes nothing and creates nothing.
 */

import { randomUUID } from "node:crypto";
import { copyFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";

import {
  categorizeLink,
  deriveLinkTitle,
  LINK_CATEGORY_ORDER,
  normalizeLinkUrl,
  type LinkCategory,
  type SavedLink,
} from "../link-organizer.ts";
import { caveHome } from "../coven-paths.ts";
import { writeJsonAtomic } from "./atomic-write.ts";

export const MAX_SAVED_LINKS = 500;
export const MAX_LINKS_PER_SAVE = 50;

type ResearchLinksFile = {
  version: 1;
  links: SavedLink[];
};

export function researchLinksPath(): string {
  const override = process.env.CAVE_RESEARCH_LINKS_PATH_OVERRIDE?.trim();
  return override || path.join(caveHome(), "research-links.json");
}

function emptyFile(): ResearchLinksFile {
  return { version: 1, links: [] };
}

function normalizeStoredLink(value: unknown): SavedLink | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<SavedLink>;
  if (typeof raw.url !== "string" || !raw.url) return null;
  // Disk contents are user-editable: unknown categories would silently drop
  // out of the grouped shelves, and unparsable timestamps would scramble the
  // newest-first sort — re-derive both instead of trusting them.
  const category =
    typeof raw.category === "string" && LINK_CATEGORY_ORDER.includes(raw.category as LinkCategory)
      ? (raw.category as LinkCategory)
      : categorizeLink(raw.url);
  const addedAt =
    typeof raw.addedAt === "string" && Number.isFinite(Date.parse(raw.addedAt))
      ? raw.addedAt
      : new Date().toISOString();
  return {
    id: typeof raw.id === "string" && raw.id ? raw.id : randomUUID(),
    url: raw.url,
    category,
    title: typeof raw.title === "string" && raw.title ? raw.title : deriveLinkTitle(raw.url),
    addedAt,
    source: raw.source === "desk" ? "desk" : "chat",
  };
}

async function loadFile(): Promise<ResearchLinksFile> {
  let text: string;
  try {
    text = await readFile(researchLinksPath(), "utf8");
  } catch (error) {
    // Only a missing file means "empty store". Transient read failures
    // (EACCES/EMFILE/EIO) must surface — otherwise the next save would
    // read-modify-write an empty result and silently wipe every saved link.
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyFile();
    throw error;
  }
  let parsed: Partial<ResearchLinksFile>;
  try {
    parsed = JSON.parse(text) as Partial<ResearchLinksFile>;
  } catch {
    // Hand-edited into invalid JSON: preserve the malformed bytes beside the
    // store (preferences-store pattern) before any rewrite can replace them.
    await preserveMalformedFile();
    return emptyFile();
  }
  const links = Array.isArray(parsed?.links)
    ? parsed.links.map(normalizeStoredLink).filter((link): link is SavedLink => link !== null)
    : [];
  return { version: 1, links };
}

async function preserveMalformedFile(): Promise<void> {
  const source = researchLinksPath();
  const suffix = new Date().toISOString().replace(/[^0-9]/g, "");
  await copyFile(source, `${source}.corrupt-${suffix}`).catch(() => {});
}

async function saveFile(file: ResearchLinksFile): Promise<void> {
  const target = researchLinksPath();
  await mkdir(path.dirname(target), { recursive: true });
  await writeJsonAtomic(target, file);
}

let writeMutex: Promise<unknown> = Promise.resolve();
function withWriteMutex<T>(fn: () => Promise<T>): Promise<T> {
  const next = writeMutex.then(fn, fn);
  writeMutex = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

/** Newest first. */
export async function listSavedLinks(): Promise<SavedLink[]> {
  const file = await loadFile();
  return [...file.links].sort((a, b) => b.addedAt.localeCompare(a.addedAt));
}

export type SaveLinksResult = {
  added: SavedLink[];
  /** URLs skipped because an equivalent link is already saved. */
  duplicates: string[];
  /** Inputs that couldn't parse as http(s) URLs. */
  invalid: string[];
};

/** Save many at once — the desk shelf accepts a whole pasted block. */
export async function saveResearchLinks(
  rawUrls: string[],
  source: SavedLink["source"],
): Promise<SaveLinksResult> {
  return withWriteMutex(async () => {
    const file = await loadFile();
    const existing = new Set(file.links.map((link) => normalizeLinkUrl(link.url)));
    const added: SavedLink[] = [];
    const duplicates: string[] = [];
    const invalid: string[] = [];

    for (const raw of rawUrls.slice(0, MAX_LINKS_PER_SAVE)) {
      const trimmed = typeof raw === "string" ? raw.trim() : "";
      let parsed: URL;
      try {
        parsed = new URL(trimmed);
      } catch {
        if (trimmed) invalid.push(trimmed);
        continue;
      }
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        invalid.push(trimmed);
        continue;
      }
      const key = normalizeLinkUrl(trimmed);
      if (existing.has(key)) {
        duplicates.push(trimmed);
        continue;
      }
      existing.add(key);
      added.push({
        id: randomUUID(),
        url: trimmed,
        category: categorizeLink(trimmed),
        title: deriveLinkTitle(trimmed),
        addedAt: new Date().toISOString(),
        source,
      });
    }

    if (added.length > 0) {
      file.links = [...added, ...file.links].slice(0, MAX_SAVED_LINKS);
      await saveFile(file);
    }
    return { added, duplicates, invalid };
  });
}

/** Returns true when a link was actually removed. */
export async function removeSavedLink(id: string): Promise<boolean> {
  return withWriteMutex(async () => {
    const file = await loadFile();
    const next = file.links.filter((link) => link.id !== id);
    if (next.length === file.links.length) return false;
    file.links = next;
    await saveFile(file);
    return true;
  });
}
