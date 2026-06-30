// Pure builder: turn a GitHub PR review (detail + comments + inline threads, and
// optionally a familiar's generated review) into a self-contained HTML document.
//
// The output is a complete `<!doctype html>` string with inline styles and
// colorized diffs (reusing parseDiff from gh-diff). It's saved as a Canvas
// "html" artifact (rendered in a sandboxed iframe), so it must carry its own CSS
// and must NOT depend on app classes. Everything user/remote-derived is escaped.
//
// Framework-free + deterministic (timestamps are injected, never read here) so it
// unit-tests directly.

import { parseDiff } from "@/lib/gh-diff";

export type ReviewComment = {
  author?: string | null;
  body?: string | null;
  createdAt?: string | null;
};

export type ReviewThread = {
  path?: string | null;
  diffHunk?: string | null;
  isResolved?: boolean;
  comments: ReviewComment[];
};

export type ReviewHtmlInput = {
  repo: string;
  number?: number | null;
  title: string;
  /** "open" | "closed" | "merged" — anything else renders as-is. */
  state?: string;
  author?: string | null;
  url?: string | null;
  /** PR/issue markdown body — included as escaped, whitespace-preserving text. */
  body?: string | null;
  comments?: ReviewComment[];
  threads?: ReviewThread[];
  /** A familiar's generated review, rendered as its own highlighted section. */
  familiarReview?: { familiarName: string; body: string } | null;
  /** ISO timestamp, injected by the caller (kept out of this pure module). */
  generatedAt: string;
};

/** Escape text for safe interpolation into HTML. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Render a unified-diff hunk to colorized HTML rows (additions/deletions/etc). */
export function renderDiffHtml(hunk: string): string {
  const lines = parseDiff(hunk);
  if (lines.length === 0) return "";
  const rows = lines
    .map((l) => {
      const num = (n: number | null) => (n == null ? "" : String(n));
      return (
        `<div class="ghx-l ghx-l--${l.type}">` +
        `<span class="ghx-n">${num(l.oldNo)}</span>` +
        `<span class="ghx-n">${num(l.newNo)}</span>` +
        `<code>${escapeHtml(l.text.length > 0 ? l.text : " ")}</code>` +
        `</div>`
      );
    })
    .join("");
  return `<div class="ghx-diff">${rows}</div>`;
}

function stateClass(state?: string): string {
  const s = (state ?? "open").toLowerCase();
  if (s === "merged") return "ghx-state--merged";
  if (s === "closed") return "ghx-state--closed";
  return "ghx-state--open";
}

/** Escaped text block that preserves newlines/indentation (markdown shown as-is). */
function textBlock(text: string): string {
  return `<pre class="ghx-text">${escapeHtml(text)}</pre>`;
}

function commentHtml(c: ReviewComment): string {
  const who = escapeHtml(c.author?.trim() || "ghost");
  const when = c.createdAt ? `<span class="ghx-when">${escapeHtml(c.createdAt)}</span>` : "";
  const body = c.body?.trim() ? textBlock(c.body) : `<p class="ghx-muted">No content.</p>`;
  return `<div class="ghx-comment"><div class="ghx-comment-head"><strong>${who}</strong>${when}</div>${body}</div>`;
}

function threadHtml(t: ReviewThread): string {
  const path = t.path ? `<span class="ghx-path">${escapeHtml(t.path)}</span>` : "";
  const resolved = t.isResolved ? `<span class="ghx-badge">resolved</span>` : "";
  const diff = t.diffHunk ? renderDiffHtml(t.diffHunk) : "";
  const comments = (t.comments ?? []).map(commentHtml).join("");
  return `<div class="ghx-thread"><div class="ghx-thread-head">${path}${resolved}</div>${diff}${comments}</div>`;
}

