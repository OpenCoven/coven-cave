/**
 * GitHub chat blocks — the `<coven:github …>` marker protocol plus bare-line
 * URL unfurl that turn GitHub references in chat turns into inline cards
 * (design: docs/chat-github-integration.md §1).
 *
 * Piggyback model, like next-paths: agents (or the app) embed self-closing
 * markers in the turn text; the transcript strips them at render and mounts a
 * card at the marker's position. A github.com issue/PR/commit/run URL standing
 * alone on its own line unfurls into the same descriptor — one card family,
 * two producers.
 *
 * Pure and JSX-free so node --test can exercise it directly; the React card
 * lives in src/components/github-card.tsx.
 */

export type GitHubBlockKind = "pr" | "issue" | "review-thread" | "commit" | "run";

export type GitHubBlockDescriptor = {
  kind: GitHubBlockKind;
  /** owner/name — validated against REPO_RE before use. */
  repo: string;
  /** Issue/PR number (pr, issue, review-thread). */
  number?: number;
  /** Commit sha (commit). */
  sha?: string;
  /** Actions run id (run). */
  runId?: number;
  /** Review thread discussion id (review-thread). */
  threadId?: string;
  /** Optional display fallback carried on the marker (renders before hydration). */
  title?: string;
};

/** One ordered piece of a text span after GitHub extraction. */
export type GitHubTextPiece =
  | { kind: "text"; text: string }
  | { kind: "card"; descriptor: GitHubBlockDescriptor }
  | { kind: "action"; action: GitHubActionDescriptor };

/** Write-action kinds (design §3) — tier classification is pinned by tests. */
export type GitHubActionKind =
  | "comment"
  | "reply"
  | "resolve"
  | "unresolve"
  | "issue-create"
  | "issue-state"
  | "review"
  | "merge"
  | "rerun"
  | "dispatch";

/**
 * Tiered confirmation (user gestures on cards only — agent-initiated actions
 * ALWAYS render proposal cards regardless of tier; that rule lives with the
 * proposal card, not here).
 */
export function classifyGitHubAction(kind: GitHubActionKind): "fire" | "confirm" {
  switch (kind) {
    case "merge":
    case "review":
    case "rerun":
    case "dispatch":
      return "confirm";
    default:
      return "fire";
  }
}

/** An agent-proposed GitHub write, parsed from `<coven:github-action …>`
 *  (design §3). Rendered as a proposal card that ALWAYS requires a user tap —
 *  agents propose, humans dispose — regardless of the kind's tier. */
export type GitHubActionDescriptor = {
  kind: GitHubActionKind;
  repo: string;
  /** Target issue/PR (comment, reply, resolve, issue-state, review, merge). */
  number?: number;
  /** Merge method; defaults to squash at fire time. */
  method?: "squash" | "merge" | "rebase";
  /** Review verdict (review). */
  event?: "APPROVE" | "REQUEST_CHANGES" | "COMMENT";
  /** Explicit issue state (issue-state) — required so the proposal card can
   *  say exactly which direction fires (review finding, cave-jqke). */
  state?: "open" | "closed";
  /** Target review-comment databaseId (resolve/unresolve) — the same id
   *  `#discussion_r<id>` URLs carry; without it the card refuses to fire
   *  rather than picking an arbitrary thread (review finding, cave-jqke). */
  threadId?: string;
  /** Comment/review/issue body text. */
  body?: string;
  /** Issue title (issue-create). */
  title?: string;
  /** Workflow run id (rerun). */
  runId?: number;
  /** Workflow file/id + ref (dispatch). */
  workflow?: string;
  ref?: string;
  /** Agent's one-line rationale, shown on the proposal card. */
  note?: string;
};

const ACTION_KINDS: ReadonlySet<string> = new Set([
  "comment",
  "reply",
  "resolve",
  "unresolve",
  "issue-create",
  "issue-state",
  "review",
  "merge",
  "rerun",
  "dispatch",
]);

/** Parse + validate an action marker's attributes; null when the proposal is
 *  malformed or missing its kind's required target. */
