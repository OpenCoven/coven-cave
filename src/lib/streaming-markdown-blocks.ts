/**
 * Streaming Markdown block partitioning (Task 2 of the calm-streaming-chat
 * plan). A renderer that reprints an entire streamed message on every token
 * flashes/scrolls badly. This module re-parses a *complete accumulated
 * snapshot* of streamed Markdown (never a delta) into a small number of
 * stable "committed" blocks — safe to render once and never touch again —
 * plus at most one trailing "active" block that keeps repainting as new
 * bytes arrive.
 *
 * Contract, in one line: block boundaries are pinned to source byte offsets,
 * so a block's `id`/`source` pair never changes once it appears in
 * `committedBlocks`, no matter how much more text streams in afterward.
 *
 * This is intentionally conservative rather than a full Markdown parser —
 * see the per-construct comments below for exactly what is recognized versus
 * what falls back to one ambiguous "active plain" block. When in doubt we
 * keep a region as one growing block instead of guessing at a split that a
 * later byte could invalidate.
 */

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
  start?: number;
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

// ── line scanning ────────────────────────────────────────────────────────
// A "line" is a source slice [start, end) that includes its own terminating
// "\n" when one exists. The final line of a source that doesn't end with
// "\n" has hasNewline=false and end===source.length — that is precisely the
// still-growing tail of a stream. We never trim or normalize source content.
// Classifiers exclude a trailing "\r" only after this record's "\n" proves
// that it is a CRLF terminator; an unterminated trailing "\r" remains content
// but is provisional until the next byte establishes CRLF or makes it literal.

type Line = { start: number; end: number; content: string; hasNewline: boolean };

function splitLines(source: string): Line[] {
  const lines: Line[] = [];
  let pos = 0;
  while (pos < source.length) {
    const nl = source.indexOf("\n", pos);
    if (nl === -1) {
      lines.push({ start: pos, end: source.length, content: source.slice(pos), hasNewline: false });
      pos = source.length;
    } else {
      lines.push({ start: pos, end: nl + 1, content: source.slice(pos, nl), hasNewline: true });
      pos = nl + 1;
    }
  }
  return lines;
}

function logicalLineContent(line: Line): string {
  return line.hasNewline && line.content.endsWith("\r")
    ? line.content.slice(0, -1)
    : line.content;
}

function isProvisionalTrailingCR(line: Line): boolean {
  return !line.hasNewline && line.content.endsWith("\r");
}

function classificationPrefixBeforeTrailingCR(line: Line): string {
  const content = logicalLineContent(line);
  return isProvisionalTrailingCR(line) ? content.slice(0, -1) : content;
}

function isBlank(line: Line): boolean {
  return /^[ \t]*$/.test(logicalLineContent(line));
}

function isCompleteBlank(line: Line): boolean {
  return isBlank(line) && line.hasNewline;
}

// ── construct detectors ──────────────────────────────────────────────────

function trimSyntaxWhitespace(content: string): string {
  return content.replace(/^[ \t]+/, "").replace(/[ \t]+$/, "");
}

function hasNonSyntaxWhitespace(content: string): boolean {
  return /[^ \t]/.test(content);
}

function sourceColumns(content: string): number {
  let columns = 0;
  for (const char of content) {
    if (char === "\t") {
      columns += 4 - (columns % 4);
    } else {
      columns++;
    }
  }
  return columns;
}

function leadingIndentation(content: string): { columns: number; offset: number } {
  let columns = 0;
  let offset = 0;
  while (offset < content.length) {
    if (content[offset] === " ") {
      columns++;
      offset++;
      continue;
    }
    if (content[offset] === "\t") {
      columns += 4 - (columns % 4);
      offset++;
      continue;
    }
    break;
  }
  return { columns, offset };
}

function stripTopLevelIndent(content: string): string | null {
  const indent = leadingIndentation(content);
  return indent.columns <= 3 ? content.slice(indent.offset) : null;
}

function isThematicBreak(content: string): boolean {
  const topLevel = stripTopLevelIndent(content);
  if (topLevel === null) return false;
  const trimmed = trimSyntaxWhitespace(topLevel);
  if (trimmed.length < 3) return false;
  const compact = trimmed.replace(/[ \t]+/g, "");
  if (compact.length < 3) return false;
  const ch = compact[0];
  if (ch !== "-" && ch !== "*" && ch !== "_") return false;
  for (let i = 1; i < compact.length; i++) {
    if (compact[i] !== ch) return false;
  }
  return true;
}

function isHeading(content: string): boolean {
  return /^#{1,6}(?:[ \t]|$)/.test(stripTopLevelIndent(content) ?? "");
}

function isSetextUnderline(content: string): boolean {
  return /^(?:=+|-+)[ \t]*$/.test(stripTopLevelIndent(content) ?? "");
}

type FenceOpener = { char: "`" | "~"; width: number };

function matchFenceMarker(content: string): FenceOpener | null {
  const topLevel = stripTopLevelIndent(content);
  if (topLevel === null) return null;
  const m = /^(`{3,}|~{3,})/.exec(topLevel);
  if (!m) return null;
  const run = m[1];
  const char = run[0] as "`" | "~";
  if (char === "`" && topLevel.slice(m[0].length).includes("`")) return null;
  return { char, width: run.length };
}

function matchFenceCloser(content: string, opener: FenceOpener): boolean {
  const m = /^(`+|~+)[ \t]*$/.exec(stripTopLevelIndent(content) ?? "");
  if (!m) return false;
  const run = m[1];
  if (run[0] !== opener.char) return false;
  return run.length >= opener.width;
}

function isBlockquoteStart(content: string): boolean {
  return /^>/.test(stripTopLevelIndent(content) ?? "");
}

function stripBlockquotePrefix(content: string): string {
  return (stripTopLevelIndent(content) ?? content).replace(/^> ?/, "");
}

function isIndentedCodeLine(content: string): boolean {
  return leadingIndentation(content).columns >= 4;
}

function isProvenTopLevelBlockStarter(content: string): boolean {
  return (
    matchRecognizedListMarker(content) !== null ||
    isBlockquoteStart(content) ||
    isHeading(content) ||
    matchFenceMarker(content) !== null ||
    matchHtmlBlockStartContent(content, true) !== null ||
    isIndentedCodeLine(content) ||
    isThematicBreak(content)
  );
}

function stripTableIndent(content: string): string | null {
  const topLevel = stripTopLevelIndent(content);
  return topLevel !== null && /[^ \t]/.test(topLevel) ? topLevel : null;
}

function isExcludedFromTableLookahead(content: string): boolean {
  return matchRecognizedListMarker(content) !== null;
}

type BacktickRun = { start: number; end: number; width: number };

function codeSpanRangesInLine(content: string): Array<[number, number]> {
  const runs: BacktickRun[] = [];
  for (let offset = 0; offset < content.length;) {
    if (content[offset] !== "`") {
      offset++;
      continue;
    }
    const start = offset;
    while (offset < content.length && content[offset] === "`") offset++;
    runs.push({ start, end: offset, width: offset - start });
  }

  const runsByWidth = new Map<number, BacktickRun[]>();
  for (const run of runs) {
    const matching = runsByWidth.get(run.width);
    if (matching) matching.push(run);
    else runsByWidth.set(run.width, [run]);
  }

  const nextByWidth = new Map<number, number>();
  const ranges: Array<[number, number]> = [];
  for (let offset = 0; offset < content.length;) {
    if (content[offset] === "\\" && offset + 1 < content.length) {
      offset += 2;
      continue;
    }
    if (content[offset] !== "`") {
      offset++;
      continue;
    }

    const start = offset;
    while (offset < content.length && content[offset] === "`") offset++;
    const width = offset - start;
    const matching = runsByWidth.get(width) ?? [];
    let next = nextByWidth.get(width) ?? 0;
    while (next < matching.length && matching[next].start < offset) next++;
    const closer = matching[next];
    if (!closer) {
      // Streaming can still append a matching delimiter. Until then, treating
      // the unmatched run as code-to-line-end keeps later pipes provisional.
      ranges.push([start, content.length]);
      break;
    }

    nextByWidth.set(width, next + 1);
    ranges.push([start, closer.end]);
    offset = closer.end;
  }
  return ranges;
}

function syntacticTablePipes(content: string): number[] {
  const codeRanges = codeSpanRangesInLine(content);
  const pipes: number[] = [];
  let codeRangeIndex = 0;
  for (let offset = 0; offset < content.length;) {
    const codeRange = codeRanges[codeRangeIndex];
    if (codeRange && offset >= codeRange[0]) {
      offset = codeRange[1];
      codeRangeIndex++;
      continue;
    }
    if (content[offset] === "\\" && offset + 1 < content.length) {
      offset += 2;
      continue;
    }
    if (content[offset] === "|") pipes.push(offset);
    offset++;
  }
  return pipes;
}

