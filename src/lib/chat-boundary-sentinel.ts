// Boundary sentinel — seamless enforcement for the runtime filesystem
// boundary (see buildRuntimeScopePreamble in chat-runtime-scope.ts).
//
// The boundary preamble is advisory: the harness child process can still
// touch any path the OS lets it. Killing the stream or throwing a modal
// permission prompt at every tool call would enforce it, but at the cost of
// interrupting the conversation. This module takes the observe → surface →
// steer path instead:
//
//   1. OBSERVE — as tool events stream out of the harness, extract the
//      filesystem paths they touch and classify them against the granted
//      roots. Detection is deliberately scoped to USER-SPACE paths (inside
//      the home directory): system paths (/usr/bin, /etc, …) are routine
//      shell traffic, and `resolveLocalRuntimeCwd` already pins runtime cwds
//      inside home — so home is exactly where an out-of-boundary excursion
//      into another project's data can happen.
//   2. SURFACE — the send route emits one non-blocking progress notice per
//      turn listing the out-of-boundary paths. The stream, and the chat,
//      keep flowing.
//   3. STEER — violations are recorded per conversation; the NEXT turn's
//      harness prompt carries a corrective reminder so the model
//      self-corrects instead of drifting further out of scope.
//
// All classification is pure and allocation-light: it runs on the hot
// stream-parse path.

import { homedir, tmpdir } from "node:os";
import path from "node:path";

export type BoundaryViolation = {
  tool: string;
  path: string;
};

export type BoundarySentinel = {
  /** Feed one tool call (envelope input value or raw hook payload text). */
  observe(tool: string, input: unknown): void;
  /** Distinct out-of-boundary paths seen so far this turn (capped). */
  violations(): BoundaryViolation[];
};

type SentinelOptions = {
  /** Roots the session may touch: runtime cwd, granted project roots, and
   *  the familiar workspace (memory/identity writes are always in-scope). */
  allowedRoots: string[];
  homeDir?: string;
  tmpDir?: string;
};

/** Cap per turn — enough to show the pattern without flooding the notice. */
const MAX_VIOLATIONS = 8;

/** Absolute-path tokens inside command strings / serialized payloads.
 *  Accepts `~/…` (expanded against home) and `/…`; stops at whitespace,
 *  quotes, and shell metacharacters. */
