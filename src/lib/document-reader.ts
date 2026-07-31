import { parse, type Block } from "@create-markdown/core";
import { parseMdDocument } from "./md-frontmatter.ts";

export type ReaderSection<TBlock> = {
  id: string;
  heading: string;
  level: number;
  blocks: TBlock[];
};

export type ReaderDocument<TBlock, TLede = TBlock> = {
  title: string;
  titleSource: "frontmatter" | "heading" | "fallback";
  lede: TLede | null;
  sections: ReaderSection<TBlock>[];
};

export type MarkdownReaderDocument = ReaderDocument<Block, Block>;

export function stripCompleteMarkdownComments(markdown: string): string {
  let cursor = 0;
  let output = "";

  while (cursor < markdown.length) {
    const start = markdown.indexOf("<!--", cursor);
    if (start === -1) {
      output += markdown.slice(cursor);
      break;
    }

    const close = markdown.indexOf("-->", start + 4);
    if (close === -1) {
      output += markdown.slice(cursor);
      break;
    }

    output += markdown.slice(cursor, start);
    cursor = close + 3;
  }

  return output;
}

export function hasUnclosedMarkdownComment(markdown: string): boolean {
  let cursor = 0;

  while (cursor < markdown.length) {
    const start = markdown.indexOf("<!--", cursor);
    if (start === -1) return false;
    const close = markdown.indexOf("-->", start + 4);
    if (close === -1) return true;
    cursor = close + 3;
  }

  return false;
}

type MarkdownLine = {
  text: string;
  eol: string;
};

type FenceMarker = {
  char: "`" | "~";
  size: number;
};

function splitMarkdownLines(markdown: string): MarkdownLine[] {
  if (!markdown) return [];

  const lines: MarkdownLine[] = [];
  let cursor = 0;
  while (cursor < markdown.length) {
    const newlineIndex = markdown.indexOf("\n", cursor);
    if (newlineIndex === -1) {
      lines.push({ text: markdown.slice(cursor), eol: "" });
      break;
    }

    const textEnd =
      newlineIndex > cursor && markdown[newlineIndex - 1] === "\r"
        ? newlineIndex - 1
        : newlineIndex;
    lines.push({
      text: markdown.slice(cursor, textEnd),
      eol: markdown.slice(textEnd, newlineIndex + 1),
    });
    cursor = newlineIndex + 1;
  }

  return lines;
}

function matchFenceMarker(text: string): FenceMarker | null {
  const match = text.match(/^\s{0,3}(`{3,}|~{3,})(.*)$/);
  if (!match) return null;
  return {
    char: match[1][0] as FenceMarker["char"],
    size: match[1].length,
  };
}

function isFenceClose(text: string, fence: FenceMarker): boolean {
  const pattern =
    fence.char === "`"
      ? new RegExp(`^\\s{0,3}\`{${fence.size},}\\s*$`)
      : new RegExp(`^\\s{0,3}~{${fence.size},}\\s*$`);
  return pattern.test(text);
}

function matchSetextUnderline(text: string): 1 | 2 | null {
  const match = text.match(/^\s{0,3}(=+|-+)\s*$/);
  if (!match) return null;
  return match[1][0] === "=" ? 1 : 2;
}

function isSetextContentLine(text: string): boolean {
  if (!text.trim()) return false;
  if (/^\s{4,}/.test(text)) return false;
  return !/^\s{0,3}(?:[-+*](?:\s|$)|\d+[.)](?:\s|$)|>\s*|#{1,6}(?:\s|$)|`{3,}|~{3,})/.test(
    text,
  );
}

function normalizeSetextHeadings(markdown: string): string {
  const lines = splitMarkdownLines(markdown);
  const normalized: MarkdownLine[] = [];
  let fence: FenceMarker | null = null;

  for (let index = 0; index < lines.length; ) {
    const line = lines[index];

    if (fence) {
      normalized.push(line);
      if (isFenceClose(line.text, fence)) fence = null;
      index += 1;
      continue;
    }

    const fenceOpen = matchFenceMarker(line.text);
    if (fenceOpen) {
      normalized.push(line);
      fence = fenceOpen;
      index += 1;
      continue;
    }

    if (!line.text.trim()) {
      normalized.push(line);
      index += 1;
      continue;
    }

    let end = index;
    while (end < lines.length && lines[end].text.trim()) {
      if (end > index && matchFenceMarker(lines[end].text)) break;
      end += 1;
    }

    const run = lines.slice(index, end);
    const level =
      run.length >= 2 ? matchSetextUnderline(run[run.length - 1].text) : null;
    if (level !== null && run.slice(0, -1).every((candidate) => isSetextContentLine(candidate.text))) {
      normalized.push({
        text: `${level === 1 ? "#" : "##"} ${run
          .slice(0, -1)
          .map((candidate) => candidate.text.trim())
          .join(" ")}`,
        eol: run[run.length - 1].eol,
      });
    } else {
      normalized.push(...run);
    }

    index = end;
  }

  return normalized.map((line) => line.text + line.eol).join("");
}

function blockText(block: Block): string {
  return block.content.map((span) => span.text).join("").trim();
}

function headingLevel(block: Block): number | null {
  if (block.type !== "heading") return null;
  const level = (block.props as { level?: unknown }).level;
  return typeof level === "number" ? level : null;
}

function slugPart(value: string): string {
  const ascii = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x00-\x7F]/g, "");
  return (
    ascii
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "section"
  );
}

