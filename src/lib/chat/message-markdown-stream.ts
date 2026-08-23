const RENDER_CACHE_MAX = 200;
const renderCache = new Map<string, string>();

export interface MarkdownRenderGate {
  issue(): number;
  settle(): void;
  apply(stamp: number): boolean;
}

/**
 * Orders async Markdown renders and synchronously invalidates work issued
 * before a pending turn settles.
 */
export function createMarkdownRenderGate(): MarkdownRenderGate {
  let issuedStamp = 0;
  let appliedStamp = 0;
  let settledBarrier = 0;

  return {
    issue() {
      issuedStamp += 1;
      return issuedStamp;
    },
    settle() {
      settledBarrier = Math.max(settledBarrier, issuedStamp + 1);
    },
    apply(stamp) {
      if (stamp < settledBarrier || stamp <= appliedStamp) return false;
      appliedStamp = stamp;
      return true;
    },
  };
}

/** Small LRU keyed by final markdown snapshots; transient stream frames never enter it. */
export function getRenderedMarkdown(key: string): string | undefined {
  const value = renderCache.get(key);
  if (value !== undefined) {
    renderCache.delete(key);
    renderCache.set(key, value);
  }
  return value;
}

export function cacheRenderedMarkdown(key: string, value: string): void {
  if (renderCache.has(key)) renderCache.delete(key);
  renderCache.set(key, value);
  if (renderCache.size > RENDER_CACHE_MAX) {
    const oldest = renderCache.keys().next().value;
    if (oldest !== undefined) renderCache.delete(oldest);
  }
}

