import path from "node:path";
import type { KnowledgeEntry } from "./server/knowledge-vault.ts";
import {
  RESEARCH_ARTIFACT_KINDS,
  type ResearchArtifactKind,
  type ResearchArtifactRef,
  type ResearchMission,
  type ResearchSourceDraft,
  type ResearchSourceRef,
} from "./research-missions.ts";

export type { ResearchSourceDraft } from "./research-missions.ts";

export const RESEARCH_CONTROL_MARKER = "@@research-control";
export const RESEARCH_ARTIFACTS_WRITTEN_MARKER = "@@research-artifacts-written";
export const MAX_RESEARCH_ARTIFACT_BYTES = 1024 * 1024;

export type ResearchControl = {
  decision: "continue" | "checkpoint" | "complete";
  reason: string;
  confidence: number | null;
};

export type ResearchProvenance = {
  missionId: string;
  iteration: number;
  flowRunId?: string;
  sessionId?: string;
  automationRunId?: string;
  generatedAt: string;
};

export type ResearchArtifactDraft = {
  kind: ResearchArtifactKind;
  path: string;
};

export type ContractResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: string };

export type PublishArtifactArgs = {
  mission: ResearchMission;
  artifact: ResearchArtifactRef;
  provenance: ResearchProvenance;
  markdown: string;
};

const MALFORMED_CONTROL: ResearchControl = {
  decision: "checkpoint",
  reason: "Missing or malformed research control output",
  confidence: null,
};

function cleanText(value: unknown, maxLength: number): string {
  if (typeof value !== "string") return "";
  return value.replace(/[\u0000-\u001f\u007f]+/g, " ").trim().slice(0, maxLength);
}

export function parseResearchControl(transcript: string): ResearchControl {
  const lines = transcript.split(/\r?\n/);
  const markerIndex = lines.lastIndexOf(RESEARCH_CONTROL_MARKER);
  if (
    markerIndex < 0 ||
    markerIndex + 2 >= lines.length ||
    lines[markerIndex + 2] !== RESEARCH_ARTIFACTS_WRITTEN_MARKER
  ) {
    return { ...MALFORMED_CONTROL };
  }

  try {
    const value = JSON.parse(lines[markerIndex + 1]) as Partial<ResearchControl>;
    if (!value || !["continue", "checkpoint", "complete"].includes(value.decision ?? "")) {
      return { ...MALFORMED_CONTROL };
    }
    const reason = cleanText(value.reason, 500);
    const confidence =
      typeof value.confidence === "number" && Number.isFinite(value.confidence)
        ? Math.max(0, Math.min(1, value.confidence))
        : null;
    return {
      decision: value.decision as ResearchControl["decision"],
      reason: reason || "No reason supplied",
      confidence,
    };
  } catch {
    return { ...MALFORMED_CONTROL };
  }
}

function normalizeWebUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (!(["http:", "https:"] as string[]).includes(url.protocol)) return null;
    if (!url.hostname || url.username || url.password) return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

export function normalizeResearchSource(
  draft: ResearchSourceDraft,
): ContractResult<ResearchSourceRef> {
  const id = cleanText(draft.id, 128);
  const title = cleanText(draft.title, 300);
  if (!id || !title) return { ok: false, reason: "Source id and title are required" };
  const url = normalizeWebUrl(draft.url);
  const localPath =
    typeof draft.localPath === "string" &&
    path.isAbsolute(draft.localPath) &&
    !draft.localPath.includes("\0")
      ? path.normalize(draft.localPath)
      : null;
  if (!url && !localPath) {
    return { ok: false, reason: "Source requires a safe URL or absolute local path" };
  }
  if (
    draft.confidence !== undefined &&
    (typeof draft.confidence !== "number" ||
      !Number.isFinite(draft.confidence) ||
      draft.confidence < 0 ||
      draft.confidence > 1)
  ) {
    return { ok: false, reason: "Source confidence must be between 0 and 1" };
  }
  const allowedStatuses: ResearchSourceRef["status"][] = [
    "candidate",
    "used",
    "conflicting",
    "rejected",
  ];
  const status = allowedStatuses.includes(draft.status ?? "candidate")
    ? (draft.status ?? "candidate")
    : "candidate";
  return {
    ok: true,
    value: {
      id,
      title,
      ...(url ? { url } : {}),
      ...(localPath ? { localPath } : {}),
      ...(cleanText(draft.publisher, 200) ? { publisher: cleanText(draft.publisher, 200) } : {}),
      ...(cleanText(draft.publishedAt, 100) ? { publishedAt: cleanText(draft.publishedAt, 100) } : {}),
      sourceType: cleanText(draft.sourceType, 100) || (url ? "web" : "local"),
      ...(cleanText(draft.claim, 2_000) ? { claim: cleanText(draft.claim, 2_000) } : {}),
      ...(cleanText(draft.note, 2_000) ? { note: cleanText(draft.note, 2_000) } : {}),
      ...(draft.confidence === undefined ? {} : { confidence: draft.confidence }),
      status,
    },
  };
}

