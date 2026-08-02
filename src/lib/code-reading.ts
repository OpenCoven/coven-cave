/**
 * Pure model for the code reading experience (cave-f6mu9) — the path a code
 * block travels from a chat message into the workshop and back.
 *
 * Three questions this module answers, none of which need a DOM:
 *  1. **Where did this block come from?** `deriveProvenance` reads the fence
 *     info the model emitted. A block that names a file is *file-backed* and
 *     can be compared against disk; a diff/patch is *generated* and can be
 *     applied; a bare fence is *quoted* and opens nothing — the distinction is
 *     what keeps "Open" from being a promise the click cannot keep.
 *  2. **Is it still true?** `staleness` compares the snippet against the file
 *     on disk. A snippet the model wrote three turns ago may no longer match
 *     the working tree, and reading it as if it did is the failure this whole
 *     surface exists to prevent.
 *  3. **How should it be shown?** `resolveInspectorMode` turns the reader's
 *     auto/split/overlay preference plus the viewport into a concrete layout.
 *
 * Kept JSX-free and side-effect-free so all of it is unit-testable without a
 * browser (repo convention: behavioral tests for pure logic, source pins for
 * the wiring that consumes it).
 */

import { parseFenceInfo } from "./message-code-fences.ts";

// ── Provenance ───────────────────────────────────────────────────────────────

/**
 * Where a chat code block came from, which decides what may be done with it.
 *
 * - `file-backed` — the fence named a path (```ts:src/lib/foo.ts). Can be
 *   opened in the workshop, compared against the working tree, and referenced
 *   by line.
 * - `generated` — a unified diff/patch. Has no single "current" file to open,
 *   but *can* be applied to the worktree.
 * - `quoted` — a bare fence with no path. Illustrative only: copyable, never
 *   openable. Nothing on disk is claimed to correspond to it.
 */
export const CODE_PROVENANCES = ["file-backed", "generated", "quoted"] as const;
export type CodeProvenance = (typeof CODE_PROVENANCES)[number];

export function isCodeProvenance(value: string | null | undefined): value is CodeProvenance {
  return (CODE_PROVENANCES as readonly string[]).includes(value ?? "");
}

/** Human label for the provenance pill in the code block header. */
export function provenanceLabel(provenance: CodeProvenance): string {
  switch (provenance) {
    case "file-backed":
      return "file";
    case "generated":
      return "patch";
    default:
      return "quoted";
  }
}

/**
 * Long-form title for the provenance pill. States the *consequence* rather
 * than restating the label — the pill's job is to tell the reader what this
 * block can do, not to name a taxonomy.
 */
export function provenanceTitle(provenance: CodeProvenance): string {
  switch (provenance) {
    case "file-backed":
      return "Backed by a file in the worktree — can be opened and compared";
    case "generated":
      return "A generated patch — can be applied to the worktree, not opened";
    default:
      return "Quoted for illustration — not backed by a file on disk";
  }
}

/** A block is openable in the workshop only when it names a real path. */
export function canOpenInWorkshop(provenance: CodeProvenance): boolean {
  return provenance === "file-backed";
}

/** Only a generated patch can be applied. */
export function canApplyPatch(provenance: CodeProvenance): boolean {
  return provenance === "generated";
}

/** Only a file-backed block has a working-tree counterpart to compare against. */
export function canCompare(provenance: CodeProvenance): boolean {
  return provenance === "file-backed";
}

// ── Deriving a reading block from a rendered fence ───────────────────────────

export type ReadingBlock = {
  /** Fence language as written (`ts`, `diff`, `rust`…). */
  lang: string;
  /** Repo-relative path when the fence named one, else null. */
  path: string | null;
  /** Basename of `path` for the header, else null. */
  name: string | null;
  /** Directory portion of `path` (no trailing slash), else null. */
  dir: string | null;
  provenance: CodeProvenance;
  /** True when the block is a unified diff. */
  isDiff: boolean;
};

function splitPath(path: string): { name: string; dir: string } {
  const clean = path.replace(/\/+$/, "");
  const idx = clean.lastIndexOf("/");
  return idx >= 0
    ? { name: clean.slice(idx + 1), dir: clean.slice(0, idx) }
    : { name: clean, dir: "" };
}

/**
 * Classify a fence into a reading block.
 *
 * A `diff`/`patch` fence is generated whether or not it names a file: the
 * body is a patch, so there is nothing to *open* even when the header says
 * which file it targets. The named path is still carried so the inspector can
 * label the patch and the apply action knows its target.
 */
export function deriveReadingBlock(info: string): ReadingBlock {
  const { lang, filename } = parseFenceInfo(info);
  const normalized = lang.toLowerCase();
  const isDiff = normalized === "diff" || normalized === "patch";
  const path = filename && filename.length > 0 ? filename : null;
  const provenance: CodeProvenance = isDiff ? "generated" : path ? "file-backed" : "quoted";
  const parts = path ? splitPath(path) : null;
  return {
    lang,
    path,
    name: parts ? parts.name : null,
    dir: parts && parts.dir ? parts.dir : null,
    provenance,
    isDiff,
  };
}