function tableRowCells(content: string, requirePipe: boolean): string[] | null {
  const topLevel = stripTableIndent(content);
  if (topLevel === null) return null;
  const pipes = syntacticTablePipes(topLevel);
  if (requirePipe && pipes.length === 0) return null;

  let start = 0;
  let end = topLevel.length;
  let firstSeparator = 0;
  let lastSeparator = pipes.length;
  if (
    pipes.length > 0 &&
    trimSyntaxWhitespace(topLevel.slice(0, pipes[0])) === ""
  ) {
    start = pipes[0] + 1;
    firstSeparator = 1;
  }
  if (
    pipes.length > 0 &&
    trimSyntaxWhitespace(topLevel.slice(pipes[pipes.length - 1] + 1)) === ""
  ) {
    end = pipes[pipes.length - 1];
    lastSeparator = Math.max(firstSeparator, pipes.length - 1);
  }

  const cells: string[] = [];
  let cellStart = start;
  for (let index = firstSeparator; index < lastSeparator; index++) {
    const pipe = pipes[index];
    cells.push(topLevel.slice(cellStart, pipe));
    cellStart = pipe + 1;
  }
  cells.push(topLevel.slice(cellStart, end));
  return cells;
}

function tableDelimiterCells(content: string): string[] | null {
  if (isExcludedFromTableLookahead(content)) return null;
  const cells = tableRowCells(content, false);
  if (
    !cells ||
    cells.length === 0 ||
    cells.every((cell) => trimSyntaxWhitespace(cell) === "")
  ) {
    return null;
  }
  return cells.every((cell) => /^[ \t]*:?-+:?[ \t]*$/.test(cell))
    ? cells
    : null;
}

function isTableDelimiterRow(content: string): boolean {
  return tableDelimiterCells(content) !== null;
}

function isTableBodyRow(content: string): boolean {
  if (isExcludedFromTableLookahead(content)) return false;
  return tableRowCells(content, true) !== null;
}

function canBeTableHeader(line: Line): boolean {
  const content = logicalLineContent(line);
  if (isBlank(line) || isProvenTopLevelBlockStarter(content)) return false;
  return tableRowCells(content, true) !== null;
}

function isTableCandidatePair(header: Line, delimiter: Line): boolean {
  if (!canBeTableHeader(header) || isBlank(delimiter)) return false;
  const headerCells = tableRowCells(logicalLineContent(header), true);
  const delimiterCells = tableDelimiterCells(logicalLineContent(delimiter));
  return (
    headerCells !== null &&
    delimiterCells !== null &&
    headerCells.length === delimiterCells.length
  );
}

function isPipeLessTableCandidatePair(header: Line, delimiter: Line): boolean {
  if (!isTableCandidatePair(header, delimiter)) return false;
  const content = stripTableIndent(logicalLineContent(delimiter));
  return content !== null && syntacticTablePipes(content).length === 0;
}

const RAW_HTML_BLOCK_TAGS = ["script", "pre", "style", "textarea"] as const;

const BLANK_TERMINATED_HTML_BLOCK_TAGS = new Set([
  "address",
  "article",
  "aside",
  "base",
  "basefont",
  "blockquote",
  "body",
  "caption",
  "center",
  "col",
  "colgroup",
  "dd",
  "details",
  "dialog",
  "dir",
  "div",
  "dl",
  "dt",
  "fieldset",
  "figcaption",
  "figure",
  "footer",
  "form",
  "frame",
  "frameset",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "head",
  "header",
  "hr",
  "html",
  "iframe",
  "legend",
  "li",
  "link",
  "main",
  "menu",
  "menuitem",
  "nav",
  "noframes",
  "ol",
  "optgroup",
  "option",
  "p",
  "param",
  "search",
  "section",
  "summary",
  "table",
  "tbody",
  "td",
  "tfoot",
  "th",
  "thead",
  "title",
  "tr",
  "track",
  "ul",
]);

type HtmlBlockStart =
  | { termination: "blank" }
  | { termination: "explicit"; closes: (content: string) => boolean };

function hasStableHtmlTagBoundary(rest: string, lineComplete: boolean): boolean {
  if (rest === "") return lineComplete;
  return /^[ \t]/.test(rest) || rest.startsWith(">") || rest.startsWith("/>");
}

function matchHtmlBlockStartContent(
  content: string,
  lineComplete: boolean,
): HtmlBlockStart | null {
  const topLevel = stripTopLevelIndent(content);
  if (topLevel === null) return null;

  const raw = /^<([A-Za-z]+)(.*)$/.exec(topLevel);
  if (raw) {
    const tag = raw[1].toLowerCase();
    if (
      RAW_HTML_BLOCK_TAGS.some((candidate) => candidate === tag) &&
      hasStableHtmlTagBoundary(raw[2], lineComplete)
    ) {
      const closing = new RegExp(`<\\/${tag}[ \\t]*>`, "i");
      return { termination: "explicit", closes: (line) => closing.test(line) };
    }
  }
  if (topLevel.startsWith("<!--")) {
    return { termination: "explicit", closes: (line) => line.includes("-->") };
  }
  if (topLevel.startsWith("<?")) {
    return { termination: "explicit", closes: (line) => line.includes("?>") };
  }
  if (topLevel.startsWith("<![CDATA[")) {
    return { termination: "explicit", closes: (line) => line.includes("]]>") };
  }
  if (/^<![A-Z]/.test(topLevel)) {
    return { termination: "explicit", closes: (line) => line.includes(">") };
  }

  const blockTag = /^<\/?([A-Za-z][A-Za-z0-9-]*)(.*)$/.exec(topLevel);
  if (
    blockTag &&
    BLANK_TERMINATED_HTML_BLOCK_TAGS.has(blockTag[1].toLowerCase()) &&
    hasStableHtmlTagBoundary(blockTag[2], lineComplete)
  ) {
    return { termination: "blank" };
  }
  return null;
}

function matchHtmlBlockStart(line: Line): HtmlBlockStart | null {
  return matchHtmlBlockStartContent(
    classificationPrefixBeforeTrailingCR(line),
    line.hasNewline,
  );
}

function couldBecomeHtmlBlockStart(line: Line): boolean {
  if (line.hasNewline) return false;
  const topLevel = stripTopLevelIndent(classificationPrefixBeforeTrailingCR(line));
  if (topLevel === null || !topLevel.startsWith("<")) return false;
  const lower = topLevel.toLowerCase();
  const fixedPrefixes = ["<!--", "<?", "<![cdata[", "<!"];
  if (fixedPrefixes.some((prefix) => prefix.startsWith(lower))) return true;
  for (const tag of [...RAW_HTML_BLOCK_TAGS, ...BLANK_TERMINATED_HTML_BLOCK_TAGS]) {
    if (`<${tag}`.startsWith(lower) || `</${tag}`.startsWith(lower)) return true;
  }
  return false;
}

type UnorderedListFamily = {
  ordered: false;
  bullet: "-" | "+" | "*";
};

type OrderedListFamily = {
  ordered: true;
  delimiter: "." | ")";
  start: number;
};

type ListFamily = UnorderedListFamily | OrderedListFamily;

type ListMarker = ListFamily & {
  indent: number;
  effectivePadding: number;
  contentStart: number;
  contentIndent: number;
  residualIndent: number;
  hasNonblankContent: boolean;
};

function listMarkerLayout(
  content: string,
  markerEnd: number,
  whitespace: string,
  hasNonblankContent: boolean,
): Pick<
  ListMarker,
  "effectivePadding" | "contentStart" | "contentIndent" | "residualIndent"
> {
  const markerEndColumn = sourceColumns(content.slice(0, markerEnd));
  const contentStart = markerEnd + whitespace.length;
  const rawPadding =
    sourceColumns(content.slice(0, contentStart)) - markerEndColumn;
  // CommonMark treats 1–4 columns as list padding. With 5+, only one
  // column is padding and the rest remains indentation in the item content.
  const effectivePadding =
    !hasNonblankContent || rawPadding > 4 ? 1 : rawPadding;
  return {
    effectivePadding,
    contentStart,
    contentIndent: markerEndColumn + effectivePadding,
    residualIndent: hasNonblankContent ? rawPadding - effectivePadding : 0,
  };
}

function matchListMarker(content: string, maximumIndent = 3): ListMarker | null {
  const indent = leadingIndentation(content);
  if (indent.columns > maximumIndent) return null;
  const markerContent = content.slice(indent.offset);
  let m = /^(\d{1,9})([.)])(?:([ \t]+)([^]*)|)$/.exec(markerContent);
  if (m) {
    const markerEnd = indent.offset + m[1].length + m[2].length;
    const hasNonblankContent = hasNonSyntaxWhitespace(m[4] ?? "");
    return {
      indent: indent.columns,
      ordered: true,
      delimiter: m[2] as "." | ")",
      start: Number(m[1]),
      ...listMarkerLayout(content, markerEnd, m[3] ?? "", hasNonblankContent),
      hasNonblankContent,
    };
  }
  m = /^([-*+])(?:([ \t]+)([^]*)|)$/.exec(markerContent);
  if (m) {
    const markerEnd = indent.offset + m[1].length;
    const hasNonblankContent = hasNonSyntaxWhitespace(m[3] ?? "");
    return {
      indent: indent.columns,
      ordered: false,
      bullet: m[1] as "-" | "+" | "*",
      ...listMarkerLayout(content, markerEnd, m[2] ?? "", hasNonblankContent),
      hasNonblankContent,
    };
  }
  return null;
}

