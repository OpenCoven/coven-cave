export type TurnResultState = "pending" | "running" | "passed" | "attention" | "failed";
export type TurnResult = {
  id: string;
  label: string;
  state: TurnResultState;
  source: "familiar" | "verified-event";
};

export const RESULT_ID_MAX = 128;
export const RESULT_LABEL_MAX = 256;
// Value maxima plus bounded room for attribute names, state, separators, and
// legitimate multiline whitespace.
const RESULT_PARSE_ATTRIBUTE_MAX =
  RESULT_ID_MAX + RESULT_LABEL_MAX + 512;

const OPEN_CANDIDATE = "<coven:r";
const CLOSE_CANDIDATE = "</coven:r";
const OPEN_NAME = "<coven:result";
const CLOSE_NAME = "</coven:result";
const ATTRIBUTE_NAMES = new Set(["id", "state", "label"]);
const RESULT_STATES = new Set<TurnResultState>([
  "pending",
  "running",
  "passed",
  "attention",
  "failed",
]);

type Candidate = {
  start: number;
  kind: "open" | "close";
  prefix: typeof OPEN_CANDIDATE | typeof CLOSE_CANDIDATE;
  name: typeof OPEN_NAME | typeof CLOSE_NAME;
};

type ProtocolCandidate = Candidate & {
  exactName: boolean;
  contentStart: number;
};

type LexicalTagScan =
  | {
    kind: "terminated";
    closeIndex: number;
    firstUnquotedBacktick: number | null;
    withinParseBudget: boolean;
  }
  | {
    kind: "candidate" | "end";
    boundary: number;
    firstUnquotedBacktick: number | null;
  };

type CodeRange = [start: number, end: number];

type SourceLineTable = {
  starts: number[];
};

function buildSourceLineTable(text: string): SourceLineTable {
  const starts = [0];
  let newline = text.indexOf("\n");
  while (newline !== -1) {
    starts.push(newline + 1);
    newline = text.indexOf("\n", newline + 1);
  }
  return { starts };
}

function sourceLineRawEnd(
  text: string,
  table: SourceLineTable,
  lineIndex: number,
): number {
  return lineIndex + 1 < table.starts.length
    ? table.starts[lineIndex + 1] - 1
    : text.length;
}

function sourceLineContentEnd(
  text: string,
  table: SourceLineTable,
  lineIndex: number,
): number {
  const rawEnd = sourceLineRawEnd(text, table, lineIndex);
  return rawEnd > table.starts[lineIndex] && text[rawEnd - 1] === "\r"
    ? rawEnd - 1
    : rawEnd;
}

function sourceLineEnd(
  text: string,
  table: SourceLineTable,
  lineIndex: number,
): number {
  return lineIndex + 1 < table.starts.length
    ? table.starts[lineIndex + 1]
    : text.length;
}

function sourceLineText(
  text: string,
  table: SourceLineTable,
  lineIndex: number,
): string {
  return text.slice(
    table.starts[lineIndex],
    sourceLineRawEnd(text, table, lineIndex),
  );
}

function advanceSourceLine(
  table: SourceLineTable,
  index: number,
  fromLine: number,
): number {
  let line = fromLine;
  while (line + 1 < table.starts.length && table.starts[line + 1] <= index) {
    line += 1;
  }
  return line;
}

function nextCandidate(text: string, from: number, limit: number): Candidate | null {
  let index = text.indexOf("<", from);
  while (index !== -1 && index < limit) {
    if (text.startsWith(CLOSE_CANDIDATE, index)) {
      return {
        start: index,
        kind: "close",
        prefix: CLOSE_CANDIDATE,
        name: CLOSE_NAME,
      };
    }
    if (text.startsWith(OPEN_CANDIDATE, index)) {
      return {
        start: index,
        kind: "open",
        prefix: OPEN_CANDIDATE,
        name: OPEN_NAME,
      };
    }
    index = text.indexOf("<", index + 1);
  }
  return null;
}

function isNameContinuation(character: string): boolean {
  return /[A-Za-z0-9_.:-]/.test(character);
}