// ── Staleness ────────────────────────────────────────────────────────────────

/**
 * Whether a snippet still matches the file it claims to come from.
 *
 * - `fresh` — the snippet appears verbatim in the working-tree file.
 * - `stale` — the file exists but no longer contains the snippet.
 * - `missing` — the file is gone (or was never readable).
 * - `unknown` — not checked yet, or the block is not file-backed.
 *
 * Comparison is whitespace-tolerant at the line ends only: trailing spaces and
 * CRLF differences are not a semantic drift, but indentation is, so leading
 * whitespace is preserved. A snippet that is a *contiguous run of lines* from
 * the file counts as fresh — models routinely quote an excerpt, and demanding
 * a whole-file match would mark every honest excerpt stale.
 */
export const STALENESS_STATES = ["fresh", "stale", "missing", "unknown"] as const;
export type Staleness = (typeof STALENESS_STATES)[number];

function normalizeLines(text: string): string[] {
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/, ""));
}

/** Drop leading/trailing blank lines so an excerpt's padding never decides freshness. */
function trimBlankEdges(lines: string[]): string[] {
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start].trim() === "") start += 1;
  while (end > start && lines[end - 1].trim() === "") end -= 1;
  return lines.slice(start, end);
}

/**
 * The outcome of trying to read the working-tree file.
 *
 * `absent` and `unreadable` are deliberately different: "this file is gone" is
 * a claim about the repository, while "I could not read it" is a claim about
 * *us*. Collapsing them would let a permission denial or an offline daemon
 * render as a confident "gone" badge — the exact species of false certainty
 * this surface exists to remove.
 */
export type WorkingTreeRead =
  | { kind: "text"; content: string }
  | { kind: "absent" }
  | { kind: "unreadable" };

/** Staleness for a read outcome. An unreadable file yields `unknown`, not `missing`. */
export function stalenessForRead(snippet: string, read: WorkingTreeRead): Staleness {
  if (read.kind === "unreadable") return "unknown";
  if (read.kind === "absent") return "missing";
  return staleness(snippet, read.content);
}

export function staleness(snippet: string, diskContent: string | null | undefined): Staleness {
  if (diskContent === null || diskContent === undefined) return "missing";
  const needle = trimBlankEdges(normalizeLines(snippet));
  if (needle.length === 0) return "unknown";
  const hay = normalizeLines(diskContent);
  if (hay.length < needle.length) return "stale";
  for (let i = 0; i + needle.length <= hay.length; i += 1) {
    let match = true;
    for (let j = 0; j < needle.length; j += 1) {
      if (hay[i + j] !== needle[j]) {
        match = false;
        break;
      }
    }
    if (match) return "fresh";
  }
  return "stale";
}

/**
 * 1-based line where the snippet starts in the file, or null when it does not
 * appear. Lets the inspector show "Working tree" scrolled to the right place
 * and lets "Open in workshop" carry a real line number instead of guessing.
 */
export function snippetStartLine(snippet: string, diskContent: string | null | undefined): number | null {
  if (!diskContent) return null;
  const needle = trimBlankEdges(normalizeLines(snippet));
  if (needle.length === 0) return null;
  const hay = normalizeLines(diskContent);
  for (let i = 0; i + needle.length <= hay.length; i += 1) {
    let match = true;
    for (let j = 0; j < needle.length; j += 1) {
      if (hay[i + j] !== needle[j]) {
        match = false;
        break;
      }
    }
    if (match) return i + 1;
  }
  return null;
}

/** Short label for the staleness marker; null when there is nothing to say. */
export function stalenessLabel(state: Staleness): string | null {
  switch (state) {
    case "stale":
      return "stale";
    case "missing":
      return "gone";
    default:
      return null;
  }
}

export function stalenessTitle(state: Staleness): string | null {
  switch (state) {
    case "stale":
      return "The working tree no longer contains these lines — compare before you rely on them";
    case "missing":
      return "This file is not in the working tree any more";
    default:
      return null;
  }
}

// ── Inspector layout ─────────────────────────────────────────────────────────

/** The reader's stored preference for how the inspector opens. */
export const INSPECTOR_PINS = ["auto", "split", "overlay"] as const;
export type InspectorPin = (typeof INSPECTOR_PINS)[number];

export function isInspectorPin(value: string | null | undefined): value is InspectorPin {
  return (INSPECTOR_PINS as readonly string[]).includes(value ?? "");
}

/** The layout actually used for a given render. */
export const INSPECTOR_MODES = ["split", "overlay", "modal"] as const;
export type InspectorMode = (typeof INSPECTOR_MODES)[number];

/**
 * Width below which a split inspector would leave the conversation unreadable.
 * The inspector's own minimum is 360px and a chat column narrower than ~420px
 * stops holding a line of prose, so below their sum a split is never right —
 * `auto` drops to an overlay, and an explicit `split` pin is overridden rather
 * than honored into an unusable layout.
 */
