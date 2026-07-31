import {
  codeBlock,
  paragraph,
  parse,
  type Block,
} from "@create-markdown/core";
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
  return scanMarkdownComments(markdown).stripped;
}

export function hasUnclosedMarkdownComment(markdown: string): boolean {
  return scanMarkdownComments(markdown).unclosedStart !== null;
}

type MarkdownLine = {
  text: string;
  eol: string;
  start: number;
  end: number;
};

type FenceMarker = {
  char: "`" | "~";
  size: number;
};

type FenceOpen = {
  indent: string;
  info: string;
  fence: FenceMarker;
};

type MarkdownRange = {
  start: number;
  end: number;
};

type FencedCodeRegion = MarkdownRange & {
  code: string;
  language?: string;
};

type ProtectedBlockStore = {
  nextIndex: number;
  sentinel: string;
  blocks: Map<string, Block>;
};

type ThematicBreak = {
  indent: string;
  char: "*" | "-" | "_";
  spaced: boolean;
};

function splitMarkdownLines(markdown: string): MarkdownLine[] {
  if (!markdown) return [];

  const lines: MarkdownLine[] = [];
  let cursor = 0;
  while (cursor < markdown.length) {
    const newlineIndex = markdown.indexOf("\n", cursor);
    if (newlineIndex === -1) {
      lines.push({
        text: markdown.slice(cursor),
        eol: "",
        start: cursor,
        end: markdown.length,
      });
      break;
    }

    const textEnd =
      newlineIndex > cursor && markdown[newlineIndex - 1] === "\r"
        ? newlineIndex - 1
        : newlineIndex;
    lines.push({
      text: markdown.slice(cursor, textEnd),
      eol: markdown.slice(textEnd, newlineIndex + 1),
      start: cursor,
      end: newlineIndex + 1,
    });
    cursor = newlineIndex + 1;
  }

  return lines;
}

