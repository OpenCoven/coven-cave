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

const SOURCE_ID_RE = /^(?:S|R)\d+$/;
const CONFLICT_ID_RE = /^C\d+$/;

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

function unavailableSummary(): { kind: ResearchIntegritySummaryKind; label: string } {
  return { kind: "unavailable", label: "Sources unavailable — references can't be verified" };
}

function preprocessMarkdownForIntegrity(markdown: string): string {
  const withoutComments = stripHtmlComments(markdown ?? "");
  const withoutBlocks = stripFencedCodeAndReferenceDefinitions(withoutComments);
  const withoutCode = stripInlineCode(withoutBlocks);
  const withoutMarkdownTargets = stripMarkdownLinksAndImages(withoutCode);
  return stripBareUrls(withoutMarkdownTargets);
}

function stripHtmlComments(markdown: string): string {
  let sanitized = "";
  let cursor = 0;

  while (cursor < markdown.length) {
    const commentStart = markdown.indexOf("<!--", cursor);
    if (commentStart === -1) return sanitized + markdown.slice(cursor);
    const commentEnd = markdown.indexOf("-->", commentStart + 4);
    if (commentEnd === -1) return sanitized + markdown.slice(cursor);
    sanitized += markdown.slice(cursor, commentStart);
    cursor = commentEnd + 3;
  }

  return sanitized;
}

type FenceRun = { character: "`" | "~"; length: number; suffix: string };

function readFenceRun(line: string): FenceRun | null {
  let index = 0;
  while (index < 3 && line[index] === " ") index += 1;

  const character = line[index];
  if (character !== "`" && character !== "~") return null;

  const runStart = index;
  while (line[index] === character) index += 1;
  const length = index - runStart;
  if (length < 3) return null;

  return { character, length, suffix: line.slice(index) };
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

function isReferenceDefinitionLine(line: string): boolean {
  let labelStart = 0;
  while (labelStart < 3 && line[labelStart] === " ") labelStart += 1;
  if (line[labelStart] !== "[") return false;

  const labelEnd = findBalancedClose(line, labelStart + 1, "[", "]");
  return labelEnd > labelStart + 1 && line[labelEnd + 1] === ":";
}

function stripFencedCodeAndReferenceDefinitions(markdown: string): string {
  const lines = markdown.split(/\r?\n/);
  let fence: { character: string; length: number } | null = null;

  return lines
    .map((line) => {
      const run = readFenceRun(line);
      if (fence) {
        if (
          run &&
          run.character === fence.character &&
          run.length >= fence.length &&
          !run.suffix.trim()
        ) {
          fence = null;
        }
        return "";
      }
      if (run) {
        fence = { character: run.character, length: run.length };
        return "";
      }
      if (isReferenceDefinitionLine(line)) return "";
      return line;
    })
    .join("\n");
}

function isEscaped(input: string, index: number): boolean {
  let slashCount = 0;
  for (let cursor = index - 1; cursor >= 0 && input[cursor] === "\\"; cursor -= 1) {
    slashCount += 1;
  }
  return slashCount % 2 === 1;
}

function backtickRunLength(input: string, index: number): number {
  let length = 0;
  while (input[index + length] === "`") length += 1;
  return length;
}

function findClosingBacktickRun(input: string, startIndex: number, openerLength: number): number {
  for (let index = startIndex; index < input.length; ) {
    if (input[index] !== "`" || isEscaped(input, index)) {
      index += 1;
      continue;
    }

    const length = backtickRunLength(input, index);
    if (length === openerLength) return index;
    index += length;
  }

  return -1;
}

function stripInlineCode(markdown: string): string {
  let sanitized = "";

  for (let index = 0; index < markdown.length; ) {
    if (markdown[index] !== "`" || isEscaped(markdown, index)) {
      sanitized += markdown[index];
      index += 1;
      continue;
    }

    const openerLength = backtickRunLength(markdown, index);
    const closeIndex = findClosingBacktickRun(markdown, index + openerLength, openerLength);
    if (closeIndex === -1) {
      sanitized += markdown.slice(index, index + openerLength);
      index += openerLength;
      continue;
    }

    sanitized += " ";
    index = closeIndex + openerLength;
  }

  return sanitized;
}

function stripMarkdownLinksAndImages(markdown: string): string {
  let sanitized = "";

  for (let index = 0; index < markdown.length; ) {
    const isImage =
      markdown[index] === "!" &&
      markdown[index + 1] === "[" &&
      !isEscaped(markdown, index);
    const isLink = markdown[index] === "[" && !isEscaped(markdown, index);
    if (!isImage && !isLink) {
      sanitized += markdown[index];
      index += 1;
      continue;
    }

    const labelStart = index + (isImage ? 2 : 1);
    const labelEnd = findBalancedClose(markdown, labelStart, "[", "]");
    if (labelEnd === -1) {
      sanitized += markdown[index];
      index += 1;
      continue;
    }

    let constructEnd = labelEnd + 1;
    const suffixStart = labelEnd + 1;
    const suffixOpen = markdown[suffixStart];
    if (suffixOpen === "(" || suffixOpen === "[") {
      const suffixClose = suffixOpen === "(" ? ")" : "]";
      const suffixEnd = findBalancedClose(markdown, suffixStart + 1, suffixOpen, suffixClose);
      if (suffixEnd === -1) {
        sanitized += markdown[index];
        index += 1;
        continue;
      }
      constructEnd = suffixEnd + 1;
    } else if (!isImage) {
      sanitized += markdown[index];
      index += 1;
      continue;
    }

    sanitized += isImage
      ? " "
      : stripMarkdownLinksAndImages(markdown.slice(labelStart, labelEnd));
    index = constructEnd;
  }

  return sanitized;
}

function stripBareUrls(markdown: string): string {
  let sanitized = "";
  for (let index = 0; index < markdown.length; ) {
    const protocolLength = markdown.startsWith("https://", index)
      ? "https://".length
      : markdown.startsWith("http://", index)
        ? "http://".length
        : 0;
    if (!protocolLength) {
      sanitized += markdown[index];
      index += 1;
      continue;
    }

    let parenDepth = 0;
    index += protocolLength;
    while (index < markdown.length) {
      const character = markdown[index];
      if (/\s/.test(character)) break;
      if (character === "[" && parenDepth === 0) break;
      if (character === "(") parenDepth += 1;
      else if (character === ")" && parenDepth > 0) parenDepth -= 1;
      index += 1;
    }
    sanitized += " ";
  }

  return sanitized;
}

function scanStrictBracketedSourceIds(sanitizedMarkdown: string): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();

  for (let index = 0; index < sanitizedMarkdown.length; ) {
    if (sanitizedMarkdown[index] !== "[" || isEscaped(sanitizedMarkdown, index)) {
      index += 1;
      continue;
    }

    const closeIndex = findBalancedClose(sanitizedMarkdown, index + 1, "[", "]");
    if (closeIndex === -1) {
      index += 1;
      continue;
    }
    for (const token of sanitizedMarkdown.slice(index + 1, closeIndex).split(",")) {
      const id = token.trim();
      if (!SOURCE_ID_RE.test(id) || seen.has(id)) continue;
      seen.add(id);
      ids.push(id);
    }
    index = closeIndex + 1;
  }

  return ids;
}