function asProtocolCandidate(
  text: string,
  candidate: Candidate,
  limit: number,
): ProtocolCandidate | null {
  for (let offset = candidate.prefix.length; offset < candidate.name.length; offset += 1) {
    const index = candidate.start + offset;
    if (index >= limit) {
      return { ...candidate, exactName: false, contentStart: index };
    }
    if (text[index] !== candidate.name[offset]) {
      return isNameContinuation(text[index])
        ? null
        : { ...candidate, exactName: false, contentStart: index };
    }
  }

  const contentStart = candidate.start + candidate.name.length;
  if (contentStart < limit && isNameContinuation(text[contentStart])) {
    return null;
  }
  return { ...candidate, exactName: true, contentStart };
}

function startsCandidate(text: string, index: number, limit: number): boolean {
  if (index >= limit || text[index] !== "<") return false;
  return (
    index + OPEN_CANDIDATE.length <= limit
    && text.startsWith(OPEN_CANDIDATE, index)
  ) || (
    index + CLOSE_CANDIDATE.length <= limit
    && text.startsWith(CLOSE_CANDIDATE, index)
  );
}

type AttributeSyntaxTracker = {
  state: "separator" | "name" | "quote" | "value" | "invalid";
  sawSeparator: boolean;
};

function advanceAttributeSyntax(
  tracker: AttributeSyntaxTracker,
  character: string,
): void {
  switch (tracker.state) {
    case "separator":
      if (/\s/.test(character)) {
        tracker.sawSeparator = true;
      } else if (tracker.sawSeparator && /[A-Za-z-]/.test(character)) {
        tracker.state = "name";
      } else {
        tracker.state = "invalid";
      }
      break;
    case "name":
      if (/[A-Za-z-]/.test(character)) return;
      tracker.state = character === "=" ? "quote" : "invalid";
      break;
    case "quote":
      tracker.state = character === '"' ? "value" : "invalid";
      break;
    case "value":
      if (character === '"') {
        tracker.state = "separator";
        tracker.sawSeparator = false;
      }
      break;
    case "invalid":
      break;
  }
}

function rangeIsHorizontalWhitespace(
  text: string,
  start: number,
  end: number,
): boolean {
  for (let index = start; index < end; index += 1) {
    if (text[index] !== " " && text[index] !== "\t") return false;
  }
  return true;
}

function lineLooksLikeAttributeContinuation(
  text: string,
  start: number,
  end: number,
): boolean {
  let cursor = start;
  while (cursor < end && /\s/.test(text[cursor])) cursor += 1;
  if (cursor === end) return true;
  if (text[cursor] === "/") {
    cursor += 1;
    while (cursor < end && /\s/.test(text[cursor])) cursor += 1;
    return cursor === end;
  }

  const nameStart = cursor;
  while (cursor < end && /[A-Za-z-]/.test(text[cursor])) cursor += 1;
  if (cursor === nameStart) return false;
  while (cursor < end && /\s/.test(text[cursor])) cursor += 1;
  return text[cursor] === "=";
}

function malformedTerminatorLineLooksOwned(
  text: string,
  closeIndex: number,
  lines: SourceLineTable,
  candidateLineIndex: number,
  closeLineIndex: number,
): boolean {
  if (closeLineIndex === candidateLineIndex) return true;
  return lineLooksLikeAttributeContinuation(
    text,
    lines.starts[closeLineIndex],
    closeIndex,
  );
}

function simpleProtocolCloseIndex(
  text: string,
  candidate: ProtocolCandidate,
  limit: number,
): number | null {
  const scanLimit = Math.min(
    limit,
    candidate.contentStart + RESULT_PARSE_ATTRIBUTE_MAX,
  );
  let inQuote = false;
  for (let index = candidate.contentStart; index < scanLimit; index += 1) {
    const character = text[index];
    if (character === '"') {
      inQuote = !inQuote;
    } else if (character === ">" && !inQuote) {
      return index;
    }
  }
  return null;
}

function isClearValidResultCandidate(
  text: string,
  index: number,
  limit: number,
): boolean {
  const nested = nextCandidate(text, index, limit);
  if (!nested || nested.start !== index || nested.kind !== "open") return false;
  const protocol = asProtocolCandidate(text, nested, limit);
  if (!protocol?.exactName) return false;
  const closeIndex = simpleProtocolCloseIndex(text, protocol, limit);
  if (closeIndex === null || text[closeIndex - 1] !== "/") return false;
  return parseResult(text.slice(protocol.contentStart, closeIndex - 1)) !== null;
}