function actionFromAttrs(attrs: Record<string, string>): GitHubActionDescriptor | null {
  const kind = attrs.kind;
  const repo = attrs.repo ?? "";
  if (!kind || !ACTION_KINDS.has(kind) || !REPO_RE.test(repo)) return null;
  const number = positiveInt(attrs.number);
  const note = attrs.note?.trim() || undefined;
  const body = attrs.body?.trim() || undefined;
  const base = { repo, note, body };
  switch (kind as GitHubActionKind) {
    case "comment":
    case "reply":
      return number ? { kind: kind as GitHubActionKind, ...base, number } : null;
    case "resolve":
    case "unresolve": {
      if (!number) return null;
      const threadRaw = attrs.thread?.trim();
      const threadId = threadRaw && /^\d+$/.test(threadRaw) ? threadRaw : undefined;
      return { kind: kind as GitHubActionKind, ...base, number, threadId };
    }
    case "issue-state": {
      if (!number) return null;
      // Direction must be explicit — a proposal that doesn't say which way it
      // flips the issue is malformed, not "default to close".
      const state = attrs.state === "open" ? "open" : attrs.state === "closed" ? "closed" : null;
      return state ? { kind: "issue-state", ...base, number, state } : null;
    }
    case "issue-create": {
      const title = attrs.title?.trim();
      return title ? { kind: "issue-create", ...base, title } : null;
    }
    case "review": {
      if (!number) return null;
      const event = attrs.event?.toUpperCase();
      if (event !== "APPROVE" && event !== "REQUEST_CHANGES" && event !== "COMMENT") return null;
      return { kind: "review", ...base, number, event };
    }
    case "merge": {
      if (!number) return null;
      const method = attrs.method;
      return {
        kind: "merge",
        ...base,
        number,
        method: method === "merge" || method === "rebase" ? method : "squash",
      };
    }
    case "rerun": {
      const runId = positiveInt(attrs.run);
      return runId ? { kind: "rerun", ...base, runId } : null;
    }
    case "dispatch": {
      const workflow = attrs.workflow?.trim();
      const ref = attrs.ref?.trim();
      return workflow && ref ? { kind: "dispatch", ...base, workflow, ref } : null;
    }
  }
}