function matchFenceOpen(text: string): FenceOpen | null {
  const match = text.match(/^( {0,3})(`{3,}|~{3,})(.*)$/);
  if (!match) return null;
  if (match[2][0] === "`" && match[3].includes("`")) return null;
  return {
    indent: match[1],
    info: match[3],
    fence: {
      char: match[2][0] as FenceMarker["char"],
      size: match[2].length,
    },
  };
}

function isFenceClose(text: string, fence: FenceMarker): boolean {
  const pattern = new RegExp(
    `^ {0,3}${fence.char}{${fence.size},}[\\t ]*$`,
  );
  return pattern.test(text);
}

function safeFenceLanguage(info: string): string | undefined {
  return info.trim().match(/^([A-Za-z0-9_+-]{1,64})/)?.[1];
}

function removeFenceIndent(text: string, indent: number): string {
  let remove = 0;
  while (remove < indent && text[remove] === " ") remove += 1;
  return text.slice(remove);
}

function findFencedCodeRegions(markdown: string): FencedCodeRegion[] {
  const lines = splitMarkdownLines(markdown);
  const regions: FencedCodeRegion[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const open = matchFenceOpen(lines[index].text);
    if (!open) continue;

    let closeIndex = index + 1;
    while (
      closeIndex < lines.length &&
      !isFenceClose(lines[closeIndex].text, open.fence)
    ) {
      closeIndex += 1;
    }

    const isClosed = closeIndex < lines.length;
    const contentLines = lines.slice(
      index + 1,
      isClosed ? closeIndex : lines.length,
    );
    let code = contentLines
      .map((line) => removeFenceIndent(line.text, open.indent.length))
      .join("\n");
    if (
      !isClosed &&
      contentLines.length > 0 &&
      contentLines.at(-1)?.eol
    ) {
      code += "\n";
    }

    regions.push({
      start: lines[index].start,
      end: isClosed ? lines[closeIndex].end : markdown.length,
      code,
      language: safeFenceLanguage(open.info),
    });
    index = isClosed ? closeIndex : lines.length;
  }

  return regions;
}

function isEscapedBacktick(markdown: string, index: number): boolean {
  let slashCount = 0;
  for (
    let cursor = index - 1;
    cursor >= 0 && markdown[cursor] === "\\";
    cursor -= 1
  ) {
    slashCount += 1;
  }
  return slashCount % 2 === 1;
}

function backtickRunLength(markdown: string, index: number): number {
  let end = index;
  while (markdown[end] === "`") end += 1;
  return end - index;
}

function rangeContaining(
  ranges: MarkdownRange[],
  index: number,
): MarkdownRange | null {
  for (const range of ranges) {
    if (index < range.start) return null;
    if (index < range.end) return range;
  }
  return null;
}

function nextRangeStart(ranges: MarkdownRange[], index: number): number {
  return (
    ranges.find((range) => range.start >= index)?.start ??
    Number.POSITIVE_INFINITY
  );
}

function findInlineCodeSpanRanges(
  markdown: string,
  excludedRanges: MarkdownRange[],
): MarkdownRange[] {
  const ranges: MarkdownRange[] = [];
  let cursor = 0;

  while (cursor < markdown.length) {
    const excluded = rangeContaining(excludedRanges, cursor);
    if (excluded) {
      cursor = excluded.end;
      continue;
    }

    const openStart = markdown.indexOf("`", cursor);
    if (openStart === -1) break;
    const openExcluded = rangeContaining(excludedRanges, openStart);
    if (openExcluded) {
      cursor = openExcluded.end;
      continue;
    }

    const openSize = backtickRunLength(markdown, openStart);
    if (isEscapedBacktick(markdown, openStart)) {
      cursor = openStart + openSize;
      continue;
    }

    const searchLimit = nextRangeStart(excludedRanges, openStart + openSize);
    let closeStart = openStart + openSize;
    let closeEnd = -1;
    while (closeStart < markdown.length && closeStart < searchLimit) {
      closeStart = markdown.indexOf("`", closeStart);
      if (closeStart === -1 || closeStart >= searchLimit) break;
      const closeSize = backtickRunLength(markdown, closeStart);
      if (
        closeSize === openSize &&
        !isEscapedBacktick(markdown, closeStart)
      ) {
        closeEnd = closeStart + closeSize;
        break;
      }
      closeStart += closeSize;
    }

    if (closeEnd === -1) {
      cursor = openStart + openSize;
      continue;
    }

    ranges.push({ start: openStart, end: closeEnd });
    cursor = closeEnd;
  }

  return ranges;
}

function markdownCodeRanges(markdown: string): MarkdownRange[] {
  const fences = findFencedCodeRegions(markdown);
  return [
    ...fences,
    ...findInlineCodeSpanRanges(markdown, fences),
  ].sort((left, right) => left.start - right.start);
}

function scanMarkdownComments(markdown: string): {
  stripped: string;
  unclosedStart: number | null;
} {
  const codeRanges = markdownCodeRanges(markdown);
  let rangeIndex = 0;
  let cursor = 0;
  let output = "";

  while (cursor < markdown.length) {
    while (
      rangeIndex < codeRanges.length &&
      codeRanges[rangeIndex].end <= cursor
    ) {
      rangeIndex += 1;
    }

    const codeRange = codeRanges[rangeIndex];
    if (
      codeRange &&
      cursor >= codeRange.start &&
      cursor < codeRange.end
    ) {
      output += markdown.slice(cursor, codeRange.end);
      cursor = codeRange.end;
      continue;
    }

    const protectedStart = codeRange?.start ?? markdown.length;
    const commentStart = markdown.indexOf("<!--", cursor);
    if (commentStart === -1 || commentStart >= protectedStart) {
      output += markdown.slice(cursor, protectedStart);
      cursor = protectedStart;
      continue;
    }

    output += markdown.slice(cursor, commentStart);
    const close = markdown.indexOf("-->", commentStart + 4);
    if (close === -1) {
      output += markdown.slice(commentStart);
      return { stripped: output, unclosedStart: commentStart };
    }
    cursor = close + 3;
  }

  return { stripped: output, unclosedStart: null };
}

function placeholderSentinel(markdown: string): string {
  for (let codePoint = 0xe000; codePoint <= 0xe0ff; codePoint += 1) {
    const candidate = String.fromCodePoint(codePoint);
    if (!markdown.includes(candidate)) return candidate;
  }

  let length = 2;
  while (markdown.includes("\ue000".repeat(length))) length += 1;
  return "\ue000".repeat(length);
}

function createProtectedBlockStore(markdown: string): ProtectedBlockStore {
  return {
    nextIndex: 0,
    sentinel: placeholderSentinel(markdown),
    blocks: new Map(),
  };
}

function addProtectedBlock(store: ProtectedBlockStore, block: Block): string {
  const placeholder = `COVEN${store.sentinel}PROTECTEDBLOCK${store.nextIndex}`;
  store.nextIndex += 1;
  store.blocks.set(placeholder, block);
  return placeholder;
}

function preferredLineEnding(markdown: string): string {
  return markdown.match(/\r\n|\n/)?.[0] ?? "\n";
}

function standalonePlaceholder(placeholder: string, eol: string): string {
  return `${eol}${eol}${placeholder}${eol}${eol}`;
}

function protectUnclosedCommentTail(
  markdown: string,
  store: ProtectedBlockStore,
): string {
  const unclosedStart = scanMarkdownComments(markdown).unclosedStart;
  if (unclosedStart === null) return markdown;

  const placeholder = addProtectedBlock(
    store,
    paragraph(markdown.slice(unclosedStart)),
  );
  return (
    markdown.slice(0, unclosedStart) +
    standalonePlaceholder(placeholder, preferredLineEnding(markdown))
  );
}

function protectFencedCodeBlocks(
  markdown: string,
  store: ProtectedBlockStore,
): string {
  const regions = findFencedCodeRegions(markdown);
  if (regions.length === 0) return markdown;

  const eol = preferredLineEnding(markdown);
  let cursor = 0;
  let protectedMarkdown = "";
  for (const region of regions) {
    protectedMarkdown += markdown.slice(cursor, region.start);
    protectedMarkdown += standalonePlaceholder(
      addProtectedBlock(store, codeBlock(region.code, region.language)),
      eol,
    );
    cursor = region.end;
  }
  return protectedMarkdown + markdown.slice(cursor);
}

function protectedPlaceholderText(block: Block): string | null {
  if (block.type !== "paragraph" || block.children.length > 0) return null;
  return block.content.map((span) => span.text).join("");
}

function restoreProtectedBlocks(
  blocks: Block[],
  store: ProtectedBlockStore,
): Block[] {
  return blocks.map((block) => {
    const placeholder = protectedPlaceholderText(block);
    const protectedBlock = placeholder
      ? store.blocks.get(placeholder)
      : undefined;
    if (protectedBlock) return protectedBlock;
    if (block.children.length === 0) return block;
    return {
      ...block,
      children: restoreProtectedBlocks(block.children, store),
    };
  });
}

function matchSetextUnderline(text: string): 1 | 2 | null {
  const match = text.match(/^ {0,3}(=+|-+)[\t ]*$/);
  if (!match) return null;
  return match[1][0] === "=" ? 1 : 2;
}

function matchThematicBreakLine(text: string): ThematicBreak | null {
  const match = text.match(/^( {0,3})([ \t*_-]+)$/);
  if (!match) return null;

  const markers = match[2];
  const compact = markers.replace(/[ \t]/g, "");
  if (compact.length < 3) return null;

  const char = compact[0];
  if (
    (char !== "*" && char !== "-" && char !== "_") ||
    compact.split("").some((marker) => marker !== char)
  ) {
    return null;
  }

  return { indent: match[1], char, spaced: /[ \t]/.test(markers) };
}

function isThematicBreakLine(text: string): boolean {
  return matchThematicBreakLine(text) !== null;
}

function isSetextContentLine(
  text: string,
  protectedBlocks: ProtectedBlockStore,
): boolean {
  if (!text.trim()) return false;
  if (protectedBlocks.blocks.has(text.trim())) return false;
  if (/^ {4,}/.test(text)) return false;
  if (matchSetextUnderline(text) !== null) return false;
  if (isThematicBreakLine(text)) return false;
  return !/^ {0,3}(?:[-+*](?:\s|$)|\d+[.)](?:\s|$)|>\s*|#{1,6}(?:\s|$)|`{3,}|~{3,})/.test(
    text,
  );
}

function isSetextContainerBoundary(text: string): boolean {
  return /^(?: {4,}| {0,3}(?:[-+*](?:\s|$)|\d+[.)](?:\s|$)|>\s*))/.test(
    text,
  );
}