const STYLE = `
:root{color-scheme:light dark}
*{box-sizing:border-box}
body{margin:0;padding:24px;max-width:980px;margin-inline:auto;
  font:14px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;
  color:#1f2328;background:#fff}
@media (prefers-color-scheme:dark){body{color:#e6edf3;background:#0d1117}}
h1{font-size:22px;margin:0 0 6px}
h2{font-size:15px;margin:28px 0 10px;padding-bottom:6px;border-bottom:1px solid #d0d7de88}
a{color:#0969da}
.ghx-sub{display:flex;flex-wrap:wrap;gap:10px;align-items:center;color:#656d76;font-size:13px;margin-bottom:4px}
.ghx-num{font-weight:600}
.ghx-state{display:inline-block;padding:2px 10px;border-radius:999px;font-size:12px;font-weight:600;color:#fff}
.ghx-state--open{background:#1a7f37}.ghx-state--closed{background:#cf222e}.ghx-state--merged{background:#8250df}
.ghx-meta{color:#656d76;font-size:12px}
.ghx-muted{color:#8b949e}
.ghx-text{white-space:pre-wrap;word-break:break-word;font:inherit;margin:0;
  padding:10px 12px;border:1px solid #d0d7de88;border-radius:8px;background:#f6f8fa}
@media (prefers-color-scheme:dark){.ghx-text{background:#161b22;border-color:#30363d}}
.ghx-comment{margin:10px 0}
.ghx-comment-head{display:flex;gap:8px;align-items:baseline;margin-bottom:4px}
.ghx-when{color:#8b949e;font-size:12px}
.ghx-thread{margin:12px 0;border:1px solid #d0d7de88;border-radius:10px;overflow:hidden}
@media (prefers-color-scheme:dark){.ghx-thread{border-color:#30363d}}
.ghx-thread-head{display:flex;gap:8px;align-items:center;padding:6px 10px;background:#f6f8fa;font-size:12px}
@media (prefers-color-scheme:dark){.ghx-thread-head{background:#161b22}}
.ghx-path{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.ghx-badge{padding:1px 7px;border-radius:999px;background:#1a7f3722;color:#1a7f37;font-size:11px}
.ghx-diff{font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;overflow-x:auto}
.ghx-l{display:grid;grid-template-columns:3em 3em 1fr;white-space:pre}
.ghx-l>code{padding:0 8px}
.ghx-n{padding:0 6px;text-align:right;color:#8b949e;user-select:none;border-right:1px solid #d0d7de55}
.ghx-l--add{background:#1a7f3722}.ghx-l--del{background:#cf222e22}
.ghx-l--meta{background:#8250df1a;color:#8250df}.ghx-l--context{color:#656d76}
.ghx-review{border:1px solid #8250df55;border-radius:10px;padding:14px 16px;background:#8250df0d}
.ghx-foot{margin-top:32px;color:#8b949e;font-size:12px;border-top:1px solid #d0d7de55;padding-top:10px}
`;

/**
 * Build a complete standalone HTML document for a PR review. Sections render in
 * order: header → familiar review (if any) → description → conversation →
 * inline review threads (with colorized diffs).
 */
export function buildReviewHtml(input: ReviewHtmlInput): string {
  const numTxt = input.number != null ? `#${input.number}` : "";
  const titleLine = `${escapeHtml(input.title)} ${numTxt}`.trim();
  const link = input.url
    ? `<a href="${escapeHtml(input.url)}" rel="noreferrer">${escapeHtml(input.repo)}${numTxt ? ` ${numTxt}` : ""}</a>`
    : `${escapeHtml(input.repo)}${numTxt ? ` ${numTxt}` : ""}`;
  const stateLabel = escapeHtml(input.state ?? "open");

  const reviewSection = input.familiarReview
    ? `<h2>Review by ${escapeHtml(input.familiarReview.familiarName)}</h2>` +
      `<div class="ghx-review">${textBlock(input.familiarReview.body)}</div>`
    : "";

  const description = input.body?.trim()
    ? `<h2>Description</h2>${textBlock(input.body)}`
    : "";

  const comments = input.comments ?? [];
  const conversation = comments.length
    ? `<h2>Conversation (${comments.length})</h2>${comments.map(commentHtml).join("")}`
    : "";

  const threads = input.threads ?? [];
  const reviewThreads = threads.length
    ? `<h2>Review threads (${threads.length})</h2>${threads.map(threadHtml).join("")}`
    : "";

  return (
    `<!doctype html><html lang="en"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width, initial-scale=1">` +
    `<title>${titleLine || "PR review"}</title><style>${STYLE}</style></head><body>` +
    `<h1>${escapeHtml(input.title)}</h1>` +
    `<div class="ghx-sub">` +
    (numTxt ? `<span class="ghx-num">${numTxt}</span>` : "") +
    `<span class="ghx-state ${stateClass(input.state)}">${stateLabel}</span>` +
    `<span>${link}</span>` +
    (input.author ? `<span>by ${escapeHtml(input.author)}</span>` : "") +
    `</div>` +
    reviewSection +
    description +
    conversation +
    reviewThreads +
    `<div class="ghx-foot">Generated by Coven Cave · ${escapeHtml(input.generatedAt)}</div>` +
    `</body></html>`
  );
}