function matchRecognizedListMarker(content: string): ListMarker | null {
  const marker = matchListMarker(content);
  return marker !== null && !isThematicBreak(content) ? marker : null;
}

function matchReferenceListMarker(content: string): ListMarker | null {
  const indentation = leadingIndentation(content);
  const marker = matchListMarker(content, Number.POSITIVE_INFINITY);
  if (marker === null || isThematicBreak(content.slice(indentation.offset))) {
    return null;
  }
  return marker;
}

function isListMarkerLine(content: string): boolean {
  return matchRecognizedListMarker(content) !== null;
}

function canInterruptParagraphWithList(marker: ListMarker): boolean {
  return (
    marker.hasNonblankContent &&
    (!marker.ordered || marker.start === 1)
  );
}

type ListMarkerContext = "block-boundary" | "paragraph" | "list";

function canStartListInContext(
  marker: ListMarker,
  context: ListMarkerContext,
): boolean {
  return context !== "paragraph" || canInterruptParagraphWithList(marker);
}

/** Marker-only tails are provisional: append-only growth can still change an
 * apparent bullet into a thematic break. A newline or any other content fixes
 * the classification permanently. */
function hasAppendStableClassification(line: Line): boolean {
  if (line.hasNewline) return true;
  const content = classificationPrefixBeforeTrailingCR(line);
  const marker = matchRecognizedListMarker(content);
  if (
    marker !== null &&
    !marker.hasNonblankContent &&
    /^ {0,3}(?:[-*+]|\d{1,9}[.)])$/.test(content)
  ) {
    return false;
  }
  return !/^[ \t]*[-*_][ \t\-*_]*$/.test(content);
}

