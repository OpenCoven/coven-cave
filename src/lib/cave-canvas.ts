// Persistence for Triage Canvas node positions.
//
// Positions live in their own file (`~/.coven/cave-canvas.json`) keyed by card
// id, deliberately separate from `cave-board.json`. The canvas is a *view* of
// the board's cards — keeping layout out of the Card schema means the board
// owner (and the many other sessions that mutate it) never has to know the
// canvas exists, and a canvas write can never clobber card data.

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { homedir } from "node:os";

import type { CanvasPosition, CanvasPositions } from "@/lib/canvas-layout";
import { sanitizeArtifacts, type CanvasArtifact } from "@/lib/canvas-artifacts";

const CANVAS_PATH = path.join(homedir(), ".coven", "cave-canvas.json");

export type CanvasFile = {
  version: number;
  positions: CanvasPositions;
  // Sketch-layer artifacts: ad-hoc generated UI examples. Their positions live
  // in the shared `positions` map (keyed by artifact id) like every other node.
  artifacts: CanvasArtifact[];
};

const EMPTY: CanvasFile = { version: 1, positions: {}, artifacts: [] };

/** Coerce an unknown value into a finite {x,y}, or null if unusable. */
function asPosition(value: unknown): CanvasPosition | null {
  if (!value || typeof value !== "object") return null;
  const { x, y } = value as { x?: unknown; y?: unknown };
  if (typeof x !== "number" || typeof y !== "number") return null;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x, y };
}

/** Sanitize a raw positions map, dropping any entry that isn't a finite point. */
export function sanitizePositions(raw: unknown): CanvasPositions {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: CanvasPositions = {};
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof id !== "string" || !id) continue;
    const pos = asPosition(value);
    if (pos) out[id] = pos;
  }
  return out;
}

async function ensureDir() {
  await mkdir(path.dirname(CANVAS_PATH), { recursive: true });
}

export async function loadCanvas(): Promise<CanvasFile> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(CANVAS_PATH, "utf8"));
  } catch {
    // Missing file or torn/invalid JSON — start from an empty layout. Nothing
    // is lost: positions are cosmetic and rebuild from the cards' statuses.
    return { ...EMPTY };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ...EMPTY };
  }
  const file = parsed as Partial<CanvasFile>;
  return {
    version: file.version ?? 1,
    positions: sanitizePositions(file.positions),
    artifacts: sanitizeArtifacts(file.artifacts),
  };
}

// Serialize writes: each mutation does load → merge → save, so without a lock
// two concurrent saves both read the same snapshot and the later one drops the
// earlier one's points. Same pattern as cave-board / cave-inbox.
let writeChain: Promise<unknown> = Promise.resolve();
function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const next = writeChain.then(fn, fn);
  writeChain = next.catch(() => undefined);
  return next;
}

let tmpCounter = 0;

export async function saveCanvas(file: CanvasFile): Promise<void> {
  await ensureDir();
  // Atomic write via temp-file + rename so a concurrent reader never observes a
  // half-written file (rename is atomic on POSIX).
  const tmp = `${CANVAS_PATH}.${process.pid}.${tmpCounter++}.tmp`;
  await writeFile(tmp, JSON.stringify(file, null, 2), "utf8");
  await rename(tmp, CANVAS_PATH);
}

/**
 * Merge the given positions over the stored layout. Callers send only the
 * nodes they moved; merging (rather than replacing) means a save from one
 * canvas view can't wipe positions another view hasn't echoed back yet.
 */
export async function mergeCanvasPositions(
  positions: CanvasPositions,
): Promise<CanvasFile> {
  const clean = sanitizePositions(positions);
  return withLock(async () => {
    const current = await loadCanvas();
    const merged: CanvasFile = {
      ...current,
      positions: { ...current.positions, ...clean },
    };
    await saveCanvas(merged);
    return merged;
  });
}

/**
 * Insert or replace an artifact by id, returning the updated file. The caller's
 * record is normalized through sanitizeArtifacts so a bad body can't corrupt
 * the store. `updatedAt` is the caller's responsibility (it has the clock).
 */
export async function upsertCanvasArtifact(artifact: CanvasArtifact): Promise<CanvasFile> {
  const [clean] = sanitizeArtifacts([artifact]);
  if (!clean) {
    // Nothing usable in the payload — return the current file unchanged.
    return withLock(loadCanvas);
  }
  return withLock(async () => {
    const current = await loadCanvas();
    const without = current.artifacts.filter((a) => a.id !== clean.id);
    const next: CanvasFile = { ...current, artifacts: [...without, clean] };
    await saveCanvas(next);
    return next;
  });
}

/** Remove an artifact (and its saved position) by id. */
export async function deleteCanvasArtifact(id: string): Promise<CanvasFile> {
  return withLock(async () => {
    const current = await loadCanvas();
    const positions = { ...current.positions };
    delete positions[id];
    const next: CanvasFile = {
      ...current,
      positions,
      artifacts: current.artifacts.filter((a) => a.id !== id),
    };
    await saveCanvas(next);
    return next;
  });
}

export type { CanvasArtifact } from "@/lib/canvas-artifacts";
