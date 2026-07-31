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
  const blocks = parse(body);
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
