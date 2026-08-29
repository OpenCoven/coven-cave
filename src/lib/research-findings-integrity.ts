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
  ledger: "available" | "empty" | "failed";
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

function unavailableSummary(): { kind: ResearchIntegritySummaryKind; label: string } {
  return { kind: "unavailable", label: "Sources unavailable — references can't be verified" };
}

function preprocessMarkdownForIntegrity(markdown: string): string {
  return stripBareUrls(stripMarkdownLinksAndImages(stripInlineCode(stripFencedCodeBlocks(markdown ?? ""))));
}

function isClosingFence(
  fenceMatch: RegExpExecArray,
  fence: { character: string; length: number },
): boolean {
  return (
    fenceMatch[1][0] === fence.character &&
    fenceMatch[1].length >= fence.length &&
    !fenceMatch[2].trim()
  );
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
      if (fence) {
        if (fenceMatch && isClosingFence(fenceMatch, fence)) fence = null;
        return "";
      }
      return line;
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
    sanitized += " ";
    index = endIndex + fenceLength - 1;
  }

  return sanitized;
}

function findBalancedClose(input: string, startIndex: number, open: string, close: string): number {
  let depth = 1;

  for (let index = startIndex; index < input.length; index += 1) {
    const character = input[index];
    if (character === "\\") {
      index += 1;
      continue;
    }
    if (character === open) {
      depth += 1;
      continue;
    }
    if (character !== close) continue;
    depth -= 1;
    if (depth === 0) return index;
  }

  return -1;
}

function stripMarkdownLinksAndImages(markdown: string): string {
  let sanitized = "";

  for (let index = 0; index < markdown.length; index += 1) {
    const isImage = markdown[index] === "!" && markdown[index + 1] === "[";
    const isLink = markdown[index] === "[";
    if (!isImage && !isLink) {
      sanitized += markdown[index];
      continue;
    }

    const labelStart = index + (isImage ? 2 : 1);
    const labelEnd = findBalancedClose(markdown, labelStart, "[", "]");
    if (labelEnd === -1) {
      sanitized += markdown[index];
      continue;
    }

    const destinationStart = labelEnd + 1;
    if (markdown[destinationStart] !== "(") {
      sanitized += markdown.slice(index, destinationStart);
      index = destinationStart - 1;
      continue;
    }

    const destinationEnd = findBalancedClose(markdown, destinationStart + 1, "(", ")");
    if (destinationEnd === -1) {
      sanitized += markdown[index];
      continue;
    }

    if (isLink) sanitized += stripMarkdownLinksAndImages(markdown.slice(labelStart, labelEnd));
    index = destinationEnd;
  }

  return sanitized;
}

function stripBareUrls(markdown: string): string {
  let sanitized = "";
  let cursor = 0;
  const urlPattern = /https?:\/\//g;

  for (let match = urlPattern.exec(markdown); match; match = urlPattern.exec(markdown)) {
    let end = match.index + match[0].length;
    while (end < markdown.length && !/\s/.test(markdown[end])) end += 1;
    sanitized += markdown.slice(cursor, match.index);
    sanitized += " ";
    cursor = end;
    urlPattern.lastIndex = end;
  }

  return sanitized + markdown.slice(cursor);
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

  if (integrity.ledger === "failed") return unavailableSummary();
  if (integrity.ledger === "empty" && integrity.referencedIds.length > 0) return unavailableSummary();

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
  options: { ledger?: ResearchFindingsIntegrity["ledger"] } = {},
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
    ledger: options.ledger ?? (sources.length > 0 ? "available" : "empty"),
    referencedIds,
    unresolvedIds,
    conflictIds,
    counts: countStatuses(sources),
    summary: { kind: "none", label: "This report does not cite sources" },
  };

  integrity.summary = summarize(integrity, citedCandidateCount, citedUsedCount, citedRejectedCount);
  return integrity;
}