function scanProtocolLexically(
  text: string,
  candidate: ProtocolCandidate,
  outerLimit: number,
  lines: SourceLineTable,
  candidateLineIndex: number,
): LexicalTagScan {
  let inQuote = false;
  let firstUnquotedBacktick: number | null = null;
  let recoveryBoundary: number | null = null;
  let scanLineIndex = candidateLineIndex;
  let parseBudgetExceeded = false;
  const attributeSyntax: AttributeSyntaxTracker = {
    state: "separator",
    sawSeparator: false,
  };

  // Parse eligibility is bounded; cleanup keeps advancing without copying the
  // attribute payload so a complete rejected tag remains one opaque span.
  for (let index = candidate.contentStart; index < outerLimit; index += 1) {
    scanLineIndex = advanceSourceLine(lines, index, scanLineIndex);
    const character = text[index];
    const selfClosingSlash = character === "/" && !inQuote && text[index + 1] === ">";
    if (
      !selfClosingSlash
      && !(character === ">" && !inQuote)
      && index - candidate.contentStart >= RESULT_PARSE_ATTRIBUTE_MAX
    ) {
      parseBudgetExceeded = true;
    }
    if (character === '"') {
      advanceAttributeSyntax(attributeSyntax, character);
      inQuote = !inQuote;
      continue;
    }

    if (startsCandidate(text, index, outerLimit)) {
      if (!inQuote) {
        return {
          kind: "candidate",
          boundary: recoveryBoundary ?? index,
          firstUnquotedBacktick,
        };
      }

      if (recoveryBoundary === null) {
        // Keep the earliest plausible fallback speculative: a grammatically
        // complete outer tag still owns candidate-looking text in its values.
        const nested = nextCandidate(text, index, outerLimit);
        const nestedProtocol = nested?.start === index
          ? asProtocolCandidate(text, nested, outerLimit)
          : null;
        const atLineBoundary = scanLineIndex > candidateLineIndex
          && rangeIsHorizontalWhitespace(
            text,
            lines.starts[scanLineIndex],
            index,
          );
        if (
          nestedProtocol?.exactName
          && (
            atLineBoundary
            || isClearValidResultCandidate(text, index, outerLimit)
          )
        ) {
          recoveryBoundary = index;
        }
      }
    }

    if (!inQuote && character === "`") {
      firstUnquotedBacktick ??= index;
      advanceAttributeSyntax(attributeSyntax, character);
      continue;
    }
    if (character === ">" && !inQuote) {
      const selfClosing = text[index - 1] === "/";
      const ownsTerminator = (
        candidate.kind !== "open"
        || !candidate.exactName
        || attributeSyntax.state === "separator"
        || selfClosing
        || malformedTerminatorLineLooksOwned(
          text,
          index,
          lines,
          candidateLineIndex,
          scanLineIndex,
        )
      );
      if (
        recoveryBoundary !== null
        && !ownsTerminator
      ) {
        return {
          kind: "candidate",
          boundary: recoveryBoundary,
          firstUnquotedBacktick,
        };
      }
      if (
        !ownsTerminator
        && scanLineIndex > candidateLineIndex
        && text[index - 1] !== "/"
      ) {
        // A prose quote can flip the recovery state; its later-line `>` is not
        // enough to complete structurally impossible attributes.
        if (index - candidate.contentStart >= RESULT_PARSE_ATTRIBUTE_MAX) {
          parseBudgetExceeded = true;
        }
        advanceAttributeSyntax(attributeSyntax, character);
        continue;
      }
      return {
        kind: "terminated",
        closeIndex: index,
        firstUnquotedBacktick,
        withinParseBudget: !parseBudgetExceeded,
      };
    }

    if (!selfClosingSlash) {
      advanceAttributeSyntax(attributeSyntax, character);
    }
  }

  if (recoveryBoundary !== null) {
    return {
      kind: "candidate",
      boundary: recoveryBoundary,
      firstUnquotedBacktick,
    };
  }

  return {
    kind: "end",
    boundary: outerLimit,
    firstUnquotedBacktick,
  };
}

function scanEndBeforeBoundary(
  text: string,
  candidate: ProtocolCandidate,
  boundary: number,
  lines: SourceLineTable,
  candidateLineIndex: number,
): { end: number; replacement: string } {
  const candidateLineStart = lines.starts[candidateLineIndex];
  const boundaryLineIndex = advanceSourceLine(
    lines,
    boundary,
    candidateLineIndex,
  );
  const boundaryLineStart = lines.starts[boundaryLineIndex];
  if (boundaryLineStart <= candidateLineStart) {
    return { end: boundary, replacement: "" };
  }
  if (candidate.start === candidateLineStart) {
    return { end: boundary, replacement: "" };
  }

  let newlineStart = boundaryLineStart - 1;
  if (newlineStart > 0 && text[newlineStart - 1] === "\r") newlineStart -= 1;
  return {
    end: boundary,
    replacement: text.slice(newlineStart, boundaryLineStart),
  };
}

