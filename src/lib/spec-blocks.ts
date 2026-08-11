import { readerOutline, readingStats } from "./reader-outline.ts";

export type SpecBlock = {
  title: string;
  markdown: string;
  sectionCount: number;
  readingMinutes: number;
};

export type SpecTextPiece =
  | { kind: "text"; text: string }
  | { kind: "spec"; spec: SpecBlock };

const OPEN_RE = /^(`{3,})spec(?:[ \t]+title="([^"\r\n]*)")?[ \t]*\r?$/gm;

function closingFence(fence: string): RegExp {
  return new RegExp(`^${fence}[ \\t]*\\r?$`, "gm");
}

function specFrom(markdown: string, explicitTitle: string | undefined): SpecBlock {
  const outline = readerOutline(markdown);
  return {
    title: explicitTitle?.trim() || outline[0]?.text || "Familiar spec",
    markdown,
    sectionCount: outline.length,
    readingMinutes: readingStats(markdown).minutes,
  };
}

export function sliceSpecBlocks(text: string): SpecTextPiece[] {
  if (!text.includes("```")) return [{ kind: "text", text }];

  const pieces: SpecTextPiece[] = [];
  let cursor = 0;
  let opening: RegExpExecArray | null;
  OPEN_RE.lastIndex = 0;

  while ((opening = OPEN_RE.exec(text)) !== null) {
    const lineEnd = opening.index + opening[0].length;
    const newline = text.slice(lineEnd).match(/^\r?\n/);
    if (!newline) continue;

    const bodyStart = lineEnd + newline[0].length;
    const closeRe = closingFence(opening[1]);
    closeRe.lastIndex = bodyStart;
    const close = closeRe.exec(text);
    if (!close) continue;

    const rawBody = text.slice(bodyStart, close.index);
    const markdown = rawBody.replace(/\r?\n$/, "");
    const blockEnd = close.index + close[0].length;

    if (!markdown.trim()) {
      OPEN_RE.lastIndex = blockEnd;
      continue;
    }

    if (opening.index > cursor) {
      pieces.push({ kind: "text", text: text.slice(cursor, opening.index) });
    }
    pieces.push({ kind: "spec", spec: specFrom(markdown, opening[2]) });
    cursor = blockEnd;
    OPEN_RE.lastIndex = blockEnd;
  }

  if (cursor === 0) return [{ kind: "text", text }];
  if (cursor < text.length) pieces.push({ kind: "text", text: text.slice(cursor) });
  return pieces;
}
