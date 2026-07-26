// Human-readable rendering of tool-call inputs and outputs.
//
// Tool inputs arrive as JSON strings (see src/app/api/chat/send/route.ts and
// chat-tool-events.ts). Rendering that raw JSON blob in the transcript buries
// the actual intent of the call behind braces and quotes. This module turns a
// tool's input payload into a labelled list of fields — `File: src/foo.ts`,
// `Find: …`, `Limit: 100` — with humanised labels and a per-field kind hint the
// UI uses to choose inline vs. block rendering. The raw JSON stays one toggle
// away for auditing; this is the default, readable view.
//
// Pure and unit-tested. The React layer (ToolBlock in chat-view) consumes the
// structured output; the colours/spacing live in cave-chat.css.

/** Coarse render hint for a single field value. */
export type ReadableFieldKind =
  | "path"
  | "command"
  | "code"
  | "url"
  | "number"
  | "boolean"
  | "text"
  | "json";

export type ReadableField = {
  /** Original JSON key. */
  key: string;
  /** Humanised label, e.g. `file_path` → "File". */
  label: string;
  /** String representation of the value. */
  value: string;
  kind: ReadableFieldKind;
  /** True when the value wants a wrapped block rather than an inline span
   *  (long strings, code, multi-line content, nested JSON). */
  multiline: boolean;
};

// Render the most identifying keys first; everything else follows in payload
// order. Mirrors PREFERRED_KEYS in tool-arg-summary.ts but tuned for the full
// field list rather than a one-line summary.
const KEY_ORDER = [
  "file_path",
  "path",
  "notebook_path",
  "command",
  "pattern",
  "url",
  "query",
  "prompt",
  "description",
  "skill",
  "old_string",
  "new_string",
  "content",
  "new_source",
  "limit",
  "offset",
] as const;

// Nicer labels than a raw humanisation would produce. Keys not listed here fall
// back to humaniseKey().
const LABEL_OVERRIDES: Record<string, string> = {
  file_path: "File",
  path: "Path",
  notebook_path: "Notebook",
  command: "Command",
  pattern: "Pattern",
  url: "URL",
  query: "Query",
  prompt: "Prompt",
  description: "Description",
  skill: "Skill",
  old_string: "Find",
  new_string: "Replace with",
  new_str: "Replace with",
  old_str: "Find",
  content: "Content",
  new_source: "Content",
  limit: "Limit",
  offset: "Offset",
  todos: "To-dos",
  subagent_type: "Agent",
  glob: "Glob",
  output_mode: "Output mode",
};

// Acronyms that should stay upper-cased after humanisation.
const ACRONYMS = new Set(["url", "uri", "id", "api", "ip", "sql", "json", "html", "css", "ui", "ux"]);

/** snake_case / kebab-case / camelCase → "Title case" with acronym fixups. */
export function humaniseKey(key: string): string {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2") // camelCase boundary
    .replace(/[_-]+/g, " ")
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return key;
  return words
    .map((word, i) => {
      if (ACRONYMS.has(word)) return word.toUpperCase();
      if (i === 0) return word.charAt(0).toUpperCase() + word.slice(1);
      return word;
    })
    .join(" ");
}

function labelFor(key: string): string {
  return LABEL_OVERRIDES[key] ?? humaniseKey(key);
}

const URL_RE = /^(https?:\/\/|www\.)/i;
const CODE_KEYS = new Set(["old_string", "new_string", "old_str", "new_str", "content", "new_source"]);
const PATH_KEYS = new Set(["file_path", "path", "notebook_path", "cwd", "directory"]);

function kindFor(key: string, value: unknown): ReadableFieldKind {
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "boolean";
  if (value !== null && typeof value === "object") return "json";
  const str = typeof value === "string" ? value : String(value ?? "");
  if (CODE_KEYS.has(key)) return "code";
  if (key === "command") return "command";
  if (PATH_KEYS.has(key)) return "path";
  if (URL_RE.test(str.trim())) return "url";
  return "text";
}

/** A value wants a wrapped block when it is code, nested JSON, has newlines, or
 *  is simply too long to sit inline next to its label. */
function isMultiline(kind: ReadableFieldKind, value: string): boolean {
  if (kind === "code" || kind === "json") return true;
  if (value.includes("\n")) return true;
  return value.length > 56;
}

function stringifyValue(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function tryParseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

/**
 * Turn a tool input payload into an ordered list of labelled fields.
 *
 * Returns null when the input is absent, not JSON, or not a JSON object (bare
 * strings/arrays have no key/value structure to label) — callers fall back to
 * their raw rendering.
 */
export function toolReadableFields(input?: string | null): ReadableField[] | null {
  const raw = (input ?? "").trim();
  if (!raw) return null;
  const parsed = tryParseJson(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;

  const record = parsed as Record<string, unknown>;
  const entries = Object.entries(record).filter(
    ([, v]) => v !== undefined && v !== null && !(typeof v === "string" && v.trim() === ""),
  );
  if (entries.length === 0) return null;

  const orderIndex = (key: string): number => {
    const i = (KEY_ORDER as readonly string[]).indexOf(key);
    return i === -1 ? KEY_ORDER.length : i;
  };
  entries.sort(([a], [b]) => orderIndex(a) - orderIndex(b));

  return entries.map(([key, value]) => {
    const kind = kindFor(key, value);
    const str = stringifyValue(value);
    return {
      key,
      label: labelFor(key),
      value: str,
      kind,
      multiline: isMultiline(kind, str),
    };
  });
}

/**
 * Pretty-print a tool output payload. JSON outputs get 2-space indentation so
 * the structure is legible; everything else (logs, plain text, diffs) passes
 * through untouched.
 */
export function prettyToolOutput(output?: string | null): string {
  const raw = output ?? "";
  const trimmed = raw.trim();
  if (!trimmed) return raw;
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    const parsed = tryParseJson(trimmed);
    if (parsed !== undefined) {
      try {
        return JSON.stringify(parsed, null, 2);
      } catch {
        return raw;
      }
    }
  }
  return raw;
}