function incompleteProtocolMaskEnd(
  text: string,
  boundary: number,
  lines: SourceLineTable,
  candidateLineIndex: number,
): number {
  let end = Math.min(
    sourceLineEnd(text, lines, candidateLineIndex),
    boundary,
  );
  let nextLineIndex = candidateLineIndex + 1;

  while (
    nextLineIndex < lines.starts.length
    && lines.starts[nextLineIndex] < boundary
  ) {
    const contentEnd = Math.min(
      sourceLineContentEnd(text, lines, nextLineIndex),
      boundary,
    );
    if (!lineLooksLikeAttributeContinuation(
      text,
      lines.starts[nextLineIndex],
      contentEnd,
    )) break;
    end = Math.min(sourceLineEnd(text, lines, nextLineIndex), boundary);
    nextLineIndex += 1;
  }

  return end;
}

function resultProtocolMaskEnd(
  text: string,
  candidate: ProtocolCandidate,
  limit: number,
  lines: SourceLineTable,
  candidateLineIndex: number,
): {
  end: number;
  terminated: boolean;
  closeIndex: number | null;
  withinParseBudget: boolean;
} {
  const lexical = scanProtocolLexically(
    text,
    candidate,
    limit,
    lines,
    candidateLineIndex,
  );
  if (lexical.kind === "terminated") {
    return {
      end: lexical.closeIndex + 1,
      terminated: true,
      closeIndex: lexical.closeIndex,
      withinParseBudget: lexical.withinParseBudget,
    };
  }

  const end = incompleteProtocolMaskEnd(
    text,
    lexical.boundary,
    lines,
    candidateLineIndex,
  );
  return {
    end: lexical.firstUnquotedBacktick === null
      ? end
      : Math.min(lexical.firstUnquotedBacktick, end),
    terminated: false,
    closeIndex: null,
    withinParseBudget: false,
  };
}

function matchingBacktickRunStart(
  text: string,
  start: number,
  end: number,
  delimiterLength: number,
): number | null {
  let cursor = text.indexOf("`", start);
  while (cursor !== -1 && cursor < end) {
    let runEnd = cursor + 1;
    while (runEnd < end && text[runEnd] === "`") runEnd += 1;
    if (runEnd - cursor === delimiterLength) return cursor;
    cursor = text.indexOf("`", runEnd);
  }
  return null;
}

// These two states mirror the range parser's container-aware and renderer-aware
// fence union while allowing protocol-owned lines to be consumed atomically.
type ContainerFenceState = {
  character: string;
  length: number;
  quoteDepth: number;
  closingIndent: number;
  openedFromList: boolean;
  interiorLines: number;
};

type RendererFenceState = {
  character: string;
  openedFromList: boolean;
};

function leadingWhitespaceLength(line: string): number {
  return /^[ \t]*/.exec(line)?.[0].length ?? 0;
}

function quotedLineContent(line: string): { content: string; quoteDepth: number } {
  let contentOffset = 0;
  let quoteDepth = 0;
  while (true) {
    const quote = /^ {0,3}>[ \t]?/.exec(line.slice(contentOffset));
    if (!quote) break;
    contentOffset += quote[0].length;
    quoteDepth += 1;
  }
  return { content: line.slice(contentOffset), quoteDepth };
}

