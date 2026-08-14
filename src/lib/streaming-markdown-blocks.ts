export type StreamingMarkdownBlock = {
  id: string;
  kind: "markdown";
  source: string;
  renderMode: "markdown" | "plain";
};

export type StreamingListBlock = {
  id: string;
  kind: "list";
  ordered: boolean;
  committedItems: Array<{ id: string; source: string }>;
  activeItem?: { id: string; source: string };
  source: string;
};

export type StreamingContentBlock = StreamingMarkdownBlock | StreamingListBlock;

export type StreamingMarkdownPartition = {
  committedBlocks: StreamingContentBlock[];
  activeBlock: StreamingContentBlock | null;
  committedText: string;
};

type PartitionOptions = { turnId: string; settled: boolean };

type Line = {
  start: number;
  end: number;
  text: string;
  hasNewline: boolean;
};

type InternalMarkdownBlock = {
  kind: "markdown";
  start: number;
  end: number;
  source: string;
  renderMode: "markdown" | "plain";
};

type InternalListItem = {
  start: number;
  end: number;
  source: string;
};

type InternalListBlock = {
  kind: "list";
  start: number;
  end: number;
  ordered: boolean;
  committedItems: InternalListItem[];
  activeItem?: InternalListItem;
  ambiguousTail?: boolean;
  source: string;
};

type InternalBlock = InternalMarkdownBlock | InternalListBlock;

type ParseResult =
  | { complete: true; nextLineIndex: number; block: InternalBlock }
  | { complete: false; block: InternalBlock };

type FenceState = { marker: "`" | "~"; width: number; start: number };
type FenceOpening = FenceState | { invalid: true; start: number };

function scanLines(source: string): Line[] {
  const lines: Line[] = [];
  let start = 0;
  while (start < source.length) {
    const newline = source.indexOf("\n", start);
    const end = newline === -1 ? source.length : newline + 1;
    lines.push({
      start,
      end,
      text: source.slice(start, end),
      hasNewline: newline !== -1,
    });
    start = end;
  }
  return lines;
}

function lineBody(line: Line): string {
  return line.text.endsWith("\n") ? line.text.slice(0, -1) : line.text;
}

function isBlankLine(line: Line): boolean {
  return /^\s*$/.test(lineBody(line).replace(/\r$/, ""));
}

function isStructuralBlankLine(line: Line): boolean {
  return line.hasNewline && isBlankLine(line);
}

function isHeadingLine(line: Line): boolean {
  return /^ {0,3}#{1,6}(?:\s+.*)?$/.test(lineBody(line).replace(/\r$/, ""));
}

function isThematicBreakLine(line: Line): boolean {
  return /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/.test(lineBody(line).replace(/\r$/, ""));
}