/** Close an incomplete streaming fence only for the transient render. */
export function closeTrailingFence(markdown: string): string {
  let inFence = false;
  for (const line of markdown.split("\n")) {
    if (/^\s*```/.test(line)) inFence = !inFence;
  }
  return inFence ? `${markdown}\n\`\`\`` : markdown;
}

function isEscaped(text: string, index: number): boolean {
  let slashCount = 0;
  for (let i = index - 1; i >= 0 && text[i] === "\\"; i -= 1) slashCount += 1;
  return slashCount % 2 === 1;
}

/**
 * Presentation-only completion for an in-flight Markdown snapshot.
 *
 * The source buffer remains untouched. This closes only delimiters that are
 * currently unmatched at the stream tail so the parser never exposes raw
 * emphasis/backtick markers while waiting for their closing token.
 */
export function stabilizeStreamingMarkdown(markdown: string): string {
  const source = closeTrailingFence(markdown);
  type Delimiter = "`" | "**" | "__" | "*" | "_";
  const stack: Array<{ token: Delimiter; index: number }> = [];
  const lines = source.split("\n");
  let inFence = false;
  let lineOffset = 0;

  for (const line of lines) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      lineOffset += line.length + 1;
      continue;
    }
    if (inFence) {
      lineOffset += line.length + 1;
      continue;
    }

    for (let i = 0; i < line.length; i += 1) {
      if (isEscaped(line, i)) continue;
      const current = line[i];
      const top = stack[stack.length - 1]?.token;

      if (current === "`") {
        if (top === "`") stack.pop();
        else stack.push({ token: "`", index: lineOffset + i });
        continue;
      }
      if (top === "`") continue;

      const pair = line.slice(i, i + 2);
      if (pair === "**" || pair === "__") {
        if (top === pair) stack.pop();
        else stack.push({ token: pair, index: lineOffset + i });
        i += 1;
        continue;
      }
      if (current !== "*" && current !== "_") continue;

      const before = line[i - 1] ?? "";
      const after = line[i + 1] ?? "";
      const isBullet = current === "*" && /^\s*$/.test(line.slice(0, i)) && /\s/.test(after);
      const isIntrawordUnderscore =
        current === "_" && /[A-Za-z0-9]/.test(before) && /[A-Za-z0-9]/.test(after);
      if (isBullet || isIntrawordUnderscore) continue;

      if (top === current) stack.pop();
      else stack.push({ token: current, index: lineOffset + i });
    }
    lineOffset += line.length + 1;
  }

  let stabilized = source;
  const neutralizedOpeners = stack
    .filter(({ token, index }) => {
      const tail = source.slice(index + token.length);
      const blockBoundary = /\n\s*\n/.test(tail);
      return blockBoundary || !/[^\s*_`]/.test(tail);
    })
    .sort((a, b) => b.index - a.index);
  const removed = new Set(neutralizedOpeners);
  for (const { token, index } of neutralizedOpeners) {
    stabilized = `${stabilized.slice(0, index)}${stabilized.slice(index + token.length)}`;
  }
  for (let i = stack.length - 1; i >= 0; i -= 1) {
    if (!removed.has(stack[i])) stabilized += stack[i].token;
  }

  // A partial destination is safe to close transiently. The final settled
  // render still receives the exact source and therefore owns real validity.
  if (/\[[^\]\n]+\]\([^)\n]*$/.test(stabilized)) stabilized += ")";
  return stabilized;
}

// ── Pseudo-list normalization ────────────────────────────────────────────────
// @create-markdown/core has no lazy-continuation support: a wrapped list-item
// line splits the list into `numberedList, paragraph, numberedList` fragments,
// and single newlines inside a paragraph collapse to spaces — so a model reply
// whose items wrap (or that uses `1)` / `**1. Title**` markers) renders as one
// dense wall of text. Normalize those shapes into real markdown lists before
// parsing. Content inside code fences is never touched.

/** `1. item` (real numbered marker the parser already understands). */
const NUM_MARKER_RE = /^(\s{0,3})(\d{1,3})\.\s+\S/;
/** `1) item` (paren marker the parser treats as prose). */
const PAREN_MARKER_RE = /^(\s{0,3})(\d{1,3})\)\s+(\S.*)$/;
/** `**1. Title** — rest` (bold-wrapped marker the parser treats as prose). */
const BOLD_NUM_MARKER_RE = /^(\s{0,3})\*\*(\d{1,3})[.)]\s*([^*]+?)\*\*(.*)$/;
/** `- item` / `* item` / `+ item`. */
const BULLET_MARKER_RE = /^(\s{0,3})[-*+]\s+\S/;
/** Lines a lazy continuation must never swallow. */
const BLOCK_START_RE = /^\s*(?:#{1,6}\s|>|```|\||[-*_]\s*(?:[-*_]\s*){2,}$|={3,}\s*$)/;

type ListMarkerKind = "numbered" | "paren" | "boldnum" | "bullet";

function listMarkerKind(line: string): ListMarkerKind | null {
  if (BLOCK_START_RE.test(line)) return null;
  if (NUM_MARKER_RE.test(line)) return "numbered";
  if (PAREN_MARKER_RE.test(line)) return "paren";
  if (BOLD_NUM_MARKER_RE.test(line)) return "boldnum";
  if (BULLET_MARKER_RE.test(line)) return "bullet";
  return null;
}

/**
 * Rewrite pseudo-list shapes into lists the markdown parser recognizes:
 * wrapped item text is joined back onto its marker line (CommonMark lazy
 * continuation, which the parser lacks), and — when a run holds two or more
 * numbered markers — `1)` markers become `1.` and `**1. Title**` unwraps to
 * `1. **Title**`. Fenced code passes through verbatim.
 */
export function normalizePseudoLists(markdown: string): string {
  const lines = markdown.split("\n");
  const out: string[] = [];
  let inFence = false;
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      out.push(line);
      i += 1;
      continue;
    }
    if (inFence) {
      out.push(line);
      i += 1;
      continue;
    }

    const startKind = listMarkerKind(line);
    if (!startKind) {
      out.push(line);
      i += 1;
      continue;
    }

    // Collect the contiguous run: marker lines of the same family plus the
    // continuation lines attached to them. Blank lines, fences, block starts,
    // and other-family markers end the run.
    const family = startKind === "bullet" ? "bullet" : "numbered";
    type RunLine = { text: string; kind: ListMarkerKind | null };
    const run: RunLine[] = [];
    let j = i;
    while (j < lines.length) {
      const candidate = lines[j];
      if (!candidate.trim() || /^\s*```/.test(candidate)) break;
      if (BLOCK_START_RE.test(candidate)) break;
      const kind = listMarkerKind(candidate);
      if (kind) {
        const candidateFamily = kind === "bullet" ? "bullet" : "numbered";
        if (candidateFamily !== family) break;
        run.push({ text: candidate, kind });
      } else {
        run.push({ text: candidate, kind: null });
      }
      j += 1;
    }

    const markerCount = run.filter((r) => r.kind !== null).length;
    // Paren/bold markers only convert when the run clearly reads as a list
    // (two or more numbered markers); a lone `1)` or `**1.**` line stays prose.
    const convert = family === "numbered" && markerCount >= 2;
    // Continuations rejoin their item whenever the run holds a real list the
    // parser would otherwise fragment.
    const join = convert || run.some((r) => r.kind === "numbered" || r.kind === "bullet");

    if (!convert && !join) {
      for (const r of run) out.push(r.text);
      i = j;
      continue;
    }

    for (const r of run) {
      let text = r.text;
      if (convert && r.kind === "paren") {
        text = text.replace(PAREN_MARKER_RE, (_m, indent, n, rest) => `${indent}${n}. ${rest}`);
      } else if (convert && r.kind === "boldnum") {
        text = text.replace(
          BOLD_NUM_MARKER_RE,
          (_m, indent, n, title, rest) => `${indent}${n}. **${title.trim()}**${rest}`,
        );
      }
      if (r.kind === null && join && out.length > 0) {
        out[out.length - 1] = `${out[out.length - 1].replace(/\s+$/, "")} ${text.trim()}`;
        continue;
      }
      out.push(text);
    }
    i = j;
  }

  return out.join("\n");
}

/** Preserve filename labels while normalizing fence info for the markdown parser. */
export function scanFenceFilenames(markdown: string): Array<string | null> {
  const filenames: Array<string | null> = [];
  let inFence = false;
  for (const line of markdown.split("\n")) {
    if (!/^\s*```/.test(line)) continue;
    if (inFence) {
      inFence = false;
      continue;
    }
    const match = /^\s*```\s*[\w+.-]*(?:(:\S+))?\s*$/.exec(line);
    filenames.push(match?.[1]?.slice(1) ?? null);
    inFence = true;
  }
  return filenames;
}