function advanceContainerFence(
  line: string,
  nextLine: string | undefined,
  state: ContainerFenceState | null,
): { protectedLine: boolean; state: ContainerFenceState | null } {
  const { content: containerContent, quoteDepth } = quotedLineContent(line);
  if (state === null) {
    const list = /^ {0,3}(?:[-+*]|\d{1,9}[.)])[ \t]+/.exec(containerContent);
    const content = list
      ? containerContent.slice(list[0].length)
      : containerContent;
    const opening = /^([ \t]*)(`{3,}|~{3,})(.*)$/.exec(content);
    if (!opening || (opening[2][0] === "`" && opening[3].includes("`"))) {
      return { protectedLine: false, state: null };
    }
    const indent = (list?.[0].length ?? 0) + opening[1].length;
    return {
      protectedLine: true,
      state: {
        character: opening[2][0],
        length: opening[2].length,
        quoteDepth,
        closingIndent: indent + 3,
        openedFromList: Boolean(list),
        interiorLines: 0,
      },
    };
  }

  const closing = /^([ \t]*)(`{3,}|~{3,})\s*$/.exec(containerContent);
  if (
    closing
    && quoteDepth === state.quoteDepth
    && closing[1].length <= state.closingIndent
    && closing[2][0] === state.character
    && closing[2].length >= state.length
  ) {
    let canReopen = false;
    if (nextLine !== undefined) {
      const next = quotedLineContent(nextLine);
      canReopen = next.quoteDepth === quoteDepth
        && leadingWhitespaceLength(next.content) >= closing[1].length;
    }
    if (
      (state.openedFromList || (state.interiorLines === 0 && quoteDepth > 0))
      && canReopen
    ) {
      return {
        protectedLine: true,
        state: {
          character: closing[2][0],
          length: closing[2].length,
          quoteDepth,
          closingIndent: closing[1].length + 3,
          openedFromList: false,
          interiorLines: 0,
        },
      };
    }
    return { protectedLine: true, state: null };
  }

  return {
    protectedLine: true,
    state: { ...state, interiorLines: state.interiorLines + 1 },
  };
}

function advanceRendererFence(
  line: string,
  nextLine: string | undefined,
  state: RendererFenceState | null,
): { protectedLine: boolean; state: RendererFenceState | null } {
  if (state === null) {
    const opening =
      /^([ \t]*)(?:(?:([-+*]|\d{1,9}[.)])[ \t]+))?(`{3,}|~{3,})(.*)$/.exec(line);
    if (!opening || (opening[3][0] === "`" && opening[4].includes("`"))) {
      return { protectedLine: false, state: null };
    }
    return {
      protectedLine: true,
      state: {
        character: opening[3][0],
        openedFromList: Boolean(opening[2]),
      },
    };
  }

  const closing = /^([ \t]*)(`{3,}|~{3,})[ \t]*$/.exec(line);
  if (closing && closing[2][0] === state.character) {
    const canReopen = nextLine !== undefined
      && leadingWhitespaceLength(nextLine) >= closing[1].length;
    if (state.openedFromList && canReopen) {
      return {
        protectedLine: true,
        state: {
          character: closing[2][0],
          openedFromList: false,
        },
      };
    }
    return { protectedLine: true, state: null };
  }

  return { protectedLine: true, state };
}

const CHAT_RESULT_PROTOCOL_SCAN = Symbol("chat-result-protocol-scan");

type ResultProtocolExtraction = {
  start: number;
  end: number;
  replacement: string;
  result: TurnResult | null;
};

export type ChatResultProtocolScan = {
  readonly sourceText: string;
  readonly sourceLength: number;
  readonly markdownRangeSource: string;
  readonly protectedRanges: CodeRange[];
  readonly extractionRanges: ResultProtocolExtraction[];
  readonly [CHAT_RESULT_PROTOCOL_SCAN]: true;
};

export type ChatResultProtocolScanner = (
  text: string,
) => ChatResultProtocolScan;

