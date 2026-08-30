// Findings document model — turns a mission's freeform findings markdown into
// the structured shape the Research Reader renders: a title, an optional lede,
// and collapsible sections whose prose/lists/tables carry inline source-ref
// chips (S14, C1, …) cross-linked to the evidence rail.
//
// The parser is deliberately small and line-based rather than a general
// markdown engine: the reader needs *structure* (sections to collapse and list
// in the contents rail, tables to typeset as Key Results, and ref tokens to
// chip) that a plain HTML renderer would flatten away. It degrades honestly —
// unknown constructs fall through to paragraphs, and nothing is invented.

import type { ResearchSourceRef } from "./research-missions.ts";

export type FindingsRefTone = "accent" | "warn" | "muted" | "unresolved";

export type RecognizedFindingsRef = {
  id: string;
  index: number;
  tone: FindingsRefTone;
};

export type FindingsSpan =
  | { kind: "text"; text: string; bold?: boolean; italic?: boolean }
  | { kind: "ref-gap"; text: string }
  | { kind: "ref"; id: string; tone: FindingsRefTone }
  | { kind: "link"; text: string; href: string };

export type FindingsListItem = {
  id: string;
  spans: FindingsSpan[];
  refIds: string[];
};

export type FindingsTableRow = {
  id: string;
  cells: FindingsSpan[][];
  refIds: string[];
};

export type FindingsBlockBase = {
  id: string;
  refIds: string[];
};

export type FindingsBlock =
  | (FindingsBlockBase & { kind: "p"; spans: FindingsSpan[] })
  | (FindingsBlockBase & { kind: "ul" | "ol"; items: FindingsListItem[] })
  | (FindingsBlockBase & { kind: "quote"; spans: FindingsSpan[] })
  | (FindingsBlockBase & {
      kind: "table";
      header: FindingsSpan[][];
      headerRefIds: string[];
      rows: FindingsTableRow[];
      redundantRefColumnIndexes: number[];
    })
  | (FindingsBlockBase & { kind: "code"; language: string; code: string });

export type FindingsSupportTarget = {
  id: string;
  label: string;
  sectionId: string | null;
};

export type FindingsSection = {
  /** Stable slug used for the contents rail anchor and scroll-spy. */
  id: string;
  /** Empty when the body has no headings (a single untitled section). */
  heading: string;
  blocks: FindingsBlock[];
  /** Unique source/conflict ids cited anywhere in this section, in order. */
  refIds: string[];
};

export type FindingsDoc = {
  title: string | null;
  lede: FindingsSpan[] | null;
  ledeId: string | null;
  sections: FindingsSection[];
  /** Union of every ref id cited across the document, in first-seen order. */
  refIds: string[];
};

/** Map a source's ledger status to the chip tone the reader paints. */
export function refToneForStatus(status: ResearchSourceRef["status"]): FindingsRefTone {
  if (status === "conflicting") return "warn";
  if (status === "rejected") return "muted";
  return "accent";
}

type RefResolver = {
  pattern: RegExp | null;
  sourceIds: ReadonlySet<string>;
  toneFor: (id: string) => FindingsRefTone;
};

const CONFLICT_ID_RE = /^C\d+$/;
const STRICT_SOURCE_ID_RE = /^(?:S|R)\d+$/;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Build the ref tokenizer from the mission's real source ids. Real ids may be
 *  bare, while missing S#/R# ids must be explicitly bracketed. Conflict ids
 *  (C1, C2, …) are always recognised even when they carry no source row. */
function buildRefResolver(sources: ResearchSourceRef[]): RefResolver {
  const toneById = new Map<string, FindingsRefTone>();
  for (const source of sources) {
    if (source.id) toneById.set(source.id, refToneForStatus(source.status));
  }
  // Longest ids first so "S14" wins over "S1" in the alternation.
  const ids = [...toneById.keys()].sort((a, b) => b.length - a.length);
  const alternatives = ids.map(escapeRegExp);
  // Always recognise bare conflict tokens even if absent from the ledger.
  alternatives.push("C\\d+");
  const pattern = alternatives.length
    ? new RegExp(`\\[?\\b(${alternatives.join("|")})\\b\\]?`, "g")
    : null;
  return {
    pattern,
    sourceIds: new Set(toneById.keys()),
    toneFor: (id) =>
      toneById.get(id) ??
      (CONFLICT_ID_RE.test(id) ? "warn" : "unresolved"),
  };
}