export function scanBracketedSourceIds(markdown: string): string[] {
  return scanStrictBracketedSourceIds(preprocessMarkdownForIntegrity(markdown));
}

function isTokenCharacter(character: string | undefined): boolean {
  if (!character) return false;
  const code = character.charCodeAt(0);
  return (
    (code >= 48 && code <= 57) ||
    (code >= 65 && code <= 90) ||
    code === 95 ||
    (code >= 97 && code <= 122)
  );
}

function scanConflictMarkerIds(markdown: string): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();

  for (let index = 0; index < markdown.length; ) {
    if (markdown[index] !== "C" || isTokenCharacter(markdown[index - 1])) {
      index += 1;
      continue;
    }

    let endIndex = index + 1;
    while (endIndex < markdown.length && /\d/.test(markdown[endIndex])) endIndex += 1;
    if (endIndex === index + 1 || isTokenCharacter(markdown[endIndex])) {
      index += 1;
      continue;
    }

    const id = markdown.slice(index, endIndex);
    if (!seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
    index = endIndex;
  }

  return ids;
}

function scanReferencedIdsInOrder(markdown: string, candidates: string[]): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  const longestFirst = uniqueIdsInOrder(candidates.filter(Boolean)).sort(
    (left, right) => right.length - left.length,
  );

  for (let index = 0; index < markdown.length; index += 1) {
    if (isTokenCharacter(markdown[index - 1])) continue;

    for (const id of longestFirst) {
      if (!markdown.startsWith(id, index)) continue;
      if (isTokenCharacter(markdown[index + id.length])) continue;
      if (!seen.has(id)) {
        seen.add(id);
        ids.push(id);
      }
      index += id.length - 1;
      break;
    }
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

  const visibleLedgerSourceIds = uniqueIdsInOrder(
    [...sourceById.keys()].filter((id) => !CONFLICT_ID_RE.test(id)),
  );
  const unresolvedCandidateIds = scanStrictBracketedSourceIds(sanitizedMarkdown).filter(
    (id) => !sourceById.has(id),
  );
  const referencedIds = scanReferencedIdsInOrder(
    sanitizedMarkdown,
    uniqueIdsInOrder([...visibleLedgerSourceIds, ...unresolvedCandidateIds]),
  );
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