function scanChatResultProtocolWithLines(
  text: string,
  sourceLines: SourceLineTable,
): ChatResultProtocolScan {
  const { starts: lineStarts } = sourceLines;
  const protectedRanges: CodeRange[] = [];
  const extractionRanges: ResultProtocolExtraction[] = [];
  const rangeSource = {
    parts: undefined as string[] | undefined,
    cursor: 0,
  };
  let containerFence: ContainerFenceState | null = null;
  let rendererFence: RendererFenceState | null = null;
  let inlineDelimiterLength: number | null = null;
  let cursor = 0;
  let lineIndex = 0;

  const maskMarkdownDelimiter = (index: number) => {
    rangeSource.parts ??= [];
    rangeSource.parts.push(text.slice(rangeSource.cursor, index), " ");
    rangeSource.cursor = index + 1;
  };

  while (lineIndex < lineStarts.length && cursor < text.length) {
    const lineStart = lineStarts[lineIndex];
    const lineEnd = sourceLineRawEnd(text, sourceLines, lineIndex);
    const afterLine = sourceLineEnd(text, sourceLines, lineIndex);

    if (cursor < lineStart) cursor = lineStart;
    if (cursor === lineStart) {
      const line = sourceLineText(text, sourceLines, lineIndex);
      const nextLine = lineIndex + 1 < lineStarts.length
        ? sourceLineText(text, sourceLines, lineIndex + 1)
        : undefined;
      const containerStep = advanceContainerFence(
        line,
        nextLine,
        containerFence,
      );
      const rendererStep = advanceRendererFence(
        line,
        nextLine,
        rendererFence,
      );
      containerFence = containerStep.state;
      rendererFence = rendererStep.state;
      if (containerStep.protectedLine || rendererStep.protectedLine) {
        cursor = afterLine;
        lineIndex += 1;
        continue;
      }
    }

    let jumped = false;
    while (cursor < lineEnd) {
      if (startsCandidate(text, cursor, text.length)) {
        const candidate = nextCandidate(text, cursor, text.length);
        const protocol = candidate
          ? asProtocolCandidate(text, candidate, text.length)
          : null;
        if (candidate?.start === cursor && protocol) {
          const insideInlineCode = inlineDelimiterLength !== null;
          const maskScan = resultProtocolMaskEnd(
            text,
            protocol,
            text.length,
            sourceLines,
            lineIndex,
          );
          let { end } = maskScan;
          if (!maskScan.terminated && insideInlineCode) {
            const outerClose = matchingBacktickRunStart(
              text,
              candidate.start,
              end,
              inlineDelimiterLength!,
            );
            if (outerClose !== null) end = outerClose;
          }
          if (!insideInlineCode && end > candidate.start) {
            protectedRanges.push([candidate.start, end]);
            const replacement = maskScan.terminated
              ? ""
              : scanEndBeforeBoundary(
                  text,
                  protocol,
                  end,
                  sourceLines,
                  lineIndex,
                ).replacement;
            let result: TurnResult | null = null;
            if (
              protocol.kind === "open"
              && protocol.exactName
              && maskScan.terminated
              && maskScan.withinParseBudget
              && maskScan.closeIndex !== null
              && text[maskScan.closeIndex - 1] === "/"
            ) {
              result = parseResult(
                text.slice(protocol.contentStart, maskScan.closeIndex - 1),
              );
            }
            extractionRanges.push({
              start: candidate.start,
              end,
              replacement,
              result,
            });
          }
          for (let index = candidate.start; index < end; index += 1) {
            if (text[index] === "`" || text[index] === "~") {
              maskMarkdownDelimiter(index);
            }
          }
          cursor = Math.max(end, candidate.start + candidate.prefix.length);
          while (
            lineIndex + 1 < lineStarts.length
            && lineStarts[lineIndex + 1] <= cursor
          ) {
            lineIndex += 1;
          }
          jumped = true;
          break;
        }
      }

      if (text[cursor] !== "`") {
        cursor += 1;
        continue;
      }
      const runStart = cursor;
      while (cursor < lineEnd && text[cursor] === "`") cursor += 1;
      const runLength = cursor - runStart;
      if (inlineDelimiterLength === null) {
        inlineDelimiterLength = runLength;
      } else if (inlineDelimiterLength === runLength) {
        inlineDelimiterLength = null;
      }
    }

    if (jumped) continue;
    cursor = afterLine;
    lineIndex += 1;
  }

  if (rangeSource.parts) {
    rangeSource.parts.push(text.slice(rangeSource.cursor));
  }
  return {
    sourceText: text,
    sourceLength: text.length,
    markdownRangeSource: rangeSource.parts
      ? rangeSource.parts.join("")
      : text,
    protectedRanges,
    extractionRanges,
    [CHAT_RESULT_PROTOCOL_SCAN]: true,
  };
}

export function hasChatResultProtocolCandidate(text: string): boolean {
  return text.includes(OPEN_CANDIDATE) || text.includes(CLOSE_CANDIDATE);
}

/**
 * Scan result protocol once to produce both a same-length Markdown range source
 * and original-offset spans that earlier control extractors must treat as
 * opaque. Markdown that opens before a candidate remains authoritative.
 */
export function scanChatResultProtocol(text: string): ChatResultProtocolScan {
  if (!text || !hasChatResultProtocolCandidate(text)) {
    return {
      sourceText: text,
      sourceLength: text.length,
      markdownRangeSource: text,
      protectedRanges: [],
      extractionRanges: [],
      [CHAT_RESULT_PROTOCOL_SCAN]: true,
    };
  }
  return scanChatResultProtocolWithLines(text, buildSourceLineTable(text));
}

