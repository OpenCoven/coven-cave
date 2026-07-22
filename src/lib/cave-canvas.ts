// Persistence for the Canvas store (`~/.coven/cave/canvas.json`): saved sketch
// artifacts plus their (legacy standalone-canvas) node positions. Kept separate
// from the board file so a canvas write can never clobber card data. Artifacts
// are user content with no undo — the load path must never let a bad read turn
// into an empty save that destroys them (see loadCanvas).

import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename } from "node:fs/promises";
import path from "node:path";
import { caveHome } from "./coven-paths.ts";
import { writeJsonAtomic } from "./server/atomic-write.ts";

import type { CanvasPosition, CanvasPositions } from "@/lib/canvas-layout";
import {
  sanitizeAnnotation,
  sanitizeArtifacts,
  type CanvasAnnotation,
  type CanvasArtifact,
} from "@/lib/canvas-artifacts";

const CANVAS_PATH = path.join(caveHome(), "canvas.json");

export type CanvasFile = {
  version: number;
  positions: CanvasPositions;
  // Sketch-layer artifacts: ad-hoc generated UI examples. Their positions live
  // in the shared `positions` map (keyed by artifact id) like every other node.
  artifacts: CanvasArtifact[];
};

const EMPTY: CanvasFile = { version: 1, positions: {}, artifacts: [] };

/** Coerce an unknown value into a finite {x,y[,width,height]}, or null if unusable. */
function asPosition(value: unknown): CanvasPosition | null {
  if (!value || typeof value !== "object") return null;
  const { x, y, width, height } = value as { x?: unknown; y?: unknown; width?: unknown; height?: unknown };
  if (typeof x !== "number" || typeof y !== "number") return null;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const out: CanvasPosition = { x, y };
  if (width !== undefined || height !== undefined) {
    if (typeof width !== "number" || typeof height !== "number") return null;
    if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
    out.width = width;
    out.height = height;
  }
  return out;
}