function isStableHeadingStart(line: Line): boolean {
  const content = classificationPrefixBeforeTrailingCR(line);
  const topLevel = stripTopLevelIndent(content);
  return (
    isHeading(content) &&
    (line.hasNewline || (topLevel !== null && /^#{1,6}[ \t]/.test(topLevel)))
  );
}

function isStableFenceStart(line: Line): boolean {
  const content = classificationPrefixBeforeTrailingCR(line);
  const opener = matchFenceMarker(content);
  return (
    opener !== null &&
    (opener.char === "~" || line.hasNewline)
  );
}

function isStableBlockquoteStart(line: Line): boolean {
  return isBlockquoteStart(classificationPrefixBeforeTrailingCR(line));
}

function isStableThematicBreak(line: Line): boolean {
  const content = logicalLineContent(line);
  return !isIndentedCodeLine(content) && line.hasNewline && isThematicBreak(content);
}

/** Only constructs whose prefix is enough to prove that they are outside a
 * list may terminate one without a blank. Thematic and table-delimiter lines
 * deliberately do not: in list context they can still belong to the current
 * item. */
function isStableListTerminatorStart(line: Line): boolean {
  return (
    isStableHeadingStart(line) ||
    isStableFenceStart(line) ||
    isStableBlockquoteStart(line) ||
    matchHtmlBlockStart(line) !== null
  );
}

// ── internal block representation ────────────────────────────────────────
// subkind drives renderMode for "markdown"-shaped blocks:
//   "safe"             -> always renderMode "markdown" (ordinary paragraphs,
//                          stable headings, thematic breaks, committed tables)
//   "plain-when-active" -> renderMode "plain" while still growing
//                          (terminated=false), "markdown" once terminated
//                          (terminated paragraphs, fence, blockquote, indented code,
//                          incomplete table)
//   "ambiguous"        -> renderMode "plain" always (nested/ambiguous
//                          containers), unless the whole partition is
//                          settled (see below)

type MarkdownSubkind = "safe" | "plain-when-active" | "ambiguous";

type InternalBlock =
  | {
      kind: "markdown";
      subkind: MarkdownSubkind;
      start: number;
      end: number;
      terminated: boolean;
      referenceLiteral?: boolean;
    }
  | {
      kind: "list";
      start: number;
      end: number;
      terminated: boolean;
      family: ListFamily;
      itemStarts: number[];
      lastItemActive: boolean;
    };

type ScanResult = { block: InternalBlock; nextIndex: number };

function scanBlankLine(i: number, lines: Line[]): ScanResult {
  const line = lines[i];
  return {
    block: {
      kind: "markdown",
      subkind: line.hasNewline ? "safe" : "plain-when-active",
      start: line.start,
      end: line.end,
      terminated: line.hasNewline,
    },
    nextIndex: i + 1,
  };
}

function scanSingleLine(i: number, lines: Line[], classificationStable: boolean): ScanResult {
  const line = lines[i];
  return {
    block: {
      kind: "markdown",
      subkind: classificationStable ? "safe" : "plain-when-active",
      start: line.start,
      end: line.end,
      terminated: line.hasNewline,
    },
    nextIndex: i + 1,
  };
}

function scanFence(i: number, lines: Line[]): ScanResult {
  const line = lines[i];
  const opener = matchFenceMarker(logicalLineContent(line));
  if (!opener) throw new Error("scanFence called on a non-fence line");
  let j = i + 1;
  let closed = false;
  let closeLine: Line | null = null;
  while (j < lines.length) {
    const l = lines[j];
    const c = logicalLineContent(l);
    if (matchFenceCloser(c, opener) && l.hasNewline) {
      closed = true;
      closeLine = l;
      j++;
      break;
    }
    j++;
  }
  if (closed && closeLine) {
    return {
      block: { kind: "markdown", subkind: "plain-when-active", start: line.start, end: closeLine.end, terminated: true },
      nextIndex: j,
    };
  }
  const last = lines[lines.length - 1];
  return {
    block: { kind: "markdown", subkind: "plain-when-active", start: line.start, end: last.end, terminated: false },
    nextIndex: lines.length,
  };
}

function scanHtml(i: number, lines: Line[], start: HtmlBlockStart): ScanResult {
  const first = lines[i];
  if (start.termination === "blank") {
    let j = i + 1;
    while (j < lines.length && !isBlank(lines[j])) j++;
    if (j < lines.length && isCompleteBlank(lines[j])) {
      return {
        block: {
          kind: "markdown",
          subkind: "plain-when-active",
          start: first.start,
          end: lines[j].end,
          terminated: true,
          referenceLiteral: true,
        },
        nextIndex: j + 1,
      };
    }
  } else {
    for (let j = i; j < lines.length; j++) {
      const line = lines[j];
      if (!start.closes(logicalLineContent(line))) continue;
      if (line.hasNewline) {
        return {
          block: {
            kind: "markdown",
            subkind: "plain-when-active",
            start: first.start,
            end: line.end,
            terminated: true,
            referenceLiteral: true,
          },
          nextIndex: j + 1,
        };
      }
      break;
    }
  }

  const last = lines[lines.length - 1];
  return {
    block: {
      kind: "markdown",
      subkind: "plain-when-active",
      start: first.start,
      end: last.end,
      terminated: false,
      referenceLiteral: true,
    },
    nextIndex: lines.length,
  };
}

/** Attempts a header+delimiter table starting at line i. Returns null when
 * line i/i+1 don't form a header+delimiter pair at all (caller falls back to
 * ordinary block-start detection for line i). */
function scanTable(i: number, lines: Line[]): ScanResult | null {
  const header = lines[i];
  if (i + 1 >= lines.length) return null;
  const delim = lines[i + 1];
  if (!isTableCandidatePair(header, delim)) return null;

  let j = i + 2;
  let bodyRows = 0;
  let validBody = true;
  while (j < lines.length && !isBlank(lines[j])) {
    if (!isTableBodyRow(logicalLineContent(lines[j]))) validBody = false;
    bodyRows++;
    j++;
  }

  if (j < lines.length && isCompleteBlank(lines[j])) {
    if (bodyRows >= 1 && validBody) {
      const blank = lines[j];
      return {
        block: { kind: "markdown", subkind: "safe", start: header.start, end: blank.end, terminated: true },
        nextIndex: j + 1,
      };
    }
  }

  // A header+delimiter pair is table-like even before it has a body. Until a
  // valid body and complete blank terminator both exist, keep the entire tail
  // together so the delimiter cannot be misclassified as another construct.
  const last = lines[lines.length - 1];
  return {
    block: { kind: "markdown", subkind: "plain-when-active", start: header.start, end: last.end, terminated: false },
    nextIndex: lines.length,
  };
}

type ImmediateTableBodyClassification =
  | "not-candidate"
  | "no-body"
  | "provisional"
  | "valid"
  | "invalid";

function classifyImmediateTableBody(
  i: number,
  lines: Line[],
): ImmediateTableBodyClassification {
  if (i + 1 >= lines.length) return "not-candidate";
  const header = lines[i];
  const delimiter = lines[i + 1];
  if (!isTableCandidatePair(header, delimiter) || !delimiter.hasNewline) {
    return "not-candidate";
  }

  const body = lines[i + 2];
  if (!body || isBlank(body)) return "no-body";
  const bodyContent = logicalLineContent(body);
  if (isExcludedFromTableLookahead(bodyContent)) return "not-candidate";
  // A later byte can close a code span and hide a pipe, so an appendable body
  // row cannot provide irreversible proof even when its current shape is valid.
  if (isTableBodyRow(bodyContent)) return body.hasNewline ? "valid" : "provisional";
  return body.hasNewline ? "invalid" : "provisional";
}

function hasValidTablePrefix(i: number, lines: Line[]): boolean {
  return classifyImmediateTableBody(i, lines) === "valid";
}

function hasProvisionalParagraphStructure(line: Line, mayBeSetextUnderline: boolean): boolean {
  const content = logicalLineContent(line);
  const classificationPrefix = classificationPrefixBeforeTrailingCR(line);
  const topLevel = stripTopLevelIndent(content);
  if (isTableBodyRow(content) || isTableDelimiterRow(content)) return true;
  if (line.hasNewline) return false;

  if (topLevel !== null && /^#{1,6}$/.test(topLevel)) return true;
  if (topLevel !== null && /^(?:`{1,2}|~{1,2})$/.test(topLevel)) return true;
  if (couldBecomeHtmlBlockStart(line)) return true;
  if (matchFenceMarker(content)?.char === "`") return true;
  if (!isProvisionalTrailingCR(line) && !hasAppendStableClassification(line)) return true;
  const classificationTopLevel = stripTopLevelIndent(classificationPrefix);
  if (classificationTopLevel !== null && /^[-*+][ \t]*$/.test(classificationTopLevel)) return true;
  if (
    classificationTopLevel !== null &&
    /^\d{1,9}(?:[.)]?[ \t]*)?$/.test(classificationTopLevel)
  ) {
    return true;
  }
  return mayBeSetextUnderline && isSetextUnderline(content);
}

function scanBlockquote(i: number, lines: Line[]): ScanResult {
  const start = lines[i].start;
  let j = i;
  let ambiguous = false;
  while (j < lines.length && isBlockquoteStart(logicalLineContent(lines[j]))) {
    const inner = stripBlockquotePrefix(logicalLineContent(lines[j]));
    if (
      isListMarkerLine(inner) ||
      isThematicBreak(inner) ||
      isBlockquoteStart(inner) ||
      isHeading(inner) ||
      matchFenceMarker(inner) !== null ||
      matchHtmlBlockStartContent(inner, true) !== null ||
      isIndentedCodeLine(inner)
    ) {
      ambiguous = true;
    }
    j++;
  }
  if (!ambiguous && j < lines.length && isCompleteBlank(lines[j])) {
    const blank = lines[j];
    return {
      block: { kind: "markdown", subkind: "plain-when-active", start, end: blank.end, terminated: true },
      nextIndex: j + 1,
    };
  }

  // A non-quote line can still be a lazy continuation, and nested quote
  // syntax owns internal blanks. Without a provable terminator the whole tail
  // must remain one active plain region.
  const last = lines[lines.length - 1];
  return {
    block: {
      kind: "markdown",
      subkind: ambiguous ? "ambiguous" : "plain-when-active",
      start,
      end: last.end,
      terminated: false,
    },
    nextIndex: lines.length,
  };
}

function scanIndentedCode(i: number, lines: Line[]): ScanResult {
  const start = lines[i].start;
  let j = i;
  // A non-indented line does not establish a durable boundary: until a blank
  // arrives it can still be parsed as continuation text adjacent to the code.
  // Keep that whole non-blank region together rather than minting a code block
  // whose end would move when the continuation arrives.
  while (j < lines.length && !isBlank(lines[j])) j++;
  if (j < lines.length && isCompleteBlank(lines[j])) {
    const blank = lines[j];
    return {
      block: { kind: "markdown", subkind: "plain-when-active", start, end: blank.end, terminated: true },
      nextIndex: j + 1,
    };
  }

  // A following non-indented line without a blank boundary may still affect
  // how the tail parses. Keep it with the code region until settlement.
  const last = lines[lines.length - 1];
  return {
    block: { kind: "markdown", subkind: "plain-when-active", start, end: last.end, terminated: false },
    nextIndex: lines.length,
  };
}

function scanParagraph(i: number, lines: Line[]): ScanResult {
  const start = lines[i].start;
  let ambiguous = hasProvisionalParagraphStructure(lines[i], false);
  let j = i + 1;
  while (j < lines.length && !isBlank(lines[j])) {
    const candidate = lines[j];
    const content = logicalLineContent(candidate);
    const listMarker = matchRecognizedListMarker(
      classificationPrefixBeforeTrailingCR(candidate),
    );
    const embeddedPipeLessTableStart =
      j > i &&
      j + 1 < lines.length &&
      isPipeLessTableCandidatePair(candidate, lines[j + 1]);
    const tableStart =
      listMarker === null &&
      !embeddedPipeLessTableStart &&
      hasValidTablePrefix(j, lines);
    const provisionalTableDelimiter =
      j > i &&
      isTableCandidatePair(lines[j - 1], candidate) &&
      !(
        j - 1 > i &&
        isPipeLessTableCandidatePair(lines[j - 1], candidate)
      );
    // A one-column delimiter can also be a thematic break. Preserve the
    // header pair before generic interruption logic can commit either line.
    if (provisionalTableDelimiter) {
      return scanAmbiguousTail(start, lines);
    }
    if (isSetextUnderline(content)) {
      if (!candidate.hasNewline) return scanAmbiguousTail(start, lines);
      return {
        block: {
          kind: "markdown",
          subkind: "safe",
          start,
          end: candidate.end,
          terminated: true,
        },
        nextIndex: j + 1,
      };
    }
    const listInterrupt =
      listMarker !== null &&
      hasAppendStableClassification(candidate) &&
      canStartListInContext(listMarker, "paragraph");
    const interrupts =
      isStableHeadingStart(candidate) ||
      isStableFenceStart(candidate) ||
      isStableThematicBreak(candidate) ||
      listInterrupt ||
      isStableBlockquoteStart(candidate) ||
      matchHtmlBlockStart(candidate) !== null ||
      tableStart;
    if (interrupts) {
      const previous = lines[j - 1];
      return {
        block: { kind: "markdown", subkind: "plain-when-active", start, end: previous.end, terminated: true },
        nextIndex: j,
      };
    }
    ambiguous ||= hasProvisionalParagraphStructure(candidate, true);
    j++;
  }
  if (j < lines.length && isCompleteBlank(lines[j])) {
    const blank = lines[j];
    return {
      block: {
        kind: "markdown",
        subkind: "plain-when-active",
        start,
        end: blank.end,
        terminated: true,
      },
      nextIndex: j + 1,
    };
  }
  const last = lines[lines.length - 1];
  return {
    block: {
      kind: "markdown",
      subkind: ambiguous ? "ambiguous" : "safe",
      start,
      end: last.end,
      terminated: false,
    },
    nextIndex: lines.length,
  };
}

/** Once a container becomes structurally ambiguous, internal blank lines do
 * not prove who owns the following bytes. Keep one active plain tail; only
 * settlement may force it committed. */
function scanAmbiguousTail(start: number, lines: Line[]): ScanResult {
  const last = lines[lines.length - 1];
  return {
    block: { kind: "markdown", subkind: "ambiguous", start, end: last.end, terminated: false },
    nextIndex: lines.length,
  };
}

function isIndentedRelativeToList(content: string, baseIndent: number): boolean {
  return leadingIndentation(content).columns > baseIndent;
}

function sameListMarkerFamily(family: ListFamily, marker: ListMarker): boolean {
  if (family.ordered) {
    return marker.ordered && family.delimiter === marker.delimiter;
  }
  return !marker.ordered && family.bullet === marker.bullet;
}

function couldBecomePeerMarker(
  content: string,
  baseIndent: number,
  family: ListFamily,
): boolean {
  const indentation = leadingIndentation(content);
  if (indentation.offset === content.length) return indentation.columns <= baseIndent;
  if (indentation.columns !== baseIndent) return false;

  const marker = content.slice(indentation.offset);
  if (marker.length === 0) return true;
  if (!family.ordered) {
    if (marker[0] !== family.bullet) return false;
    return marker.length === 1 || marker[1] === " " || marker[1] === "\t";
  }

  let digits = 0;
  while (digits < marker.length && /\d/.test(marker[digits])) digits++;
  if (digits === 0 || digits > 9) return false;
  if (digits === marker.length) return true;
  if (marker[digits] !== family.delimiter) return false;
  return (
    digits + 1 === marker.length ||
    marker[digits + 1] === " " ||
    marker[digits + 1] === "\t"
  );
}

function scanList(i: number, lines: Line[]): ScanResult {
  const start = lines[i].start;
  const firstContent = classificationPrefixBeforeTrailingCR(lines[i]);
  const firstMarker = matchRecognizedListMarker(firstContent);
  if (!firstMarker) throw new Error("scanList called on a non-list line");
  const baseIndent = firstMarker.indent;
  const family: ListFamily = firstMarker.ordered
    ? {
        ordered: true,
        delimiter: firstMarker.delimiter,
        start: firstMarker.start,
      }
    : {
        ordered: false,
        bullet: firstMarker.bullet,
      };
  const firstItemContainsPipe = firstContent.includes("|");
  const itemStarts = [start];

  let j = i + 1;
  let ownsAmbiguousTail = false;
  let terminationIndex: number | null = null;
  while (j < lines.length) {
    const l = lines[j];
    if (isBlank(l)) {
      if (!l.hasNewline) {
        ownsAmbiguousTail = true;
        j++;
        continue;
      }

      const next = lines[j + 1];
      if (!next) {
        ownsAmbiguousTail = true;
        j++;
        continue;
      }
      if (isBlank(next)) {
        if (next.hasNewline) {
          terminationIndex = j;
          break;
        }
        ownsAmbiguousTail = true;
        j++;
        continue;
      }

      const nextContent = classificationPrefixBeforeTrailingCR(next);
      const nextMarker = matchRecognizedListMarker(nextContent);
      const nextIsPeer =
        nextMarker !== null &&
        sameListMarkerFamily(family, nextMarker) &&
        nextMarker.indent === baseIndent &&
        hasAppendStableClassification(next);
      if (
        nextIsPeer ||
        isIndentedRelativeToList(nextContent, baseIndent) ||
        (!next.hasNewline && couldBecomePeerMarker(nextContent, baseIndent, family))
      ) {
        ownsAmbiguousTail = true;
        j++;
        continue;
      }

      terminationIndex = j;
      break;
    }
    const c = classificationPrefixBeforeTrailingCR(l);
    const marker = matchRecognizedListMarker(c);
    const isSameFamilyPeer =
      marker !== null &&
      sameListMarkerFamily(family, marker) &&
      marker.indent === baseIndent &&
      hasAppendStableClassification(l);
    // A proven peer owns its full line before pipe content can trigger table
    // lookahead; subsequent unindented rows remain that item's continuation.
    if (isSameFamilyPeer) {
      itemStarts.push(l.start);
      j++;
      continue;
    }

    const isDifferentFamilyPeer =
      marker !== null &&
      !sameListMarkerFamily(family, marker) &&
      marker.indent === baseIndent &&
      hasAppendStableClassification(l);
    if (isDifferentFamilyPeer) {
      terminationIndex = j;
      break;
    }
    if (isIndentedRelativeToList(c, baseIndent)) {
      ownsAmbiguousTail = true;
      j++;
      continue;
    }
    if (isStableListTerminatorStart(l)) {
      terminationIndex = j;
      break;
    }
    const immediateTableBody = classifyImmediateTableBody(j, lines);
    if (immediateTableBody === "valid") {
      terminationIndex = j;
      break;
    }
    if (immediateTableBody === "provisional") {
      ownsAmbiguousTail = true;
      j = lines.length;
      break;
    }
    ownsAmbiguousTail = true;
    j++;
  }

  if (terminationIndex !== null) {
    return {
      block: {
        kind: "list",
        start,
        end: lines[terminationIndex].start,
        terminated: true,
        family,
        itemStarts,
        lastItemActive: false,
      },
      nextIndex: terminationIndex,
    };
  }

  if (itemStarts.length === 1 && ownsAmbiguousTail && !firstItemContainsPipe) {
    return scanAmbiguousTail(start, lines);
  }

  const last = lines[lines.length - 1];
  return {
    block: {
      kind: "list",
      start,
      end: last.end,
      terminated: false,
      family,
      itemStarts,
      lastItemActive: true,
    },
    nextIndex: lines.length,
  };
}

function parseBlocks(lines: Line[]): InternalBlock[] {
  const blocks: InternalBlock[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (isBlank(line)) {
      const r = scanBlankLine(i, lines);
      blocks.push(r.block);
      i = r.nextIndex;
      continue;
    }
    const content = logicalLineContent(line);
    const listMarker = matchRecognizedListMarker(
      classificationPrefixBeforeTrailingCR(line),
    );

    if (isIndentedCodeLine(content)) {
      const r = scanIndentedCode(i, lines);
      blocks.push(r.block);
      i = r.nextIndex;
      continue;
    }
    const htmlStart = matchHtmlBlockStart(line);
    if (htmlStart) {
      const r = scanHtml(i, lines, htmlStart);
      blocks.push(r.block);
      i = r.nextIndex;
      continue;
    }
    if (listMarker && hasAppendStableClassification(line)) {
      const r = scanList(i, lines);
      blocks.push(r.block);
      i = r.nextIndex;
      continue;
    }
    if (isThematicBreak(content)) {
      const r = scanSingleLine(i, lines, isStableThematicBreak(line));
      blocks.push(r.block);
      i = r.nextIndex;
      continue;
    }
    if (isHeading(content)) {
      const r = scanSingleLine(i, lines, isStableHeadingStart(line));
      blocks.push(r.block);
      i = r.nextIndex;
      continue;
    }
    if (isStableFenceStart(line)) {
      const r = scanFence(i, lines);
      blocks.push(r.block);
      i = r.nextIndex;
      continue;
    }
    const tableResult = scanTable(i, lines);
    if (tableResult) {
      blocks.push(tableResult.block);
      i = tableResult.nextIndex;
      continue;
    }
    if (isStableBlockquoteStart(line)) {
      const r = scanBlockquote(i, lines);
      blocks.push(r.block);
      i = r.nextIndex;
      continue;
    }
    const r = scanParagraph(i, lines);
    blocks.push(r.block);
    i = r.nextIndex;
  }
  return blocks;
}

// ── document-scoped reference dependencies ───────────────────────────────

type ReferenceFence = FenceOpener & {
  start: number;
  quoteDepth: number;
  listIndent: number | null;
};

type ReferenceAnalysisDiagnostics = {
  referenceAnalysisOperations: number;
  referenceCodeRangeBuilds: number;
};

function recordReferenceOperation(
  diagnostics: ReferenceAnalysisDiagnostics | undefined,
  count = 1,
): void {
  if (diagnostics) {
    diagnostics.referenceAnalysisOperations =
      (diagnostics.referenceAnalysisOperations ?? 0) + count;
  }
}

function referenceContainerContent(content: string): {
  content: string;
  contentOffset: number;
  quoteDepth: number;
} {
  let offset = 0;
  let quoteDepth = 0;
  while (true) {
    const quote = /^ {0,3}>[ \t]?/.exec(content.slice(offset));
    if (!quote) break;
    offset += quote[0].length;
    quoteDepth++;
  }
  return { content: content.slice(offset), contentOffset: offset, quoteDepth };
}

function stripIndentationColumns(content: string, required: number): string | null {
  let columns = 0;
  let offset = 0;
  while (offset < content.length && columns < required) {
    if (content[offset] === " ") {
      columns++;
      offset++;
      continue;
    }
    if (content[offset] === "\t") {
      columns += 4 - (columns % 4);
      offset++;
      continue;
    }
    return null;
  }
  return columns >= required ? content.slice(offset) : null;
}

function referenceFenceOpener(
  line: Line,
  context: ListMarkerContext,
): { fence: ReferenceFence | null; neutralizeMarkerAt: number | null } {
  const container = referenceContainerContent(logicalLineContent(line));
  const list =
    /^( {0,3})([-+*]|\d{1,9}[.)])([ \t]+)(.*)$/.exec(container.content);
  const marker = list ? matchRecognizedListMarker(container.content) : null;
  const fenceContent =
    marker !== null
      ? container.content.slice(marker.contentStart)
      : list
        ? list[4]
        : container.content;
  const opener = matchFenceMarker(fenceContent);
  if (!opener) return { fence: null, neutralizeMarkerAt: null };

  if (list) {
    if (
      marker === null ||
      marker.residualIndent >= 4 ||
      !canStartListInContext(marker, context)
    ) {
      return {
        fence: null,
        neutralizeMarkerAt:
          line.start + container.contentOffset + list[1].length,
      };
    }
  }

  return {
    fence: {
      ...opener,
      start: line.start,
      quoteDepth: container.quoteDepth,
      listIndent: marker?.contentIndent ?? null,
    },
    neutralizeMarkerAt: null,
  };
}

function referenceFenceCloser(line: Line, fence: ReferenceFence): boolean {
  const container = referenceContainerContent(logicalLineContent(line));
  if (container.quoteDepth !== fence.quoteDepth) return false;
  const content =
    fence.listIndent === null
      ? container.content
      : stripIndentationColumns(container.content, fence.listIndent);
  return content !== null && matchFenceCloser(content, fence);
}

function referenceFenceRanges(
  source: string,
  lines: Line[],
  blocks: InternalBlock[],
  diagnostics: ReferenceAnalysisDiagnostics | undefined,
): {
  ranges: Array<[number, number]>;
  neutralizedListMarkers: number[];
} {
  const ranges: Array<[number, number]> = [];
  const neutralizedListMarkers: number[] = [];
  let open: ReferenceFence | null = null;
  let blockIndex = 0;
  for (const line of lines) {
    recordReferenceOperation(diagnostics);
    while (
      blockIndex < blocks.length &&
      line.start >= blocks[blockIndex].end
    ) {
      blockIndex++;
      recordReferenceOperation(diagnostics);
    }
    const owner = blocks[blockIndex];
    if (owner?.kind === "markdown" && owner.referenceLiteral) continue;
    if (open) {
      if (referenceFenceCloser(line, open)) {
        ranges.push([open.start, line.end]);
        open = null;
      }
      continue;
    }
    const context: ListMarkerContext =
      !owner || owner.start === line.start
        ? "block-boundary"
        : owner.kind === "list"
          ? "list"
          : "paragraph";
    const candidate = referenceFenceOpener(line, context);
    open = candidate.fence;
    if (candidate.neutralizeMarkerAt !== null) {
      neutralizedListMarkers.push(candidate.neutralizeMarkerAt);
    }
  }
  if (open) ranges.push([open.start, source.length]);
  return { ranges, neutralizedListMarkers };
}

function maskCodeRanges(source: string, ranges: Array<[number, number]>): string {
  let cursor = 0;
  const masked: string[] = [];
  for (const [start, end] of ranges) {
    masked.push(source.slice(cursor, start));
    masked.push(source.slice(start, end).replace(/[^\n]/g, " "));
    cursor = end;
  }
  masked.push(source.slice(cursor));
  return masked.join("");
}

function neutralizeSourceOffsets(source: string, offsets: number[]): string {
  const chunks: string[] = [];
  let cursor = 0;
  for (const offset of offsets) {
    chunks.push(source.slice(cursor, offset), "x");
    cursor = offset + 1;
  }
  chunks.push(source.slice(cursor));
  return chunks.join("");
}

function mergeSortedCodeRanges(
  rangeLists: Array<Array<[number, number]>>,
  diagnostics: ReferenceAnalysisDiagnostics | undefined,
): Array<[number, number]> {
  const indexes = rangeLists.map(() => 0);
  const merged: Array<[number, number]> = [];
  while (true) {
    let selectedList = -1;
    let range: [number, number] | null = null;
    for (let listIndex = 0; listIndex < rangeLists.length; listIndex++) {
      const candidate = rangeLists[listIndex][indexes[listIndex]];
      if (
        candidate &&
        (
          range === null ||
          candidate[0] < range[0] ||
          (candidate[0] === range[0] && candidate[1] < range[1])
        )
      ) {
        selectedList = listIndex;
        range = candidate;
      }
    }
    if (range === null) break;
    indexes[selectedList]++;
    recordReferenceOperation(diagnostics);
    const previous = merged[merged.length - 1];
    if (!previous || range[0] > previous[1]) {
      merged.push([...range]);
      continue;
    }
    previous[1] = Math.max(previous[1], range[1]);
  }
  return merged;
}

function referenceCodeRanges(
  source: string,
  lines: Line[],
  blocks: InternalBlock[],
  diagnostics: ReferenceAnalysisDiagnostics | undefined,
): Array<[number, number]> {
  if (diagnostics) {
    diagnostics.referenceCodeRangeBuilds =
      (diagnostics.referenceCodeRangeBuilds ?? 0) + 1;
  }
  const {
    ranges: fences,
    neutralizedListMarkers,
  } = referenceFenceRanges(source, lines, blocks, diagnostics);
  const indented = referenceIndentedCodeRanges(lines, blocks, diagnostics);
  const html: Array<[number, number]> = [];
  for (const block of blocks) {
    recordReferenceOperation(diagnostics);
    if (block.kind === "markdown" && block.referenceLiteral) {
      html.push([block.start, block.end]);
    }
  }
  const literal = mergeSortedCodeRanges([fences, indented, html], diagnostics);
  // Keep local fenced, indented, and HTML literal ranges authoritative while
  // scanning the remaining source for inline code spans.
  const maskedLiterals = maskCodeRanges(source, literal);
  const inlineSource = neutralizeSourceOffsets(maskedLiterals, neutralizedListMarkers);
  const inline = closedInlineCodeRanges(inlineSource, lines, blocks);
  return mergeSortedCodeRanges([literal, inline], diagnostics);
}

type ClosedInlineCodeRun = {
  start: number;
  end: number;
  width: number;
  escapedAsOpener: boolean;
};

function appendClosedInlineCodeRanges(
  source: string,
  start: number,
  end: number,
  ranges: Array<[number, number]>,
): void {
  const runs: ClosedInlineCodeRun[] = [];
  let precedingBackslashes = 0;
  for (let cursor = start; cursor < end;) {
    if (source[cursor] === "\\") {
      precedingBackslashes++;
      cursor++;
      continue;
    }
    if (source[cursor] !== "`") {
      precedingBackslashes = 0;
      cursor++;
      continue;
    }

    const runStart = cursor;
    while (cursor < end && source[cursor] === "`") cursor++;
    runs.push({
      start: runStart,
      end: cursor,
      width: cursor - runStart,
      escapedAsOpener: precedingBackslashes % 2 === 1,
    });
    precedingBackslashes = 0;
  }
  if (runs.length < 2) return;

  const nextEqualRun = new Int32Array(runs.length);
  nextEqualRun.fill(-1);
  const nextByWidth = new Map<number, number>();
  for (let index = runs.length - 1; index >= 0; index--) {
    const run = runs[index];
    nextEqualRun[index] = nextByWidth.get(run.width) ?? -1;
    nextByWidth.set(run.width, index);
  }

  for (let index = 0; index < runs.length;) {
    const opener = runs[index];
    if (opener.escapedAsOpener) {
      index++;
      continue;
    }
    const closingIndex = nextEqualRun[index];
    if (closingIndex === -1) {
      index++;
      continue;
    }
    ranges.push([opener.start, runs[closingIndex].end]);
    index = closingIndex + 1;
  }
}

function interruptsInlineCodeParagraph(
  content: string,
  lineComplete: boolean,
): boolean {
  const marker = matchRecognizedListMarker(content);
  return (
    isHeading(content) ||
    matchFenceMarker(content) !== null ||
    isBlockquoteStart(content) ||
    (marker !== null && canStartListInContext(marker, "paragraph")) ||
    isThematicBreak(content) ||
    isSetextUnderline(content) ||
    matchHtmlBlockStartContent(content, lineComplete) !== null
  );
}

function closedInlineCodeRanges(
  source: string,
  originalLines: Line[],
  blocks: InternalBlock[],
): Array<[number, number]> {
  const maskedLines = splitLines(source);
  const listItemStarts = new Set<number>();
  for (const block of blocks) {
    if (block.kind !== "list") continue;
    for (const itemStart of block.itemStarts) listItemStarts.add(itemStart);
  }

  const ranges: Array<[number, number]> = [];
  let contextStart: number | null = null;
  let contextQuoteDepth = 0;
  let blockIndex = 0;
  let previousBlockIndex = -1;
  let listContentIndent: number | null = null;

  const closeContext = (end: number): void => {
    if (contextStart !== null && contextStart < end) {
      appendClosedInlineCodeRanges(source, contextStart, end, ranges);
    }
    contextStart = null;
  };

  for (let lineIndex = 0; lineIndex < maskedLines.length; lineIndex++) {
    const maskedLine = maskedLines[lineIndex];
    while (
      blockIndex < blocks.length &&
      maskedLine.start >= blocks[blockIndex].end
    ) {
      blockIndex++;
    }
    const owner = blocks[blockIndex];
    const ownerChanged = blockIndex !== previousBlockIndex;
    if (ownerChanged) {
      closeContext(maskedLine.start);
      listContentIndent = null;
      previousBlockIndex = blockIndex;
    }

    const originalLine = originalLines[lineIndex] ?? maskedLine;
    const container = referenceContainerContent(logicalLineContent(originalLine));
    const isListItemStart =
      owner?.kind === "list" && listItemStarts.has(maskedLine.start);
    const itemMarker =
      isListItemStart ? matchReferenceListMarker(container.content) : null;
    if (isListItemStart) {
      if (!ownerChanged) closeContext(maskedLine.start);
      listContentIndent = itemMarker?.contentIndent ?? null;
    }

    if (isBlank(maskedLine)) {
      closeContext(maskedLine.start);
      continue;
    }

    let parsingContent = container.content;
    if (owner?.kind === "list" && listContentIndent !== null) {
      if (itemMarker !== null) {
        parsingContent = container.content.slice(itemMarker.contentStart);
      } else {
        parsingContent =
          stripIndentationColumns(container.content, listContentIndent) ??
          container.content;
      }
    }

    if (
      contextStart !== null &&
      (
        container.quoteDepth !== contextQuoteDepth ||
        interruptsInlineCodeParagraph(parsingContent, originalLine.hasNewline)
      )
    ) {
      closeContext(maskedLine.start);
    }
    if (contextStart === null) {
      contextStart = maskedLine.start;
      contextQuoteDepth = container.quoteDepth;
    }
  }
  closeContext(source.length);
  return ranges;
}

function closingBracketOffsets(
  content: string,
  lineStart: number,
  codeRanges: Array<[number, number]>,
  firstCodeRange: number,
): Int32Array {
  const closingOffsets = new Int32Array(content.length);
  const openOffsets: number[] = [];
  let codeRangeIndex = firstCodeRange;
  for (let i = 0; i < content.length; i++) {
    const sourceOffset = lineStart + i;
    while (
      codeRangeIndex < codeRanges.length &&
      codeRanges[codeRangeIndex][1] <= sourceOffset
    ) {
      codeRangeIndex++;
    }
    const codeRange = codeRanges[codeRangeIndex];
    if (
      codeRange &&
      codeRange[0] <= sourceOffset &&
      sourceOffset < codeRange[1]
    ) {
      i = Math.min(content.length, codeRange[1] - lineStart) - 1;
      continue;
    }
    if (content[i] === "\\" && i + 1 < content.length) {
      i++;
      continue;
    }
    if (content[i] === "[") {
      openOffsets.push(i);
      continue;
    }
    if (content[i] !== "]" || openOffsets.length === 0) continue;
    const openOffset = openOffsets.pop();
    if (openOffset !== undefined) closingOffsets[openOffset] = i + 1;
  }
  return closingOffsets;
}

function skipInlineLinkWhitespace(content: string, start: number): number {
  let cursor = start;
  while (cursor < content.length && /[ \t]/.test(content[cursor])) cursor++;
  return cursor;
}

function isAsciiPunctuation(char: string): boolean {
  const code = char.charCodeAt(0);
  return (
    (code >= 33 && code <= 47) ||
    (code >= 58 && code <= 64) ||
    (code >= 91 && code <= 96) ||
    (code >= 123 && code <= 126)
  );
}

function findInlineTitleEnd(content: string, start: number): number | null {
  const opener = content[start];
  const closer = opener === "(" ? ")" : opener;
  if (opener !== "\"" && opener !== "'" && opener !== "(") return null;

  for (let cursor = start + 1; cursor < content.length; cursor++) {
    if (content[cursor] === "\\" && cursor + 1 < content.length) {
      cursor++;
      continue;
    }
    if (opener === "(" && content[cursor] === "(") return null;
    if (content[cursor] === closer) return cursor + 1;
  }
  return null;
}

function finishInlineLinkAfterDestination(
  content: string,
  start: number,
): number | null {
  let cursor = skipInlineLinkWhitespace(content, start);
  if (content[cursor] === ")") return cursor + 1;

  const titleEnd = findInlineTitleEnd(content, cursor);
  if (titleEnd === null) return null;
  cursor = skipInlineLinkWhitespace(content, titleEnd);
  return content[cursor] === ")" ? cursor + 1 : null;
}

function findInlineLinkEnd(content: string, openParen: number): number | null {
  let cursor = skipInlineLinkWhitespace(content, openParen + 1);
  if (content[cursor] === ")") return cursor + 1;

  if (
    cursor > openParen + 1 &&
    (content[cursor] === "\"" || content[cursor] === "'" || content[cursor] === "(")
  ) {
    return finishInlineLinkAfterDestination(content, cursor);
  }

  if (content[cursor] === "<") {
    cursor++;
    let closed = false;
    while (cursor < content.length) {
      if (content[cursor] === "\\" && cursor + 1 < content.length) {
        cursor += 2;
        continue;
      }
      if (content[cursor] === "<") return null;
      if (content[cursor] === ">") {
        cursor++;
        closed = true;
        break;
      }
      cursor++;
    }
    if (!closed) return null;
    if (content[cursor] === ")") return cursor + 1;
    if (!/[ \t]/.test(content[cursor] ?? "")) return null;
    return finishInlineLinkAfterDestination(content, cursor);
  }

  let depth = 0;
  while (cursor < content.length) {
    const char = content[cursor];
    if (char === "\\" && cursor + 1 < content.length) {
      if (!isAsciiPunctuation(content[cursor + 1])) return null;
      cursor += 2;
      continue;
    }
    if (char === "(") {
      depth++;
      cursor++;
      continue;
    }
    if (char === ")") {
      if (depth === 0) return cursor + 1;
      depth--;
      cursor++;
      continue;
    }
    if (char === "\"" || char === "'" || /[\u0000-\u0020\u007f]/.test(char)) {
      if (!/[ \t]/.test(char) || depth > 0) return null;
      return finishInlineLinkAfterDestination(content, cursor);
    }
    cursor++;
  }
  return null;
}

function findPotentialReferenceInLine(
  content: string,
  lineStart: number,
  codeRanges: Array<[number, number]>,
  firstCodeRange: number,
): number | null {
  if (!content.includes("[")) return null;
  const closingOffsets = closingBracketOffsets(
    content,
    lineStart,
    codeRanges,
    firstCodeRange,
  );
  // Valid inline links partition the current span into their label and the
  // remaining suffix. These spans never overlap, so both work and stack depth
  // stay bounded by the line length even for deeply nested labels.
  const pendingSpans: Array<[number, number]> = [[0, content.length]];
  let codeRangeIndex = firstCodeRange;
  while (pendingSpans.length > 0) {
    const span = pendingSpans.pop();
    if (!span) break;
    const [start, end] = span;
    let i = start;
    while (i < end) {
      const sourceOffset = lineStart + i;
      while (
        codeRangeIndex < codeRanges.length &&
        codeRanges[codeRangeIndex][1] <= sourceOffset
      ) {
        codeRangeIndex++;
      }
      const codeRange = codeRanges[codeRangeIndex];
      if (
        codeRange &&
        codeRange[0] <= sourceOffset &&
        sourceOffset < codeRange[1]
      ) {
        i = Math.min(end, codeRange[1] - lineStart);
        continue;
      }
      if (content[i] === "\\" && i + 1 < end) {
        i += 2;
        continue;
      }
      if (content[i] !== "[") {
        i++;
        continue;
      }

      const close = closingOffsets[i] - 1;
      if (close >= i && close < end && content[close + 1] === "(") {
        const inlineEnd = findInlineLinkEnd(content, close + 1);
        if (inlineEnd !== null && inlineEnd <= end) {
          if (inlineEnd < end) pendingSpans.push([inlineEnd, end]);
          if (i + 1 < close) pendingSpans.push([i + 1, close]);
          break;
        }
      }
      return i;
    }
  }
  return null;
}

type ReferenceDependency = { offset: number; blockIndex: number };

type ReferenceListContext = {
  markerIndent: number;
  contentIndent: number;
  family: ListFamily;
  paragraphOpen: boolean;
};

function referenceListContext(marker: ListMarker): ReferenceListContext {
  return {
    markerIndent: marker.indent,
    contentIndent: marker.contentIndent,
    family: marker.ordered
      ? {
          ordered: true,
          delimiter: marker.delimiter,
          start: marker.start,
        }
      : {
          ordered: false,
          bullet: marker.bullet,
        },
    paragraphOpen: marker.hasNonblankContent && marker.residualIndent < 4,
  };
}

function updateReferenceListStack(
  stack: ReferenceListContext[],
  marker: ListMarker,
  allowRoot: boolean,
  diagnostics: ReferenceAnalysisDiagnostics | undefined,
): boolean {
  for (let index = stack.length - 1; index >= 0; index--) {
    recordReferenceOperation(diagnostics);
    const owner = stack[index];
    if (marker.indent === owner.markerIndent) {
      stack.length = index + 1;
      stack[index] = referenceListContext(marker);
      return true;
    }
    if (marker.indent >= owner.contentIndent) {
      if (marker.indent > owner.contentIndent + 3) return false;
      stack.length = index + 1;
      owner.paragraphOpen = false;
      stack.push(referenceListContext(marker));
      return true;
    }
  }

  if (!allowRoot || marker.indent > 3) return false;
  stack.length = 0;
  stack.push(referenceListContext(marker));
  return true;
}

function referenceIndentedCodeRanges(
  lines: Line[],
  blocks: InternalBlock[],
  diagnostics: ReferenceAnalysisDiagnostics | undefined,
): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  let blockIndex = 0;
  let paragraphOpen = false;
  const listStack: ReferenceListContext[] = [];

  for (const line of lines) {
    recordReferenceOperation(diagnostics);
    while (
      blockIndex < blocks.length &&
      line.start >= blocks[blockIndex].end
    ) {
      blockIndex++;
      paragraphOpen = false;
      listStack.length = 0;
      recordReferenceOperation(diagnostics);
    }
    const owner = blocks[blockIndex];
    if (!owner || (owner.kind === "markdown" && owner.referenceLiteral)) continue;

    const lineContent = classificationPrefixBeforeTrailingCR(line);
    const rootMarker = matchRecognizedListMarker(lineContent);
    const referenceMarker = matchReferenceListMarker(lineContent);
    let isListMarkerLine = false;
    let acceptedMarker: ListMarker | null = null;
    if (line.start === owner.start && rootMarker !== null) {
      listStack.push(referenceListContext(rootMarker));
      isListMarkerLine = true;
      acceptedMarker = rootMarker;
    } else if (referenceMarker !== null && listStack.length > 0) {
      isListMarkerLine = updateReferenceListStack(
        listStack,
        referenceMarker,
        owner.kind === "list",
        diagnostics,
      );
      if (isListMarkerLine) acceptedMarker = referenceMarker;
    } else if (referenceMarker !== null && owner.kind === "list") {
      isListMarkerLine = updateReferenceListStack(
        listStack,
        referenceMarker,
        true,
        diagnostics,
      );
      if (isListMarkerLine) acceptedMarker = referenceMarker;
    }

    let isLiteralIndentedLine =
      acceptedMarker !== null && acceptedMarker.residualIndent >= 4;
    if (isBlank(line)) {
      paragraphOpen = false;
      for (const context of listStack) context.paragraphOpen = false;
    } else if (!isListMarkerLine) {
      const indentation = leadingIndentation(lineContent);
      while (
        listStack.length > 0 &&
        !listStack[listStack.length - 1].paragraphOpen &&
        indentation.columns < listStack[listStack.length - 1].contentIndent
      ) {
        listStack.pop();
        recordReferenceOperation(diagnostics);
      }
      const listOwner = listStack[listStack.length - 1];
      const relativeCodeIndent = (listOwner?.contentIndent ?? 0) + 4;
      const ownerParagraphOpen = listOwner?.paragraphOpen ?? paragraphOpen;
      if (
        !ownerParagraphOpen &&
        indentation.columns >= relativeCodeIndent
      ) {
        isLiteralIndentedLine = true;
      } else if (listOwner) {
        listOwner.paragraphOpen = true;
      } else {
        paragraphOpen = true;
      }
    }

    if (isLiteralIndentedLine) {
      const previous = ranges[ranges.length - 1];
      if (previous?.[1] === line.start) {
        previous[1] = line.end;
      } else {
        ranges.push([line.start, line.end]);
      }
    }
  }

  return ranges;
}

function findReferenceDependencyOffset(
  source: string,
  lines: Line[],
  blocks: InternalBlock[],
  diagnostics: ReferenceAnalysisDiagnostics | undefined,
): ReferenceDependency | null {
  recordReferenceOperation(diagnostics);
  if (!source.includes("[")) return null;

  const codeRanges = referenceCodeRanges(source, lines, blocks, diagnostics);
  let codeRangeIndex = 0;
  let blockIndex = 0;
  for (const line of lines) {
    recordReferenceOperation(diagnostics);
    while (
      blockIndex < blocks.length &&
      line.start >= blocks[blockIndex].end
    ) {
      blockIndex++;
      recordReferenceOperation(diagnostics);
    }
    const owner = blocks[blockIndex];
    if (!owner) continue;

    while (
      codeRangeIndex < codeRanges.length &&
      codeRanges[codeRangeIndex][1] <= line.start
    ) {
      codeRangeIndex++;
      recordReferenceOperation(diagnostics);
    }
    const inLine = findPotentialReferenceInLine(
      logicalLineContent(line),
      line.start,
      codeRanges,
      codeRangeIndex,
    );
    if (inLine !== null) {
      return { offset: line.start + inLine, blockIndex };
    }
  }
  return null;
}

function isStructurallySafeReferenceBlock(block: InternalBlock): boolean {
  if (block.kind === "list") return true;
  return (
    block.subkind === "safe" ||
    (block.subkind === "plain-when-active" && block.terminated)
  );
}

function holdReferenceDependentTail(
  source: string,
  lines: Line[],
  blocks: InternalBlock[],
  diagnostics: ReferenceAnalysisDiagnostics | undefined,
): InternalBlock[] {
  const dependency = findReferenceDependencyOffset(source, lines, blocks, diagnostics);
  if (dependency === null) return blocks;
  const { offset, blockIndex: firstDependent } = dependency;

  const dependent = blocks.slice(firstDependent);
  const last = dependent[dependent.length - 1];
  const first = dependent[0];
  if (first.kind === "list") {
    let dependentItem = 0;
    for (let index = 1; index < first.itemStarts.length; index++) {
      if (first.itemStarts[index] > offset) break;
      dependentItem = index;
    }
    const dependentStart = first.itemStarts[dependentItem];
    const structurallySafe = dependent.every(isStructurallySafeReferenceBlock);
    const activeSuffix: InternalBlock = {
      kind: "markdown",
      subkind: structurallySafe ? "safe" : "plain-when-active",
      start: dependentStart,
      end: last.end,
      terminated: false,
    };
    if (dependentItem === 0) {
      return [
        ...blocks.slice(0, firstDependent),
        activeSuffix,
      ];
    }
    return [
      ...blocks.slice(0, firstDependent),
      {
        ...first,
        end: dependentStart,
        terminated: true,
        itemStarts: first.itemStarts.slice(0, dependentItem),
        lastItemActive: false,
      },
      activeSuffix,
    ];
  }

  const structurallySafe = dependent.every(isStructurallySafeReferenceBlock);
  return [
    ...blocks.slice(0, firstDependent),
    {
      kind: "markdown",
      subkind: structurallySafe ? "safe" : "plain-when-active",
      start: first.start,
      end: last.end,
      terminated: false,
    },
  ];
}

// ── output shaping ───────────────────────────────────────────────────────

function renderModeFor(subkind: MarkdownSubkind, terminated: boolean): "markdown" | "plain" {
  if (subkind === "safe") return "markdown";
  if (subkind === "plain-when-active") return terminated ? "markdown" : "plain";
  return "plain"; // ambiguous
}

function buildListBlock(
  block: Extract<InternalBlock, { kind: "list" }>,
  source: string,
  turnId: string,
  forceSettled: boolean,
): StreamingListBlock {
  // Task 6 owns one stable ul/ol and explicit li wrappers, then renders each
  // marker-stripped item independently. List-wide loose/tight classification
  // therefore cannot change a frozen item and is intentionally not partition state.
  const lastItemActive = forceSettled ? false : block.lastItemActive;
  const items = block.itemStarts.map((itemStart, index) => {
    const isLast = index === block.itemStarts.length - 1;
    const itemEnd = isLast ? block.end : block.itemStarts[index + 1];
    return {
      id: `${turnId}:${block.start}-item-${index}`,
      source: source.slice(itemStart, itemEnd),
    };
  });
  const committedItems = lastItemActive ? items.slice(0, -1) : items;
  const activeItem = lastItemActive ? items[items.length - 1] : undefined;
  return {
    id: `${turnId}:${block.start}-list`,
    kind: "list",
    ordered: block.family.ordered,
    ...(block.family.ordered ? { start: block.family.start } : {}),
    committedItems,
    activeItem,
    source: source.slice(block.start, block.end),
  };
}

function buildMarkdownBlock(
  block: Extract<InternalBlock, { kind: "markdown" }>,
  source: string,
  turnId: string,
  forceMarkdown: boolean,
  active: boolean,
): StreamingMarkdownBlock {
  return {
    id: active ? `${turnId}:${block.start}-active` : `${turnId}:${block.start}-${block.end}`,
    kind: "markdown",
    source: source.slice(block.start, block.end),
    renderMode: forceMarkdown ? "markdown" : renderModeFor(block.subkind, block.terminated),
  };
}

function buildBlock(
  block: InternalBlock,
  source: string,
  turnId: string,
  forceSettled: boolean,
  active = false,
): StreamingContentBlock {
  if (block.kind === "list") {
    return buildListBlock(block, source, turnId, forceSettled);
  }
  return buildMarkdownBlock(block, source, turnId, forceSettled, active);
}

export function partitionStreamingMarkdown(
  source: string,
  options: {
    turnId: string;
    settled: boolean;
    referenceAnalysisDiagnostics?: ReferenceAnalysisDiagnostics;
  },
): StreamingMarkdownPartition {
  if (source.length === 0) {
    return { committedBlocks: [], activeBlock: null, committedText: "" };
  }

  const { turnId, settled, referenceAnalysisDiagnostics } = options;
  const lines = splitLines(source);
  const blocks = holdReferenceDependentTail(
    source,
    lines,
    parseBlocks(lines),
    referenceAnalysisDiagnostics,
  );

  const committedBlocks: StreamingContentBlock[] = [];
  let activeBlock: StreamingContentBlock | null = null;

  for (let idx = 0; idx < blocks.length; idx++) {
    const block = blocks[idx];
    const isLast = idx === blocks.length - 1;
    if (isLast && !block.terminated) {
      // Only the very last block in the whole document can be non-terminated
      // (every scan function only returns terminated=false after running out
      // of lines). settled forces it into committedBlocks verbatim, with
      // renderMode markdown; otherwise it is the trailing active block.
      if (settled) {
        committedBlocks.push(buildBlock(block, source, turnId, true));
        activeBlock = null;
      } else {
        activeBlock = buildBlock(block, source, turnId, false, true);
      }
    } else {
      committedBlocks.push(buildBlock(block, source, turnId, false));
    }
  }

  if (settled) {
    for (let idx = 0; idx < committedBlocks.length; idx++) {
      const b = committedBlocks[idx];
      if (b.kind === "markdown" && b.renderMode !== "markdown") {
        committedBlocks[idx] = { ...b, renderMode: "markdown" };
      }
    }
  }

  const committedText = committedBlocks.map((b) => b.source).join("");
  return { committedBlocks, activeBlock, committedText };
}
