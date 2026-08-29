import type { ResearchSourceRef } from "./research-missions.ts";
import {
  findRecognizedFindingsRefs,
  matchFindingsFenceRun,
  matchFindingsInlineLinkAt,
  stripFindingsComments,
} from "./research-findings-doc.ts";

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
  const withoutComments = stripFindingsComments(markdown ?? "");
  const withoutBlocks = stripFencedCode(withoutComments);
  const withoutCode = stripInlineCode(withoutBlocks);
  const withoutMarkdownTargets = stripMarkdownLinksAndImages(withoutCode);
  return stripBareUrls(withoutMarkdownTargets);
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

function stripFencedCode(markdown: string): string {
  const lines = markdown.split(/\r?\n/);
  let fence: { character: string; length: number } | null = null;
  const strippedLines: string[] = [];

  for (const line of lines) {
    const run = matchFindingsFenceRun(line);
    if (fence) {
      if (
        run &&
        run.character === fence.character &&
        run.length >= fence.length &&
        !run.suffix.trim()
      ) {
        fence = null;
      }
      strippedLines.push("");
      continue;
    }

    if (run) {
      fence = { character: run.character, length: run.length };
      strippedLines.push("");
      continue;
    }

    strippedLines.push(line);
  }

  return strippedLines.join("\n");
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

function isUnsupportedContainerFenceRun(
  input: string,
  index: number,
  runLength: number,
): boolean {
  if (runLength < 3) return false;

  const lineStart = input.lastIndexOf("\n", index - 1) + 1;
  const prefix = input.slice(lineStart, index);
  return /^(?:[ \t]*(?:>[ \t]?|(?:[-+*]|\d{1,9}[.)])[ \t]+))+[ \t]*$/.test(prefix);
}

function findClosingBacktickRun(input: string, startIndex: number, openerLength: number): number {
  for (let index = startIndex; index < input.length; ) {
    if (input[index] !== "`") {
      index += 1;
      continue;
    }

    const length = backtickRunLength(input, index);
    if (
      length === openerLength &&
      !isUnsupportedContainerFenceRun(input, index, length)
    ) {
      return index;
    }
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
    if (isUnsupportedContainerFenceRun(markdown, index, openerLength)) {
      sanitized += markdown.slice(index, index + openerLength);
      index += openerLength;
      continue;
    }
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
    const isLink = markdown[index] === "[";
    if (!isImage && !isLink) {
      sanitized += markdown[index];
      index += 1;
      continue;
    }

    if (isLink) {
      if (markdown.startsWith("![", index + 1)) {
        sanitized += markdown[index];
        index += 1;
        continue;
      }
      const inlineLink = matchFindingsInlineLinkAt(markdown, index);
      if (inlineLink) {
        sanitized += `[${stripMarkdownLinksAndImages(inlineLink.text)}]`;
        index += inlineLink.length;
        continue;
      }
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
    }

    sanitized += " ";
    index = constructEnd;
  }

  return sanitized;
}

function stripBareUrls(markdown: string): string {
  let sanitized = "";
  for (let index = 0; index < markdown.length; ) {
    const protocol = markdown.slice(index, index + "https://".length).toLowerCase();
    const protocolLength = protocol.startsWith("https://")
      ? "https://".length
      : protocol.startsWith("http://")
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

type IndexedSourceId = { id: string; index: number };

function scanStrictBracketedSourceIds(sanitizedMarkdown: string): IndexedSourceId[] {
  const matches: IndexedSourceId[] = [];

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

    let tokenStart = index + 1;
    for (let tokenEnd = tokenStart; tokenEnd <= closeIndex; tokenEnd += 1) {
      if (tokenEnd < closeIndex && sanitizedMarkdown[tokenEnd] !== ",") continue;
      const token = sanitizedMarkdown.slice(tokenStart, tokenEnd);
      const id = token.trim();
      if (SOURCE_ID_RE.test(id)) {
        matches.push({
          id,
          index: tokenStart + token.length - token.trimStart().length,
        });
      }
      tokenStart = tokenEnd + 1;
    }
    index += 1;
  }

  return matches;
}

export function scanBracketedSourceIds(markdown: string): string[] {
  return uniqueIdsInOrder(
    scanStrictBracketedSourceIds(preprocessMarkdownForIntegrity(markdown)).map(
      (match) => match.id,
    ),
  );
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

  const recognizedRefs = findRecognizedFindingsRefs(sanitizedMarkdown, sources);
  const actualLedgerRefs = recognizedRefs.filter(
    (match) => sourceById.has(match.id) && !CONFLICT_ID_RE.test(match.id),
  );
  const unresolvedStrictRefs = scanStrictBracketedSourceIds(sanitizedMarkdown).filter(
    (match) => !sourceById.has(match.id),
  );
  const referencedIds = uniqueIdsInOrder(
    [...actualLedgerRefs, ...unresolvedStrictRefs]
      .sort((left, right) => left.index - right.index)
      .map((match) => match.id),
  );
  const unresolvedIds = referencedIds.filter((id) => !sourceById.has(id));
  const conflictMarkerIds = uniqueIdsInOrder(
    recognizedRefs
      .filter((match) => CONFLICT_ID_RE.test(match.id))
      .map((match) => match.id),
  );
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
