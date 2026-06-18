/**
 * Pure parser for ripgrep's `--json` event stream (CODE-SEARCH-01).
 *
 * The /api/project/search route spawns `rg --json` and feeds its stdout here.
 * Keeping the parse pure (no child_process, no next/server) lets it be
 * unit-tested against captured ripgrep output without a live binary or repo.
 *
 * ripgrep emits one JSON object per line. We only care about `match` events;
 * `begin`/`end`/`summary`/`context` are ignored. Each match carries the file
 * path, the 1-based line number, the matched line text, and submatch byte
 * offsets (used to derive a 1-based column for jump-to-line).
 *
 * Output is grouped by file and bounded twice — total matches and per-file
 * matches — so a pathological query ("e" across a monorepo) can't flood the
 * client. The bounds are reported via `truncated` so the UI can say so.
 */

export type SearchMatch = {
  /** 1-based line number within the file. */
  line: number;
  /** 1-based column of the first submatch (best-effort; 1 when unknown). */
  column: number;
  /** The matched line, newline-stripped and length-capped for display. */
  preview: string;
};

export type SearchFileGroup = {
  /** Path relative to the searched root, as ripgrep reported it. */
  path: string;
  matches: SearchMatch[];
};

export type SearchResult = {
  files: SearchFileGroup[];
  totalMatches: number;
  /** True when either the global or a per-file cap dropped further matches. */
  truncated: boolean;
};

export type ParseOptions = {
  /** Hard cap on total matches across all files. */
  maxMatches?: number;
  /** Hard cap on matches kept per file. */
  maxPerFile?: number;
  /** Max characters of a preview line kept (avoids minified-file blowups). */
  maxPreviewLen?: number;
};

const DEFAULT_MAX_MATCHES = 500;
const DEFAULT_MAX_PER_FILE = 50;
const DEFAULT_MAX_PREVIEW = 240;

type RgText = { text?: string; bytes?: string };

type RgMatchData = {
  path?: RgText;
  lines?: RgText;
  line_number?: number;
  submatches?: Array<{ start?: number }>;
};

function textOf(value: RgText | undefined): string {
  if (!value) return "";
  if (typeof value.text === "string") return value.text;
  // ripgrep base64-encodes non-UTF8 paths/lines as `{ bytes }`. We can't render
  // those meaningfully, so fall back to empty and let the caller skip.
  return "";
}

/**
 * Derive a 1-based column from the first submatch's byte start. ripgrep reports
 * byte offsets into the line; for the common ASCII case this equals the column.
 * For multibyte lines it's an approximation, which is acceptable for a
 * cursor-placement hint.
 */
function columnFromSubmatches(data: RgMatchData): number {
  const first = data.submatches?.[0]?.start;
  return typeof first === "number" && first >= 0 ? first + 1 : 1;
}

export function parseRipgrepJson(stdout: string, options: ParseOptions = {}): SearchResult {
  const maxMatches = options.maxMatches ?? DEFAULT_MAX_MATCHES;
  const maxPerFile = options.maxPerFile ?? DEFAULT_MAX_PER_FILE;
  const maxPreviewLen = options.maxPreviewLen ?? DEFAULT_MAX_PREVIEW;

  const groups = new Map<string, SearchFileGroup>();
  const order: string[] = [];
  let totalMatches = 0;
  let truncated = false;

  for (const rawLine of stdout.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;

    let event: { type?: string; data?: RgMatchData };
    try {
      event = JSON.parse(line) as { type?: string; data?: RgMatchData };
    } catch {
      continue; // tolerate partial/garbled lines
    }
    if (event.type !== "match" || !event.data) continue;

    const data = event.data;
    // ripgrep reports paths relative to the search path we pass ("."), so they
    // arrive prefixed with "./" — strip it so the path is clean for display and
    // for rejoining to the project root.
    const path = textOf(data.path).replace(/^\.\//, "");
    if (!path) continue;
    const lineNumber = typeof data.line_number === "number" ? data.line_number : 0;
    if (lineNumber <= 0) continue;

    if (totalMatches >= maxMatches) {
      truncated = true;
      break;
    }

    let group = groups.get(path);
    if (!group) {
      group = { path, matches: [] };
      groups.set(path, group);
      order.push(path);
    }
    if (group.matches.length >= maxPerFile) {
      truncated = true;
      continue; // keep scanning other files, just skip this one's overflow
    }

    const rawPreview = textOf(data.lines).replace(/\r?\n$/, "");
    const preview =
      rawPreview.length > maxPreviewLen ? `${rawPreview.slice(0, maxPreviewLen)}…` : rawPreview;

    group.matches.push({
      line: lineNumber,
      column: columnFromSubmatches(data),
      preview,
    });
    totalMatches += 1;
  }

  return {
    files: order.map((p) => groups.get(p)!),
    totalMatches,
    truncated,
  };
}
