/**
 * Durable store + extractive drafting for Research Studio generations.
 *
 * One JSON file per familiar under ~/.coven/…/research-generations/. Drafting
 * is synchronous and strictly extractive: content is derived from the source
 * mission's primary-lineage artifact (newest published, else working; falling
 * back to the mission's newest published/working markdown artifact when no
 * primary-lineage ref exists — see pickGenerationSourceArtifact) plus the
 * mission's own phase/step structure. Every content string either comes from
 * the artifact/mission fields verbatim or is pure structure/provenance
 * boilerplate ("graph TD", slide numbering, "1/4" thread markers, the blog
 * and thread provenance lines naming the artifact and run) — no facts are
 * invented.
 *
 * The optional `directions` field is stored verbatim on the record so the UI
 * can display it and a future generation pipeline can consume it, but it is
 * deliberately NEVER read by any drafting function below: mechanical
 * extraction cannot take editorial direction without inventing emphasis, so
 * directions are forwarded, not interpreted.
 */

import { randomUUID } from "node:crypto";
import {
  copyFile,
  mkdir,
  readFile,
  readdir,
} from "node:fs/promises";
import path from "node:path";

import {
  isResearchGenerationContent,
  isResearchGenerationCreatableKind,
  isResearchGenerationMediaKind,
  isResearchGenerationProgress,
  isResearchGenerationStage,
  isResearchGenerationStatusForKind,
  isValidResearchGenerationFamiliarId,
  RESEARCH_GENERATION_DIRECTIONS_MAX_LENGTH,
  RESEARCH_MEDIA_LENGTH_LIMITS,
  RESEARCH_THREAD_POST_MAX_CHARS,
  validateResearchMediaRenderConfig,
  type CreateResearchGenerationInput,
  type ResearchGeneration,
  type ResearchGenerationContent,
  type ResearchGenerationMediaFileRef,
  type ResearchGenerationProgress,
  type ResearchGenerationScriptSegment,
  type ResearchGenerationStatus,
  type ResearchGenerationStage,
  type ResearchGenerationKind,
  type ResearchGenerationSlide,
  type ResearchGenerationStat,
  type ResearchGenerationStoryboardScene,
  type ResearchGenerationThreadPost,
  type ResearchGenerationVideoChapter,
  type ResearchMediaLength,
  type ResearchMediaRenderConfig,
  type ResearchPodcastSpeaker,
  type ResearchPodcastStyle,
} from "../research-generations.ts";
import { LOCAL_TTS_MAX_CHARS } from "../voice/local-tts.ts";
import type { ResearchArtifactRef, ResearchMission } from "../research-missions.ts";
import { caveHome } from "../coven-paths.ts";
import { writeJsonAtomic } from "./atomic-write.ts";
import { corruptAsidePath } from "./corrupt-aside.ts";
import { acquireProcessIntentLock } from "./process-intent-lock.ts";
import {
  loadResearchMission,
  isResearchFileIntegrityError,
  readValidatedMissionFile,
} from "./research-mission-store.ts";

export const MAX_RESEARCH_GENERATIONS = 200;

type ResearchGenerationsFile = {
  version: 2;
  generations: ResearchGeneration[];
};

export function researchGenerationsRoot(): string {
  return (
    process.env.COVEN_RESEARCH_GENERATIONS_DIR?.trim() ||
    // Generation records are runtime user data beneath Cave home, never build inputs.
    path.join(/* turbopackIgnore: true */ caveHome(), "research-generations")
  );
}

function assertFamiliarId(familiarId: string): void {
  // The familiar id becomes a filename — the shared validator plus a basename
  // check keeps traversal sequences out of the store directory.
  if (
    !isValidResearchGenerationFamiliarId(familiarId) ||
    path.basename(familiarId) !== familiarId
  ) {
    throw new Error("invalid familiar id");
  }
}

export function researchGenerationsPath(familiarId: string): string {
  assertFamiliarId(familiarId);
  return path.join(
    /* turbopackIgnore: true */ researchGenerationsRoot(),
    `${familiarId}.json`,
  );
}

function emptyFile(): ResearchGenerationsFile {
  return { version: 2, generations: [] };
}

function normalizeStoredGeneration(
  value: unknown,
  familiarId: string,
): ResearchGeneration | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Partial<ResearchGeneration>;
  // Disk contents are user-editable: entries that lost their kind/status/content
  // shape would render as blank cards or crash the viewer — drop them instead
  // of trusting them.
  if (typeof raw.id !== "string" || !raw.id) return null;
  if (!isResearchGenerationCreatableKind(raw.kind)) return null;
  if (!isResearchGenerationStatusForKind(raw.kind, raw.status)) return null;
  if (typeof raw.sourceMissionId !== "string" || !raw.sourceMissionId) return null;
  let content = raw.content;
  // Pre-contract WIP represented long video as one flat storyboard. Preserve
  // those local drafts as one reviewable chapter while normalizing the stored
  // shape; newly created long video records always use explicit H2 chapters.
  if (
    raw.kind === "long-video" &&
    content &&
    typeof content === "object" &&
    !Array.isArray(content) &&
    (content as { kind?: unknown }).kind === "long-video" &&
    Array.isArray((content as { storyboard?: unknown }).storyboard)
  ) {
    const legacy = content as {
      storyboard: ResearchGenerationStoryboardScene[];
      video?: ResearchGenerationMediaFileRef;
    };
    content = {
      kind: "long-video",
      chapters: [
        {
          id: "chapter-1",
          title: raw.sourceTitle || "Imported chapter",
          scenes: legacy.storyboard,
        },
      ],
      ...("video" in legacy ? { video: legacy.video } : {}),
    } as ResearchGenerationContent;
  }
  if (content !== undefined) {
    if (!isResearchGenerationContent(content) || content.kind !== raw.kind) return null;
  }
  if (raw.status === "ready" && content === undefined) return null;
  const renderConfig =
    raw.renderConfig === undefined
      ? undefined
      : validateResearchMediaRenderConfig(raw.kind, raw.renderConfig);
  if (renderConfig && !renderConfig.ok) return null;
  if (raw.progress !== undefined && !isResearchGenerationProgress(raw.progress)) return null;
  const timestamp = (candidate: unknown): string =>
    typeof candidate === "string" && Number.isFinite(Date.parse(candidate))
      ? candidate
      : new Date().toISOString();
  return {
    // v1 rows are terminal extractive records. Read-time normalization makes
    // them v2 records without rewriting user data until the next save.
    version: 2,
    id: raw.id,
    familiarId,
    kind: raw.kind,
    sourceMissionId: raw.sourceMissionId,
    sourceTitle: typeof raw.sourceTitle === "string" ? raw.sourceTitle : raw.sourceMissionId,
    ...(typeof raw.sourceArtifactKey === "string" && raw.sourceArtifactKey
      ? { sourceArtifactKey: raw.sourceArtifactKey }
      : {}),
    ...(typeof raw.directions === "string" && raw.directions
      ? { directions: raw.directions.slice(0, RESEARCH_GENERATION_DIRECTIONS_MAX_LENGTH) }
      : {}),
    status: raw.status,
    ...(renderConfig?.ok ? { renderConfig: renderConfig.value } : {}),
    ...(isResearchGenerationStage(raw.stage) ? { stage: raw.stage } : {}),
    ...(isResearchGenerationProgress(raw.progress) ? { progress: raw.progress } : {}),
    createdAt: timestamp(raw.createdAt),
    updatedAt: timestamp(raw.updatedAt),
    ...(content !== undefined ? { content } : {}),
    ...(typeof raw.error === "string" && raw.error ? { error: raw.error } : {}),
  };
}

async function loadFile(familiarId: string): Promise<ResearchGenerationsFile> {
  let text: string;
  try {
    text = await readFile(/* turbopackIgnore: true */ researchGenerationsPath(familiarId), "utf8");
  } catch (error) {
    // Only a missing file means "empty store". Transient read failures
    // (EACCES/EMFILE/EIO) must surface — otherwise the next create would
    // read-modify-write an empty result and silently wipe every generation.
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyFile();
    throw error;
  }
  let parsed: Partial<ResearchGenerationsFile>;
  try {
    parsed = JSON.parse(text) as Partial<ResearchGenerationsFile>;
  } catch {
    // Hand-edited into invalid JSON: preserve the malformed bytes beside the
    // store (research-links pattern) before any rewrite can replace them.
    await preserveMalformedFile(familiarId);
    return emptyFile();
  }
  const generations = Array.isArray(parsed?.generations)
    ? parsed.generations
        .map((entry) => normalizeStoredGeneration(entry, familiarId))
        .filter((entry): entry is ResearchGeneration => entry !== null)
    : [];
  return { version: 2, generations };
}