type FindingsRefMatch = RecognizedFindingsRef & { length: number };

function isEscaped(input: string, index: number): boolean {
  let slashCount = 0;
  for (
    let cursor = index - 1;
    cursor >= 0 && input[cursor] === "\\";
    cursor -= 1
  ) {
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
  return (
    (index === lineStart && /\s/.test(input[index + runLength] ?? "")) ||
    /^[ \t]+$/.test(prefix) ||
    /^(?:[ \t]*(?:>[ \t]?|(?:[-+*]|\d{1,9}[.)])[ \t]+))+[ \t]*$/.test(
      prefix,
    )
  );
}

function inlineCodeRanges(input: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];

  for (let index = 0; index < input.length; ) {
    if (input[index] !== "`" || isEscaped(input, index)) {
      index += 1;
      continue;
    }
    const openerLength = backtickRunLength(input, index);
    if (isUnsupportedContainerFenceRun(input, index, openerLength)) {
      index += openerLength;
      continue;
    }
    let closeIndex = index + openerLength;
    while (closeIndex < input.length) {
      if (input[closeIndex] !== "`") {
        closeIndex += 1;
        continue;
      }
      const closeLength = backtickRunLength(input, closeIndex);
      if (closeLength === openerLength) break;
      closeIndex += closeLength;
    }
    if (closeIndex >= input.length) {
      index += openerLength;
      continue;
    }
    const end = closeIndex + openerLength;
    ranges.push([index, end]);
    index = end;
  }

  return ranges;
}

function bareUrlRanges(input: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];

  for (let index = 0; index < input.length; ) {
    const protocol = input.slice(index, index + "https://".length).toLowerCase();
    const protocolLength = protocol.startsWith("https://")
      ? "https://".length
      : protocol.startsWith("http://")
        ? "http://".length
        : 0;
    if (!protocolLength) {
      index += 1;
      continue;
    }

    const rangeStart = index;
    let parenDepth = 0;
    index += protocolLength;
    const authorityStart = index;
    while (index < input.length) {
      const character = input[index];
      if (/\s/.test(character)) break;
      if (character === "[" && parenDepth === 0) {
        const hostEnd = input.indexOf("]", index + 1);
        const bracketedHost =
          hostEnd === -1 ? "" : input.slice(index + 1, hostEnd);
        const authorityPrefix = input.slice(authorityStart, index);
        if (
          bracketedHost.includes(":") &&
          !/\s/.test(bracketedHost) &&
          !/[/?#]/.test(authorityPrefix)
        ) {
          index = hostEnd + 1;
          continue;
        }
        const bracketedComponent =
          hostEnd === -1 ? "" : input.slice(index + 1, hostEnd);
        if (
          /[/?#]/.test(authorityPrefix) &&
          !/[.,;:!?)]/.test(input[index - 1] ?? "") &&
          bracketedComponent &&
          !/\s/.test(bracketedComponent)
        ) {
          index = hostEnd + 1;
          continue;
        }
        break;
      }
      if (character === "(") parenDepth += 1;
      else if (character === ")" && parenDepth > 0) parenDepth -= 1;
      index += 1;
    }
    ranges.push([rangeStart, index]);
  }

  return ranges;
}

function scanStrictBracketedSourceRefs(
  input: string,
  resolver: RefResolver,
): FindingsRefMatch[] {
  const matches: FindingsRefMatch[] = [];
  const bracketGroup = /\[([^\[\]\r\n]+)\]/g;

  for (
    let group = bracketGroup.exec(input);
    group;
    group = bracketGroup.exec(input)
  ) {
    if (isEscaped(input, group.index)) continue;
    const content = group[1];
    const tokens = content.split(",");
    let contentOffset = 0;

    tokens.forEach((token, tokenIndex) => {
      const id = token.trim();
      const leadingSpace = token.length - token.trimStart().length;
      const idIndex = group.index + 1 + contentOffset + leadingSpace;
      contentOffset += token.length + 1;
      if (
        !STRICT_SOURCE_ID_RE.test(id) ||
        resolver.sourceIds.has(id)
      ) {
        return;
      }

      const firstToken = tokenIndex === 0;
      const lastToken = tokenIndex === tokens.length - 1;
      const matchIndex = firstToken ? group.index : idIndex;
      const matchEnd = lastToken
        ? group.index + group[0].length
        : idIndex + id.length;
      matches.push({
        id,
        index: matchIndex,
        length: matchEnd - matchIndex,
        tone: "unresolved",
      });
    });
  }

  return matches;
}