export const SPLIT_MIN_VIEWPORT = 880;

/** Below this the overlay has no room to sit beside anything: go full modal. */
export const MODAL_MAX_VIEWPORT = 620;

/**
 * Resolve the concrete layout. The preference is a preference, not a promise:
 * a viewport too narrow to hold a split gets an overlay regardless of the pin,
 * because honoring the pin would produce two unreadable columns instead of one
 * readable panel.
 */
export function resolveInspectorMode(pin: InspectorPin, viewportWidth: number): InspectorMode {
  if (viewportWidth <= MODAL_MAX_VIEWPORT) return "modal";
  if (pin === "overlay") return "overlay";
  if (viewportWidth < SPLIT_MIN_VIEWPORT) return "overlay";
  return "split";
}

// ── Inspector tabs ───────────────────────────────────────────────────────────

export type InspectorTabId = "snippet" | "file" | "compare";

export type InspectorTab = { id: InspectorTabId; label: string };

/**
 * Tabs for a block, in reading order. The vocabulary shifts with provenance so
 * the labels never lie: a patch's first tab is the patch itself and its second
 * is the file it targets, whereas a file-backed snippet reads snippet → tree →
 * diff. A quoted block has one tab, because there is nothing to compare it to.
 */
export function inspectorTabs(provenance: CodeProvenance): InspectorTab[] {
  if (provenance === "generated") {
    return [
      { id: "snippet", label: "Patch" },
      { id: "file", label: "Target file" },
    ];
  }
  if (provenance === "quoted") {
    return [{ id: "snippet", label: "Snippet" }];
  }
  return [
    { id: "snippet", label: "Snippet" },
    { id: "file", label: "Working tree" },
    { id: "compare", label: "Compare" },
  ];
}

/** Clamp a requested tab to one the block actually has. */
export function normalizeInspectorTab(
  requested: string | null | undefined,
  provenance: CodeProvenance,
): InspectorTabId {
  const tabs = inspectorTabs(provenance);
  const hit = tabs.find((tab) => tab.id === requested);
  return hit ? hit.id : tabs[0].id;
}

// ── Line selection ───────────────────────────────────────────────────────────

export type LineSelection = { from: number; to: number };

/**
 * Fold a line click into the current selection. A plain click starts a new
 * one-line selection; shift-click extends the existing selection to cover the
 * clicked line (in either direction), matching every code host's behavior.
 */
export function extendSelection(
  current: LineSelection | null,
  line: number,
  shiftKey: boolean,
): LineSelection {
  if (!shiftKey || !current) return { from: line, to: line };
  return { from: Math.min(current.from, line), to: Math.max(current.to, line) };
}

/** True when a 1-based line falls inside the selection. */
export function isLineSelected(selection: LineSelection | null, line: number): boolean {
  if (!selection) return false;
  return line >= selection.from && line <= selection.to;
}

/** "line 14" / "lines 14–19" (en dash, matching the design). */
export function selectionLabel(selection: LineSelection | null): string | null {
  if (!selection) return null;
  return selection.from === selection.to
    ? `line ${selection.from}`
    : `lines ${selection.from}–${selection.to}`;
}

/** The selected lines' text, or the whole snippet when nothing is selected. */
export function selectedText(snippet: string, selection: LineSelection | null): string {
  const lines = snippet.replace(/\r\n?/g, "\n").split("\n");
  if (!selection) return lines.join("\n");
  const from = Math.max(1, selection.from);
  const to = Math.min(lines.length, selection.to);
  if (to < from) return "";
  return lines.slice(from - 1, to).join("\n");
}

/**
 * Label for the chip dropped into the composer: `oauth-loopback.ts:14-19`.
 * Uses a plain hyphen (not the display en dash) because this string is meant
 * to be typed, searched and pasted back — a en dash in a path fragment does
 * not round-trip through a shell or a grep.
 */
export function referenceChipLabel(
  block: Pick<ReadingBlock, "name" | "path">,
  selection: LineSelection | null,
): string {
  const base = block.name ?? block.path ?? "snippet";
  if (!selection) return base;
  return selection.from === selection.to
    ? `${base}:${selection.from}`
    : `${base}:${selection.from}-${selection.to}`;
}

/**
 * The blockquote a "Quote" action inserts into the composer. Fenced with the
 * block's own language and prefixed with the path + range so the quoted lines
 * stay attributable after they leave the inspector.
 */
export function quotedSnippet(
  block: Pick<ReadingBlock, "name" | "path" | "lang">,
  snippet: string,
  selection: LineSelection | null,
): string {
  const body = selectedText(snippet, selection);
  const where = selectionLabel(selection);
  const path = block.path ?? block.name;
  const header = path ? (where ? `${path} · ${where}` : path) : where;
  const fence = block.lang || "text";
  return header ? `> ${header}\n\n\`\`\`${fence}\n${body}\n\`\`\`\n` : `\`\`\`${fence}\n${body}\n\`\`\`\n`;
}
