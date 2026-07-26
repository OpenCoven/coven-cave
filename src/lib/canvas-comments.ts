import type {
  CanvasAnnotation,
  CanvasComponentTarget,
} from "./canvas-artifacts.ts";
import { sanitizeCanvasComponentTarget } from "./canvas-artifacts.ts";

const MAX_ANNOTATIONS = 100;
const ANNOTATION_NOTE_CHARS = 4_000;

export type CanvasAnnotationResolutionToken = {
  id: string;
  updatedAt: string;
};

function isNormalizedTimestamp(value: string): boolean {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

export function buildCanvasCommentsRequest(annotations: CanvasAnnotation[]): {
  prompt: string;
  resolvedAnnotations: CanvasAnnotationResolutionToken[];
} {
  const usable = annotations.slice(0, MAX_ANNOTATIONS).flatMap((annotation) => {
    const note = annotation.note.trim().slice(0, ANNOTATION_NOTE_CHARS);
    const target = sanitizeCanvasComponentTarget(annotation.target);
    const id = annotation.id.trim();
    if (
      !note
      || !target
      || !id
      || id.length > 200
      || !isNormalizedTimestamp(annotation.updatedAt)
    ) return [];
    return [{
      id,
      updatedAt: annotation.updatedAt,
      ...target,
      note,
    }];
  });
  if (usable.length === 0) return { prompt: "", resolvedAnnotations: [] };

  const comments = usable.map((annotation, index) => [
    `${index + 1}. Target: ${annotation.label || "Unlabelled component"}`,
    `Selector: ${annotation.selector}`,
    `Excerpt: ${annotation.excerpt}`,
    `Requested change: ${annotation.note}`,
  ].join("\n"));

  return {
    prompt: [
      `Apply these ${usable.length} component comment${usable.length === 1 ? "" : "s"} to the artifact:`,
      "",
      ...comments.flatMap((comment) => [comment, ""]),
      "Return the full revised artifact, not a diff.",
      "Preserve unrelated behavior, content, styling, and interactions.",
    ].join("\n").trim(),
    resolvedAnnotations: usable.map(({ id, updatedAt }) => ({ id, updatedAt })),
  };
}

export function buildCanvasCommentsPrompt(annotations: CanvasAnnotation[]): string {
  return buildCanvasCommentsRequest(annotations).prompt;
}

export function upsertCanvasAnnotationDraft(
  annotations: CanvasAnnotation[],
  target: CanvasComponentTarget,
  options: { id: string; now: string },
): CanvasAnnotation[] {
  const bounded = annotations.length > MAX_ANNOTATIONS
    ? annotations.slice(0, MAX_ANNOTATIONS)
    : annotations;
  const sanitizedTarget = sanitizeCanvasComponentTarget(target);
  if (!sanitizedTarget) return bounded;
  const index = bounded.findIndex(
    (annotation) => sanitizeCanvasComponentTarget(annotation.target)?.selector === sanitizedTarget.selector,
  );
  if (index === -1) {
    if (bounded.length === MAX_ANNOTATIONS) return bounded;
    return [...bounded, {
      id: options.id,
      target: sanitizedTarget,
      note: "",
      createdAt: options.now,
      updatedAt: options.now,
    }];
  }
  const existing = bounded[index];
  const next = bounded.slice();
  next[index] = {
    ...existing,
    target: sanitizedTarget,
    updatedAt: options.now,
  };
  return next;
}

export function replaceCanvasAnnotationNote(
  annotations: CanvasAnnotation[],
  id: string,
  note: string,
  now: string,
): CanvasAnnotation[] {
  const index = annotations.findIndex((annotation) => annotation.id === id);
  if (index === -1) return annotations;
  const next = annotations.slice();
  next[index] = {
    ...annotations[index],
    note: note.slice(0, ANNOTATION_NOTE_CHARS),
    updatedAt: now,
  };
  return next;
}

export function removeCanvasAnnotationDraft(
  annotations: CanvasAnnotation[],
  id: string,
): CanvasAnnotation[] {
  const index = annotations.findIndex((annotation) => annotation.id === id);
  if (index === -1) return annotations;
  return annotations.filter((annotation) => annotation.id !== id);
}
