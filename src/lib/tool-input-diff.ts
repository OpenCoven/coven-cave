// Structured diff rendering for file-mutation tool calls (CHAT-D8-02).
//
// Edit/Write tool inputs arrive as pretty-printed JSON strings (see
// formatToolPayload/formatToolInputValue in chat-tool-events.ts): an Edit is
// `{"file_path": …, "old_string": …, "new_string": …}`. Rendering that JSON
// blob through SyntaxBlock buries the actual change. This module converts the
// payload into unified-diff-style text so the chat can render it with diff
// gutter chrome — the same way Claude Code shows every Edit as a before/after
// block.
//
// Deliberately NOT an LCS line differ: Edit old_string/new_string pairs are
// already minimal context by construction (the harness requires a unique
// match), so a full-block -/+ diff is faithful.

/** Tool names whose input mutates a file (case-insensitive exact match). */
const MUTATION_TOOLS = new Set(["edit", "write", "multiedit", "notebookedit"]);

/** Cap rendered diff output; beyond this we truncate with a marker. */
const MAX_DIFF_LINES = 400;

type Rec = Record<string, unknown>;

function str(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/** Best-effort file path from the well-known keys mutation tools use. */
function filePathOf(record: Rec): string {
  return str(record.file_path) ?? str(record.path) ?? str(record.notebook_path) ?? "file";
}

function prefixLines(text: string, prefix: "+" | "-"): string[] {
  // A trailing newline would otherwise render a spurious empty +/- row.
  if (text === "") return [];
  const body = text.endsWith("\n") ? text.slice(0, -1) : text;
  if (!body) return [`${prefix}`];
  return body.split("\n").map((line) => `${prefix}${line}`);
}

/** -old/+new hunk body for one edit pair. Empty old_string (file-creation
 *  style edits) yields an all-plus hunk. */
function editHunk(oldString: string, newString: string): string[] {
  return [
    ...(oldString ? prefixLines(oldString, "-") : []),
    ...(newString ? prefixLines(newString, "+") : []),
  ];
}

function isEditLike(record: Rec): record is Rec & { old_string: string; new_string: string } {
  return typeof record.old_string === "string" && typeof record.new_string === "string";
}

function capLines(lines: string[]): string {
  if (lines.length <= MAX_DIFF_LINES) return lines.join("\n");
  const hidden = lines.length - MAX_DIFF_LINES;
  return [...lines.slice(0, MAX_DIFF_LINES), `… (${hidden} more lines truncated)`].join("\n");
}

/**
 * Convert a file-mutation tool input payload into unified-diff-style text.
 *
 * Returns null for non-mutation tools, non-JSON input, or payload shapes we
 * don't recognise — callers fall back to their current raw rendering.
 */
export function toolInputAsDiff(name: string, input?: string | null): string | null {
  if (!MUTATION_TOOLS.has(name.toLowerCase())) return null;
  const raw = (input ?? "").trim();
  if (!raw) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const record = parsed as Rec;
  const file = filePathOf(record);

  // Edit-like: { old_string, new_string } → -old/+new with a/b headers.
  if (isEditLike(record)) {
    return capLines([
      `--- a/${file}`,
      `+++ b/${file}`,
      ...editHunk(record.old_string, record.new_string),
    ]);
  }

  // MultiEdit: { edits: [{ old_string, new_string }, …] } → one hunk per edit.
  if (Array.isArray(record.edits)) {
    const edits = record.edits.filter((e): e is Rec & { old_string: string; new_string: string } =>
      Boolean(e) && typeof e === "object" && isEditLike(e as Rec),
    );
    if (!edits.length) return null;
    const lines = [`--- a/${file}`, `+++ b/${file}`];
    edits.forEach((edit, i) => {
      lines.push(`@@ edit ${i + 1}/${edits.length} @@`);
      lines.push(...editHunk(edit.old_string, edit.new_string));
    });
    return capLines(lines);
  }

  // Write-like: { content } (or NotebookEdit's { new_source }) → all-plus.
  const content = str(record.content) ?? str(record.new_source);
  if (content !== undefined) {
    return capLines([`+++ b/${file}`, ...prefixLines(content, "+")]);
  }

  return null;
}

/** Tool names that operate on a single addressable file we can open in the
 *  editor preview (mutations plus the read tool). */
const FILE_TOOLS = new Set([...MUTATION_TOOLS, "read"]);

/**
 * Best-effort absolute file path a tool call targets, for click-to-open in the
 * Code workspace. Returns null for non-file tools, unparseable input, or when
 * no concrete path is present (so the caller renders a plain, non-clickable
 * label rather than a dead link).
 */
export function toolTargetFile(name: string, input?: string | null): string | null {
  if (!FILE_TOOLS.has(name.toLowerCase())) return null;
  const raw = (input ?? "").trim();
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const path = filePathOf(parsed as Rec);
  // filePathOf falls back to the literal "file" when no key matched; treat that
  // sentinel (and any non-absolute path) as "no openable target".
  return path !== "file" && path.startsWith("/") ? path : null;
}