function escapedBracketRanges(input: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  const bracketGroup = /\[([^\[\]\r\n]+)\]/g;

  for (
    let group = bracketGroup.exec(input);
    group;
    group = bracketGroup.exec(input)
  ) {
    if (isEscaped(input, group.index)) {
      ranges.push([group.index, group.index + group[0].length]);
    }
  }

  return ranges;
}

function matchRecognizedFindingsRefs(input: string, resolver: RefResolver): FindingsRefMatch[] {
  if (!input) return [];

  const matches: FindingsRefMatch[] = [];
  if (resolver.pattern) {
    resolver.pattern.lastIndex = 0;
    for (
      let match = resolver.pattern.exec(input);
      match;
      match = resolver.pattern.exec(input)
    ) {
      matches.push({
        id: match[1],
        index: match.index,
        length: match[0].length,
        tone: resolver.toneFor(match[1]),
      });
    }
  }
  matches.push(...scanStrictBracketedSourceRefs(input, resolver));

  const opaqueRanges = [
    ...inlineCodeRanges(input),
    ...bareUrlRanges(input),
    ...escapedBracketRanges(input),
  ];
  return matches
    .sort((left, right) => left.index - right.index)
    .filter(
      (match, index, ordered) =>
        !opaqueRanges.some(
          ([start, end]) => match.index >= start && match.index < end,
        ) &&
        !ordered
          .slice(0, index)
          .some(
            (previous) =>
              match.index < previous.index + previous.length,
          ),
    );
}

/** Find references using the exact resolver and boundary grammar used by the
 * inline findings parser. Matches retain duplicates and input-relative order. */
export function findRecognizedFindingsRefs(
  input: string,
  sources: ResearchSourceRef[],
): RecognizedFindingsRef[] {
  return matchRecognizedFindingsRefs(input, buildRefResolver(sources)).map(
    ({ id, index, tone }) => ({ id, index, tone }),
  );
}

/** Split plain text into text/ref spans (no emphasis parsing at this layer). */
function tokenizeRefs(text: string, resolver: RefResolver, base: { bold?: boolean; italic?: boolean }): FindingsSpan[] {
  const matches = matchRecognizedFindingsRefs(text, resolver);
  if (matches.length === 0) {
    return text ? [{ kind: "text", text, ...base }] : [];
  }
  const spans: FindingsSpan[] = [];
  const pushTextBeforeRef = (value: string) => {
    const trailingWhitespace = value.match(/\s+$/)?.[0] ?? "";
    const prose = trailingWhitespace
      ? value.slice(0, -trailingWhitespace.length)
      : value;
    if (prose) spans.push({ kind: "text", text: prose, ...base });
    if (trailingWhitespace) {
      spans.push({ kind: "ref-gap", text: trailingWhitespace });
    }
  };
  let last = 0;
  for (const match of matches) {
    if (match.index > last) pushTextBeforeRef(text.slice(last, match.index));
    spans.push({ kind: "ref", id: match.id, tone: match.tone });
    last = match.index + match.length;
  }
  if (last < text.length) spans.push({ kind: "text", text: text.slice(last), ...base });
  return spans;
}

function tokenizeLinkLabel(
  text: string,
  href: string,
  resolver: RefResolver,
): FindingsSpan[] {
  const strictSourceGroup =
    /^\s*(?:[SR]\d+\s*)(?:,\s*[SR]\d+\s*)*$/.test(text);
  const tokenized = tokenizeRefs(
    strictSourceGroup ? `[${text}]` : text,
    resolver,
    {},
  );
  const spans: FindingsSpan[] = [];

  for (const span of tokenized) {
    if (span.kind === "ref") {
      spans.push(span);
      continue;
    }
    const previous = spans.at(-1);
    if (previous?.kind === "link" && previous.href === href) {
      previous.text += span.text;
    } else {
      spans.push({ kind: "link", text: span.text, href });
    }
  }

  return spans;
}

