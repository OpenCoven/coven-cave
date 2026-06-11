// One-line argument summaries for collapsed tool rows.
//
// Tool inputs arrive as strings (see src/app/api/chat/send/route.ts): either
// pretty-printed JSON (when the hook payload parsed) or the raw payload text
// (e.g. a bare Bash command line, or a truncated `{...}` blob). The chat UI
// shows `Read(src/foo.ts)`-style summaries so a run can be audited without
// expanding each tool block.

const MAX_SUMMARY_CHARS = 48;

// Well-known argument keys, most identifying first.
const PREFERRED_KEYS = [
  "file_path",
  "path",
  "command",
  "pattern",
  "url",
  "query",
  "prompt",
  "description",
  "skill",
  "notebook_path",
] as const;

// Shell-ish tools whose `command` key is the headline argument.
const COMMAND_FIRST_TOOLS = /^(bash|shell|terminal|exec)/i;

// A quoted token, or something that looks like a file path.
const QUOTED_TOKEN_RE = /"([^"\n]{2,})"|'([^'\n]{2,})'/;
const PATH_TOKEN_RE = /(?:~|\.{1,2})?\/?[\w.@-]+(?:\/[\w.@-]+)+/;

/** Collapse to a single line and cap at `max` characters with an ellipsis. */
function ellipsize(value: string, max = MAX_SUMMARY_CHARS): string {
  const flat = value.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  return `${flat.slice(0, max - 1)}…`;
}

function tryParseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

function summarizeRecord(name: string, record: Record<string, unknown>): string {
  const keys: readonly string[] = COMMAND_FIRST_TOOLS.test(name)
    ? ["command", ...PREFERRED_KEYS.filter((k) => k !== "command")]
    : PREFERRED_KEYS;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return ellipsize(value);
    if (typeof value === "number" || typeof value === "boolean") return ellipsize(String(value));
  }
  // No well-known key — fall back to the first non-empty string value, then
  // to the flattened JSON itself.
  for (const value of Object.values(record)) {
    if (typeof value === "string" && value.trim()) return ellipsize(value);
  }
  return ellipsize(JSON.stringify(record));
}

/**
 * Derive a one-line argument summary from a tool's input payload.
 * Always single-line, at most ~48 chars, empty string when input is absent.
 */
export function toolArgSummary(name: string, input?: string | null): string {
  const raw = (input ?? "").trim();
  if (!raw) return "";

  const parsed = tryParseJson(raw);
  if (parsed !== undefined && parsed !== null) {
    if (typeof parsed === "string") return ellipsize(parsed);
    if (Array.isArray(parsed)) return ellipsize(parsed.map((v) => String(v)).join(" "));
    if (typeof parsed === "object") return summarizeRecord(name, parsed as Record<string, unknown>);
    return ellipsize(String(parsed));
  }

  // Non-JSON object-ish blob (e.g. truncated `{ file_path: src/foo.ts … }`):
  // pull the first path-looking or quoted token out of it.
  if (raw.startsWith("{")) {
    const quoted = raw.match(QUOTED_TOKEN_RE);
    const quotedToken = quoted?.[1] ?? quoted?.[2];
    const pathToken = raw.match(PATH_TOKEN_RE)?.[0];
    const token =
      pathToken && (!quotedToken || raw.indexOf(pathToken) < raw.indexOf(quotedToken))
        ? pathToken
        : quotedToken ?? pathToken;
    if (token) return ellipsize(token);
  }

  // Plain string payload (e.g. a Bash command line) — use it directly.
  return ellipsize(raw);
}
