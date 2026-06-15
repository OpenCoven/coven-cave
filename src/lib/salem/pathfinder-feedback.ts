// Salem pathfinder feedback — LOCAL ONLY. Records which path the user picked,
// the mode, the registry version, whether they saved it to the Board, and an
// optional explicit correction note. Privacy (design §"Privacy And Logging"):
// nothing leaves the machine; only the whitelisted fields below are stored —
// arbitrary keys are dropped, so no project files/secrets/logs can leak in.
// These local traces can later seed a sanitized eval set after review.

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { covenHome } from "@/lib/coven-paths";
import { REGISTRY_VERSION } from "@/lib/salem/happy-paths";

export const FEEDBACK_PATH = path.join(covenHome(), "cave-salem-pathfinder.json");

export type SalemPathfinderFeedback = {
  pathId: string;
  mode: "setup" | "home";
  registryVersion: string;
  helpful?: boolean;
  savedToBoard?: boolean;
  correctionNote?: string;
  at: string;
};

/** Client-supplied fields. The store stamps registryVersion + at itself. */
export type SalemPathfinderFeedbackInput = {
  pathId?: string;
  mode?: string;
  helpful?: boolean;
  savedToBoard?: boolean;
  correctionNote?: string;
};

type FeedbackFile = { entries: SalemPathfinderFeedback[] };

/**
 * Keep ONLY the whitelisted fields (privacy). Returns null if there's no valid
 * path id. `at`/`registryVersion` are stamped here, never trusted from input.
 */
export function sanitizeFeedback(input: SalemPathfinderFeedbackInput, at: string): SalemPathfinderFeedback | null {
  if (!input || typeof input.pathId !== "string" || !input.pathId.trim()) return null;
  const fb: SalemPathfinderFeedback = {
    pathId: input.pathId.trim().slice(0, 120),
    mode: input.mode === "setup" ? "setup" : "home",
    registryVersion: REGISTRY_VERSION,
    at,
  };
  if (typeof input.helpful === "boolean") fb.helpful = input.helpful;
  if (typeof input.savedToBoard === "boolean") fb.savedToBoard = input.savedToBoard;
  if (typeof input.correctionNote === "string" && input.correctionNote.trim()) {
    fb.correctionNote = input.correctionNote.trim().slice(0, 500);
  }
  return fb;
}

export async function loadFeedback(): Promise<SalemPathfinderFeedback[]> {
  try {
    const raw = await readFile(FEEDBACK_PATH, "utf8");
    const parsed = JSON.parse(raw) as FeedbackFile;
    return Array.isArray(parsed.entries) ? parsed.entries : [];
  } catch {
    return [];
  }
}

let feedbackTmpCounter = 0;

/** Append one sanitized feedback entry. Returns the stored entry, or null if invalid. */
export async function recordFeedback(input: SalemPathfinderFeedbackInput): Promise<SalemPathfinderFeedback | null> {
  const entry = sanitizeFeedback(input, new Date().toISOString());
  if (!entry) return null;
  await mkdir(path.dirname(FEEDBACK_PATH), { recursive: true });
  const entries = await loadFeedback();
  entries.push(entry);
  const tmp = `${FEEDBACK_PATH}.${process.pid}.${feedbackTmpCounter++}.tmp`;
  await writeFile(tmp, JSON.stringify({ entries }, null, 2), "utf8");
  await rename(tmp, FEEDBACK_PATH);
  return entry;
}