/**
 * Backward-compatible same-length range source for Markdown-sensitive callers.
 * New callers that also need opaque spans should use scanChatResultProtocol.
 */
export function maskChatResultProtocolForMarkdown(text: string): string {
  return scanChatResultProtocol(text).markdownRangeSource;
}

export function chatResultProtocolRanges(text: string): CodeRange[] {
  return scanChatResultProtocol(text).protectedRanges;
}

function parseAttributes(raw: string): Record<string, string> | null {
  const attributes: Record<string, string> = {};
  let cursor = 0;

  while (cursor < raw.length) {
    const whitespaceStart = cursor;
    while (cursor < raw.length && /\s/.test(raw[cursor])) cursor += 1;
    if (cursor === raw.length) break;
    if (cursor === whitespaceStart) return null;

    const nameStart = cursor;
    while (cursor < raw.length && /[A-Za-z-]/.test(raw[cursor])) cursor += 1;
    if (cursor === nameStart || raw[cursor] !== "=") return null;
    const name = raw.slice(nameStart, cursor);
    cursor += 1;
    if (raw[cursor] !== '"') return null;
    cursor += 1;

    const valueStart = cursor;
    while (cursor < raw.length && raw[cursor] !== '"') cursor += 1;
    if (cursor === raw.length) return null;
    const value = raw.slice(valueStart, cursor);
    cursor += 1;

    if (!ATTRIBUTE_NAMES.has(name) || Object.hasOwn(attributes, name)) return null;
    attributes[name] = value;
  }

  return attributes;
}

function parseResult(raw: string): TurnResult | null {
  const attributes = parseAttributes(raw);
  if (!attributes) return null;

  const rawId = attributes.id;
  const rawLabel = attributes.label;
  const state = attributes.state?.trim();
  if (!rawId || !rawLabel || !state) return null;
  if (rawId.length > RESULT_ID_MAX || rawLabel.length > RESULT_LABEL_MAX) return null;

  const id = rawId.trim();
  const label = rawLabel.trim();
  if (!id || !label) return null;
  if (id.length > RESULT_ID_MAX || label.length > RESULT_LABEL_MAX) return null;
  if (!RESULT_STATES.has(state as TurnResultState)) return null;

  return {
    id,
    label,
    state: state as TurnResultState,
    source: "familiar",
  };
}

function validateChatResultProtocolScan(
  text: string,
  scan: ChatResultProtocolScan,
): void {
  if (
    scan[CHAT_RESULT_PROTOCOL_SCAN] !== true
    || scan.sourceText !== text
    || scan.sourceLength !== text.length
    || scan.markdownRangeSource.length !== text.length
  ) {
    throw new RangeError(
      "extractChatResultMarkersFromScan requires a scan of the exact source",
    );
  }
}

export function extractChatResultMarkersFromScan(
  text: string,
  scan: ChatResultProtocolScan,
  options: { pending?: boolean } = {},
): { visible: string; results: TurnResult[] } {
  void options.pending;
  validateChatResultProtocolScan(text, scan);
  if (scan.extractionRanges.length === 0) {
    return { visible: text, results: [] };
  }

  const visibleParts: string[] = [];
  const resultsById = new Map<string, TurnResult>();
  let cursor = 0;
  for (const entry of scan.extractionRanges) {
    if (
      entry.start < cursor
      || entry.start < 0
      || entry.end <= entry.start
      || entry.end > text.length
    ) {
      throw new RangeError("chat result scan contains invalid extraction ranges");
    }
    visibleParts.push(text.slice(cursor, entry.start));
    if (entry.replacement) visibleParts.push(entry.replacement);
    if (entry.result) resultsById.set(entry.result.id, entry.result);
    cursor = entry.end;
  }
  visibleParts.push(text.slice(cursor));

  return {
    visible: visibleParts.join(""),
    results: [...resultsById.values()],
  };
}

export function extractChatResultMarkers(
  text: string,
  options: { pending?: boolean } = {},
): { visible: string; results: TurnResult[] } {
  if (!text || !hasChatResultProtocolCandidate(text)) {
    return { visible: text, results: [] };
  }
  return extractChatResultMarkersFromScan(
    text,
    scanChatResultProtocol(text),
    options,
  );
}
