/**
 * Durable store + extractive drafting for Research Studio generations.
 *
 * One JSON file per familiar under ~/.coven/…/research-generations/. Drafting
 * is synchronous and strictly extractive: content is derived from the source
 * mission's newest published (else working) markdown artifact plus the
 * mission's own phase/step structure. Every content string either comes from
 * the artifact/mission fields verbatim or is pure structure ("graph TD",
 * slide numbering, "1/4" thread markers) — nothing is invented.
 *
 * The optional `directions` field is stored verbatim on the record so the UI
 * can display it and a future generation pipeline can consume it, but it is
 * deliberately NEVER read by any drafting function below: mechanical
 * extraction cannot take editorial direction without inventing emphasis, so
 * directions are forwarded, not interpreted.
 */

import { randomUUID } from "node:crypto";
import { copyFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";

import {
  isResearchGenerationContent,
  isResearchGenerationKind,
  isResearchGenerationStatus,
  isValidResearchGenerationFamiliarId,
  RESEARCH_GENERATION_DIRECTIONS_MAX_LENGTH,
  type CreateResearchGenerationInput,
  type ResearchGeneration,
  type ResearchGenerationContent,
  type ResearchGenerationKind,
  type ResearchGenerationSlide,
  type ResearchGenerationStat,
  type ResearchGenerationThreadPost,
} from "../research-generations.ts";
import type { ResearchArtifactRef, ResearchMission } from "../research-missions.ts";
import { caveHome } from "../coven-paths.ts";
import { writeJsonAtomic } from "./atomic-write.ts";
import { corruptAsidePath } from "./corrupt-aside.ts";
import {
  loadResearchMission,
  readValidatedMissionFile,
} from "./research-mission-store.ts";

export const MAX_RESEARCH_GENERATIONS = 200;

type ResearchGenerationsFile = {
  version: 1;
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
  return { version: 1, generations: [] };
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
  if (!isResearchGenerationKind(raw.kind)) return null;
  if (!isResearchGenerationStatus(raw.status)) return null;
  if (typeof raw.sourceMissionId !== "string" || !raw.sourceMissionId) return null;
  const content = raw.content;
  if (content !== undefined) {
    if (!isResearchGenerationContent(content) || content.kind !== raw.kind) return null;
  }
  if (raw.status === "ready" && content === undefined) return null;
  const timestamp = (candidate: unknown): string =>
    typeof candidate === "string" && Number.isFinite(Date.parse(candidate))
      ? candidate
      : new Date().toISOString();
  return {
    version: 1,
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
  return { version: 1, generations };
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
  const next = previous.then(fn, fn);
  locks.set(
    familiarId,
    next.then(
      () => undefined,
      () => undefined,
    ),
  );
  return next;
}

/** Newest first. */
export async function listResearchGenerations(
  familiarId: string,
): Promise<ResearchGeneration[]> {
  assertFamiliarId(familiarId);
  const file = await loadFile(familiarId);
  return [...file.generations].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
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

// ── source artifact selection ────────────────────────────────────────────────

function isMarkdownArtifact(artifact: ResearchArtifactRef): boolean {
  return artifact.relativePath.toLowerCase().endsWith(".md");
}

/**
 * The newest published markdown artifact; when the mission has published
 * nothing yet, the newest working one. Rejected artifacts never qualify.
 */
export function pickGenerationSourceArtifact(
  mission: Pick<ResearchMission, "artifacts">,
): ResearchArtifactRef | null {
  const markdown = mission.artifacts.filter(isMarkdownArtifact);
  const byNewest = (a: ResearchArtifactRef, b: ResearchArtifactRef) =>
    b.updatedAt.localeCompare(a.updatedAt);
  const published = markdown.filter((artifact) => artifact.state === "published").sort(byNewest);
  if (published.length > 0) return published[0];
  const working = markdown.filter((artifact) => artifact.state === "working").sort(byNewest);
  return working[0] ?? null;
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

/** Hook from the mission title + key claims from headings and bold lines. */
export function draftThreadContent(source: GenerationDraftSource): ResearchGenerationContent {
  const { sections } = extractMarkdownSections(source.markdown);
  const claims: string[] = [];
  const seen = new Set<string>();
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
  const texts = [source.mission.title, ...claims].slice(0, MAX_THREAD_POSTS);
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
  /** no-artifact maps to HTTP 409 in the route; mission-not-found to 404. */
  code: "mission-not-found" | "no-artifact" | "artifact-unreadable";
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
  } catch {
    return {
      ok: false,
      code: "artifact-unreadable",
      error: `could not read the mission artifact “${artifact.title}”`,
    };
  }
  const content = draftGenerationContent(input.kind, {
    mission,
    artifact,
    markdown,
  });
  const now = new Date().toISOString();
  const generation: ResearchGeneration = {
    version: 1,
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
  await withWriteMutex(input.familiarId, async () => {
    const file = await loadFile(input.familiarId);
    file.generations = [generation, ...file.generations].slice(0, MAX_RESEARCH_GENERATIONS);
    await saveFile(input.familiarId, file);
  });
  return { ok: true, generation };
}