/** Sanitize a raw positions map, dropping any entry that isn't finite geometry. */
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
  let raw: string;
  try {
    raw = await readFile(CANVAS_PATH, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") {
      // No store yet — a fresh start, nothing to protect.
      return { ...EMPTY };
    }
    // The file exists but can't be read (permissions, IO). Treating that as
    // empty would let the next save overwrite sketches we merely failed to
    // read — surface the error instead; mutations abort, nothing is lost.
    throw err;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    // The file holds bytes that aren't a canvas store (torn write, foreign
    // content). This store now carries user sketches with no undo — reading
    // it as empty made the NEXT save silently destroy all of them. Move the
    // bad file aside (bytes preserved for recovery) and start fresh. The
    // timestamp is for humans; the random suffix keeps two corruption events
    // in the same millisecond from renaming onto the SAME aside path (rename
    // clobbers, so the second capture silently destroyed the first).
    const aside = `${CANVAS_PATH}.corrupt-${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;
    try {
      await rename(CANVAS_PATH, aside);
      console.error(`cave-canvas: unreadable store moved aside to ${aside}`);
    } catch {
      // Rename raced another writer (who may have just replaced the file
      // with a good one) or failed outright — leave the path alone either way.
    }
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

export async function saveCanvas(file: CanvasFile): Promise<void> {
  await ensureDir();
  await writeJsonAtomic(CANVAS_PATH, file);
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
    // Deep-merge per window so a position-only write (e.g. a drag that sends
    // just {x,y}) preserves the window's saved width/height instead of dropping
    // it and snapping the window back to its default size on reload.
    const mergedPositions = { ...current.positions };
    for (const [id, pos] of Object.entries(clean)) {
      mergedPositions[id] = { ...mergedPositions[id], ...pos };
    }
    const merged: CanvasFile = {
      ...current,
      positions: mergedPositions,
    };
    await saveCanvas(merged);
    return merged;
  });
}

/**
 * Insert or replace an artifact, returning the updated file plus the id the
 * record settled under. Callers replace by id; when the id is new but the
 * content is byte-identical to an existing sketch (same kind + code), the
 * existing record is updated in place instead — "Save to Canvas" mints a
 * fresh id per click, so id-only dedupe let unchanged re-saves pile up as
 * twin tiles. Keeping the incumbent's id also keeps its createdAt and saved
 * position. The caller's record is normalized through sanitizeArtifacts so a
 * bad body can't corrupt the store. Unguarded writes retain the caller's
 * `updatedAt`; guarded same-id revisions receive a monotonic server timestamp.
 */
export type CanvasArtifactUpsertResult =
  | { status: "invalid" }
  | { status: "saved"; file: CanvasFile; savedId: string | null; artifact: CanvasArtifact | null }
  | { status: "not_found"; file: CanvasFile; savedId: null }
  | { status: "conflict"; file: CanvasFile; savedId: null; currentUpdatedAt: string };

export type CanvasAnnotationResolutionToken = {
  id: string;
  updatedAt: string;
};

export function nextCanvasArtifactUpdatedAt(
  incumbentUpdatedAt: string,
  nowMs = Date.now(),
): string | null {
  const incumbentMs = Date.parse(incumbentUpdatedAt);
  const nextMs = Number.isFinite(incumbentMs) ? Math.max(nowMs, incumbentMs + 1) : nowMs;
  const next = new Date(nextMs);
  return Number.isFinite(next.getTime()) ? next.toISOString() : null;
}

function parseResolvedAnnotations(value: unknown): CanvasAnnotationResolutionToken[] | null {
  if (!Array.isArray(value) || value.length > 100) return null;
  const tokens: CanvasAnnotationResolutionToken[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
    const raw = entry as Record<string, unknown>;
    if (
      Object.keys(raw).length !== 2
      || !Object.prototype.hasOwnProperty.call(raw, "id")
      || !Object.prototype.hasOwnProperty.call(raw, "updatedAt")
      || typeof raw.id !== "string"
      || raw.id !== raw.id.trim()
      || !raw.id
      || raw.id.length > 200
      || typeof raw.updatedAt !== "string"
    ) return null;
    const parsed = Date.parse(raw.updatedAt);
    if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== raw.updatedAt) return null;
    tokens.push({ id: raw.id, updatedAt: raw.updatedAt });
  }
  return tokens;
}

export async function upsertCanvasArtifact(
  artifact: CanvasArtifact,
  options: {
    expectedUpdatedAt?: string;
    expectedAbsent?: boolean;
    resolvedAnnotations?: unknown;
  } = {},
): Promise<CanvasArtifactUpsertResult> {
  if (options.expectedUpdatedAt !== undefined && options.expectedAbsent) {
    return { status: "invalid" };
  }
  const guardedRevision = options.expectedUpdatedAt !== undefined || options.expectedAbsent === true;
  if (!guardedRevision && options.resolvedAnnotations !== undefined) {
    return { status: "invalid" };
  }
  const resolvedAnnotations = guardedRevision
    ? options.resolvedAnnotations === undefined
      ? []
      : parseResolvedAnnotations(options.resolvedAnnotations)
    : [];
  if (!resolvedAnnotations) return { status: "invalid" };
  const annotationsProvided = Object.prototype.hasOwnProperty.call(artifact, "annotations");
  const rawAnnotations = (artifact as { annotations?: unknown }).annotations;
  const [clean] = sanitizeArtifacts([artifact]);
  if (!clean) {
    // Nothing usable in the payload — return the current file unchanged.
    return withLock(async () => ({
      status: "saved",
      file: await loadCanvas(),
      savedId: null,
      artifact: null,
    }));
  }
  return withLock(async () => {
    const current = await loadCanvas();
    const incumbent = current.artifacts.find((a) => a.id === clean.id);
    const incumbentMatchesRevision = incumbent
      && incumbent.id === clean.id
      && incumbent.title === clean.title
      && incumbent.prompt === clean.prompt
      && incumbent.code === clean.code
      && incumbent.kind === clean.kind
      && incumbent.createdAt === clean.createdAt;
    if (options.expectedAbsent && incumbent) {
      if (incumbentMatchesRevision) {
        return {
          status: "saved",
          file: current,
          savedId: incumbent.id,
          artifact: incumbent,
        };
      }
      return {
        status: "conflict",
        file: current,
        savedId: null,
        currentUpdatedAt: incumbent.updatedAt,
      };
    }
    if (options.expectedUpdatedAt !== undefined) {
      if (!incumbent) return { status: "not_found", file: current, savedId: null };
      if (incumbent.updatedAt !== options.expectedUpdatedAt) {
        if (incumbentMatchesRevision) {
          return {
            status: "saved",
            file: current,
            savedId: incumbent.id,
            artifact: incumbent,
          };
        }
        return {
          status: "conflict",
          file: current,
          savedId: null,
          currentUpdatedAt: incumbent.updatedAt,
        };
      }
    }
    const without = current.artifacts.filter((a) => a.id !== clean.id);
    // An explicit update to an existing id is authoritative, even when its new
    // content happens to match another artifact. Content dedupe is only for
    // saves that arrive under a newly minted id.
    const twin = incumbent
      ? undefined
      : without.find((a) => a.kind === clean.kind && a.code === clean.code);
    let settled = twin
      ? {
          ...twin,
          title: clean.title,
          prompt: clean.prompt,
          updatedAt: clean.updatedAt,
        }
      : incumbent && !annotationsProvided && incumbent.annotations
        ? { ...clean, annotations: incumbent.annotations }
        : clean;
    if (guardedRevision && incumbent) {
      const nextUpdatedAt = nextCanvasArtifactUpdatedAt(incumbent.updatedAt);
      if (!nextUpdatedAt) {
        return {
          status: "conflict",
          file: current,
          savedId: null,
          currentUpdatedAt: incumbent.updatedAt,
        };
      }
      const remainingAnnotations = (incumbent.annotations ?? []).filter(
        (annotation) => !resolvedAnnotations.some(
          (token) => token.id === annotation.id && token.updatedAt === annotation.updatedAt,
        ),
      );
      settled = {
        ...clean,
        updatedAt: nextUpdatedAt,
      };
      if (remainingAnnotations.length > 0) settled.annotations = remainingAnnotations;
      else delete settled.annotations;
    }
    const existing = incumbent ?? twin;
    const preserveAnnotations = !annotationsProvided
      || !Array.isArray(rawAnnotations)
      || (rawAnnotations.length > 0 && !clean.annotations);
    if (!guardedRevision && existing?.annotations && preserveAnnotations) {
      settled.annotations = existing.annotations;
    } else if (!guardedRevision && twin && annotationsProvided) {
      if (clean.annotations) settled.annotations = clean.annotations;
      else delete settled.annotations;
    }
    const rest = twin ? without.filter((a) => a.id !== twin.id) : without;
    const next: CanvasFile = { ...current, artifacts: [...rest, settled] };
    await saveCanvas(next);
    return { status: "saved", file: next, savedId: settled.id, artifact: settled };
  });
}

export type CanvasAnnotationMutation =
  | {
      id: string;
      annotation: CanvasAnnotation;
      expectedAnnotationUpdatedAt?: string;
      expectedAnnotationAbsent?: true;
    }
  | { id: string; removeAnnotationId: string }
  | { id: string; clearAnnotations: true };

export type CanvasAnnotationMutationResult =
  | { status: "invalid" }
  | { status: "not_found"; file: CanvasFile }
  | { status: "conflict"; file: CanvasFile; currentUpdatedAt: string | null }
  | { status: "updated"; file: CanvasFile; artifact: CanvasArtifact };

function parseCanvasAnnotationMutation(value: unknown): CanvasAnnotationMutation | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const id = typeof raw.id === "string" ? raw.id.trim() : "";
  if (!id || id.length > 200) return null;

  const hasAnnotation = Object.prototype.hasOwnProperty.call(raw, "annotation");
  const hasRemove = Object.prototype.hasOwnProperty.call(raw, "removeAnnotationId");
  const hasClear = Object.prototype.hasOwnProperty.call(raw, "clearAnnotations");
  if (Number(hasAnnotation) + Number(hasRemove) + Number(hasClear) !== 1) return null;

  if (hasAnnotation) {
    if (Object.keys(raw).some((key) => ![
      "id",
      "annotation",
      "expectedAnnotationUpdatedAt",
      "expectedAnnotationAbsent",
    ].includes(key))) return null;
    const annotation = sanitizeAnnotation(raw.annotation);
    if (!annotation) return null;
    const expectedAnnotationUpdatedAt = raw.expectedAnnotationUpdatedAt;
    const expectedAnnotationAbsent = raw.expectedAnnotationAbsent;
    if (
      expectedAnnotationUpdatedAt !== undefined
      && (
        typeof expectedAnnotationUpdatedAt !== "string"
        || !Number.isFinite(Date.parse(expectedAnnotationUpdatedAt))
        || new Date(Date.parse(expectedAnnotationUpdatedAt)).toISOString() !== expectedAnnotationUpdatedAt
      )
    ) return null;
    if (expectedAnnotationAbsent !== undefined && expectedAnnotationAbsent !== true) return null;
    if (expectedAnnotationUpdatedAt !== undefined && expectedAnnotationAbsent === true) return null;
    return {
      id,
      annotation,
      ...(expectedAnnotationUpdatedAt !== undefined ? { expectedAnnotationUpdatedAt } : {}),
      ...(expectedAnnotationAbsent === true ? { expectedAnnotationAbsent: true as const } : {}),
    };
  }
  if (hasRemove) {
    if (Object.keys(raw).some((key) => key !== "id" && key !== "removeAnnotationId")) return null;
    const removeAnnotationId = typeof raw.removeAnnotationId === "string"
      ? raw.removeAnnotationId.trim()
      : "";
    if (!removeAnnotationId || removeAnnotationId.length > 200) return null;
    return { id, removeAnnotationId };
  }
  if (
    raw.clearAnnotations !== true
    || Object.keys(raw).some((key) => key !== "id" && key !== "clearAnnotations")
  ) {
    return null;
  }
  return { id, clearAnnotations: true };
}

/**
 * Apply one bounded annotation operation to the current stored artifact.
 * Loading and merging happen inside the Canvas write lock, so this path can
 * never replay a stale client copy of artifact code or metadata.
 */
export async function mutateCanvasArtifactAnnotation(
  value: unknown,
): Promise<CanvasAnnotationMutationResult> {
  const mutation = parseCanvasAnnotationMutation(value);
  if (!mutation) return { status: "invalid" };

  return withLock(async () => {
    const current = await loadCanvas();
    const index = current.artifacts.findIndex((artifact) => artifact.id === mutation.id);
    if (index === -1) return { status: "not_found", file: current };

    const incumbent = current.artifacts[index];
    let annotations = incumbent.annotations ?? [];
    if ("annotation" in mutation) {
      const matchingIndex = annotations.findIndex(
        (annotation) => (
          annotation.id === mutation.annotation.id
          || annotation.target.selector === mutation.annotation.target.selector
        ),
      );
      if (mutation.expectedAnnotationAbsent && matchingIndex >= 0) {
        return {
          status: "conflict",
          file: current,
          currentUpdatedAt: annotations[matchingIndex].updatedAt,
        };
      }
      if (
        mutation.expectedAnnotationUpdatedAt !== undefined
        && (
          matchingIndex < 0
          || annotations[matchingIndex].updatedAt !== mutation.expectedAnnotationUpdatedAt
        )
      ) {
        return {
          status: "conflict",
          file: current,
          currentUpdatedAt: matchingIndex >= 0 ? annotations[matchingIndex].updatedAt : null,
        };
      }
      if (matchingIndex >= 0) {
        annotations = annotations.slice();
        annotations[matchingIndex] = mutation.annotation;
      } else if (annotations.length < 100) {
        annotations = [...annotations, mutation.annotation];
      }
    } else if ("removeAnnotationId" in mutation) {
      annotations = annotations.filter((annotation) => annotation.id !== mutation.removeAnnotationId);
    } else {
      annotations = [];
    }

    const artifact: CanvasArtifact = {
      ...incumbent,
      ...(annotations.length > 0 ? { annotations } : {}),
    };
    if (annotations.length === 0) delete artifact.annotations;
    const artifacts = current.artifacts.slice();
    artifacts[index] = artifact;
    const file: CanvasFile = { ...current, artifacts };
    await saveCanvas(file);
    return { status: "updated", file, artifact };
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
