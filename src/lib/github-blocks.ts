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

function mergeRanges(ranges: Array<[number, number]>): Array<[number, number]> {
  const merged: Array<[number, number]> = [];
  for (const range of ranges.sort(([a], [b]) => a - b)) {
    const previous = merged[merged.length - 1];
    if (previous && range[0] <= previous[1]) {
      previous[1] = Math.max(previous[1], range[1]);
    } else {
      merged.push([...range]);
    }
  }
  return merged;
}

function rendererFenceRanges(text: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  let offset = 0;
  let start = -1;
  let character = "";
  let openedFromList = false;
  let interiorLines = 0;
  for (const line of text.split("\n")) {
    if (start === -1) {
      const opening = /^([ \t]*)(?:(?:([-+*]|\d{1,9}[.)])[ \t]+))?(`{3,}|~{3,})(.*)$/.exec(line);
      const validOpening = opening &&
        !(opening[3][0] === "`" && opening[4].includes("`"));
      if (validOpening) {
        start = offset;
        character = opening[3][0];
        openedFromList = Boolean(opening[2]);
        interiorLines = 0;
      }
    } else {
      const closing = /^[ \t]*(`{3,}|~{3,})[ \t]*$/.exec(line);
      if (closing && closing[1][0] === character) {
        ranges.push([start, offset + line.length]);
        if (openedFromList || interiorLines === 0) {
          start = offset;
          character = closing[1][0];
          openedFromList = false;
          interiorLines = 0;
        } else {
          start = -1;
          character = "";
          openedFromList = false;
          interiorLines = 0;
        }
      } else {
        interiorLines += 1;
      }
    }
    offset += line.length + 1;
  }
  if (start !== -1) ranges.push([start, text.length]);
  return ranges;
}

/** Character ranges covered by ```/~~~ fences (delimiters included). Fenced
 *  marker syntax is example text, never live cards (review finding,
 *  cave-m0r6); an unclosed trailing fence protects through the text end. */
export function fencedRanges(text: string): Array<[number, number]> {
  const containerRanges: Array<[number, number]> = [];
  let offset = 0;
  let fenceStart = -1;
  let fenceCharacter = "";
  let fenceLength = 0;
  let fenceQuoteDepth = 0;
  let closingIndent = 3;
  let openedFromList = false;
  let interiorLines = 0;
  for (const line of text.split("\n")) {
    let contentOffset = 0;
    let quoteDepth = 0;
    while (true) {
      const quote = /^ {0,3}>[ \t]?/.exec(line.slice(contentOffset));
      if (!quote) break;
      contentOffset += quote[0].length;
      quoteDepth += 1;
    }
    const containerContent = line.slice(contentOffset);

    if (fenceStart === -1) {
      const list = /^ {0,3}(?:[-+*]|\d{1,9}[.)])[ \t]+/.exec(containerContent);
      const content = list
        ? containerContent.slice(list[0].length)
        : containerContent;
      const opening = /^([ \t]*)(`{3,}|~{3,})(.*)$/.exec(content);
      if (opening) {
        const indent = (list?.[0].length ?? 0) + opening[1].length;
        const fence = opening[2];
        const info = opening[3];
        if (fence[0] === "`" && info.includes("`")) {
          offset += line.length + 1;
          continue;
        }
        fenceStart = offset;
        fenceCharacter = fence[0];
        fenceLength = fence.length;
        fenceQuoteDepth = quoteDepth;
        closingIndent = indent + 3;
        openedFromList = Boolean(list);
        interiorLines = 0;
      }
    } else {
      const closing = /^([ \t]*)(`{3,}|~{3,})\s*$/.exec(containerContent);
      if (
        closing
        && quoteDepth === fenceQuoteDepth
        && closing[1].length <= closingIndent
        && closing[2][0] === fenceCharacter
        && closing[2].length >= fenceLength
      ) {
        containerRanges.push([fenceStart, offset + line.length]);
        if (openedFromList || interiorLines === 0) {
          fenceStart = offset;
          fenceCharacter = closing[2][0];
          fenceLength = closing[2].length;
          fenceQuoteDepth = quoteDepth;
          closingIndent = closing[1].length + 3;
          openedFromList = false;
          interiorLines = 0;
        } else {
          fenceStart = -1;
          fenceCharacter = "";
          fenceLength = 0;
          fenceQuoteDepth = 0;
          closingIndent = 3;
          openedFromList = false;
          interiorLines = 0;
        }
      } else {
        interiorLines += 1;
      }
    }
    offset += line.length + 1;
  }
  if (fenceStart !== -1) containerRanges.push([fenceStart, text.length]);

  // The shipped parser also recognizes any whitespace-indented raw fence line
  // and closes it with the next same-character fence, regardless of run
  // length. Union that state machine with the container-aware ranges above so
  // parser quirks can never leave rendered code executable as protocol.
  return mergeRanges([...containerRanges, ...rendererFenceRanges(text)]);
}