// owner/name — same barrier as /api/github/item; safe to interpolate into URLs.
const REPO_RE = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?\/[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/;

const KINDS: ReadonlySet<string> = new Set(["pr", "issue", "review-thread", "commit", "run"]);

// A complete display marker: `<coven:github kind="pr" repo="o/r" number="7" />`
// (self-closing slash optional). Attribute order is free; values are
// double-quoted, and the attributes segment treats quoted strings as atomic so
// a `>` inside a quoted title can't terminate the match early. Action markers
// (`<coven:github-action …>`) are recognized so they never render as raw
// text, but W1a mounts no card for them (W2b does).
const MARKER_RE = /<coven:github(-action)?\b((?:[^">]|"[^"]*")*?)\/?>/g;

const ATTR_RE = /([a-zA-Z-]+)="([^"]*)"/g;

function parseAttrs(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  let m: RegExpExecArray | null;
  ATTR_RE.lastIndex = 0;
  while ((m = ATTR_RE.exec(raw)) !== null) out[m[1]] = m[2];
  return out;
}

function positiveInt(raw: string | undefined): number | undefined {
  if (!raw || !/^\d+$/.test(raw)) return undefined;
  const n = Number.parseInt(raw, 10);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

/** Descriptor from a display marker's attributes; null when malformed. */
function descriptorFromAttrs(attrs: Record<string, string>): GitHubBlockDescriptor | null {
  const kind = attrs.kind;
  const repo = attrs.repo ?? "";
  if (!kind || !KINDS.has(kind) || !REPO_RE.test(repo)) return null;
  const number = positiveInt(attrs.number);
  const title = attrs.title?.trim() || undefined;
  switch (kind as GitHubBlockKind) {
    case "pr":
    case "issue":
      return number ? { kind: kind as GitHubBlockKind, repo, number, title } : null;
    case "review-thread": {
      if (!number) return null;
      const threadRaw = attrs.thread?.trim();
      // thread must be numeric like parseGitHubUrl's #discussion_r capture —
      // anything else would mint an invalid URL, so drop the attr, keep the PR.
      const threadId = threadRaw && /^\d+$/.test(threadRaw) ? threadRaw : undefined;
      return { kind: "review-thread", repo, number, threadId, title };
    }
    case "commit": {
      const sha = attrs.sha?.trim();
      return sha && /^[0-9a-f]{7,40}$/i.test(sha) ? { kind: "commit", repo, sha, title } : null;
    }
    case "run": {
      const runId = positiveInt(attrs.run);
      return runId ? { kind: "run", repo, runId, title } : null;
    }
  }
}

/** Canonical github.com URL for a descriptor. */
export function descriptorUrl(d: GitHubBlockDescriptor): string {
  const base = `https://github.com/${d.repo}`;
  switch (d.kind) {
    case "pr":
      return `${base}/pull/${d.number}`;
    case "issue":
      return `${base}/issues/${d.number}`;
    case "review-thread":
      return d.threadId ? `${base}/pull/${d.number}#discussion_r${d.threadId}` : `${base}/pull/${d.number}`;
    case "commit":
      return `${base}/commit/${d.sha}`;
    case "run":
      return `${base}/actions/runs/${d.runId}`;
  }
}

// github.com URL → descriptor. Anchored: the whole string must be the URL
// (callers pass a trimmed candidate line or link target).
const URL_RE =
  /^https:\/\/github\.com\/([A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?\/[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?)\/(pull|issues|commit|actions\/runs)\/([0-9a-fA-F]+)(#discussion_r(\d+))?\/?$/;

/** Parse a github.com issue/PR/commit/run URL into a descriptor, else null. */
export function parseGitHubUrl(url: string): GitHubBlockDescriptor | null {
  const m = URL_RE.exec(url.trim());
  if (!m) return null;
  const [, repo, path, ref, , thread] = m;
  if (path === "pull") {
    const number = positiveInt(ref);
    if (!number) return null;
    return thread ? { kind: "review-thread", repo, number, threadId: thread } : { kind: "pr", repo, number };
  }
  if (path === "issues") {
    const number = positiveInt(ref);
    return number ? { kind: "issue", repo, number } : null;
  }
  if (path === "commit") {
    return /^[0-9a-f]{7,40}$/i.test(ref) ? { kind: "commit", repo, sha: ref } : null;
  }
  // actions/runs
  const runId = positiveInt(ref);
  return runId ? { kind: "run", repo, runId } : null;
}

/** True when an UNQUOTED `>` exists at/after `from` — quote-aware so a `>`
 *  inside a still-open attribute value (`title="a -> b`) doesn't read as the
 *  tag's close while the marker is mid-stream (review finding, cave-m0r6). */
function hasUnquotedGt(s: string, from: number): boolean {
  let inQuote = false;
  for (let i = from; i < s.length; i++) {
    const c = s[i];
    if (c === '"') inQuote = !inQuote;
    else if (c === ">" && !inQuote) return true;
  }
  return false;
}

/** Character ranges covered by ```/~~~ fences (delimiters included). Fenced
 *  marker syntax is example text, never live cards (review finding,
 *  cave-m0r6); an unclosed trailing fence protects through the text end. */
export function fencedRanges(text: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  let offset = 0;
  let fenceStart = -1;
  for (const line of text.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) {
      if (fenceStart === -1) fenceStart = offset;
      else {
        ranges.push([fenceStart, offset + line.length]);
        fenceStart = -1;
      }
    }
    offset += line.length + 1;
  }
  if (fenceStart !== -1) ranges.push([fenceStart, text.length]);
  return ranges;
}

function inRanges(ranges: Array<[number, number]>, index: number): boolean {
  return ranges.some(([start, end]) => index >= start && index < end);
}

/**
 * Streaming-safe strip: remove complete `<coven:github…>` markers and hide a
 * PARTIAL marker at the very end of the text (the stream may cut mid-tag —
 * raw tag fragments must never flash). Fenced markers are example text and
 * stay literal. Cards are not mounted while streaming; they appear when the
 * turn settles (same contract as canvas artifacts).
 */
export function stripGitHubMarkers(text: string): string {
  if (!text || !text.includes("<coven:g")) return text;
  const fences = fencedRanges(text);
  MARKER_RE.lastIndex = 0;
  let out = text.replace(MARKER_RE, (m, _action, _attrs, index: number) =>
    inRanges(fences, index) ? m : "",
  );
  // Partial tail: an unterminated `<coven:github…` (or any prefix of the tag
  // name) with no UNQUOTED closing `>` after it hides from the visible
  // stream — unless it sits inside a fence, where it's example text.
  const tail = out.lastIndexOf("<coven:g");
  if (tail !== -1 && !hasUnquotedGt(out, tail) && !inRanges(fencedRanges(out), tail)) {
    const frag = out.slice(tail);
    if ("<coven:github-action".startsWith(frag.slice(0, "<coven:github-action".length)) || frag.startsWith("<coven:github")) {
      out = out.slice(0, tail);
    }
  }
  return out;
}

/** True when a trimmed line is exactly one unfurlable github.com URL. */
function bareLineDescriptor(line: string): GitHubBlockDescriptor | null {
  const t = line.trim();
  if (!t.startsWith("https://github.com/")) return null;
  return parseGitHubUrl(t);
}

/**
 * Split one prose span into ordered text/card/action pieces (design §1, §3):
 * - complete `<coven:github …>` display markers become cards at their position
 * - `<coven:github-action …>` markers become PROPOSAL pieces (rendered as
 *   cards that always require a user tap — agents propose, humans dispose)
 * - a URL standing alone on its own line unfurls into a card replacing the line
 * Inline URL mentions stay plain text. Returns [{kind:"text", text}] unchanged
 * when there is nothing to extract, so callers can cheaply detect "no cards".
 */
export function sliceGitHubBlocks(text: string): GitHubTextPiece[] {
  if (!text) return [{ kind: "text", text }];
  const pieces: GitHubTextPiece[] = [];
  let cursor = 0;
  const pushText = (chunk: string) => {
    if (chunk) pieces.push({ kind: "text", text: chunk });
  };

  if (text.includes("<coven:github")) {
    // Fenced markers are example text — leave them literal instead of
    // splitting the fence and mounting a live (possibly armed action) card
    // (review finding, cave-m0r6).
    const fences = fencedRanges(text);
    MARKER_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = MARKER_RE.exec(text)) !== null) {
      if (inRanges(fences, m.index)) continue;
      pushText(text.slice(cursor, m.index));
      cursor = m.index + m[0].length;
      const isAction = Boolean(m[1]);
      if (isAction) {
        const a = actionFromAttrs(parseAttrs(m[2] ?? ""));
        if (a) pieces.push({ kind: "action", action: a });
        // Malformed action markers are dropped silently — never raw tags.
      } else {
        const d = descriptorFromAttrs(parseAttrs(m[2] ?? ""));
        if (d) pieces.push({ kind: "card", descriptor: d });
        // Malformed display markers are dropped silently — never raw tags.
      }
    }
    pushText(text.slice(cursor));
  } else {
    pushText(text);
  }

  // Second pass: unfurl bare-line URLs inside the text pieces.
  const out: GitHubTextPiece[] = [];
  for (const piece of pieces) {
    if (piece.kind !== "text") {
      out.push(piece);
      continue;
    }
    const lines = piece.text.split("\n");
    let buf: string[] = [];
    let inFence = false;
    const flush = () => {
      if (buf.length) out.push({ kind: "text", text: buf.join("\n") });
      buf = [];
    };
    for (const line of lines) {
      // Fence tracking: never unfurl inside ```/~~~ blocks — consuming a line
      // there would split the fence and break the markdown render.
      if (/^\s*(```|~~~)/.test(line)) {
        inFence = !inFence;
        buf.push(line);
        continue;
      }
      const d = inFence ? null : bareLineDescriptor(line);
      if (d) {
        flush();
        out.push({ kind: "card", descriptor: d });
      } else {
        buf.push(line);
      }
    }
    flush();
  }

  // Merge is unnecessary: adjacent text pieces only arise around cards.
  return out.length ? out : [{ kind: "text", text }];
}

/** Cards referenced anywhere in a USER message (bare-line URLs only — user
 *  text is never marker-stripped; typed markers are the author's own text).
 *  Rendered beneath the user bubble, like attachments. */
export function unfurlUserMessage(text: string): GitHubBlockDescriptor[] {
  if (!text) return [];
  const out: GitHubBlockDescriptor[] = [];
  const seen = new Set<string>();
  for (const line of text.split("\n")) {
    const d = bareLineDescriptor(line);
    if (!d) continue;
    const key = descriptorUrl(d);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(d);
  }
  return out;
}