async function preserveMalformedFile(familiarId: string): Promise<void> {
  const source = researchGenerationsPath(familiarId);
  await copyFile(/* turbopackIgnore: true */ source, corruptAsidePath(source)).catch(() => {});
}

async function saveFile(familiarId: string, file: ResearchGenerationsFile): Promise<void> {
  const target = researchGenerationsPath(familiarId);
  await mkdir(/* turbopackIgnore: true */ path.dirname(target), { recursive: true });
  await writeJsonAtomic(/* turbopackIgnore: true */ target, file);
}

declare global {
  var __caveResearchGenerationLocks: Map<string, Promise<unknown>> | undefined;
}

function withWriteMutex<T>(familiarId: string, fn: () => Promise<T>): Promise<T> {
  globalThis.__caveResearchGenerationLocks ??= new Map();
  const locks = globalThis.__caveResearchGenerationLocks;
  const previous = locks.get(familiarId) ?? Promise.resolve();
  const next = previous.then(
    () => withGenerationFileLock(familiarId, fn),
    () => withGenerationFileLock(familiarId, fn),
  );
  locks.set(
    familiarId,
    next.then(
      () => undefined,
      () => undefined,
    ),
  );
  return next;
}

async function withGenerationFileLock<T>(
  familiarId: string,
  fn: () => Promise<T>,
): Promise<T> {
  const target = researchGenerationsPath(familiarId);
  const release = await acquireProcessIntentLock({
    intentsDirectory: `${target}.locks`,
    label: "research-generations write",
  });
  try {
    return await fn();
  } finally {
    await release();
  }
}