const PATH_TOKEN_RE = /(?:^|[\s"'`=(:,[{])(~\/[^\s"'`;|&<>)\]}]+|\/[^\s"'`;|&<>)\]}]+)/g;

/** Input keys that carry a single filesystem path verbatim. */
const PATH_KEY_RE = /^(?:file_?path|path|notebook_?path|target_?file|cwd|directory|dir|filename)$/i;

/** Free-text payload keys — file bodies, edit strings, prose. Paths that
 *  merely appear inside written CONTENT are mentions, not touches; scanning
 *  them would flag a familiar for writing documentation about other
 *  projects. */
const CONTENT_KEY_RE = /^(?:content|file_?text|new_?str(?:ing)?|old_?str(?:ing)?|text|body|description|prompt|message|data|patch|diff|input)$/i;

function normalizeRoot(p: string): string {
  const resolved = path.resolve(p.trim());
  const stripped = resolved.replace(/[\\/]+$/, "");
  return stripped || resolved;
}

function isInside(root: string, candidate: string): boolean {
  const rel = path.relative(root, candidate);
  return (
    rel === "" ||
    (rel !== ".." &&
      !rel.startsWith(".." + path.sep) &&
      !path.isAbsolute(rel) &&
      !rel.split(path.sep).includes(".."))
  );
}

/** Trim trailing punctuation that regularly rides along in prose or JSON
 *  fragments ("… /Users/x/file." / "/Users/x/file",). */
function trimPathToken(token: string): string {
  return token.replace(/[.,]+$/, "");
}

export function createBoundarySentinel(options: SentinelOptions): BoundarySentinel {
  const home = normalizeRoot(options.homeDir ?? homedir());
  const tmp = normalizeRoot(options.tmpDir ?? tmpdir());
  const allowed = options.allowedRoots
    .map((root) => root?.trim())
    .filter((root): root is string => Boolean(root))
    .map(normalizeRoot);

  const seen = new Set<string>();
  const found: BoundaryViolation[] = [];

  const classify = (tool: string, rawPath: string) => {
    if (found.length >= MAX_VIOLATIONS) return;
    const expanded = rawPath.startsWith("~/") ? path.join(home, rawPath.slice(2)) : rawPath;
    if (!path.isAbsolute(expanded)) return;
    const candidate = normalizeRoot(trimPathToken(expanded));
    // Bare "/" and single-segment roots ("/usr") are never user data.
    if (candidate.split(path.sep).filter(Boolean).length < 2) return;
    // Only user-space paths count — system paths are routine shell traffic.
    if (!isInside(home, candidate)) return;
    // Temp scratch is always fine (image attachments ride through tmpdir).
    if (isInside(tmp, candidate)) return;
    for (const root of allowed) {
      if (isInside(root, candidate)) return;
      // A granted root's own parent chain (e.g. `ls` of the containing
      // directory) is navigation, not an excursion into foreign data.
      if (isInside(candidate, root)) return;
    }
    if (seen.has(candidate)) return;
    seen.add(candidate);
    found.push({ tool, path: candidate });
  };

  const extractFromText = (tool: string, text: string) => {
    PATH_TOKEN_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = PATH_TOKEN_RE.exec(text)) !== null) {
      classify(tool, match[1]);
      if (found.length >= MAX_VIOLATIONS) return;
    }
  };

  const walk = (tool: string, value: unknown, depth: number) => {
    if (found.length >= MAX_VIOLATIONS || depth > 4 || value == null) return;
    if (typeof value === "string") {
      // Top-level string payloads (hook lines) are usually serialized JSON —
      // parse them so content-key filtering applies; only fall back to raw
      // token extraction for genuinely unstructured text.
      if (depth === 0) {
        try {
          const parsed = JSON.parse(value) as unknown;
          if (parsed && typeof parsed === "object") {
            walk(tool, parsed, depth + 1);
            return;
          }
        } catch {
          /* not JSON — scan as text below */
        }
      }
      extractFromText(tool, value);
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) walk(tool, item, depth + 1);
      return;
    }
    if (typeof value === "object") {
      for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
        if (typeof item === "string" && PATH_KEY_RE.test(key)) {
          classify(tool, item.trim());
        } else if (typeof item === "string" && CONTENT_KEY_RE.test(key)) {
          continue; // mentions inside written content are not touches
        } else {
          walk(tool, item, depth + 1);
        }
      }
    }
  };

  return {
    observe(tool: string, input: unknown) {
      try {
        walk(tool, input, 0);
      } catch {
        /* classification must never break the stream */
      }
    },
    violations() {
      return [...found];
    },
  };
}

/** One-line summary for the non-blocking progress notice. */
export function formatBoundaryNotice(violations: BoundaryViolation[]): string {
  return violations.map((v) => `${v.path} (${v.tool})`).join("\n");
}

// ---------------------------------------------------------------------------
// Next-turn steering — per-conversation reminder registry.
//
// In-memory and best-effort by design: the reminder is a soft corrective
// nudge, not the enforcement record (the progress notice is what the user
// sees). Entries expire so a stale server process never lectures a fresh
// conversation about last week's turn.

const REMINDER_TTL_MS = 6 * 60 * 60 * 1000;
const pendingReminders = new Map<string, { paths: string[]; at: number }>();

export function recordBoundaryViolations(
  sessionId: string,
  violations: BoundaryViolation[],
): void {
  if (!sessionId || violations.length === 0) return;
  const paths = [...new Set(violations.map((v) => v.path))].slice(0, MAX_VIOLATIONS);
  pendingReminders.set(sessionId, { paths, at: Date.now() });
}

/** Consume (and clear) the pending reminder for a conversation, if fresh. */
export function takeBoundaryReminder(sessionId: string | null | undefined): string[] | null {
  if (!sessionId) return null;
  const entry = pendingReminders.get(sessionId);
  if (!entry) return null;
  pendingReminders.delete(sessionId);
  if (Date.now() - entry.at > REMINDER_TTL_MS) return null;
  return entry.paths;
}

/** Append the corrective boundary reminder to an already-built harness
 *  prompt when the conversation's previous turn went out of bounds. */
export function buildPromptWithBoundaryReminder(
  prompt: string,
  sessionId: string | null | undefined,
): string {
  const paths = takeBoundaryReminder(sessionId);
  if (!paths || paths.length === 0) return prompt;
  const block = [
    "Boundary reminder (from your previous turn):",
    "- The previous turn touched paths outside this session's granted roots:",
    ...paths.map((p) => `  - ${p}`),
    "- Stay inside the runtime filesystem boundary listed above. If completing the task genuinely requires those paths, say so and ask the user to grant that project root instead of accessing it directly.",
  ].join("\n");
  return `${prompt}\n\n${block}`;
}

/** Test hook: clear the module-level reminder registry. */
export function __resetBoundaryRemindersForTest(): void {
  pendingReminders.clear();
}
