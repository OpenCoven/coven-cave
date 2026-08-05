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

import { resolvePathWithinProjectRoot } from "./cave-projects-types.ts";

/** Tool names whose input mutates a file (case-insensitive exact match). */
const MUTATION_TOOLS = new Set([
  "edit",
  "write",
  "multiedit",
  "notebookedit",
  "file_change",
  "apply_patch",
  "applypatch",
  "patch",
]);
const PATCH_TOOLS = new Set(["apply_patch", "applypatch", "patch"]);

/** Cap rendered diff output; beyond this we truncate with a marker. */
const MAX_DIFF_LINES = 400;

type Rec = Record<string, unknown>;

function str(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function validPath(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const path = value.trim();
  return path && !/[\0\r\n]/.test(path) ? path : null;
}

function parseRecord(input?: string | null): Rec | null {
  const raw = (input ?? "").trim();
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Rec : null;
  } catch {
    return null;
  }
}

/** Best-effort file path from repository adapter mutation schemas. */
function filePathOf(record: Rec): string | null {
  const direct =
    validPath(record.file_path) ??
    validPath(record.path) ??
    validPath(record.notebook_path);
  if (direct) return direct;
  if (!Array.isArray(record.changes)) return null;
  for (const change of record.changes) {
    if (!change || typeof change !== "object" || Array.isArray(change)) continue;
    const path = validPath((change as Rec).path);
    if (path) return path;
  }
  return null;
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

type EditPair = { oldText: string; newText: string };

function editPair(record: Rec): EditPair | null {
  const oldText = str(record.old_string) ?? str(record.old_str) ?? str(record.oldText);
  const newText = str(record.new_string) ?? str(record.new_str) ?? str(record.newText);
  return oldText !== undefined && newText !== undefined ? { oldText, newText } : null;
}

function patchTextOf(toolName: string, record: Rec): string | null {
  if (!PATCH_TOOLS.has(toolName)) return null;
  return str(record.input) ?? str(record.patch) ?? str(record.diff) ?? null;
}

function patchPathOf(patch: string | null): string | null {
  if (!patch) return null;
  for (const line of patch.split(/\r?\n/)) {
    const marker = line.trim().match(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/);
    const path = validPath(marker?.[1]);
    if (path) return path;
  }
  return null;
}

function capLines(lines: string[]): string {
  if (lines.length <= MAX_DIFF_LINES) return lines.join("\n");
  const hidden = lines.length - MAX_DIFF_LINES;
  return [...lines.slice(0, MAX_DIFF_LINES), `… (${hidden} more lines truncated)`].join("\n");
}

function mutationDiff(record: Rec, file: string, toolName: string): string | null {
  // Edit-like: { old_string, new_string } → -old/+new with a/b headers.
  const pair = editPair(record);
  if (pair) {
    if (pair.oldText === pair.newText) return null;
    return capLines([
      `--- a/${file}`,
      `+++ b/${file}`,
      ...editHunk(pair.oldText, pair.newText),
    ]);
  }

  // MultiEdit/OpenClaw edit: snake_case or camelCase edit pairs.
  if (Array.isArray(record.edits)) {
    const edits = record.edits.flatMap((edit) => {
      if (!edit || typeof edit !== "object" || Array.isArray(edit)) return [];
      const normalized = editPair(edit as Rec);
      return normalized && normalized.oldText !== normalized.newText ? [normalized] : [];
    });
    if (!edits.length) return null;
    const lines = [`--- a/${file}`, `+++ b/${file}`];
    edits.forEach((edit, i) => {
      lines.push(`@@ edit ${i + 1}/${edits.length} @@`);
      lines.push(...editHunk(edit.oldText, edit.newText));
    });
    return capLines(lines);
  }

  // Write-like: { content } (or NotebookEdit's { new_source }) → all-plus.
  const content = str(record.content) ?? str(record.new_source);
  if (content !== undefined) {
    return capLines([`+++ b/${file}`, ...prefixLines(content, "+")]);
  }

  const patch = patchTextOf(toolName, record);
  if (patch?.trim()) return capLines(patch.split("\n"));

  return null;
}

export type FileMutationDescriptor = {
  /** Stable exact-name classification; present even while input is partial. */
  name: string;
  /** Displayable path, including relative paths. */
  path: string | null;
  /** Absolute path suitable for the Code workspace and aggregate review. */
  targetFile: string | null;
  /** Structured diff only when the payload contains actual before/after data. */
  diff: string | null;
};

/**
 * Normalize every supported repository adapter mutation shape once.
 *
 * A recognized name always returns a descriptor, even when streamed JSON is
 * partial. Consumers can therefore choose a stable slot from first appearance
 * without pretending that path-only metadata is reviewable.
 */
export function normalizeFileMutation(
  name: string,
  input?: string | null,
): FileMutationDescriptor | null {
  const normalizedName = name.trim().toLowerCase();
  if (!MUTATION_TOOLS.has(normalizedName)) return null;
  const record = parseRecord(input);
  const patch = record ? patchTextOf(normalizedName, record) : null;
  const path = record ? filePathOf(record) ?? patchPathOf(patch) : null;
  const raw = (input ?? "").trim();
  const diff = record
    ? mutationDiff(record, path ?? "file", normalizedName)
    : PATCH_TOOLS.has(normalizedName) && raw && !raw.startsWith("{")
      ? capLines(raw.split("\n"))
      : null;
  return {
    name: normalizedName,
    path,
    targetFile: path?.startsWith("/") ? path : null,
    diff,
  };
}

/** Stable mutation classification available before a streamed input parses. */
export function isFileMutationTool(name: string): boolean {
  return normalizeFileMutation(name) !== null;
}

/** Review/Undo readiness shared by per-card and aggregate actions. */
export function isFileMutationActionReady(
  mutation: FileMutationDescriptor,
  status: "running" | "ok" | "error",
): mutation is FileMutationDescriptor & { path: string; diff: string } {
  return status === "ok" && mutation.path !== null && mutation.diff !== null;
}

/** Absolute review target only when the mutation is successful and complete. */
export function actionReadyMutationTargetFile(
  name: string,
  input: string | null | undefined,
  status: "running" | "ok" | "error",
  projectRoot: string | null | undefined,
): string | null {
  const mutation = normalizeFileMutation(name, input);
  if (!mutation || !isFileMutationActionReady(mutation, status)) return null;
  return resolvePathWithinProjectRoot(projectRoot, mutation.path)?.absolutePath ?? null;
}

/** Convert a recognized file mutation into unified-diff-style text. */
export function toolInputAsDiff(name: string, input?: string | null): string | null {
  return normalizeFileMutation(name, input)?.diff ?? null;
}

/**
 * Best-effort file path a tool call targets, for transcript display. Relative
 * paths are still useful here because mutation diffs should remain visible in
 * chat even when the Code workspace cannot open the file directly.
 */
export function toolTargetPath(name: string, input?: string | null): string | null {
  const mutation = normalizeFileMutation(name, input);
  if (mutation) return mutation.path;
  if (name.trim().toLowerCase() !== "read") return null;
  const record = parseRecord(input);
  return record ? filePathOf(record) : null;
}

/**
 * Best-effort absolute file path a tool call targets, for click-to-open in the
 * Code workspace. Returns null for non-file tools, unparseable input, or when
 * no concrete absolute path is present (so callers render a plain, non-clickable
 * label rather than a dead link).
 */
export function toolTargetFile(name: string, input?: string | null): string | null {
  const path = toolTargetPath(name, input);
  return path && path.startsWith("/") ? path : null;
}