/** Parse and normalize the authoritative sources.json payload. Keep this
 * outside the runner so read-only routes can validate the ledger without
 * importing the runner's orchestration graph. */
export function parseResearchSourcesFile(raw: string): ResearchSourceRef[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("sources.json is malformed");
  }
  if (!Array.isArray(parsed)) {
    throw new Error("sources.json must contain an array");
  }
  return parsed.map((item, index) => {
    const normalized = normalizeResearchSource(
      item as Parameters<typeof normalizeResearchSource>[0],
    );
    if (!normalized.ok) {
      throw new Error(
        `sources.json source ${index + 1}: ${normalized.reason}`,
      );
    }
    return normalized.value;
  });
}

export function researchSourcesShareIdentity(
  left: ResearchSourceRef,
  right: ResearchSourceRef,
): boolean {
  return left.id === right.id ||
    Boolean(left.url && right.url && left.url === right.url) ||
    Boolean(
      left.localPath &&
      right.localPath &&
      left.localPath === right.localPath,
    );
}

function ambiguousResearchSourceIdentities(): never {
  throw new Error("Research source identities are ambiguous");
}

function indexDistinctResearchSourceIds(
  sources: ResearchSourceRef[],
): Map<string, number> {
  const owners = new Map<string, number>();

  sources.forEach((source, index) => {
    if (owners.has(source.id)) ambiguousResearchSourceIdentities();
    owners.set(source.id, index);
  });

  return owners;
}

function researchSourcesShareSecondaryIdentity(
  left: ResearchSourceRef,
  right: ResearchSourceRef,
): boolean {
  return Boolean(left.url && right.url && left.url === right.url) ||
    Boolean(
      left.localPath &&
      right.localPath &&
      left.localPath === right.localPath,
    );
}

/**
 * Reconcile a healthy file snapshot with the mission's current user-owned
 * source state. Exact ids pair first. Remaining rows may bridge by one unique
 * URL or local-path match; shared secondary identities otherwise stay distinct
 * or fail closed when they make the bridge ambiguous. Mission order and fields
 * win, and unmatched file rows follow in their file order.
 */
export function reconcileResearchSourcesForRead(
  fileSources: ResearchSourceRef[],
  missionSources: ResearchSourceRef[],
): ResearchSourceRef[] {
  const fileIdOwners = indexDistinctResearchSourceIds(fileSources);
  indexDistinctResearchSourceIds(missionSources);

  const matchedFileIndexes = new Set<number>();
  const fileIndexByMissionIndex = new Map<number, number>();

  missionSources.forEach((missionSource, missionIndex) => {
    const fileIndex = fileIdOwners.get(missionSource.id);
    if (fileIndex === undefined) return;
    matchedFileIndexes.add(fileIndex);
    fileIndexByMissionIndex.set(missionIndex, fileIndex);
  });

  const candidateMissionIndexesByFile = new Map<number, number[]>();
  missionSources.forEach((missionSource, missionIndex) => {
    if (fileIndexByMissionIndex.has(missionIndex)) return;

    const candidateFileIndexes: number[] = [];
    fileSources.forEach((fileSource, fileIndex) => {
      if (
        !matchedFileIndexes.has(fileIndex) &&
        researchSourcesShareSecondaryIdentity(missionSource, fileSource)
      ) {
        candidateFileIndexes.push(fileIndex);
      }
    });
    if (candidateFileIndexes.length > 1) ambiguousResearchSourceIdentities();
    const fileIndex = candidateFileIndexes[0];
    if (fileIndex === undefined) return;
    const candidateMissionIndexes =
      candidateMissionIndexesByFile.get(fileIndex) ?? [];
    candidateMissionIndexes.push(missionIndex);
    candidateMissionIndexesByFile.set(fileIndex, candidateMissionIndexes);
  });

  for (const [fileIndex, missionIndexes] of candidateMissionIndexesByFile) {
    if (missionIndexes.length > 1) ambiguousResearchSourceIdentities();
    matchedFileIndexes.add(fileIndex);
    fileIndexByMissionIndex.set(missionIndexes[0], fileIndex);
  }

  const reconciledMissionSources = missionSources.map((missionSource, missionIndex) => {
    const fileIndex = fileIndexByMissionIndex.get(missionIndex);
    if (fileIndex === undefined) return missionSource;
    return {
      ...fileSources[fileIndex],
      ...missionSource,
    };
  });

  const reconciledSources = [
    ...reconciledMissionSources,
    ...fileSources.filter((_, index) => !matchedFileIndexes.has(index)),
  ];
  indexDistinctResearchSourceIds(reconciledSources);
  return reconciledSources;
}

