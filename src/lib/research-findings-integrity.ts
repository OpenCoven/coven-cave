import type { ResearchSourceRef } from "./research-missions.ts";
import { findRecognizedFindingsRefs } from "./research-findings-doc.ts";

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
  const { markdown: withoutBlocks, referenceDefinitionLabels } =
    stripFencedCodeAndReferenceDefinitions(withoutComments);
  const withoutCode = stripInlineCode(withoutBlocks);
  const withoutMarkdownTargets = stripMarkdownLinksAndImages(withoutCode, referenceDefinitionLabels);
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

function isCommonMarkEscapablePunctuation(char: string): boolean {
  const code = char.charCodeAt(0);
  return (
    (code >= 0x21 && code <= 0x2f) ||
    (code >= 0x3a && code <= 0x40) ||
    (code >= 0x5b && code <= 0x60) ||
    (code >= 0x7b && code <= 0x7e)
  );
}

function unescapeCommonMarkPunctuation(text: string): string {
  let result = "";
  for (let index = 0; index < text.length; index += 1) {
    if (
      text[index] === "\\" &&
      index + 1 < text.length &&
      isCommonMarkEscapablePunctuation(text[index + 1])
    ) {
      result += text[index + 1];
      index += 1;
      continue;
    }
    result += text[index];
  }
  return result;
}

function normalizeReferenceLabel(label: string): string {
  return unescapeCommonMarkPunctuation(label).trim().replace(/\s+/g, " ").toLowerCase();
}

type ReferenceDefinitionContainer = {
  blockquoteDepth: number;
  listIndent: number;
};

function stripBlockquotePrefix(
  line: string,
  expectedDepth?: number,
): { content: string; depth: number } | null {
  let cursor = 0;
  let depth = 0;

  while (expectedDepth === undefined || depth < expectedDepth) {
    let markerIndex = cursor;
    let spaces = 0;
    while (spaces < 3 && line[markerIndex] === " ") {
      markerIndex += 1;
      spaces += 1;
    }
    if (line[markerIndex] !== ">") break;

    cursor = markerIndex + 1;
    if (line[cursor] === " " || line[cursor] === "\t") cursor += 1;
    depth += 1;
  }

  if (expectedDepth !== undefined && depth !== expectedDepth) return null;
  return { content: line.slice(cursor), depth };
}

function readReferenceDefinitionContainer(line: string): {
  content: string;
  container: ReferenceDefinitionContainer;
} {
  const blockquote = stripBlockquotePrefix(line) ?? { content: line, depth: 0 };
  const listMatch = blockquote.content.match(/^ {0,3}(?:[-+*]|\d{1,9}[.)])([ \t]+)/);
  const listIndent = listMatch?.[0].length ?? 0;

  return {
    content: blockquote.content.slice(listIndent),
    container: { blockquoteDepth: blockquote.depth, listIndent },
  };
}

function readReferenceContainerLine(
  line: string,
  container: ReferenceDefinitionContainer,
): string | null {
  const blockquote = stripBlockquotePrefix(line, container.blockquoteDepth);
  if (!blockquote) return null;
  if (!container.listIndent) return blockquote.content;
  if (!blockquote.content.startsWith(" ".repeat(container.listIndent))) return null;
  return blockquote.content.slice(container.listIndent);
}

function readReferenceDefinitionStart(line: string): {
  label: string;
  body: string;
} | null {
  let labelStart = 0;
  while (labelStart < 3 && line[labelStart] === " ") labelStart += 1;
  if (line[labelStart] !== "[") return null;

  let labelEnd = -1;
  for (let index = labelStart + 1; index < line.length; index += 1) {
    if (line[index] === "[" && !isEscaped(line, index)) return null;
    if (line[index] === "]" && !isEscaped(line, index)) {
      labelEnd = index;
      break;
    }
  }

  if (labelEnd <= labelStart + 1 || line[labelEnd + 1] !== ":") return null;
  const rawLabel = line.slice(labelStart + 1, labelEnd);
  if (rawLabel.length > 999 || !/\S/.test(rawLabel)) return null;
  return {
    label: normalizeReferenceLabel(rawLabel),
    body: line.slice(labelEnd + 2),
  };
}

function readReferenceDefinitionContinuation(line: string): string | null {
  let indent = 0;
  while (indent < 3 && line[indent] === " ") indent += 1;
  if (line[indent] === " " || line[indent] === "\t") return null;

  const content = line.slice(indent);
  return content.trim() ? content : null;
}