function inRanges(ranges: Array<[number, number]>, index: number): boolean {
  return ranges.some(([start, end]) => index >= start && index < end);
}

/** Markdown code ranges, including fenced blocks and inline backtick spans.
 * Unterminated spans protect through the text end so streamed examples cannot
 * briefly activate protocol controls before their closing delimiter arrives. */
export function markdownCodeRanges(text: string): Array<[number, number]> {
  const fences = fencedRanges(text);
  const inline: Array<[number, number]> = [];
  let cursor = 0;
  let fenceIndex = 0;

  while (cursor < text.length) {
    while (
      fenceIndex < fences.length
      && cursor >= fences[fenceIndex][1]
    ) {
      fenceIndex += 1;
    }
    const fence = fences[fenceIndex];
    if (fence && cursor >= fence[0]) {
      cursor = fence[1];
      continue;
    }
    if (text[cursor] !== "`") {
      cursor += 1;
      continue;
    }

    const start = cursor;
    while (cursor < text.length && text[cursor] === "`") cursor += 1;
    const delimiterLength = cursor - start;
    let closingEnd = -1;
    let search = cursor;
    let searchFenceIndex = fenceIndex;

    while (search < text.length) {
      while (
        searchFenceIndex < fences.length
        && search >= fences[searchFenceIndex][1]
      ) {
        searchFenceIndex += 1;
      }
      const searchFence = fences[searchFenceIndex];
      if (searchFence && search >= searchFence[0]) {
        search = searchFence[1];
        continue;
      }
      if (text[search] !== "`") {
        search += 1;
        continue;
      }
      const closingStart = search;
      while (search < text.length && text[search] === "`") search += 1;
      if (search - closingStart === delimiterLength) {
        closingEnd = search;
        break;
      }
    }

    inline.push([start, closingEnd === -1 ? text.length : closingEnd]);
    cursor = closingEnd === -1 ? text.length : closingEnd;
  }

  return mergeRanges([...fences, ...inline]);
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
  const codeRanges = markdownCodeRanges(text);
  MARKER_RE.lastIndex = 0;
  const out = text.replace(MARKER_RE, (m, _action, _attrs, index: number) =>
    inRanges(codeRanges, index) ? m : "",
  );
  return stripIncompleteGitHubMarker(out);
}

/** Remove only an unterminated marker tail, preserving complete markers for
 * callers that still need to turn them into cards. */
export function stripIncompleteGitHubMarker(text: string): string {
  if (!text || !text.includes("<coven:g")) return text;
  // Partial tail: an unterminated `<coven:github…` (or any prefix of the tag
  // name) with no UNQUOTED closing `>` after it hides from the visible
  // stream — unless it sits inside a fence, where it's example text.
  const tail = text.lastIndexOf("<coven:g");
  if (tail !== -1 && !hasUnquotedGt(text, tail) && !inRanges(markdownCodeRanges(text), tail)) {
    const frag = text.slice(tail);
    if ("<coven:github-action".startsWith(frag.slice(0, "<coven:github-action".length)) || frag.startsWith("<coven:github")) {
      return text.slice(0, tail);
    }
  }
  return text;
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
export function sliceGitHubBlocks(
  text: string,
  { unfurlBareUrls = true }: { unfurlBareUrls?: boolean } = {},
): GitHubTextPiece[] {
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
    const codeRanges = markdownCodeRanges(text);
    MARKER_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = MARKER_RE.exec(text)) !== null) {
      if (inRanges(codeRanges, m.index)) continue;
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

  if (!unfurlBareUrls) {
    return pieces.length ? pieces : [{ kind: "text", text }];
  }

  // Second pass: unfurl bare-line URLs inside the text pieces.
  const out: GitHubTextPiece[] = [];
  for (const piece of pieces) {
    if (piece.kind !== "text") {
      out.push(piece);
      continue;
    }
    const lines = piece.text.split("\n");
    const codeRanges = markdownCodeRanges(piece.text);
    let buf: string[] = [];
    let offset = 0;
    const flush = () => {
      if (buf.length) out.push({ kind: "text", text: buf.join("\n") });
      buf = [];
    };
    for (const line of lines) {
      const d = inRanges(codeRanges, offset) ? null : bareLineDescriptor(line);
      if (d) {
        flush();
        out.push({ kind: "card", descriptor: d });
      } else {
        buf.push(line);
      }
      offset += line.length + 1;
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