function isValidSetextParagraphRun(
  lines: MarkdownLine[],
  previousLine: MarkdownLine | undefined,
): boolean {
  if (
    previousLine &&
    previousLine.text.trim() !== "" &&
    isSetextContainerBoundary(previousLine.text)
  ) {
    return false;
  }

  const candidateBlocks = parse(lines.map((line) => line.text).join("\n"));
  return (
    candidateBlocks.length === 1 &&
    candidateBlocks[0].type === "paragraph" &&
    candidateBlocks[0].children.length === 0
  );
}

function normalizeSetextHeadings(
  markdown: string,
  protectedBlocks: ProtectedBlockStore,
): string {
  const lines = splitMarkdownLines(markdown);
  const normalized: MarkdownLine[] = [];

  for (let index = 0; index < lines.length; ) {
    const line = lines[index];

    if (!isSetextContentLine(line.text, protectedBlocks)) {
      if (
        matchSetextUnderline(line.text) === 2 &&
        isThematicBreakLine(line.text)
      ) {
        const previous = normalized.at(-1);
        if (previous && previous.text.trim() !== "") {
          normalized.push({
            text: "",
            eol: previous.eol || line.eol || "\n",
            start: line.start,
            end: line.start,
          });
        }
      }
      normalized.push(line);
      index += 1;
      continue;
    }

    let end = index;
    while (
      end < lines.length &&
      isSetextContentLine(lines[end].text, protectedBlocks)
    ) {
      end += 1;
    }

    const level =
      end < lines.length ? matchSetextUnderline(lines[end].text) : null;
    const candidateLines = lines.slice(index, end);
    if (
      level !== null &&
      isValidSetextParagraphRun(candidateLines, lines[index - 1])
    ) {
      normalized.push({
        text: `${level === 1 ? "#" : "##"} ${candidateLines
          .map((candidate) => candidate.text.trim())
          .join(" ")}`,
        eol: lines[end].eol,
        start: line.start,
        end: lines[end].end,
      });
      index = end + 1;
    } else if (level !== null) {
      normalized.push(...candidateLines);
      const previous = normalized.at(-1);
      if (previous && previous.text.trim() !== "") {
        normalized.push({
          text: "",
          eol: previous.eol || lines[end].eol || "\n",
          start: lines[end].start,
          end: lines[end].start,
        });
      }
      normalized.push(lines[end]);
      index = end + 1;
    } else {
      normalized.push(...candidateLines);
      index = end;
    }
  }

  return normalized.map((line) => line.text + line.eol).join("");
}