function readReferenceDestination(input: string): { remainder: string } | null {
  const destination = input.trimStart();
  if (!destination) return null;

  if (destination[0] === "<") {
    for (let index = 1; index < destination.length; index += 1) {
      if (destination[index] === "<" && !isEscaped(destination, index)) return null;
      if (destination[index] === ">" && !isEscaped(destination, index)) {
        return { remainder: destination.slice(index + 1) };
      }
    }
    return null;
  }

  let parenthesisDepth = 0;
  let index = 0;
  while (index < destination.length) {
    const character = destination[index];
    if (/\s/.test(character)) break;
    if (character === "\\" && index + 1 < destination.length) {
      index += 2;
      continue;
    }
    if (character === "(") {
      parenthesisDepth += 1;
      if (parenthesisDepth > 32) return null;
    } else if (character === ")") {
      if (parenthesisDepth === 0) break;
      parenthesisDepth -= 1;
    }
    index += 1;
  }

  if (index === 0 || parenthesisDepth !== 0) return null;
  return { remainder: destination.slice(index) };
}

function readReferenceTitleCloser(title: string): "'" | '"' | ")" | null {
  if (title.startsWith("'")) return "'";
  if (title.startsWith('"')) return '"';
  if (title.startsWith("(")) return ")";
  return null;
}

function readReferenceTitleEnd(
  startLineIndex: number,
  title: string,
  readContinuation: (lineIndex: number) => string | null,
): number | null {
  const closer = readReferenceTitleCloser(title);
  if (!closer) return null;

  let lineIndex = startLineIndex;
  let current = title;
  let searchStart = 1;
  while (true) {
    for (let index = searchStart; index < current.length; index += 1) {
      if (current[index] !== closer || isEscaped(current, index)) continue;
      return current.slice(index + 1).trim() ? null : lineIndex;
    }

    const continuation = readContinuation(lineIndex + 1);
    if (!continuation) return null;
    current = continuation;
    searchStart = 0;
    lineIndex += 1;
  }
}

function readReferenceDefinition(
  lines: string[],
  startLineIndex: number,
): { label: string; endLineIndex: number } | null {
  const { content, container } = readReferenceDefinitionContainer(lines[startLineIndex]);
  const start = readReferenceDefinitionStart(content);
  if (!start) return null;

  const readContinuation = (lineIndex: number): string | null => {
    const containerLine = readReferenceContainerLine(lines[lineIndex] ?? "", container);
    return containerLine === null ? null : readReferenceDefinitionContinuation(containerLine);
  };

  let lineIndex = startLineIndex;
  let destinationInput = start.body.trimStart();
  if (!destinationInput) {
    const continuation = readContinuation(lineIndex + 1);
    if (!continuation || readReferenceTitleCloser(continuation)) return null;
    destinationInput = continuation;
    lineIndex += 1;
  }

  const destination = readReferenceDestination(destinationInput);
  if (!destination) return null;

  const separatedRemainder = destination.remainder;
  const title = separatedRemainder.trimStart();
  if (title) {
    if (title === separatedRemainder || !readReferenceTitleCloser(title)) return null;
    const titleEndLineIndex = readReferenceTitleEnd(lineIndex, title, readContinuation);
    if (titleEndLineIndex === null) return null;
    lineIndex = titleEndLineIndex;
  } else {
    const continuation = readContinuation(lineIndex + 1);
    if (continuation && readReferenceTitleCloser(continuation)) {
      const titleEndLineIndex = readReferenceTitleEnd(
        lineIndex + 1,
        continuation,
        readContinuation,
      );
      if (titleEndLineIndex === null) return null;
      lineIndex = titleEndLineIndex;
    }
  }

  return { label: start.label, endLineIndex: lineIndex };
}

function stripFencedCodeAndReferenceDefinitions(markdown: string): {
  markdown: string;
  referenceDefinitionLabels: Set<string>;
} {
  const lines = markdown.split(/\r?\n/);
  let fence: { character: string; length: number } | null = null;
  const referenceDefinitionLabels = new Set<string>();
  const strippedLines: string[] = [];

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
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
      strippedLines.push("");
      continue;
    }
    if (run) {
      fence = { character: run.character, length: run.length };
      strippedLines.push("");
      continue;
    }
    const referenceDefinition = readReferenceDefinition(lines, lineIndex);
    if (referenceDefinition) {
      referenceDefinitionLabels.add(referenceDefinition.label);
      while (lineIndex <= referenceDefinition.endLineIndex) {
        strippedLines.push("");
        lineIndex += 1;
      }
      lineIndex -= 1;
      continue;
    }
    strippedLines.push(line);
  }

  return { markdown: strippedLines.join("\n"), referenceDefinitionLabels };
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
    if (input[index] !== "`") {
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

function stripMarkdownLinksAndImages(markdown: string, referenceDefinitionLabels: Set<string>): string {
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
    } else if (!referenceDefinitionLabels.has(normalizeReferenceLabel(markdown.slice(labelStart, labelEnd)))) {
      sanitized += markdown.slice(index, labelEnd + 1);
      index = labelEnd + 1;
      continue;
    }

    sanitized += isImage
      ? " "
      : stripMarkdownLinksAndImages(markdown.slice(labelStart, labelEnd), referenceDefinitionLabels);
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
    index = closeIndex + 1;
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