function parseFenceOpening(line: Line): FenceOpening | null {
  const match = /^( {0,3})(`{3,}|~{3,})(.*)$/.exec(lineBody(line).replace(/\r$/, ""));
  if (!match) return null;
  const marker = match[2][0] as "`" | "~";
  if (marker === "`" && match[3].includes("`")) return { invalid: true, start: line.start };
  return { marker, width: match[2].length, start: line.start };
}

function isFenceClosingLine(line: Line, fence: FenceState): boolean {
  const body = lineBody(line).replace(/\r$/, "");
  const match = /^( {0,3})(`{3,}|~{3,})[ \t]*$/.exec(body);
  return !!match && match[2][0] === fence.marker && match[2].length >= fence.width;
}

function parseListMarker(line: Line): { ordered: boolean; markerIndent: number; contentIndent: number } | null {
  const body = lineBody(line).replace(/\r$/, "");
  const unordered = /^( {0,3})([-+*])(\s+).*$/.exec(body);
  if (unordered) {
    return {
      ordered: false,
      markerIndent: unordered[1].length,
      contentIndent: unordered[1].length + unordered[2].length + unordered[3].length,
    };
  }

  const ordered = /^( {0,3})(\d+[.)])(\s+).*$/.exec(body);
  if (ordered) {
    return {
      ordered: true,
      markerIndent: ordered[1].length,
      contentIndent: ordered[1].length + ordered[2].length + ordered[3].length,
    };
  }

  return null;
}

function isIndentedCodeLine(line: Line): boolean {
  const body = lineBody(line);
  return body.startsWith("    ") || body.startsWith("\t");
}

function isBlockquoteLine(line: Line): boolean {
  return /^ {0,3}>/.test(lineBody(line).replace(/\r$/, ""));
}

function isTableBodyLine(line: Line): boolean {
  const body = lineBody(line).replace(/\r$/, "");
  return !/^[ \t]/.test(body) && body.includes("|");
}

function splitTableCells(body: string): string[] {
  const cells: string[] = [];
  let current = "";
  let trailingBackslashes = 0;

  for (const character of body) {
    if (character === "|" && trailingBackslashes % 2 === 0) {
      cells.push(current);
      current = "";
      trailingBackslashes = 0;
      continue;
    }

    current += character;
    trailingBackslashes = character === "\\" ? trailingBackslashes + 1 : 0;
  }

  cells.push(current);

  if (body.startsWith("|")) cells.shift();
  if (hasUnescapedTerminalPipe(body)) cells.pop();

  return cells.map((cell) => cell.trim());
}

function hasUnescapedTerminalPipe(body: string): boolean {
  if (!body.endsWith("|")) return false;
  let backslashes = 0;
  for (let index = body.length - 2; index >= 0 && body[index] === "\\"; index -= 1) {
    backslashes += 1;
  }
  return backslashes % 2 === 0;
}

function getTableHeaderCellCount(line: Line): number | null {
  const body = lineBody(line).replace(/\r$/, "");
  if (/^[ \t]/.test(body) || !body.includes("|")) return null;
  return splitTableCells(body).length;
}

function getTableDelimiterCellCount(line: Line): number | null {
  const body = lineBody(line).replace(/\r$/, "").trim();
  if (!body) return null;
  const cells = splitTableCells(body);
  if (cells.length === 0 || !cells.every((cell) => /^:?-{1,}:?$/.test(cell))) return null;
  return cells.length;
}

function makeMarkdownBlock(
  source: string,
  start: number,
  end: number,
  renderMode: "markdown" | "plain",
): InternalMarkdownBlock {
  return { kind: "markdown", start, end, source: source.slice(start, end), renderMode };
}

function makeListBlock(
  source: string,
  start: number,
  end: number,
  ordered: boolean,
  committedItems: InternalListItem[],
  activeItem?: InternalListItem,
  ambiguousTail = false,
): InternalListBlock {
  return {
    kind: "list",
    start,
    end,
    ordered,
    committedItems,
    activeItem,
    ambiguousTail,
    source: source.slice(start, end),
  };
}

function consumeStructuralBlankLine(line: Line, startIndex: number): { nextLineIndex: number; end: number } {
  return { nextLineIndex: startIndex + 1, end: line.end };
}

function parseFence(source: string, lines: Line[], startIndex: number): ParseResult | null {
  const fence = parseFenceOpening(lines[startIndex]);
  if (!fence) return null;
  if ("invalid" in fence) {
    return { complete: false, block: makeMarkdownBlock(source, fence.start, source.length, "plain") };
  }
  for (let index = startIndex + 1; index < lines.length; index += 1) {
    if (!isFenceClosingLine(lines[index], fence)) continue;
    if (!lines[index].hasNewline) {
      return { complete: false, block: makeMarkdownBlock(source, fence.start, source.length, "plain") };
    }
    return {
      complete: true,
      nextLineIndex: index + 1,
      block: makeMarkdownBlock(source, fence.start, lines[index].end, "markdown"),
    };
  }
  return { complete: false, block: makeMarkdownBlock(source, fence.start, source.length, "plain") };
}

function parseTable(source: string, lines: Line[], startIndex: number): ParseResult | null {
  const headerCellCount = getTableHeaderCellCount(lines[startIndex]);
  if (headerCellCount === null) return null;
  if (startIndex + 1 >= lines.length) return null;

  const delimiterCellCount = getTableDelimiterCellCount(lines[startIndex + 1]);
  if (delimiterCellCount === null) return null;
  if (delimiterCellCount !== headerCellCount) {
    return { complete: false, block: makeMarkdownBlock(source, lines[startIndex].start, source.length, "plain") };
  }

  let index = startIndex + 2;
  let bodyRows = 0;
  while (index < lines.length && isTableBodyLine(lines[index])) {
    const bodyCellCount = getTableHeaderCellCount(lines[index]);
    if (bodyCellCount !== headerCellCount) {
      return { complete: false, block: makeMarkdownBlock(source, lines[startIndex].start, source.length, "plain") };
    }
    bodyRows += 1;
    index += 1;
  }
  if (bodyRows < 1) {
    return { complete: false, block: makeMarkdownBlock(source, lines[startIndex].start, source.length, "plain") };
  }
  if (index >= lines.length || !isStructuralBlankLine(lines[index])) {
    return { complete: false, block: makeMarkdownBlock(source, lines[startIndex].start, source.length, "plain") };
  }
  const blankTail = consumeStructuralBlankLine(lines[index], index);
  return {
    complete: true,
    nextLineIndex: blankTail.nextLineIndex,
    block: makeMarkdownBlock(source, lines[startIndex].start, blankTail.end, "markdown"),
  };
}

function parseList(source: string, lines: Line[], startIndex: number): ParseResult | null {
  const marker = parseListMarker(lines[startIndex]);
  if (!marker) return null;

  const committedItems: InternalListItem[] = [];
  let itemStart = lines[startIndex].start;
  let index = startIndex + 1;

  while (index < lines.length) {
    if (isStructuralBlankLine(lines[index])) {
      committedItems.push({
        start: itemStart,
        end: lines[index].start,
        source: source.slice(itemStart, lines[index].start),
      });
      const blankTail = consumeStructuralBlankLine(lines[index], index);
      return {
        complete: true,
        nextLineIndex: blankTail.nextLineIndex,
        block: makeListBlock(
          source,
          lines[startIndex].start,
          blankTail.end,
          marker.ordered,
          committedItems,
        ),
      };
    }

    const nextMarker = parseListMarker(lines[index]);
    if (nextMarker && nextMarker.ordered === marker.ordered) {
      if (nextMarker.markerIndent >= marker.contentIndent) {
        if (committedItems.length > 0) {
          return {
            complete: false,
            block: makeListBlock(
              source,
              lines[startIndex].start,
              source.length,
              marker.ordered,
              committedItems,
              { start: itemStart, end: source.length, source: source.slice(itemStart) },
              true,
            ),
          };
        }
        return {
          complete: false,
          block: makeMarkdownBlock(source, lines[startIndex].start, source.length, "plain"),
        };
      }
      committedItems.push({
        start: itemStart,
        end: lines[index].start,
        source: source.slice(itemStart, lines[index].start),
      });
      itemStart = lines[index].start;
      index += 1;
      continue;
    }

    return {
      complete: false,
      block: makeMarkdownBlock(source, lines[startIndex].start, source.length, "plain"),
    };
  }

  return {
    complete: false,
    block: makeListBlock(
      source,
      lines[startIndex].start,
      source.length,
      marker.ordered,
      committedItems,
      { start: itemStart, end: source.length, source: source.slice(itemStart) },
    ),
  };
}

function parseBlockquote(source: string, lines: Line[], startIndex: number): ParseResult | null {
  if (!isBlockquoteLine(lines[startIndex])) return null;
  let index = startIndex + 1;
  while (index < lines.length && !isStructuralBlankLine(lines[index])) index += 1;
  if (index >= lines.length) {
    return { complete: false, block: makeMarkdownBlock(source, lines[startIndex].start, source.length, "plain") };
  }
  const blankTail = consumeStructuralBlankLine(lines[index], index);
  return {
    complete: true,
    nextLineIndex: blankTail.nextLineIndex,
    block: makeMarkdownBlock(source, lines[startIndex].start, blankTail.end, "markdown"),
  };
}

function parseIndentedCode(source: string, lines: Line[], startIndex: number): ParseResult | null {
  if (!isIndentedCodeLine(lines[startIndex])) return null;
  let index = startIndex + 1;
  while (index < lines.length && !isStructuralBlankLine(lines[index])) index += 1;
  if (index >= lines.length) {
    return { complete: false, block: makeMarkdownBlock(source, lines[startIndex].start, source.length, "plain") };
  }
  const blankTail = consumeStructuralBlankLine(lines[index], index);
  return {
    complete: true,
    nextLineIndex: blankTail.nextLineIndex,
    block: makeMarkdownBlock(source, lines[startIndex].start, blankTail.end, "markdown"),
  };
}

function parseHeadingOrThematic(source: string, lines: Line[], startIndex: number): ParseResult | null {
  if (!isHeadingLine(lines[startIndex]) && !isThematicBreakLine(lines[startIndex])) return null;
  if (!lines[startIndex].hasNewline) {
    return {
      complete: false,
      block: makeMarkdownBlock(source, lines[startIndex].start, source.length, "markdown"),
    };
  }
  return {
    complete: true,
    nextLineIndex: startIndex + 1,
    block: makeMarkdownBlock(source, lines[startIndex].start, lines[startIndex].end, "markdown"),
  };
}

function parseParagraph(source: string, lines: Line[], startIndex: number): ParseResult {
  let index = startIndex + 1;
  while (index < lines.length && !isStructuralBlankLine(lines[index])) index += 1;
  if (index >= lines.length) {
    return {
      complete: false,
      block: makeMarkdownBlock(source, lines[startIndex].start, source.length, "markdown"),
    };
  }
  const blankTail = consumeStructuralBlankLine(lines[index], index);
  return {
    complete: true,
    nextLineIndex: blankTail.nextLineIndex,
    block: makeMarkdownBlock(source, lines[startIndex].start, blankTail.end, "markdown"),
  };
}

function parseNextBlock(source: string, lines: Line[], startIndex: number): ParseResult {
  return (
    parseFence(source, lines, startIndex)
    ?? parseTable(source, lines, startIndex)
    ?? parseIndentedCode(source, lines, startIndex)
    ?? parseHeadingOrThematic(source, lines, startIndex)
    ?? parseList(source, lines, startIndex)
    ?? parseBlockquote(source, lines, startIndex)
    ?? parseParagraph(source, lines, startIndex)
  );
}

function toPublicMarkdownBlock(turnId: string, block: InternalBlock): StreamingMarkdownBlock {
  return {
    id: `${turnId}:${block.start}-${block.end}`,
    kind: "markdown",
    source: block.source,
    renderMode: "markdown",
  };
}

function toPublicBlock(turnId: string, block: InternalBlock): StreamingContentBlock {
  if (block.kind === "markdown") {
    return {
      id: `${turnId}:${block.start}-${block.end}`,
      kind: "markdown",
      source: block.source,
      renderMode: block.renderMode,
    };
  }
  return {
    id: `${turnId}:${block.start}-list`,
    kind: "list",
    ordered: block.ordered,
    committedItems: block.committedItems.map((item, index) => ({
      id: `${turnId}:${block.start}-item-${index}`,
      source: item.source,
    })),
    ...(block.activeItem
      ? {
        activeItem: {
          id: `${turnId}:${block.start}-item-${block.committedItems.length}`,
          source: block.activeItem.source,
        },
      }
      : {}),
    source: block.source,
  };
}

function finalizeSettledBlock(block: InternalBlock): InternalBlock {
  if (block.kind !== "list") return block;
  if (block.ambiguousTail) {
    return {
      kind: "markdown",
      start: block.start,
      end: block.end,
      source: block.source,
      renderMode: "plain",
    };
  }
  if (!block.activeItem) return block;
  return {
    ...block,
    committedItems: [...block.committedItems, block.activeItem],
    activeItem: undefined,
  };
}

function toSettledPublicBlock(turnId: string, block: InternalBlock): StreamingContentBlock {
  const finalized = finalizeSettledBlock(block);
  return finalized.kind === "markdown"
    ? toPublicMarkdownBlock(turnId, finalized)
    : toPublicBlock(turnId, finalized);
}

export function partitionStreamingMarkdown(
  source: string,
  options: PartitionOptions,
): StreamingMarkdownPartition {
  const lines = scanLines(source);
  const committedInternal: InternalBlock[] = [];
  let lineIndex = 0;

  while (lineIndex < lines.length) {
    if (isStructuralBlankLine(lines[lineIndex])) {
      const blankTail = consumeStructuralBlankLine(lines[lineIndex], lineIndex);
      committedInternal.push(makeMarkdownBlock(source, lines[lineIndex].start, blankTail.end, "markdown"));
      lineIndex = blankTail.nextLineIndex;
      continue;
    }

    const result = parseNextBlock(source, lines, lineIndex);
    if (!result.complete) {
      if (options.settled) {
        return {
          committedBlocks: [...committedInternal, result.block].map((block) => toSettledPublicBlock(options.turnId, block)),
          activeBlock: null,
          committedText: source,
        };
      }
      return {
        committedBlocks: committedInternal.map((block) => toPublicBlock(options.turnId, block)),
        activeBlock: toPublicBlock(options.turnId, result.block),
        committedText: committedInternal.map((block) => block.source).join(""),
      };
    }

    committedInternal.push(result.block);
    lineIndex = result.nextLineIndex;
  }

  return {
    committedBlocks: options.settled
      ? committedInternal.map((block) => toSettledPublicBlock(options.turnId, block))
      : committedInternal.map((block) => toPublicBlock(options.turnId, block)),
    activeBlock: null,
    committedText: options.settled ? source : committedInternal.map((block) => block.source).join(""),
  };
}
