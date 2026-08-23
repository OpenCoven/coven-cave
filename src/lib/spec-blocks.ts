import { readerOutline, readingStats } from "./reader-outline.ts";

export type FamiliarDocumentKind = "spec" | "handoff";

export type SpecBlock = {
  kind: FamiliarDocumentKind;
  title: string;
  markdown: string;
  sectionCount: number;
  readingMinutes: number;
};

export type SpecTextPiece =
  | { kind: "text"; text: string }
  | { kind: "spec"; spec: SpecBlock };

const DOCUMENT_OPEN_RE =
  /^(`{3,})(spec|handoff)(?:[ \t]+title="([^"\r\n]*)")?[ \t]*$/;
const FENCE_OPEN_RE = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const FENCE_CLOSE_RE = /^ {0,3}(`+|~+)[ \t]*$/;

type SourceLine = {
  start: number;
  contentEnd: number;
  end: number;
  content: string;
};

function sourceLines(text: string): SourceLine[] {
  const lines: SourceLine[] = [];
  let start = 0;
  while (start < text.length) {
    const newline = text.indexOf("\n", start);
    const contentEnd = newline === -1 ? text.length : newline;
    const end = newline === -1 ? text.length : newline + 1;
    const contentWithoutReturn =
      contentEnd > start && text[contentEnd - 1] === "\r"
        ? contentEnd - 1
        : contentEnd;
    lines.push({
      start,
      contentEnd,
      end,
      content: text.slice(start, contentWithoutReturn),
    });
    start = end;
  }
  return lines;
}

function findFenceClose(
  lines: SourceLine[],
  openingIndex: number,
  fence: string,
  exact: boolean,
): number {
  for (let index = openingIndex + 1; index < lines.length; index += 1) {
    const closing = lines[index].content.match(FENCE_CLOSE_RE);
    if (
      closing &&
      closing[1][0] === fence[0] &&
      (exact ? closing[1].length === fence.length : closing[1].length >= fence.length)
    ) {
      return index;
    }
  }
  return -1;
}

function specFrom(
  kind: FamiliarDocumentKind,
  markdown: string,
  explicitTitle: string | undefined,
): SpecBlock {
  const outline = readerOutline(markdown);
  return {
    kind,
    title: explicitTitle?.trim() || outline[0]?.text || `Familiar ${kind}`,
    markdown,
    sectionCount: outline.length,
    readingMinutes: readingStats(markdown).minutes,
  };
}

export function sliceSpecBlocks(text: string): SpecTextPiece[] {
  if (!text.includes("```")) return [{ kind: "text", text }];

  const lines = sourceLines(text);
  const pieces: SpecTextPiece[] = [];
  let cursor = 0;
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    const opening = line.content.match(DOCUMENT_OPEN_RE);
    if (opening) {
      if (line.end === line.contentEnd) break;
      const closeIndex = findFenceClose(lines, index, opening[1], true);
      if (closeIndex === -1) break;

      const close = lines[closeIndex];
      const rawBody = text.slice(line.end, close.start);
      const markdown = rawBody.replace(/\r?\n$/, "");
      if (!markdown.trim()) {
        index = closeIndex + 1;
        continue;
      }

      if (line.start > cursor) {
        pieces.push({ kind: "text", text: text.slice(cursor, line.start) });
      }
      const kind: FamiliarDocumentKind =
        opening[2] === "handoff" ? "handoff" : "spec";
      pieces.push({
        kind: "spec",
        spec: specFrom(kind, markdown, opening[3]),
      });
      cursor = close.contentEnd;
      index = closeIndex + 1;
      continue;
    }

    const ordinaryFence = line.content.match(FENCE_OPEN_RE);
    if (!ordinaryFence) {
      index += 1;
      continue;
    }
    const closeIndex = findFenceClose(lines, index, ordinaryFence[1], false);
    if (closeIndex === -1) break;
    index = closeIndex + 1;
  }

  if (cursor === 0) return [{ kind: "text", text }];
  if (cursor < text.length) pieces.push({ kind: "text", text: text.slice(cursor) });
  return pieces;
}