const INLINE_LINK_RE = /^\[([^\]]+)\]\(([^)\s]+)\)/;
const INLINE_EMPHASIS_RE =
  /^(?:(\*\*|__)([\s\S]+?)\1|(\*|_)([\s\S]+?)\3)/;

function findBalancedClose(
  input: string,
  startIndex: number,
  open: string,
  close: string,
): number {
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

type FindingsImageBoundary = {
  text: string;
  href: string | null;
  length: number;
};

function matchFindingsImageBodyAt(
  input: string,
  index: number,
): FindingsImageBoundary | null {
  if (
    input[index] !== "!" ||
    input[index + 1] !== "[" ||
    isEscaped(input, index)
  ) {
    return null;
  }

  const labelStart = index + 2;
  const labelEnd = findBalancedClose(input, labelStart, "[", "]");
  if (labelEnd === -1) return null;

  const suffixStart = labelEnd + 1;
  const suffixOpen = input[suffixStart];
  if (suffixOpen !== "(" && suffixOpen !== "[") return null;

  const suffixClose = suffixOpen === "(" ? ")" : "]";
  const suffixEnd = findBalancedClose(
    input,
    suffixStart + 1,
    suffixOpen,
    suffixClose,
  );
  if (suffixEnd === -1) return null;

  return {
    text: input.slice(labelStart, labelEnd),
    href:
      suffixOpen === "("
        ? input.slice(suffixStart + 1, suffixEnd)
        : null,
    length: suffixEnd + 1 - index,
  };
}

export function matchFindingsImageAt(
  input: string,
  index: number,
): FindingsImageBoundary | null {
  if (input[index] === "!") {
    return matchFindingsImageBodyAt(input, index);
  }

  if (
    input[index] !== "[" ||
    input[index + 1] !== "!" ||
    isEscaped(input, index)
  ) {
    return null;
  }

  const image = matchFindingsImageBodyAt(input, index + 1);
  if (!image) return null;

  const imageEnd = index + 1 + image.length;
  if (input[imageEnd] !== "]") return null;

  const suffixStart = imageEnd + 1;
  const suffixOpen = input[suffixStart];
  if (suffixOpen !== "(" && suffixOpen !== "[") return null;

  const suffixClose = suffixOpen === "(" ? ")" : "]";
  const suffixEnd = findBalancedClose(
    input,
    suffixStart + 1,
    suffixOpen,
    suffixClose,
  );
  if (suffixEnd === -1) return null;

  return {
    text: image.text,
    href:
      suffixOpen === "("
        ? input.slice(suffixStart + 1, suffixEnd)
        : image.href,
    length: suffixEnd + 1 - index,
  };
}

export function matchFindingsInlineLinkAt(
  input: string,
  index: number,
): { text: string; href: string; length: number } | null {
  const match = INLINE_LINK_RE.exec(input.slice(index));
  if (!match) return null;
  return { text: match[1], href: match[2], length: match[0].length };
}

/** Parse one run of inline markdown into spans (emphasis, links, ref chips). */
export function parseInline(input: string, sources: ResearchSourceRef[]): FindingsSpan[] {
  return parseSpans(input, buildRefResolver(sources));
}

function parseSpans(input: string, resolver: RefResolver): FindingsSpan[] {
  const text = input.trim();
  if (!text) return [];
  const spans: FindingsSpan[] = [];
  let plainStart = 0;

  const pushPlain = (end: number) => {
    if (end <= plainStart) return;
    spans.push(...tokenizeRefs(text.slice(plainStart, end), resolver, {}));
  };
  const pushImageFallback = (image: FindingsImageBoundary) => {
    if (!image.text) return;
    if (image.href) {
      spans.push({ kind: "link", text: image.text, href: image.href });
    } else {
      spans.push({ kind: "text", text: image.text });
    }
  };

  for (let index = 0; index < text.length; ) {
    const character = text[index];
    const image =
      character === "!" || character === "["
        ? matchFindingsImageAt(text, index)
        : null;
    if (image) {
      pushPlain(index);
      pushImageFallback(image);
      index += image.length;
      plainStart = index;
      continue;
    }

    const link =
      character === "[" ? matchFindingsInlineLinkAt(text, index) : null;
    if (link) {
      pushPlain(index);
      if (isEscaped(text, index)) {
        spans.push({ kind: "link", text: link.text, href: link.href });
      } else {
        spans.push(...tokenizeLinkLabel(link.text, link.href, resolver));
      }
      index += link.length;
      plainStart = index;
      continue;
    }

    const emphasis =
      character === "*" || character === "_"
        ? INLINE_EMPHASIS_RE.exec(text.slice(index))
        : null;
    if (emphasis) {
      pushPlain(index);
      if (emphasis[1]) {
        spans.push(
          ...tokenizeRefs(emphasis[2], resolver, { bold: true }),
        );
      } else {
        spans.push(
          ...tokenizeRefs(emphasis[4], resolver, { italic: true }),
        );
      }
      index += emphasis[0].length;
      plainStart = index;
      continue;
    }

    index += 1;
  }
  pushPlain(text.length);
  return spans;
}

function collectRefIds(spans: FindingsSpan[], into: string[]): void {
  for (const span of spans) {
    if (span.kind === "ref" && !into.includes(span.id)) into.push(span.id);
  }
}

function slugify(heading: string, index: number): string {
  const base = heading
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return `s-${base || `section-${index + 1}`}`;
}

type TargetIdAllocator = {
  allocate: (baseId: string) => string;
  release: (id: string) => void;
};

function createTargetIdAllocator(): TargetIdAllocator {
  const usedIds = new Set<string>();

  const allocate = (baseId: string) => {
    let id = baseId;
    let occurrence = 2;
    while (usedIds.has(id)) {
      id = `${baseId}-${occurrence}`;
      occurrence += 1;
    }
    usedIds.add(id);
    return id;
  };

  return {
    allocate,
    release: (id) => {
      usedIds.delete(id);
    },
  };
}

function uniqueSectionId(
  heading: string,
  index: number,
  allocator: TargetIdAllocator,
): string {
  return allocator.allocate(slugify(heading, index));
}

function releaseBlockTargetIds(block: FindingsBlock, allocator: TargetIdAllocator): void {
  allocator.release(block.id);
  if (block.kind === "ul" || block.kind === "ol") {
    for (const item of block.items) allocator.release(item.id);
  } else if (block.kind === "table") {
    for (const row of block.rows) allocator.release(row.id);
  }
}

const HEADING_RE = /^(#{1,6})\s+(.+?)\s*#*$/;
const LIST_RE = /^\s*[-*+]\s+(.+)$/;
const ORDERED_LIST_RE = /^\s*\d+[.)]\s+(.+)$/;
const QUOTE_RE = /^\s*>\s?(.*)$/;

/** Match the ATX headings that become reader title/section chrome. Their text
 * is navigation, not a provenance target; integrity scanning shares this exact
 * boundary so heading-only citations cannot claim evidence support. */
export function matchFindingsAtxHeading(
  line: string,
): { level: number; heading: string } | null {
  const match = HEADING_RE.exec(line);
  return match
    ? { level: match[1].length, heading: match[2].trim() }
    : null;
}
const TABLE_ROW_RE = /^\s*\|(.+)\|\s*$/;
const TABLE_SEP_RE = /^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/;
const FENCE_RE = /^\s{0,3}(`{3,}|~{3,})(.*)$/;

export function matchFindingsFenceRun(
  line: string,
): { character: "`" | "~"; length: number; suffix: string } | null {
  const match = FENCE_RE.exec(line);
  if (!match) return null;
  return {
    character: match[1][0] as "`" | "~",
    length: match[1].length,
    suffix: match[2],
  };
}

function splitCells(row: string): string[] {
  return row
    .replace(/^\s*\|/, "")
    .replace(/\|\s*$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

const REFERENCE_COLUMN_HEADERS = new Set([
  "source",
  "sources",
  "reference",
  "references",
  "evidence",
  "citation",
  "citations",
]);

function referenceColumnHeader(cell: FindingsSpan[]): boolean {
  const label = cell
    .filter(
      (
        span,
      ): span is Extract<FindingsSpan, { kind: "text" | "link" }> =>
        span.kind === "text" || span.kind === "link",
    )
    .map((span) => span.text)
    .join("")
    .trim()
    .toLowerCase();
  return REFERENCE_COLUMN_HEADERS.has(label);
}

function refOnlyCell(cell: FindingsSpan[]): boolean {
  return (
    cell.some((span) => span.kind === "ref") &&
    cell.every(
      (span) => span.kind === "ref" || span.kind === "ref-gap",
    )
  );
}

/** Parse the body region (everything after the title/lede or one section) into
 *  blocks. Consecutive list items merge into one list; pipe tables with a
 *  dash separator become table blocks; wrapped prose lines join into one
 *  paragraph. */
function parseBlocks(
  lines: string[],
  resolver: RefResolver,
  idPrefix: string,
  allocator: TargetIdAllocator,
): FindingsBlock[] {
  const blocks: FindingsBlock[] = [];
  let paragraph: string[] = [];
  let list: { kind: "ul" | "ol"; items: FindingsSpan[][] } | null = null;
  let blockIndex = 0;

  const nextBlockId = () => {
    blockIndex += 1;
    return allocator.allocate(`${idPrefix}-block-${blockIndex}`);
  };
  const refsForSpans = (spans: FindingsSpan[]) => {
    const refIds: string[] = [];
    collectRefIds(spans, refIds);
    return refIds;
  };

  const flushParagraph = () => {
    if (paragraph.length) {
      const spans = parseSpans(paragraph.join(" "), resolver);
      if (spans.length) {
        blocks.push({
          id: nextBlockId(),
          kind: "p",
          spans,
          refIds: refsForSpans(spans),
        });
      }
      paragraph = [];
    }
  };
  const flushList = () => {
    if (list && list.items.length) {
      const blockId = nextBlockId();
      const items = list.items.map((spans, itemIndex) => ({
        id: allocator.allocate(`${blockId}-item-${itemIndex + 1}`),
        spans,
        refIds: refsForSpans(spans),
      }));
      const refIds: string[] = [];
      for (const item of items) {
        for (const id of item.refIds) if (!refIds.includes(id)) refIds.push(id);
      }
      blocks.push({ id: blockId, kind: list.kind, items, refIds });
    }
    list = null;
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.trim()) {
      flushParagraph();
      flushList();
      continue;
    }

    const fenceRun = matchFindingsFenceRun(line);
    if (fenceRun) {
      flushParagraph();
      flushList();
      const closingFence = new RegExp(
        `^\\s{0,3}${escapeRegExp(fenceRun.character)}{${fenceRun.length},}\\s*$`,
      );
      const language = fenceRun.suffix.trim().split(/\s+/, 1)[0] ?? "";
      const code: string[] = [];
      i += 1;
      for (; i < lines.length && !closingFence.test(lines[i]); i += 1) {
        code.push(lines[i]);
      }
      blocks.push({
        id: nextBlockId(),
        kind: "code",
        language,
        code: code.join("\n"),
        refIds: [],
      });
      continue;
    }

    // Pipe table: a row line immediately followed by a dash separator.
    if (TABLE_ROW_RE.test(line) && i + 1 < lines.length && TABLE_SEP_RE.test(lines[i + 1])) {
      flushParagraph();
      flushList();
      const blockId = nextBlockId();
      const header = splitCells(line).map((cell) => parseSpans(cell, resolver));
      const rows: FindingsTableRow[] = [];
      i += 2;
      for (; i < lines.length && TABLE_ROW_RE.test(lines[i]); i += 1) {
        const cells = splitCells(lines[i]).map((cell) => parseSpans(cell, resolver));
        const refIds: string[] = [];
        for (const cell of cells) collectRefIds(cell, refIds);
        rows.push({
          id: allocator.allocate(`${blockId}-row-${rows.length + 1}`),
          cells,
          refIds,
        });
      }
      i -= 1;
      const headerRefIds: string[] = [];
      for (const cell of header) collectRefIds(cell, headerRefIds);
      const redundantRefColumnIndexes = header.flatMap((cell, columnIndex) =>
        referenceColumnHeader(cell) &&
        rows.length > 0 &&
        rows.every((row) => refOnlyCell(row.cells[columnIndex] ?? []))
          ? [columnIndex]
          : [],
      );
      const refIds = [...headerRefIds];
      for (const row of rows) {
        for (const id of row.refIds) if (!refIds.includes(id)) refIds.push(id);
      }
      blocks.push({
        id: blockId,
        kind: "table",
        header,
        headerRefIds,
        rows,
        redundantRefColumnIndexes,
        refIds,
      });
      continue;
    }

    const unorderedMatch = LIST_RE.exec(line);
    const orderedMatch = ORDERED_LIST_RE.exec(line);
    const listMatch = unorderedMatch ?? orderedMatch;
    if (listMatch) {
      flushParagraph();
      const kind = unorderedMatch ? "ul" : "ol";
      if (list && list.kind !== kind) flushList();
      list = list ?? { kind, items: [] };
      list.items.push(parseSpans(listMatch[1], resolver));
      continue;
    }

    const quoteMatch = QUOTE_RE.exec(line);
    if (quoteMatch) {
      flushParagraph();
      flushList();
      const quoteLines = [quoteMatch[1]];
      for (i += 1; i < lines.length; i += 1) {
        const nextQuote = QUOTE_RE.exec(lines[i]);
        if (!nextQuote) break;
        quoteLines.push(nextQuote[1]);
      }
      i -= 1;
      const spans = parseSpans(quoteLines.join(" "), resolver);
      if (spans.length) {
        blocks.push({
          id: nextBlockId(),
          kind: "quote",
          spans,
          refIds: refsForSpans(spans),
        });
      }
      continue;
    }

    flushList();
    paragraph.push(line.trim());
  }
  flushParagraph();
  flushList();
  return blocks;
}

function sectionRefIds(blocks: FindingsBlock[]): string[] {
  const ids: string[] = [];
  for (const block of blocks) {
    for (const id of block.refIds) if (!ids.includes(id)) ids.push(id);
  }
  return ids;
}

/** Strip the leading `<!-- research-provenance … -->` header (and any other
 *  HTML comments) so it never renders as prose. */
export function stripFindingsComments(markdown: string): string {
  let current = markdown;
  let previous: string;
  do {
    previous = current;
    current = current.replace(/<!--[\s\S]*?-->/g, "");
  } while (current !== previous);
  return current;
}

/**
 * Parse findings markdown into the reader's document model. `sources` supplies
 * the id set that permits bare source refs; bracketed missing S#/R# refs remain
 * visible as unresolved evidence.
 */
export function parseFindingsDoc(markdown: string, sources: ResearchSourceRef[]): FindingsDoc {
  const resolver = buildRefResolver(sources);
  const targetIds = createTargetIdAllocator();
  const lines = stripFindingsComments(markdown ?? "").split(/\r?\n/);

  let title: string | null = null;
  let lede: FindingsSpan[] | null = null;
  let ledeId: string | null = null;
  const sections: FindingsSection[] = [];

  // Group lines by heading. The first level-1 heading is the title; the region
  // before the first sub-heading yields the lede (its first paragraph/quote).
  type Group = { heading: string; level: number; lines: string[] };
  const preamble: string[] = [];
  const groups: Group[] = [];
  let current: Group | null = null;
  let headingFence: { character: string; length: number } | null = null;

  for (const line of lines) {
    const fenceRun = matchFindingsFenceRun(line);
    if (fenceRun) {
      if (
        headingFence &&
        fenceRun.character === headingFence.character &&
        fenceRun.length >= headingFence.length &&
        !fenceRun.suffix.trim()
      ) {
        headingFence = null;
      } else if (!headingFence) {
        headingFence = {
          character: fenceRun.character,
          length: fenceRun.length,
        };
      }
    }
    const headingMatch = headingFence ? null : matchFindingsAtxHeading(line);
    if (headingMatch) {
      const { level, heading } = headingMatch;
      if (title === null && level === 1) {
        title = heading;
        current = null;
        continue;
      }
      current = { heading, level, lines: [] };
      groups.push(current);
      continue;
    }
    if (current) current.lines.push(line);
    else preamble.push(line);
  }

  // Lede: only a *leading blockquote* becomes the italic tagline under the
  // title (matching the design). Plain opening prose stays body text so a
  // heading-less "title + paragraph" doc doesn't lose its content to a lede.
  const overviewId = targetIds.allocate("s-overview");
  const preambleBlocks = parseBlocks(preamble, resolver, overviewId, targetIds);
  let leadBlocks: FindingsBlock[] = preambleBlocks;
  if (preambleBlocks[0]?.kind === "quote") {
    lede = preambleBlocks[0].spans;
    releaseBlockTargetIds(preambleBlocks[0], targetIds);
    ledeId = targetIds.allocate("research-question");
    leadBlocks = preambleBlocks.slice(1);
  }
  if (!leadBlocks.length) targetIds.release(overviewId);

  groups.forEach((group, index) => {
    const sectionId = uniqueSectionId(group.heading, index, targetIds);
    const blocks = parseBlocks(group.lines, resolver, sectionId, targetIds);
    sections.push({
      id: sectionId,
      heading: group.heading,
      blocks,
      refIds: sectionRefIds(blocks),
    });
  });

  // Leftover preamble prose (rare) is preserved as a leading, heading-less
  // section rather than discarded.
  if (leadBlocks.length) {
    sections.unshift({ id: overviewId, heading: "", blocks: leadBlocks, refIds: sectionRefIds(leadBlocks) });
  }

  const refIds: string[] = [];
  if (lede) collectRefIds(lede, refIds);
  for (const section of sections) for (const id of section.refIds) if (!refIds.includes(id)) refIds.push(id);

  return { title, lede, ledeId, sections, refIds };
}

function spansSupportRef(spans: FindingsSpan[], id: string): boolean {
  return spans.some((span) => span.kind === "ref" && span.id === id);
}

/** Claim-level targets cited by a source — the evidence card's "Supports"
 * links, derived from the exact lede, block, list item, or table row. */
export function targetsSupportingRef(
  doc: FindingsDoc,
  id: string,
): FindingsSupportTarget[] {
  const targets: FindingsSupportTarget[] = [];

  if (doc.lede && doc.ledeId && spansSupportRef(doc.lede, id)) {
    targets.push({
      id: doc.ledeId,
      label: "Research question",
      sectionId: null,
    });
  }

  for (const section of doc.sections) {
    const sectionLabel = section.heading || "Overview";
    for (const block of section.blocks) {
      if (block.kind === "p" || block.kind === "quote") {
        if (block.refIds.includes(id)) {
          targets.push({
            id: block.id,
            label: sectionLabel,
            sectionId: section.id,
          });
        }
      } else if (block.kind === "ul" || block.kind === "ol") {
        block.items.forEach((item, itemIndex) => {
          if (item.refIds.includes(id)) {
            targets.push({
              id: item.id,
              label: `${sectionLabel} · item ${itemIndex + 1}`,
              sectionId: section.id,
            });
          }
        });
      } else if (block.kind === "table") {
        block.rows.forEach((row, rowIndex) => {
          if (row.refIds.includes(id)) {
            targets.push({
              id: row.id,
              label: `${sectionLabel} · row ${rowIndex + 1}`,
              sectionId: section.id,
            });
          }
        });
      }
    }
  }

  const duplicateCounts = new Map<string, number>();
  for (const target of targets) {
    if (!target.sectionId) continue;
    const key = `${target.sectionId}\u0000${target.label}`;
    duplicateCounts.set(key, (duplicateCounts.get(key) ?? 0) + 1);
  }

  const duplicateIndexes = new Map<string, number>();
  return targets.map((target) => {
    if (!target.sectionId) return target;
    const key = `${target.sectionId}\u0000${target.label}`;
    const count = duplicateCounts.get(key) ?? 1;
    if (count === 1) return target;
    const index = (duplicateIndexes.get(key) ?? 0) + 1;
    duplicateIndexes.set(key, index);
    return {
      ...target,
      label: `${target.label} · claim ${index}/${count}`,
    };
  });
}