function normalizeThematicBreaks(markdown: string): string {
  const lines = splitMarkdownLines(markdown);
  const normalized: MarkdownLine[] = [];

  for (let index = 0; index < lines.length; ) {
    const line = lines[index];

    const thematicBreak = matchThematicBreakLine(line.text);
    if (thematicBreak && (thematicBreak.char !== "-" || thematicBreak.spaced)) {
      const previous = normalized.at(-1);
      if (previous && previous.text.trim() !== "") {
        normalized.push({
          text: "",
          eol: previous.eol || line.eol || "\n",
          start: line.start,
          end: line.start,
        });
      }
      normalized.push({
        text: `${thematicBreak.indent}---`,
        eol: line.eol,
        start: line.start,
        end: line.end,
      });
    } else {
      normalized.push(line);
    }

    index += 1;
  }

  return normalized.map((line) => line.text + line.eol).join("");
}

function normalizeMarkdownForParse(
  markdown: string,
  protectedBlocks: ProtectedBlockStore,
): string {
  return normalizeSetextHeadings(
    normalizeThematicBreaks(markdown),
    protectedBlocks,
  );
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
  const protectedBlocks = createProtectedBlockStore(parsed.body);
  const withProtectedTail = protectUnclosedCommentTail(
    parsed.body,
    protectedBlocks,
  );
  const withProtectedFences = protectFencedCodeBlocks(
    withProtectedTail,
    protectedBlocks,
  );
  const body = stripCompleteMarkdownComments(withProtectedFences);
  const blocks = restoreProtectedBlocks(
    parse(normalizeMarkdownForParse(body, protectedBlocks)),
    protectedBlocks,
  );
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
