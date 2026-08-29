import { parseFindingsDoc } from "./research-findings-doc.ts";
import type { ResearchSourceRef } from "./research-missions.ts";

export type ResearchIntegritySummaryKind =
  | "unavailable"
  | "unresolved"
  | "conflicting"
  | "candidate"
  | "verified"
  | "rejected"
  | "none";

export type ResearchFindingsIntegrity = {
  ledger: "available" | "empty";
  referencedIds: string[];
  unresolvedIds: string[];
  conflictIds: string[];
  counts: Record<ResearchSourceRef["status"], number>;
  summary: { kind: ResearchIntegritySummaryKind; label: string };
};

const BRACKETED_TOKEN_RE = /\[\s*([^\[\]]+?)\s*\]/g;
const SOURCE_ID_RE = /^(?:S|R)\d+$/;
const CONFLICT_ID_RE = /^C\d+$/;
const FENCE_RE = /^\s{0,3}(`{3,}|~{3,})(.*)$/;

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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function preprocessMarkdownForIntegrity(markdown: string): string {
  return stripBareUrls(stripMarkdownLinksAndImages(stripInlineCode(stripFencedCodeBlocks(markdown ?? ""))));
}

function stripFencedCodeBlocks(markdown: string): string {
  const lines = markdown.split(/\r?\n/);
  let fence: { character: string; length: number } | null = null;

  return lines
    .map((line) => {
      const fenceMatch = FENCE_RE.exec(line);
      if (!fence && fenceMatch) {
        fence = { character: fenceMatch[1][0], length: fenceMatch[1].length };
        return "";
      }
      if (fence && fenceMatch && fenceMatch[1][0] === fence.character && fenceMatch[1].length >= fence.length) {
        fence = null;
        return "";
      }
      return fence ? "" : line;
    })
    .join("\n");
}

function stripInlineCode(markdown: string): string {
  let sanitized = "";

  for (let index = 0; index < markdown.length; index += 1) {
    if (markdown[index] !== "`") {
      sanitized += markdown[index];
      continue;
    }

    let fenceLength = 1;
    while (markdown[index + fenceLength] === "`") fenceLength += 1;
    const marker = "`".repeat(fenceLength);
    const endIndex = markdown.indexOf(marker, index + fenceLength);
    if (endIndex === -1) {
      sanitized += marker;
      index += fenceLength - 1;
      continue;
    }
    index = endIndex + fenceLength - 1;
  }

  return sanitized;
}

function stripMarkdownLinksAndImages(markdown: string): string {
  return markdown
    .replace(/!\[[^\]]*]\(([^)\s]+)\)/g, "")
    .replace(/\[[^\]]+]\(([^)\s]+)\)/g, "");
}

function stripBareUrls(markdown: string): string {
  return markdown.replace(/https?:\/\/[^\s<>()]+/g, "");
}

export function scanBracketedSourceIds(markdown: string): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  const sanitized = preprocessMarkdownForIntegrity(markdown);

  BRACKETED_TOKEN_RE.lastIndex = 0;
  for (let match = BRACKETED_TOKEN_RE.exec(sanitized); match; match = BRACKETED_TOKEN_RE.exec(sanitized)) {
    for (const token of match[1].split(",")) {
      const id = token.trim();
      if (!SOURCE_ID_RE.test(id) || seen.has(id)) continue;
      seen.add(id);
      ids.push(id);
    }
  }

  return ids;
}

function scanConflictMarkerIds(markdown: string): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();

  const conflictPattern = /\[\s*([^\[\]]+?)\s*\]|\b(C\d+)\b/g;
  for (let match = conflictPattern.exec(markdown); match; match = conflictPattern.exec(markdown)) {
    if (match[1] !== undefined) {
      for (const token of match[1].split(",")) {
        const id = token.trim();
        if (!CONFLICT_ID_RE.test(id) || seen.has(id)) continue;
        seen.add(id);
        ids.push(id);
      }
      continue;
    }

    const id = match[2];
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }

  return ids;
}

function scanReferencedIdsInOrder(markdown: string, actualSourceIds: Set<string>): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  const actualIds = [...actualSourceIds].sort((a, b) => b.length - a.length);
  const pattern = actualIds.length
    ? new RegExp(`\\[\\s*([^\\[\\]]+?)\\s*\\]|\\b(${actualIds.map(escapeRegExp).join("|")})\\b`, "g")
    : /\[\s*([^\[\]]+?)\s*\]/g;

  for (let match = pattern.exec(markdown); match; match = pattern.exec(markdown)) {
    if (match[1] !== undefined) {
      for (const token of match[1].split(",")) {
        const id = token.trim();
        if (CONFLICT_ID_RE.test(id) || seen.has(id)) continue;
        if (!SOURCE_ID_RE.test(id) && !actualSourceIds.has(id)) continue;
        seen.add(id);
        ids.push(id);
      }
      continue;
    }

    const id = match[2];
    if (!id || seen.has(id) || CONFLICT_ID_RE.test(id)) continue;
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
  citedRejectedCount: number,
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

  if (citedRejectedCount > 0) {
    return {
      kind: "rejected",
      label: citedRejectedCount === 1 ? "1 rejected source cited" : `${citedRejectedCount} rejected sources cited`,
    };
  }

  return { kind: "none", label: "This report does not cite sources" };
}

export function deriveResearchFindingsIntegrity(
  markdown: string,
  sources: ResearchSourceRef[],
): ResearchFindingsIntegrity {
  const sourceById = new Map<string, ResearchSourceRef>();
  const sanitizedMarkdown = preprocessMarkdownForIntegrity(markdown);

  for (const source of sources) {
    if (!sourceById.has(source.id)) sourceById.set(source.id, source);
  }

  const parserRecognizedSourceIds = new Set(
    parseFindingsDoc(sanitizedMarkdown, sources).refIds.filter(
      (id) => sourceById.has(id) && !CONFLICT_ID_RE.test(id),
    ),
  );
  const referencedIds = scanReferencedIdsInOrder(sanitizedMarkdown, parserRecognizedSourceIds);
  const unresolvedIds = referencedIds.filter((id) => !sourceById.has(id));
  const conflictMarkerIds = scanConflictMarkerIds(sanitizedMarkdown);
  const conflictingSourceIds = uniqueIdsInOrder(
    sources.filter((source) => source.status === "conflicting").map((source) => source.id),
  );
  const conflictIds = uniqueIdsInOrder([...conflictMarkerIds, ...conflictingSourceIds]);
  const citedCandidateCount = referencedIds.filter((id) => sourceById.get(id)?.status === "candidate").length;
  const citedUsedCount = referencedIds.filter((id) => sourceById.get(id)?.status === "used").length;
  const citedRejectedCount = referencedIds.filter((id) => sourceById.get(id)?.status === "rejected").length;
  const integrity: ResearchFindingsIntegrity = {
    ledger: sources.length > 0 ? "available" : "empty",
    referencedIds,
    unresolvedIds,
    conflictIds,
    counts: countStatuses(sources),
    summary: { kind: "none", label: "This report does not cite sources" },
  };

  integrity.summary = summarize(integrity, citedCandidateCount, citedUsedCount, citedRejectedCount);
  return integrity;
}