/** Newest first. */
export async function listResearchGenerations(
  familiarId: string,
): Promise<ResearchGeneration[]> {
  assertFamiliarId(familiarId);
  const file = await loadFile(familiarId);
  return [...file.generations].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function listResearchGenerationFamiliarIds(): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(/* turbopackIgnore: true */ researchGenerationsRoot(), {
      withFileTypes: true,
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => entry.name.slice(0, -5))
    .filter((familiarId) => isValidResearchGenerationFamiliarId(familiarId));
}

export type ResearchGenerationUpdate = {
  status?: ResearchGenerationStatus;
  stage?: ResearchGenerationStage | null;
  progress?: ResearchGenerationProgress | null;
  renderConfig?: ResearchMediaRenderConfig | null;
  content?: ResearchGenerationContent | null;
  error?: string | null;
};

function applyResearchGenerationUpdate(
  existing: ResearchGeneration,
  update: ResearchGenerationUpdate,
): ResearchGeneration | null {
  if (
    update.status !== undefined &&
    !isResearchGenerationStatusForKind(existing.kind, update.status)
  ) {
    return null;
  }
  if (
    update.stage !== undefined &&
    update.stage !== null &&
    !isResearchGenerationStage(update.stage)
  ) {
    return null;
  }
  if (
    update.progress !== undefined &&
    update.progress !== null &&
    !isResearchGenerationProgress(update.progress)
  ) {
    return null;
  }
  if (
    update.content !== undefined &&
    update.content !== null &&
    (!isResearchGenerationContent(update.content) || update.content.kind !== existing.kind)
  ) {
    return null;
  }

  const next: ResearchGeneration = {
    ...existing,
    ...(update.status !== undefined ? { status: update.status } : {}),
    updatedAt: new Date().toISOString(),
  };
  if ("renderConfig" in update) {
    if (update.renderConfig === null) {
      delete next.renderConfig;
    } else if (update.renderConfig !== undefined) {
      const validated = validateResearchMediaRenderConfig(existing.kind, update.renderConfig);
      if (!validated.ok) return null;
      next.renderConfig = validated.value;
    }
  }
  if ("stage" in update) {
    if (update.stage === null) delete next.stage;
    else if (update.stage !== undefined) next.stage = update.stage;
  }
  if ("progress" in update) {
    if (update.progress === null) delete next.progress;
    else if (update.progress !== undefined) next.progress = update.progress;
  }
  if ("content" in update) {
    if (update.content === null) delete next.content;
    else if (update.content !== undefined) next.content = update.content;
  }
  if ("error" in update) {
    if (!update.error) delete next.error;
    else next.error = update.error;
  }

  if (isResearchGenerationMediaKind(next.kind)) {
    if (
      (next.status === "queued" || next.status === "rendering" || next.status === "ready") &&
      (!next.renderConfig || !next.content)
    ) {
      return null;
    }
  } else if (next.renderConfig || next.progress || next.stage) {
    return null;
  }
  if (next.progress && next.kind !== "long-video") return null;
  if (next.status === "ready" && !next.content) return null;
  return next;
}

export async function updateResearchGeneration(
  familiarId: string,
  id: string,
  update: ResearchGenerationUpdate,
): Promise<ResearchGeneration | null> {
  assertFamiliarId(familiarId);
  return withWriteMutex(familiarId, async () => {
    const file = await loadFile(familiarId);
    const existing = file.generations.find((generation) => generation.id === id);
    if (!existing) return null;
    const next = applyResearchGenerationUpdate(existing, update);
    if (!next) throw new Error("invalid generation update");
    file.generations = file.generations.map((generation) =>
      generation.id === id ? next : generation,
    );
    await saveFile(familiarId, file);
    return next;
  });
}

export type ResearchGenerationTransitionResult =
  | { ok: true; generation: ResearchGeneration }
  | {
      ok: false;
      code: "not-found" | "invalid-state";
      generation?: ResearchGeneration;
    };

export async function transitionResearchGeneration(
  familiarId: string,
  id: string,
  expected: readonly ResearchGenerationStatus[],
  update: ResearchGenerationUpdate,
): Promise<ResearchGenerationTransitionResult> {
  assertFamiliarId(familiarId);
  return withWriteMutex(familiarId, async () => {
    const file = await loadFile(familiarId);
    const existing = file.generations.find((generation) => generation.id === id);
    if (!existing) return { ok: false, code: "not-found" };
    if (!expected.includes(existing.status)) {
      return { ok: false, code: "invalid-state", generation: existing };
    }
    const next = applyResearchGenerationUpdate(existing, update);
    if (!next) return { ok: false, code: "invalid-state", generation: existing };
    file.generations = file.generations.map((generation) =>
      generation.id === id ? next : generation,
    );
    await saveFile(familiarId, file);
    return { ok: true, generation: next };
  });
}

/** Returns true when a generation was actually removed. */
export async function removeResearchGeneration(
  familiarId: string,
  id: string,
): Promise<boolean> {
  assertFamiliarId(familiarId);
  return withWriteMutex(familiarId, async () => {
    const file = await loadFile(familiarId);
    const next = file.generations.filter((generation) => generation.id !== id);
    if (next.length === file.generations.length) return false;
    file.generations = next;
    await saveFile(familiarId, file);
    return true;
  });
}

export type RemoveResearchGenerationResult =
  | { ok: true; generation: ResearchGeneration }
  | {
      ok: false;
      code: "not-found" | "active";
      generation?: ResearchGeneration;
    };

/**
 * Delete only after an asynchronous media job is terminal. The status check
 * and record removal share the familiar's write mutex, so a queued row cannot
 * race into rendering while DELETE is deciding whether it is safe to remove.
 */
export async function removeResearchGenerationIfInactive(
  familiarId: string,
  id: string,
): Promise<RemoveResearchGenerationResult> {
  assertFamiliarId(familiarId);
  return withWriteMutex(familiarId, async () => {
    const file = await loadFile(familiarId);
    const existing = file.generations.find((generation) => generation.id === id);
    if (!existing) return { ok: false, code: "not-found" };
    if (
      isResearchGenerationMediaKind(existing.kind) &&
      (existing.status === "queued" || existing.status === "rendering")
    ) {
      return { ok: false, code: "active", generation: existing };
    }
    file.generations = file.generations.filter(
      (generation) => generation.id !== id,
    );
    await saveFile(familiarId, file);
    return { ok: true, generation: existing };
  });
}

// ── source artifact selection ────────────────────────────────────────────────

function isMarkdownArtifact(artifact: ResearchArtifactRef): boolean {
  return artifact.relativePath.toLowerCase().endsWith(".md");
}

/** research-mission-runner.ts's createMissionRecord seeds the primary ref's
 *  relativePath as "artifacts/primary.md", and startNextIteration's rejected-
 *  primary resurrection only ever renames the *key* (to `primary-i${n}`),
 *  never the relativePath — so relativePath alone already identifies every
 *  primary-lineage ref. The key pattern is matched too, defensively, so the
 *  lineage is still found even if that relativePath invariant ever drifts. */
const PRIMARY_ARTIFACT_RELATIVE_PATH = "artifacts/primary.md";
const PRIMARY_ARTIFACT_KEY_PATTERN = /^primary(-i\d+)?$/;

function isPrimaryLineageArtifact(artifact: ResearchArtifactRef): boolean {
  return (
    artifact.relativePath === PRIMARY_ARTIFACT_RELATIVE_PATH ||
    PRIMARY_ARTIFACT_KEY_PATTERN.test(artifact.key)
  );
}

function newestPublishedElseWorking(pool: ResearchArtifactRef[]): ResearchArtifactRef | null {
  const byNewest = (a: ResearchArtifactRef, b: ResearchArtifactRef) =>
    b.updatedAt.localeCompare(a.updatedAt);
  const published = pool.filter((artifact) => artifact.state === "published").sort(byNewest);
  if (published.length > 0) return published[0];
  const working = pool.filter((artifact) => artifact.state === "working").sort(byNewest);
  return working[0] ?? null;
}

/**
 * Prefers the mission's primary lineage: its newest published markdown ref,
 * else its newest working one. Only when the mission has no non-rejected
 * primary-lineage ref at all does this fall back to the same newest-
 * published-else-working pick over every other markdown ref — e.g. a
 * manually-retried research-log publish, or a checkpoint where only a
 * standard ref has been published, must never outrank the primary just for
 * being the newer publish (cave research-final-artifacts Fix 1). Rejected
 * artifacts never qualify, in either the primary lineage or the fallback.
 */
export function pickGenerationSourceArtifact(
  mission: Pick<ResearchMission, "artifacts">,
): ResearchArtifactRef | null {
  const markdown = mission.artifacts.filter(isMarkdownArtifact);
  const nonRejected = markdown.filter((artifact) => artifact.state !== "rejected");
  const primaryLineage = nonRejected.filter(isPrimaryLineageArtifact);
  if (primaryLineage.length > 0) return newestPublishedElseWorking(primaryLineage);
  return newestPublishedElseWorking(nonRejected);
}

// ── markdown structure extraction (pure) ─────────────────────────────────────

type MarkdownSection = {
  /** Heading text without the leading #s. */
  title: string;
  level: number;
  /** Bullet texts under the heading, markers stripped. */
  bullets: string[];
  /** First non-bullet, non-heading body line under the heading. */
  firstLine?: string;
};

function stripInlineMarkdown(text: string): string {
  return text
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/_([^_]+)_/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .trim();
}

/** Headings/bullets/first-lines of a markdown document, fences excluded. */
export function extractMarkdownSections(markdown: string): {
  documentTitle: string | null;
  sections: MarkdownSection[];
} {
  const sections: MarkdownSection[] = [];
  let documentTitle: string | null = null;
  let current: MarkdownSection | null = null;
  let inFence = false;
  for (const rawLine of markdown.split("\n")) {
    const line = rawLine.trimEnd();
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      const level = heading[1].length;
      const title = stripInlineMarkdown(heading[2]);
      if (level === 1 && documentTitle === null) {
        documentTitle = title;
        current = null;
        continue;
      }
      current = { title, level, bullets: [] };
      sections.push(current);
      continue;
    }
    if (!current) continue;
    const bullet = line.match(/^\s*[-*+]\s+(.+)$/);
    if (bullet) {
      current.bullets.push(stripInlineMarkdown(bullet[1]));
      continue;
    }
    const body = line.trim();
    if (body && current.firstLine === undefined && !/^[>|#]/.test(body)) {
      current.firstLine = stripInlineMarkdown(body);
    }
  }
  return { documentTitle, sections };
}

/** Bold-run texts (**…** / __…__) outside code fences, deduped, in order. */
export function extractEmphasizedClaims(markdown: string): string[] {
  const claims: string[] = [];
  const seen = new Set<string>();
  let inFence = false;
  for (const line of markdown.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence || /^\s*#{1,6}\s/.test(line)) continue;
    for (const match of line.matchAll(/\*\*([^*]+)\*\*|__([^_]+)__/g)) {
      const text = stripInlineMarkdown(match[1] ?? match[2] ?? "");
      if (text && !seen.has(text)) {
        seen.add(text);
        claims.push(text);
      }
    }
  }
  return claims;
}

// ── extractive drafting (pure; one function per kind) ────────────────────────

const MAX_SLIDES = 16;
const MAX_SLIDE_BULLETS = 4;
const MAX_THREAD_POSTS = 8;
const MAX_INFOGRAPHIC_STATS = 12;
const MAX_DIAGRAM_SECTIONS = 8;
const MAX_MEDIA_DRAFT_CHARS = 1_000;

/**
 * Word-boundary clamp to the social post budget. Mechanical truncation only —
 * the ellipsis marks the cut, nothing is rephrased. Cutting mid-word is
 * avoided unless the first word alone would blow half the budget.
 */
function clampThreadPostText(text: string): string {
  if (text.length <= RESEARCH_THREAD_POST_MAX_CHARS) return text;
  const slice = text.slice(0, RESEARCH_THREAD_POST_MAX_CHARS - 1);
  const lastSpace = slice.lastIndexOf(" ");
  const cut = lastSpace > RESEARCH_THREAD_POST_MAX_CHARS / 2 ? slice.slice(0, lastSpace) : slice;
  return `${cut.trimEnd()}…`;
}

export type GenerationDraftSource = {
  mission: Pick<ResearchMission, "id" | "title" | "iterations">;
  artifact: Pick<ResearchArtifactRef, "key" | "title">;
  markdown: string;
};

/** The artifact markdown itself as an editable copy, provenance line first. */
export function draftBlogContent(source: GenerationDraftSource): ResearchGenerationContent {
  const provenance = `> Editable draft copied from “${source.artifact.title}” (mission: ${source.mission.title}). Edits here never change the source artifact.`;
  return { kind: "blog", markdown: `${provenance}\n\n${source.markdown}` };
}

/** Outline deck: title slide + one slide per section heading with its first bullets. */
export function draftSlidesContent(source: GenerationDraftSource): ResearchGenerationContent {
  const { documentTitle, sections } = extractMarkdownSections(source.markdown);
  const slides: ResearchGenerationSlide[] = [];
  const coverTitle = documentTitle ?? source.artifact.title;
  slides.push({
    title: coverTitle,
    bullets: coverTitle === source.mission.title ? [] : [source.mission.title],
  });
  for (const section of sections.slice(0, MAX_SLIDES - 1)) {
    const bullets = section.bullets.slice(0, MAX_SLIDE_BULLETS);
    if (bullets.length === 0 && section.firstLine) bullets.push(section.firstLine);
    slides.push({ title: section.title, bullets });
  }
  return { kind: "slides", slides };
}

/**
 * Thread: hook from the mission title, claims from bold lines and headings,
 * extra section bullets while room remains, then a provenance closer naming
 * the artifact and run (the same fixed-boilerplate-plus-verbatim-titles shape
 * as the blog draft's provenance line). Every post is clamped to the social
 * budget at a word boundary.
 */
export function draftThreadContent(source: GenerationDraftSource): ResearchGenerationContent {
  const { sections } = extractMarkdownSections(source.markdown);
  const claims: string[] = [];
  // Seed with the hook so a bold line or heading repeating the mission title
  // can't produce a duplicate post.
  const seen = new Set<string>([source.mission.title]);
  const push = (text: string) => {
    if (text && !seen.has(text)) {
      seen.add(text);
      claims.push(text);
    }
  };
  for (const claim of extractEmphasizedClaims(source.markdown)) push(claim);
  for (const section of sections) {
    const headline = section.bullets[0] ?? section.firstLine;
    push(headline ? `${section.title} — ${headline}` : section.title);
  }
  // Fill any remaining room with the sections' other bullets, in document
  // order — more of the artifact's own words, never padding.
  for (const section of sections) {
    for (const bullet of section.bullets.slice(1)) push(bullet);
  }
  const closer = `Full findings: “${source.artifact.title}” — from the research run “${source.mission.title}”.`;
  const texts = [
    source.mission.title,
    ...claims.slice(0, Math.max(0, MAX_THREAD_POSTS - 2)),
    closer,
  ].map(clampThreadPostText);
  const posts: ResearchGenerationThreadPost[] = texts.map((text, index) => ({
    pre: `${index + 1}/${texts.length}`,
    text,
  }));
  return { kind: "thread", posts };
}

function mermaidLabel(text: string): string {
  // Quoted mermaid labels tolerate most punctuation; double quotes would end
  // the label early, so soften them.
  return text.replace(/"/g, "'").slice(0, 80);
}

/**
 * Mermaid flow of the run's structure: the latest iteration's phase steps as
 * a chain, feeding an artifact-section chain. Purely structural — every label
 * is a step id/detail or a section heading from the artifact.
 */
export function draftDiagramContent(source: GenerationDraftSource): ResearchGenerationContent {
  const lines: string[] = ["graph TD"];
  const steps = source.mission.iterations.at(-1)?.steps ?? [];
  const stepIds: string[] = [];
  steps.forEach((step, index) => {
    const nodeId = `P${index}`;
    stepIds.push(nodeId);
    lines.push(`  ${nodeId}["${mermaidLabel(step.id)}"]`);
  });
  for (let i = 1; i < stepIds.length; i += 1) {
    lines.push(`  ${stepIds[i - 1]} --> ${stepIds[i]}`);
  }
  const artifactNode = "A0";
  lines.push(`  ${artifactNode}["${mermaidLabel(source.artifact.title)}"]`);
  if (stepIds.length > 0) {
    lines.push(`  ${stepIds[stepIds.length - 1]} --> ${artifactNode}`);
  }
  const { sections } = extractMarkdownSections(source.markdown);
  sections.slice(0, MAX_DIAGRAM_SECTIONS).forEach((section, index) => {
    const nodeId = `S${index}`;
    lines.push(`  ${nodeId}["${mermaidLabel(section.title)}"]`);
    lines.push(`  ${artifactNode} --> ${nodeId}`);
  });
  return { kind: "diagram", mermaid: lines.join("\n") };
}

const NUMBER_RE = /(?:\$\s?)?\d[\d,.]*(?:\s?[–—-]\s?\d[\d,.]*)?\s?(?:%|×|x(?=\b))?/g;

/** Numbers regex-extracted from the artifact with their line context. */
export function draftInfographicContent(source: GenerationDraftSource): ResearchGenerationContent {
  const stats: ResearchGenerationStat[] = [];
  const seen = new Set<string>();
  let inFence = false;
  for (const rawLine of source.markdown.split("\n")) {
    if (stats.length >= MAX_INFOGRAPHIC_STATS) break;
    if (/^\s*(```|~~~)/.test(rawLine)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const context = stripInlineMarkdown(
      rawLine.replace(/^\s*#{1,6}\s+/, "").replace(/^\s*[-*+]\s+/, "").replace(/^\s*>\s*/, ""),
    );
    if (!context) continue;
    // Ordered-list markers ("1. …") are structure, not findings.
    const searchable = context.replace(/^\d+[.)]\s+/, "");
    for (const match of searchable.matchAll(NUMBER_RE)) {
      const value = match[0].trim();
      // Bare years and tiny counters carry no infographic value on their own;
      // keep anything with a unit/currency/range, or a magnitude ≥ 3 digits.
      const hasUnit = /[%×x$]/.test(value) || /[–—-]/.test(value);
      const digits = value.replace(/[^0-9]/g, "");
      if (!hasUnit && digits.length < 3) continue;
      const key = `${value}|${searchable}`;
      if (seen.has(key)) continue;
      seen.add(key);
      stats.push({ value, context: searchable });
      if (stats.length >= MAX_INFOGRAPHIC_STATS) break;
    }
  }
  return { kind: "infographic", stats };
}

/** Sentence terminator (with optional closing quotes/brackets) before whitespace. */
const SENTENCE_BREAK_RE = /[.!?…]["'”’)\]]*(?=\s)/g;

function splitMediaDraftText(text: string): string[] {
  const normalized = text.trim();
  if (!normalized) return [];
  const chunks: string[] = [];
  let remaining = normalized;
  while (remaining.length > MAX_MEDIA_DRAFT_CHARS) {
    // Chunks become separate spoken turns, so prefer ending one at a sentence
    // boundary; a continuation turn must never open mid-sentence.
    const window = remaining.slice(0, MAX_MEDIA_DRAFT_CHARS);
    let sentenceCut = -1;
    for (const match of window.matchAll(SENTENCE_BREAK_RE)) {
      sentenceCut = match.index + match[0].length;
    }
    const boundary =
      sentenceCut > MAX_MEDIA_DRAFT_CHARS / 2
        ? sentenceCut
        : remaining.lastIndexOf(" ", MAX_MEDIA_DRAFT_CHARS);
    const cut = boundary > MAX_MEDIA_DRAFT_CHARS / 2 ? boundary : MAX_MEDIA_DRAFT_CHARS;
    chunks.push(remaining.slice(0, cut).trimEnd());
    remaining = remaining.slice(cut).trimStart();
  }
  if (remaining) chunks.push(remaining);
  return chunks.filter((chunk) => chunk.length <= LOCAL_TTS_MAX_CHARS);
}

/** Fragment endings that already close a spoken clause — no "." appended. */
const SPEAKABLE_TERMINAL_RE = /[.!?…;:)\]"'”’]$/;

/**
 * Glyphs TTS engines mangle or skip, mapped to spoken words. Scoped to
 * symbols that carry meaning when read aloud ("Open questions → next steps").
 */
const SPOKEN_GLYPHS: [RegExp, string][] = [
  [/\s*(?:→|->)\s*/g, " to "],
  [/(?<=\d)\s*×\s*/g, " times "],
  [/\s*≥\s*/g, " at least "],
  [/\s*≤\s*/g, " at most "],
  [/\s*≈\s*/g, " about "],
  // "~5" gets spoken as "five-five" or a stray glyph (cave-8nndo, Charm
  // re-review); only the numeric-approximation use is rewritten, so paths
  // like "~/.config" stay untouched.
  [/~\s*(?=\d)/g, "about "],
  // "spec+regression" gets ASR-mangled ("specs or aggression"); digits keep
  // arithmetic sense ("2+2" → "2 plus 2"), words read as a pairing — with or
  // without surrounding same-line spaces ("spec + regression" mangles just
  // the same; a "+" list bullet after a newline never merges lines).
  // "C++" stays intact: only whitespace may sit between the letter and the
  // "+", so its first "+" (followed by "+") and second "+" (preceded by "+")
  // both fail to match.
  [/(?<=\d)\s*\+\s*(?=\d)/g, " plus "],
  [/(?<=[A-Za-z])[^\S\n]*\+[^\S\n]*(?=[A-Za-z])/g, " and "],
];

function normalizeSpokenGlyphs(text: string): string {
  let spoken = text;
  for (const [pattern, replacement] of SPOKEN_GLYPHS) {
    spoken = spoken.replace(pattern, replacement);
  }
  return spoken.replace(/\s{2,}/g, " ").trim();
}

// ── spoken citation handling (cave-jckyz, Charm review #4) ──────────────────
// Citation apparatus belongs in show notes, not speech: "(S5, S6; high)" read
// aloud is noise. Removal is strictly mechanical — a group goes only when
// every token in it is recognizably citation metadata; anything containing
// plain prose stays verbatim.

/** Source-ledger ids: "S20", "C2", "F1.1", "src-kiro-specs", "knuth-lp-1992", "[^1]". */
const CITATION_ID_RE =
  /^(?:\^?\d+|SS|[A-Z]{1,2}\d{1,3}(?:\.\w+)?[a-z]?|(?:src|link)-[\w.…-]+|arXiv:[\w./-]+|[a-z][\w]*(?:-[\w…]+)+)$/;
/** Confidence labels that only annotate a citation. */
const CITATION_LABEL_RE =
  /^(?:high|medium|low|inference|fact|theory|confidence|verified|\[?[IVH]\]?|\d{4}(?:-\d{2}){0,2})$/i;
/**
 * Tokens that anchor a parenthetical as citation metadata on their own.
 * Deliberately narrower than `CITATION_LABEL_RE`: single grade letters would
 * strip prose like "(I)", and bare years would strip publication years like
 * "(2003)" that still read as meaningful speech.
 */
const CITATION_ANCHOR_RE =
  /^(?:high|medium|low|inference|fact|theory|verified|confidence|\d{4}(?:-\d{2}){1,2})$/i;
/**
 * Ids allowed to anchor a parenthetical. Narrower than the bracket form:
 * bare numbers ("(2003)") and hyphenated prose ("(state-of-the-art)") are
 * not citations there, so kebab ids must carry a digit.
 */
const PAREN_ID_RE =
  /^(?:SS|[A-Z]{1,2}\d{1,3}(?:\.\w+)?[a-z]?|(?:src|link)-[\w.…-]+|arXiv:[\w./-]+|[a-z][\w.…]*(?:-[\w.…]+)*-[\w.…]*\d[\w.…-]*)$/;

function citationTokens(inner: string): string[] {
  return inner.split(/[\s,;·+&]+/).filter(Boolean);
}

function stripSpokenCitations(text: string): string {
  return text
    // Bracket groups made only of ledger ids: "[S01]", "[knuth-lp-1992]".
    .replace(/\[([^\][]+)\]/g, (match, inner: string) => {
      const tokens = citationTokens(inner);
      return tokens.every((token) => CITATION_ID_RE.test(token)) ? "" : match;
    })
    // Parentheticals of ids + dates + confidence labels: "(S20 2025-06; high)",
    // "(high confidence)". At least one id or label keeps "(the DGM lesson)"
    // and other prose parentheticals intact.
    .replace(/\(([^()]+)\)/g, (match, inner: string) => {
      const tokens = citationTokens(inner);
      const allCitation = tokens.every(
        (token) => PAREN_ID_RE.test(token) || CITATION_LABEL_RE.test(token),
      );
      const anchored = tokens.some(
        (token) => PAREN_ID_RE.test(token) || CITATION_ANCHOR_RE.test(token),
      );
      return allCitation && anchored ? "" : match;
    })
    // Bare ledger ids left behind by markdown-link stripping ("S01 S06").
    .replace(/(^|\s)[SCR]\d{1,3}[a-z]?(?=[\s,.;:!?]|$)/g, "$1")
    // Tidy the seams the removals leave behind.
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/([,;:])\s*(?=[,.;:])/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** Full spoken-text normalization: citations out, glyphs to words. */
function spokenText(text: string): string {
  return normalizeSpokenGlyphs(stripSpokenCitations(text));
}

/** Terminates a fragment for speech without ever doubling punctuation. */
function speakable(fragment: string): string {
  const trimmed = spokenText(fragment);
  if (!trimmed) return trimmed;
  return SPEAKABLE_TERMINAL_RE.test(trimmed) ? trimmed : `${trimmed}.`;
}

/**
 * Mission titles are often raw research prompts ("Research and compare: X.
 * Primary questions: …"). The episode should frame the intellectual question,
 * not read the query furniture aloud (Charm review #1) — so strip prompt
 * prefixes, cut instruction tails, and drop trailing punctuation/ellipses.
 */
function spokenTitle(missionTitle: string): string {
  let title = normalizeSpokenGlyphs(missionTitle);
  title = title.replace(
    /^research(?:\s+(?:and\s+compare|prompt|brief|mission|task))?\s*[:\-–—]\s*/i,
    "",
  );
  const instructionTail = title.search(
    /[.!?]\s+(?:primary\s+questions?|questions?|task|recommend|compare|focus)\b/i,
  );
  if (instructionTail !== -1) title = title.slice(0, instructionTail);
  return title.replace(/[\s.…:;,–—-]+$/u, "");
}

type NarrationUnit = {
  /** Section heading, or null on the heading-less fallback path. */
  title: string | null;
  /** Speakable detail text, punctuation-safe joined. */
  text: string;
};

function mediaNarrationSectionUnits(source: GenerationDraftSource): NarrationUnit[] {
  const { sections } = extractMarkdownSections(source.markdown);
  if (sections.length > 0) {
    return sections.flatMap((section): NarrationUnit[] => {
      const details = section.bullets.length > 0 ? section.bullets : section.firstLine ? [section.firstLine] : [];
      // Sections whose body is only a table (or nothing) have no speakable
      // details; a bare spoken heading is worse than silence, so skip them.
      if (details.length === 0) return [];
      return [{ title: section.title, text: details.map(speakable).join(" ") }];
    });
  }
  // A heading-less artifact still has useful source lines. Ignore markdown
  // fences and structural blank lines, but retain the artifact's wording.
  const lines: NarrationUnit[] = [];
  let inFence = false;
  for (const rawLine of source.markdown.split("\n")) {
    if (/^\s*(```|~~~)/.test(rawLine)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const line = stripInlineMarkdown(
      rawLine.replace(/^\s*[-*+]\s+/, "").replace(/^\s*>\s?/, ""),
    );
    if (line && !/^#{1,6}\s/.test(line)) {
      lines.push({ title: null, text: spokenText(line) });
    }
  }
  return lines;
}

function mediaNarrationUnits(source: GenerationDraftSource): string[] {
  return mediaNarrationSectionUnits(source).map((unit) =>
    unit.title === null ? unit.text : `${speakable(unit.title)} ${unit.text}`,
  );
}

/** Drafts a reviewable, extractive host script before any audio is rendered. */
export function draftPodcastContent(
  source: GenerationDraftSource,
  length: ResearchMediaLength,
  style: ResearchPodcastStyle = "breakdown",
): ResearchGenerationContent {
  const budget = RESEARCH_MEDIA_LENGTH_LIMITS.podcast[length].maxCharacters;
  const units = mediaNarrationSectionUnits(source);
  if (style === "recap") {
    // Recap is the original single-narrator read-through: one voice, no
    // dialogue turns, findings in source order.
    const candidates = units
      .map((unit) =>
        unit.title !== null ? `${speakable(unit.title)} ${unit.text}` : unit.text,
      )
      .flatMap(splitMediaDraftText);
    const script: ResearchGenerationScriptSegment[] = [];
    let used = 0;
    for (const [index, text] of candidates.entries()) {
      if (used + text.length > budget) break;
      script.push({ id: `segment-${index + 1}`, text });
      used += text.length;
    }
    return { kind: "podcast", script };
  }
  return {
    kind: "podcast",
    script: draftDialogueScript(
      style === "debate" ? contestedSectionsFirst(units) : units,
      { budget, ...PODCAST_DIALOGUE_TEMPLATES[style](source.mission.title) },
    ),
  };
}

/**
 * Section titles that signal disagreement or open ground. Debate episodes
 * lead with these so the contested findings get the airtime.
 */
const CONTESTED_TITLE_RE =
  /conflict|contradiction|open question|unresolved|challenge|risk|limitation/i;

function contestedSectionsFirst(units: NarrationUnit[]): NarrationUnit[] {
  const contested = units.filter(
    (unit) => unit.title !== null && CONTESTED_TITLE_RE.test(unit.title),
  );
  if (contested.length === 0) return units;
  return [...contested, ...units.filter((unit) => !contested.includes(unit))];
}

/**
 * Per-style templated copy — episode structure only. Every findings turn the
 * templates introduce stays verbatim artifact text. Host bridges rotate
 * through distinct editorial jobs (orient / define / challenge / connect /
 * turn-to-practice) instead of repeating one generic line, and every section
 * ends on a short host synthesis turn rather than the guest's last list item
 * (cave-jckyz, Charm review #2/#5). Closers are content-bearing: when the
 * section's lead sentence is short enough, the host restates it verbatim as
 * the takeaway instead of a bare acknowledgment (cave-upkaf, Charm
 * re-review — measured host share was 16.2% against a 20–30% target and
 * "got it" closers never synthesized). Style guidance for dense research:
 * breakdown (default) > interview (host as listener proxy) > recap > debate
 * (only when the source has genuinely competing interpretations).
 */
const rotated = (variants: readonly string[], index: number): string =>
  variants[index % variants.length];

const PODCAST_DIALOGUE_TEMPLATES: Record<
  Exclude<ResearchPodcastStyle, "recap">,
  (missionTitle: string) => Omit<DialogueTemplate, "budget">
> = {
  breakdown: (missionTitle) => ({
    opening: `Welcome in — today we're breaking down what we actually know about “${spokenTitle(missionTitle)}”, finding by finding.`,
    framing: (title, section) =>
      rotated(
        [
          `Next up — ${speakable(title)}`,
          `Let's get precise about this one. ${speakable(title)}`,
          `Here's the part worth slowing down for. ${speakable(title)}`,
          `And notice how this connects to what we just heard. ${speakable(title)}`,
          `So what would you actually do with this? ${speakable(title)}`,
        ],
        section,
      ),
    closer: (section, takeaway) =>
      takeaway
        ? rotated(
            [
              `So if you keep one piece of that, keep this: ${takeaway}`,
              `The takeaway there — ${takeaway}`,
              `Put that one on the board: ${takeaway}`,
            ],
            section,
          )
        : rotated(
            [
              "Okay — that one's on the board.",
              "Good. Let's keep moving.",
              "That's the takeaway there.",
              "Noted — that piece matters.",
            ],
            section,
          ),
  }),
  debate: (missionTitle) => ({
    opening: `Welcome to the debate — today we're stress-testing “${spokenTitle(missionTitle)}”, starting where the findings are most contested.`,
    framing: (title, section) =>
      rotated(
        [
          `Where do we actually stand on this one? ${speakable(title)}`,
          `Steelman it for me. ${speakable(title)}`,
          `I'm not convinced yet — make the case. ${speakable(title)}`,
          `What would it take to change your mind here? ${speakable(title)}`,
        ],
        section,
      ),
    closer: (section, takeaway) =>
      takeaway
        ? rotated(
            [
              `Where that leaves us: ${takeaway}`,
              `Then the record shows it: ${takeaway}`,
              `If that holds, it holds on this: ${takeaway}`,
            ],
            section,
          )
        : rotated(
            [
              "So the jury's still out on that one.",
              "Fair — I'll grant that point.",
              "We'll have to leave that one contested.",
              "That lands. Next round.",
            ],
            section,
          ),
  }),
  interview: (missionTitle) => ({
    opening: `My guest has spent real time inside “${spokenTitle(missionTitle)}” — and I want to know what actually holds up. Let's get into it.`,
    framing: (title, section) =>
      rotated(
        [
          `Walk me through this part — ${speakable(title)}`,
          `For listeners just joining us, what does this actually mean? ${speakable(title)}`,
          `Where did this one surprise you? ${speakable(title)}`,
          `How does that square with what you said earlier? ${speakable(title)}`,
          `And for someone who wants to apply this tomorrow? ${speakable(title)}`,
        ],
        section,
      ),
    closer: (section, takeaway) =>
      takeaway
        ? rotated(
            [
              `So if I'm hearing you right: ${takeaway}`,
              `Let me play that back — ${takeaway}`,
              `So the version I'd repeat to a friend: ${takeaway}`,
            ],
            section,
          )
        : rotated(
            [
              "Got it — that's much clearer now.",
              "That's a really useful way to put it.",
              "Right — I hadn't thought of it that way.",
              "Okay, that helps. Let's go on.",
            ],
            section,
          ),
    // Interview's own turn shape (cave-9wkyq): the guest never monologues —
    // long answers split into short conversational turns with the host
    // reacting in between, and exactly one real challenge lands per episode.
    maxGuestTurnWords: 100,
    interjection: (index) =>
      rotated(
        [
          "Okay — keep going.",
          "Right, so there's more to it.",
          "Stay on this one — what else?",
          "And that's not the whole story, is it?",
        ],
        index,
      ),
    challenge: (title) =>
      `You knew I'd push back somewhere — here's where. Make the case for this one. ${speakable(title)}`,
  }),
};

/**
 * Document furniture headings translated into listener questions — the host
 * never reads "Executive summary" or "Open questions" aloud (cave-jckyz,
 * Charm review #3). Matching is prefix-based after list numbering is dropped;
 * unmatched headings flow to the style's own bridges.
 */
const FURNITURE_HEADING_QUESTIONS: [RegExp, string][] = [
  [/^executive summary/i, "Let's start with the big picture — what's the headline here?"],
  [/^key claims/i, "What are the claims we can actually stand behind?"],
  [/^(?:key |detailed |main )?findings/i, "So what did the research actually find?"],
  [/^(?:open|unresolved) questions/i, "What's still unsettled after all of this?"],
  [/^(?:recommended )?next steps/i, "So where does this go from here?"],
  [/^(?:comparison|decision) criteria/i, "If someone has to choose, how should they actually decide?"],
  [/^\S+ comparison\b/i, "How do the options stack up against each other?"],
  [/^(?:conclusion|bottom line|summary\b)/i, "So what's the bottom line?"],
  [/^(?:sources?\b|source ledger|research log)/i, "And what is all of this based on?"],
];

function furnitureQuestion(title: string): string | null {
  const bare = title.replace(/^\d+[.)]\s*/, "").trim();
  for (const [pattern, question] of FURNITURE_HEADING_QUESTIONS) {
    if (pattern.test(bare)) return question;
  }
  return null;
}

type DialogueTemplate = {
  budget: number;
  /** Templated host opener; counts against the character budget. */
  opening: string;
  /** Templated host bridge into a titled section; structure, never findings. */
  framing: (title: string, section: number) => string;
  /**
   * Templated host synthesis turn closing a titled section. When the section
   * yields a short declarative lead sentence, it arrives as `takeaway` and the
   * closer restates it verbatim (cave-upkaf) — content-bearing synthesis, not
   * an acknowledgment, without inventing a word.
   */
  closer: (section: number, takeaway?: string) => string;
  /**
   * Cap on guest-turn length in words. Longer answers split at sentence
   * boundaries into separate turns so the guest never monologues (cave-9wkyq).
   */
  maxGuestTurnWords?: number;
  /** Short templated host reaction slotted between split guest turns. */
  interjection?: (index: number) => string;
  /**
   * One-per-episode challenge bridge, spent on the first contested section
   * (never on furniture headings) in place of the rotating framing line.
   */
  challenge?: (title: string) => string;
};

const MAX_TAKEAWAY_CHARS = 160;

/** First sentence of a chunk, when whole (terminator + trailing quotes). */
const FIRST_SENTENCE_RE = /^[\s\S]*?[.!?…]["'”’)\]]*(?=\s|$)/;

/**
 * A list enumerator or bullet marker opening a chunk (`1.`, `2)`, `a.`, `-`,
 * `*`, `•`). Stripped before sentence extraction: on real artifacts a section
 * often leads with a numbered list, and the enumerator's own dot otherwise
 * matches as a complete "sentence" — closers then restate "1." as the
 * takeaway (cave-8ksv1).
 */
const LEAD_LIST_MARKER_RE = /^(?:[-*•]|(?:\d{1,3}|[a-z])[.)])\s+/i;

/** Spoken-substance gate: at least three words, at least one with letters. */
const TAKEAWAY_SUBSTANCE_RE = /(?:\S+\s+){2}\S/;

/**
 * The section's lead sentence, restated verbatim by content-bearing closers.
 * Declarative sentences only — a question restated as "the takeaway" is not a
 * synthesis — and only when short enough to work as a spoken bookend. Any
 * non-question terminator qualifies; only `?` disqualifies. A leading list
 * marker is not part of the sentence, and a match without real word content
 * (three words, one carrying letters) is structure, not a takeaway.
 */
function sectionTakeaway(chunks: string[]): string | undefined {
  const lead = chunks[0]?.trimStart().replace(LEAD_LIST_MARKER_RE, "");
  if (!lead) return undefined;
  const sentence = lead.match(FIRST_SENTENCE_RE)?.[0]?.trim();
  if (!sentence || sentence.length > MAX_TAKEAWAY_CHARS) return undefined;
  if (!TAKEAWAY_SUBSTANCE_RE.test(sentence) || !/\p{L}/u.test(sentence)) return undefined;
  return /\?["'”’)\]]*$/.test(sentence) ? undefined : sentence;
}

/**
 * Splits a chunk into sentence-bounded turns of at most `maxWords` words. A
 * single sentence over the cap stays whole — a turn never opens or closes
 * mid-sentence (cave-2emgc).
 */
function splitTurnByWordCap(text: string, maxWords: number): string[] {
  const sentences: string[] = [];
  let last = 0;
  for (const match of text.matchAll(SENTENCE_BREAK_RE)) {
    const end = match.index + match[0].length;
    sentences.push(text.slice(last, end).trim());
    last = end;
  }
  const tail = text.slice(last).trim();
  if (tail) sentences.push(tail);
  const turns: string[] = [];
  let current = "";
  let words = 0;
  for (const sentence of sentences) {
    const count = sentence.split(/\s+/).length;
    if (current && words + count > maxWords) {
      turns.push(current);
      current = sentence;
      words = count;
    } else {
      current = current ? `${current} ${sentence}` : sentence;
      words += count;
    }
  }
  if (current) turns.push(current);
  return turns;
}

/**
 * Turns narration units into alternating host/guest turns. Framing lines are
 * templated structure; every findings turn stays verbatim artifact text.
 */
function draftDialogueScript(
  units: NarrationUnit[],
  template: DialogueTemplate,
): ResearchGenerationScriptSegment[] {
  const turns: { text: string; speaker: ResearchPodcastSpeaker }[] = [];
  let used = 0;
  const push = (text: string, speaker: ResearchPodcastSpeaker) => {
    turns.push({ text, speaker });
    used += text.length;
  };
  if (units.length === 0 || template.opening.length > template.budget) {
    return [];
  }
  // The episode's single challenge lands on the first contested real section;
  // when nothing is contested it falls to the last real section — but never
  // to an episode's only one, which carries the whole rapport.
  let challengeUnit: NarrationUnit | null = null;
  if (template.challenge) {
    const eligible = units.filter(
      (unit) =>
        unit.title !== null &&
        furnitureQuestion(unit.title.replace(/^\d+[.)]\s*/, "")) === null,
    );
    challengeUnit =
      eligible.find((unit) => CONTESTED_TITLE_RE.test(unit.title ?? "")) ??
      (eligible.length > 1 ? eligible[eligible.length - 1] : null);
  }
  push(template.opening, "host");
  // Heading-less lines have no title to frame, so delivery alternates.
  let alternate: ResearchPodcastSpeaker = "guest";
  let section = 0;
  let interjections = 0;
  outer: for (const unit of units) {
    const chunks = splitMediaDraftText(unit.text);
    if (chunks.length === 0) continue;
    if (unit.title !== null) {
      // Document furniture becomes a listener question; real headings get the
      // style's rotating bridge (list numbering never gets spoken).
      const heading = unit.title.replace(/^\d+[.)]\s*/, "");
      const framing =
        furnitureQuestion(heading) ??
        (unit === challengeUnit && template.challenge
          ? template.challenge(heading)
          : template.framing(heading, section));
      // Never leave an orphan host question: the framing line only enters
      // when at least its first findings chunk also fits the budget.
      if (used + framing.length + chunks[0].length > template.budget) break;
      push(framing, "host");
      let guestTurnsInSection = 0;
      for (const chunk of chunks) {
        const guestTurns = template.maxGuestTurnWords
          ? splitTurnByWordCap(chunk, template.maxGuestTurnWords)
          : [chunk];
        for (const turn of guestTurns) {
          if (guestTurnsInSection > 0 && template.interjection) {
            // A host reaction between guest turns only enters when the guest
            // turn it introduces also fits — no orphan interjections.
            const interjection = template.interjection(interjections);
            if (used + interjection.length + turn.length > template.budget) {
              break outer;
            }
            push(interjection, "host");
            interjections += 1;
          } else if (used + turn.length > template.budget) {
            break outer;
          }
          push(turn, "guest");
          guestTurnsInSection += 1;
        }
      }
      // Host synthesis bookend — a section ends on the host's turn, not the
      // guest's last list item. Skipped only when the budget is spent.
      const closer = template.closer(section, sectionTakeaway(chunks));
      if (used + closer.length <= template.budget) {
        push(closer, "host");
      }
      section += 1;
    } else {
      for (const chunk of chunks) {
        if (used + chunk.length > template.budget) break outer;
        push(chunk, alternate);
        alternate = alternate === "guest" ? "host" : "guest";
      }
    }
  }
  // An opening with nothing to deliver is not a podcast.
  if (turns.length < 2) return [];
  return turns.map((turn, index) => ({
    id: `segment-${index + 1}`,
    text: turn.text,
    speaker: turn.speaker,
  }));
}

function storyboardSceneFromSection(
  section: MarkdownSection,
  index: number,
): ResearchGenerationStoryboardScene {
  const bullets = (section.bullets.length > 0
    ? section.bullets
    : section.firstLine
      ? [section.firstLine]
      : []).slice(0, MAX_SLIDE_BULLETS);
  return {
    id: `scene-${index}`,
    title: section.title,
    bullets,
    narration: [section.title, ...bullets].join(". "),
  };
}

function shortVideoStoryboardSceneFromSection(
  section: MarkdownSection,
  index: number,
  maxNarrationCharacters: number,
): ResearchGenerationStoryboardScene | null {
  const availableBullets = (section.bullets.length > 0
    ? section.bullets
    : section.firstLine
      ? [section.firstLine]
      : []).slice(0, MAX_SLIDE_BULLETS);
  const bullets: string[] = [];
  for (const bullet of availableBullets) {
    const narration = [section.title, ...bullets, bullet].join(". ");
    if (narration.length > maxNarrationCharacters) break;
    bullets.push(bullet);
  }
  if (bullets.length === 0 && section.title.length > maxNarrationCharacters) return null;
  return {
    id: `scene-${index}`,
    title: section.title,
    bullets,
    narration: [section.title, ...bullets].join(". "),
  };
}

/** Drafts the bounded storyboard consumed by the short-video path. */
export function draftVideoStoryboardContent(
  source: GenerationDraftSource,
  length: "brief" | "standard",
): ResearchGenerationContent {
  const { documentTitle, sections } = extractMarkdownSections(source.markdown);
  const limits = RESEARCH_MEDIA_LENGTH_LIMITS["short-video"][length];
  const scenes: ResearchGenerationStoryboardScene[] = [];
  let remainingCharacters = limits.maxCharacters;
  if (sections.length > 0) {
    for (const section of sections) {
      if (scenes.length >= limits.maxScenes || remainingCharacters <= 0) break;
      const scene = shortVideoStoryboardSceneFromSection(
        section,
        scenes.length + 1,
        remainingCharacters,
      );
      if (!scene) continue;
      scenes.push(scene);
      remainingCharacters -= scene.narration.length;
    }
  } else {
    for (const unit of mediaNarrationUnits(source)) {
      if (scenes.length >= limits.maxScenes || remainingCharacters <= 0) break;
      if (unit.length > remainingCharacters) continue;
      scenes.push({
        id: `scene-${scenes.length + 1}`,
        title: documentTitle ?? source.artifact.title,
        bullets: [unit],
        narration: unit,
      });
      remainingCharacters -= unit.length;
    }
  }
  return { kind: "short-video", storyboard: scenes };
}

/**
 * Long video follows the artifact's H2 outline. Every H2 starts a chapter and
 * subordinate headings remain inside it in source order.
 */
export function draftLongVideoContent(
  source: GenerationDraftSource,
  length: ResearchMediaLength,
): ResearchGenerationContent {
  const { documentTitle, sections } = extractMarkdownSections(source.markdown);
  const limits = RESEARCH_MEDIA_LENGTH_LIMITS["long-video"][length];
  const maxChapters = limits.maxChapters;
  const maxScenes = limits.maxScenes;
  const chapters: ResearchGenerationVideoChapter[] = [];
  let current: ResearchGenerationVideoChapter | null = null;
  let sceneIndex = 0;

  for (const section of sections) {
    if (sceneIndex >= maxScenes) break;
    if (section.level === 2) {
      if (chapters.length >= maxChapters) {
        current = null;
        continue;
      }
      current = {
        id: `chapter-${chapters.length + 1}`,
        title: section.title,
        scenes: [],
      };
      chapters.push(current);
    }
    if (!current) continue;
    sceneIndex += 1;
    current.scenes.push(storyboardSceneFromSection(section, sceneIndex));
  }

  if (chapters.length === 0) {
    const fallbackScenes =
      sections.length > 0
        ? sections
            .slice(0, maxScenes)
            .map((section, index) => storyboardSceneFromSection(section, index + 1))
        : mediaNarrationUnits(source).slice(0, maxScenes).map((unit, index) => ({
            id: `scene-${index + 1}`,
            title: documentTitle ?? source.artifact.title,
            bullets: [unit],
            narration: unit,
          }));
    chapters.push({
      id: "chapter-1",
      title: documentTitle ?? source.artifact.title,
      scenes: fallbackScenes,
    });
  }

  return { kind: "long-video", chapters };
}

export function draftGenerationContent(
  kind: ResearchGenerationKind,
  source: GenerationDraftSource,
): ResearchGenerationContent {
  switch (kind) {
    case "blog":
      return draftBlogContent(source);
    case "slides":
      return draftSlidesContent(source);
    case "thread":
      return draftThreadContent(source);
    case "diagram":
      return draftDiagramContent(source);
    case "infographic":
      return draftInfographicContent(source);
  }
}

// ── create (draft synchronously, persist on success) ─────────────────────────

export type ResearchGenerationDraftFailure = {
  ok: false;
  /** State conflicts map to HTTP 409 in the route. */
  code:
    | "mission-not-found"
    | "no-artifact"
    | "artifact-unreadable"
    | "media-not-ready"
    | "capacity";
  error: string;
};

export type ResearchGenerationDraftResult =
  | { ok: true; generation: ResearchGeneration }
  | ResearchGenerationDraftFailure;

/**
 * Load the source mission, extract content from its newest markdown artifact,
 * and persist a ready generation. Fails typed — never persists a record that
 * could not draft (no fake queued states).
 */
export async function createResearchGenerationFromMission(
  input: CreateResearchGenerationInput,
): Promise<ResearchGenerationDraftResult> {
  assertFamiliarId(input.familiarId);
  if (isResearchGenerationMediaKind(input.kind)) {
    return {
      ok: false,
      code: "media-not-ready",
      error: "media generation requires the asynchronous media runner",
    };
  }
  const mission = await loadResearchMission(input.sourceMissionId);
  if (!mission || mission.familiarId !== input.familiarId) {
    return {
      ok: false,
      code: "mission-not-found",
      error: "research mission not found for this familiar",
    };
  }
  const artifact = pickGenerationSourceArtifact(mission);
  if (!artifact) {
    return {
      ok: false,
      code: "no-artifact",
      error:
        "this mission has no markdown artifact yet — generations draft from published findings, so let a pass finish first",
    };
  }
  let markdown: string;
  try {
    markdown = await readValidatedMissionFile(mission.id, artifact.relativePath);
  } catch (error) {
    // A workspace-containment failure (symlinked/oversized/escaping artifact)
    // is a client-visible 4xx via the route's artifact-unreadable mapping — the
    // request was valid, the target file fails the sandbox (cave-v73d). A
    // genuine fs fault (ENOENT race, EIO, …) is a real 500 — rethrow it.
    if (isResearchFileIntegrityError(error)) {
      return {
        ok: false,
        code: "artifact-unreadable",
        error: `could not read the mission artifact “${artifact.title}”`,
      };
    }
    throw error;
  }
  const content = draftGenerationContent(input.kind, {
    mission,
    artifact,
    markdown,
  });
  const now = new Date().toISOString();
  const generation: ResearchGeneration = {
    version: 2,
    id: randomUUID(),
    familiarId: input.familiarId,
    kind: input.kind,
    sourceMissionId: mission.id,
    sourceTitle: mission.title,
    sourceArtifactKey: artifact.key,
    // Stored verbatim, displayed, and forwarded to future pipelines — but not
    // passed to draftGenerationContent above. See the module header.
    ...(input.directions ? { directions: input.directions } : {}),
    status: "ready",
    createdAt: now,
    updatedAt: now,
    content,
  };
  const persisted = await withWriteMutex(input.familiarId, async () => {
    const file = await loadFile(input.familiarId);
    if (file.generations.length >= MAX_RESEARCH_GENERATIONS) return false;
    file.generations = [generation, ...file.generations];
    await saveFile(input.familiarId, file);
    return true;
  });
  if (!persisted) {
    return {
      ok: false,
      code: "capacity",
      error:
        "Research Studio has reached its 200-generation limit. Remove a generation before creating another.",
    };
  }
  return { ok: true, generation };
}

/** Draft media source material synchronously, then hand the record to the
 * asynchronous runner. The queued row already contains the reviewable script
 * or storyboard, so a render never hides what will be spoken or shown. */
export async function createResearchMediaGenerationFromMission(
  input: CreateResearchGenerationInput,
): Promise<ResearchGenerationDraftResult> {
  assertFamiliarId(input.familiarId);
  if (!isResearchGenerationMediaKind(input.kind)) {
    return {
      ok: false,
      code: "media-not-ready",
      error: "extractive generations use the synchronous drafting path",
    };
  }
  const mission = await loadResearchMission(input.sourceMissionId);
  if (!mission || mission.familiarId !== input.familiarId) {
    return { ok: false, code: "mission-not-found", error: "research mission not found for this familiar" };
  }
  const artifact = pickGenerationSourceArtifact(mission);
  if (!artifact) {
    return {
      ok: false,
      code: "no-artifact",
      error: "this mission has no markdown artifact yet — media drafts from published findings",
    };
  }
  let markdown: string;
  try {
    markdown = await readValidatedMissionFile(mission.id, artifact.relativePath);
  } catch (error) {
    if (isResearchFileIntegrityError(error)) {
      return { ok: false, code: "artifact-unreadable", error: `could not read the mission artifact “${artifact.title}”` };
    }
    throw error;
  }
  const draftSource = { mission, artifact, markdown };
  const validatedConfig = validateResearchMediaRenderConfig(input.kind, input.renderConfig);
  if (!validatedConfig.ok) {
    return {
      ok: false,
      code: "media-not-ready",
      error: validatedConfig.error,
    };
  }
  const renderConfig = validatedConfig.value;
  let content: ResearchGenerationContent;
  switch (input.kind) {
    case "podcast":
      content = draftPodcastContent(draftSource, renderConfig.length, renderConfig.style);
      break;
    case "short-video":
      if (renderConfig.length === "extended") {
        throw new Error("validated short-video config cannot be extended");
      }
      content = draftVideoStoryboardContent(draftSource, renderConfig.length);
      break;
    case "long-video":
      content = draftLongVideoContent(draftSource, renderConfig.length);
      break;
  }
  const hasNarration =
    content.kind === "podcast"
      ? content.script.length > 0
      : content.kind === "short-video"
        ? content.storyboard.length > 0
        : content.kind === "long-video"
          ? content.chapters.length > 0 &&
            content.chapters.every((chapter) => chapter.scenes.length > 0)
          : true;
  if (!hasNarration) {
    return {
      ok: false,
      code: "media-not-ready",
      error:
        "the source artifact has no narratable findings yet — publish substantive findings before creating media",
    };
  }
  const now = new Date().toISOString();
  const generation: ResearchGeneration = {
    version: 2,
    id: randomUUID(),
    familiarId: input.familiarId,
    kind: input.kind,
    sourceMissionId: mission.id,
    sourceTitle: mission.title,
    sourceArtifactKey: artifact.key,
    ...(input.directions ? { directions: input.directions } : {}),
    status: "draft",
    renderConfig,
    createdAt: now,
    updatedAt: now,
    content,
  };
  const persisted = await withWriteMutex(input.familiarId, async () => {
    const file = await loadFile(input.familiarId);
    if (file.generations.length >= MAX_RESEARCH_GENERATIONS) return false;
    file.generations = [generation, ...file.generations];
    await saveFile(input.familiarId, file);
    return true;
  });
  if (!persisted) {
    return {
      ok: false,
      code: "capacity",
      error:
        "Research Studio has reached its 200-generation limit. Remove a generation before creating another.",
    };
  }
  return { ok: true, generation };
}