function nextSectionId(heading: string, counts: Map<string, number>): string {
  const slug = slugPart(heading);
  const occurrence = (counts.get(slug) ?? 0) + 1;
  counts.set(slug, occurrence);
  const base = slug === "section" ? "section" : `section-${slug}`;
  return `${base}-${occurrence}`;
}

function pushSection(
  sections: ReaderSection<Block>[],
  counts: Map<string, number>,
  heading: string,
  level: number,
  blocks: Block[],
): void {
  sections.push({
    id: nextSectionId(heading, counts),
    heading,
    level,
    blocks,
  });
}

function findTitleHeadingIndex(blocks: Block[]): number {
  return blocks.findIndex((block) => headingLevel(block) === 1);
}

export function parseMarkdownReaderDocument(
  raw: string,
  fallbackTitle: string,
): MarkdownReaderDocument {
  const parsed = parseMdDocument(raw);
  const body = stripCompleteMarkdownComments(parsed.body);
  const blocks = parse(normalizeSetextHeadings(body));
  const titleHeadingIndex = findTitleHeadingIndex(blocks);

  let title = fallbackTitle;
  let titleSource: MarkdownReaderDocument["titleSource"] = "fallback";
  if (parsed.title) {
    title = parsed.title;
    titleSource = "frontmatter";
  } else if (titleHeadingIndex !== -1) {
    title = blockText(blocks[titleHeadingIndex]) || fallbackTitle;
    titleSource = "heading";
  }

  const contentBlocks =
    titleHeadingIndex === -1
      ? blocks
      : blocks.filter((_, index) => index !== titleHeadingIndex);

  let lede: Block | null = null;
  let startIndex = 0;
  if (contentBlocks[0]?.type === "blockquote") {
    lede = contentBlocks[0];
    startIndex = 1;
  }

  const sections: ReaderSection<Block>[] = [];
  const counts = new Map<string, number>();
  let overviewBlocks: Block[] = [];
  let currentHeading = "";
  let currentLevel = 0;
  let currentBlocks: Block[] | null = null;

  for (const block of contentBlocks.slice(startIndex)) {
    const level = headingLevel(block);
    if (level !== null && level >= 2 && level <= 6) {
      if (currentBlocks) {
        pushSection(sections, counts, currentHeading, currentLevel, currentBlocks);
      } else if (overviewBlocks.length > 0) {
        pushSection(sections, counts, "", 0, overviewBlocks);
        overviewBlocks = [];
      }
      currentHeading = blockText(block);
      currentLevel = level;
      currentBlocks = [];
      continue;
    }

    if (currentBlocks) currentBlocks.push(block);
    else overviewBlocks.push(block);
  }

  if (currentBlocks) {
    pushSection(sections, counts, currentHeading, currentLevel, currentBlocks);
  } else if (overviewBlocks.length > 0) {
    pushSection(sections, counts, "", 0, overviewBlocks);
  }

  return { title, titleSource, lede, sections };
}