export function normalizeResearchArtifact(
  draft: ResearchArtifactDraft,
): ContractResult<{ kind: ResearchArtifactKind; relativePath: string }> {
  if (!(RESEARCH_ARTIFACT_KINDS as readonly string[]).includes(draft.kind)) {
    return { ok: false, reason: "Unsupported research artifact kind" };
  }
  const relativePath = draft.path.trim();
  if (
    !relativePath.startsWith("artifacts/") ||
    relativePath.includes("\\") ||
    path.posix.isAbsolute(relativePath) ||
    path.posix.normalize(relativePath) !== relativePath
  ) {
    return { ok: false, reason: "Artifact path must stay inside artifacts" };
  }
  const extension = path.posix.extname(relativePath).toLowerCase();
  const allowedExtensions = draft.kind === "presentation" ? [".md", ".html"] : [".md"];
  if (!allowedExtensions.includes(extension)) {
    return { ok: false, reason: "Unsupported artifact file type" };
  }
  return { ok: true, value: { kind: draft.kind, relativePath } };
}

export function validateResearchArtifactContent(
  kind: ResearchArtifactKind,
  content: string,
): ContractResult<string> {
  if (!(RESEARCH_ARTIFACT_KINDS as readonly string[]).includes(kind)) {
    return { ok: false, reason: "Unsupported research artifact kind" };
  }
  if (new TextEncoder().encode(content).byteLength > MAX_RESEARCH_ARTIFACT_BYTES) {
    return { ok: false, reason: "Research artifact is too large" };
  }
  return { ok: true, value: content };
}

function provenanceValue(value: string | number | undefined): string {
  return cleanText(value === undefined ? "unavailable" : String(value), 300) || "unavailable";
}

export function researchProvenanceHeader(provenance: ResearchProvenance): string {
  return [
    "<!-- research-provenance",
    `mission: ${provenanceValue(provenance.missionId)}`,
    `iteration: ${provenanceValue(provenance.iteration)}`,
    `flow_run: ${provenanceValue(provenance.flowRunId)}`,
    `session: ${provenanceValue(provenance.sessionId)}`,
    `automation_run: ${provenanceValue(provenance.automationRunId)}`,
    `generated_at: ${provenanceValue(provenance.generatedAt)}`,
    "-->",
  ].join("\n");
}

function knowledgeId(missionId: string, artifactKey: string): string {
  return ["research", missionId, artifactKey]
    .join("-")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

export function researchKnowledgeEntry(args: PublishArtifactArgs): KnowledgeEntry {
  return {
    id: knowledgeId(args.mission.id, args.artifact.key),
    title: args.artifact.title,
    tags: [
      "research",
      `mission:${args.mission.id}`,
      args.mission.mode,
      args.artifact.kind,
    ],
    scope: [args.mission.familiarId],
    enabled: true,
    body: `${researchProvenanceHeader(args.provenance)}\n\n${args.markdown.trim()}\n`,
  };
}

/** Render the mission's merged sources as a markdown ledger for Vault
 *  publication — sources.json itself is machine-shaped, not readable. */
export function renderSourceLedgerMarkdown(sources: ResearchSourceRef[]): string {
  const lines = ["# Source ledger", ""];
  if (sources.length === 0) {
    lines.push("No sources were recorded for this mission.");
    return `${lines.join("\n")}\n`;
  }
  lines.push(`${sources.length} source${sources.length === 1 ? "" : "s"} recorded for this mission.`, "");
  sources.forEach((source, index) => {
    const indent = " ".repeat(String(index + 1).length + 2);
    lines.push(`${index + 1}. **${source.title}** — ${source.status} · ${source.sourceType}`);
    if (source.url) lines.push(`${indent}- URL: ${source.url}`);
    if (source.localPath) lines.push(`${indent}- Local path: ${source.localPath}`);
    if (source.publisher) {
      lines.push(`${indent}- Publisher: ${source.publisher}${source.publishedAt ? ` (${source.publishedAt})` : ""}`);
    } else if (source.publishedAt) {
      lines.push(`${indent}- Published: ${source.publishedAt}`);
    }
    if (source.claim) lines.push(`${indent}- Claim: ${source.claim}`);
    if (source.note) lines.push(`${indent}- Note: ${source.note}`);
    if (source.confidence !== undefined) lines.push(`${indent}- Confidence: ${source.confidence}`);
  });
  return `${lines.join("\n")}\n`;
}
