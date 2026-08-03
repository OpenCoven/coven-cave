/**
 * `/auto` mission feedback store — the completion questionnaire (rating +
 * liked/disliked/freeform) that lets a familiar "learn" a human's preferences
 * across successive /auto missions. Stored per-familiar at
 * `<caveHome>/auto-mode-preferences.json` (same atomic-write convention as
 * cave-inbox.ts). A rolling digest of recent liked/disliked notes is folded
 * back into the next mission's directive (buildAutoModeDirective).
 */

import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { caveHome } from "./coven-paths.ts";
import { writeJsonAtomic } from "./server/atomic-write.ts";

const STORE_PATH = path.join(caveHome(), "auto-mode-preferences.json");

/** Entries kept per familiar — enough history for a digest without unbounded growth. */
const MAX_ENTRIES_PER_FAMILIAR = 50;
/** Most-recent entries folded into the digest string handed back to the model. */
const DIGEST_ENTRY_LIMIT = 12;

export type AutoMissionFeedback = {
  id: string;
  mission: string;
  /** 1-5 star rating of the final response. */
  rating: number;
  liked?: string;
  disliked?: string;
  freeform?: string;
  createdAt: string;
};

type StoreFile = {
  version: number;
  byFamiliar: Record<string, AutoMissionFeedback[]>;
};

async function ensureDir() {
  await mkdir(path.dirname(STORE_PATH), { recursive: true });
}

async function loadStore(): Promise<StoreFile> {
  try {
    const raw = await readFile(STORE_PATH, "utf8");
    const parsed = JSON.parse(raw) as Partial<StoreFile>;
    return { version: parsed.version ?? 1, byFamiliar: parsed.byFamiliar ?? {} };
  } catch {
    return { version: 1, byFamiliar: {} };
  }
}

async function saveStore(file: StoreFile): Promise<void> {
  await ensureDir();
  await writeJsonAtomic(STORE_PATH, file);
}

export type NewFeedbackInput = {
  familiarId: string;
  mission: string;
  rating: number;
  liked?: string;
  disliked?: string;
  freeform?: string;
};

export async function recordMissionFeedback(input: NewFeedbackInput): Promise<AutoMissionFeedback> {
  const file = await loadStore();
  const entry: AutoMissionFeedback = {
    id: crypto.randomUUID(),
    mission: input.mission.trim().slice(0, 500),
    rating: Math.min(5, Math.max(1, Math.round(input.rating))),
    liked: input.liked?.trim().slice(0, 1000) || undefined,
    disliked: input.disliked?.trim().slice(0, 1000) || undefined,
    freeform: input.freeform?.trim().slice(0, 1000) || undefined,
    createdAt: new Date().toISOString(),
  };
  const existing = file.byFamiliar[input.familiarId] ?? [];
  const next = [...existing, entry].slice(-MAX_ENTRIES_PER_FAMILIAR);
  file.byFamiliar[input.familiarId] = next;
  await saveStore(file);
  return entry;
}

export async function getMissionFeedback(familiarId: string): Promise<AutoMissionFeedback[]> {
  const file = await loadStore();
  return file.byFamiliar[familiarId] ?? [];
}

/**
 * Build a short natural-language digest of recent liked/disliked notes for a
 * familiar, folded into the next mission's directive. Deliberately simple
 * (no summarization model) — the most recent entries speak for themselves and
 * a human can always correct course again via the next questionnaire.
 */
export function buildPreferenceDigest(entries: AutoMissionFeedback[]): string {
  const recent = entries.slice(-DIGEST_ENTRY_LIMIT);
  if (recent.length === 0) return "";
  const lines: string[] = [];
  for (const e of recent) {
    const bits: string[] = [`rated ${e.rating}/5`];
    if (e.liked) bits.push(`liked: ${e.liked}`);
    if (e.disliked) bits.push(`disliked: ${e.disliked}`);
    if (e.freeform) bits.push(`note: ${e.freeform}`);
    lines.push(`- "${e.mission}" — ${bits.join("; ")}`);
  }
  return lines.join("\n");
}

export { STORE_PATH as AUTO_MODE_PREFERENCES_PATH };
