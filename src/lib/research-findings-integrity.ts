import type { ResearchSourceRef } from "./research-missions.ts";

export type ResearchIntegritySummaryKind =
  | "unavailable"
  | "unresolved"
  | "conflicting"
  | "candidate"
  | "verified"
  | "none";

export type ResearchFindingsIntegrity = {
  ledger: "available" | "empty";
  referencedIds: string[];
  unresolvedIds: string[];
  conflictIds: string[];
  counts: Record<ResearchSourceRef["status"], number>;
  summary: { kind: ResearchIntegritySummaryKind; label: string };
};

const BRACKETED_SOURCE_RE = /\[\s*([A-Z]\d+(?:\s*,\s*[A-Z]\d+)*)\s*\]/g;
const CONFLICT_MARKER_RE = /\b(C\d+)\b/g;

function emptyCounts(): Record<ResearchSourceRef["status"], number> {
  return { candidate: 0, used: 0, conflicting: 0, rejected: 0 };
}

function uniqueIdsInOrder(ids: string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    unique.push(id);
  }
  return unique;
}

export function scanBracketedSourceIds(markdown: string): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();

  BRACKETED_SOURCE_RE.lastIndex = 0;
  for (let match = BRACKETED_SOURCE_RE.exec(markdown); match; match = BRACKETED_SOURCE_RE.exec(markdown)) {
    for (const id of match[1].split(",")) {
      const trimmed = id.trim();
      if (!trimmed || seen.has(trimmed)) continue;
      seen.add(trimmed);
      ids.push(trimmed);
    }
  }

  return ids;
}

function scanConflictMarkerIds(markdown: string): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  const bareMarkdown = markdown.replace(/\[[^\[\]]*\]/g, " ");

  CONFLICT_MARKER_RE.lastIndex = 0;
  for (let match = CONFLICT_MARKER_RE.exec(bareMarkdown); match; match = CONFLICT_MARKER_RE.exec(bareMarkdown)) {
    const id = match[1];
    if (seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }

  return ids;
}

function countStatuses(sources: ResearchSourceRef[]): Record<ResearchSourceRef["status"], number> {
  const counts = emptyCounts();
  for (const source of sources) {
    counts[source.status] += 1;
  }
  return counts;
}

function summarize(
  integrity: ResearchFindingsIntegrity,
  citedCandidateCount: number,
  citedUsedCount: number,
): { kind: ResearchIntegritySummaryKind; label: string } {
  const unresolvedCount = integrity.unresolvedIds.length;
  const conflictCount = integrity.conflictIds.length;

  if (integrity.ledger === "empty" && integrity.referencedIds.length > 0) {
    return { kind: "unavailable", label: "Sources unavailable — references can't be verified" };
  }

  if (unresolvedCount > 0) {
    return {
      kind: "unresolved",
      label: unresolvedCount === 1 ? "1 reference is unresolved" : `${unresolvedCount} references are unresolved`,
    };
  }

  if (conflictCount > 0) {
    return {
      kind: "conflicting",
      label: conflictCount === 1 ? "1 conflict remains" : `${conflictCount} conflicts remain`,
    };
  }

  if (citedCandidateCount > 0) {
    return {
      kind: "candidate",
      label: citedCandidateCount === 1 ? "1 source awaits review" : `${citedCandidateCount} sources await review`,
    };
  }

  if (citedUsedCount > 0) {
    return {
      kind: "verified",
      label: citedUsedCount === 1 ? "1 source verified" : `${citedUsedCount} sources verified`,
    };
  }

  return { kind: "none", label: "This report does not cite sources" };
}

export function deriveResearchFindingsIntegrity(
  markdown: string,
  sources: ResearchSourceRef[],
): ResearchFindingsIntegrity {
  const referencedIds = scanBracketedSourceIds(markdown);
  const sourceById = new Map<string, ResearchSourceRef>();

  for (const source of sources) {
    if (!sourceById.has(source.id)) sourceById.set(source.id, source);
  }

  const unresolvedIds = referencedIds.filter((id) => !sourceById.has(id));
  const conflictMarkerIds = scanConflictMarkerIds(markdown);
  const conflictingSourceIds = uniqueIdsInOrder(
    sources.filter((source) => source.status === "conflicting").map((source) => source.id),
  );
  const conflictIds = uniqueIdsInOrder([...conflictMarkerIds, ...conflictingSourceIds]);
  const citedCandidateCount = referencedIds.filter((id) => sourceById.get(id)?.status === "candidate").length;
  const citedUsedCount = referencedIds.filter((id) => sourceById.get(id)?.status === "used").length;
  const integrity: ResearchFindingsIntegrity = {
    ledger: sources.length > 0 ? "available" : "empty",
    referencedIds,
    unresolvedIds,
    conflictIds,
    counts: countStatuses(sources),
    summary: { kind: "none", label: "This report does not cite sources" },
  };

  integrity.summary = summarize(integrity, citedCandidateCount, citedUsedCount);
  return integrity;
}
