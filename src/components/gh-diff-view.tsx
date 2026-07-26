"use client";

import { useEffect, useMemo, useState } from "react";
import type { ThemedToken } from "shiki";
import { parseDiff, diffStats, diffLineClass, type DiffLine } from "@/lib/gh-diff";
import { resolveShikiLang } from "@/lib/code-lang";
import { getShikiHighlighter } from "@/lib/shiki-highlighter";

/**
 * Render a GitHub unified-diff hunk as a colorized, line-numbered diff table.
 *
 * Replaces the old raw `<pre>` (which only showed the last few lines as flat
 * text). Additions are green, deletions red, hunk headers tinted; old/new line
 * numbers sit in gutter columns. Long hunks collapse to the trailing
 * `previewLines` (the context nearest a review comment) with an expand toggle.
 *
 * When `path` resolves to a known grammar (via its file extension), line
 * contents are syntax-highlighted with the shared Shiki singleton — the
 * +/-/context marker stays in a separate span so the diff coloring and the
 * token coloring compose. Until Shiki resolves (or when the language is
 * unknown) lines render as plain text, so nothing blocks on the WASM load.
 * Long lines wrap (no horizontal scrolling) — see .gh-diff__line CSS.
 */
export function DiffHunk({
  hunk,
  path,
  previewLines = 6,
  className,
}: {
  hunk: string;
  /** File path of the diff — its extension picks the Shiki grammar. */
  path?: string | null;
  previewLines?: number;
  className?: string;
}) {
  const lines = useMemo(() => parseDiff(hunk), [hunk]);
  const stats = useMemo(() => diffStats(lines), [lines]);
  const [expanded, setExpanded] = useState(false);
  const lang = resolveShikiLang(pathLangToken(path));
  // tokens[i] = Shiki tokens for lines[i]'s content (marker stripped); null
  // until the async highlight lands or when the grammar is unknown.
  const [tokens, setTokens] = useState<ThemedToken[][] | null>(null);

  useEffect(() => {
    setTokens(null);
    if (lang === "text" || lines.length === 0) return;
    let cancelled = false;
    (async () => {
      try {
        const hl = await getShikiHighlighter();
        // Highlight the hunk as one document (meta rows blanked) so tokens
        // stay line-aligned with the parsed rows.
        const code = lines
          .map((l) => (l.type === "meta" ? "" : splitMarker(l.text).content))
          .join("\n");
        const result = hl.codeToTokens(code, { lang, theme: "mood-c-dark" });
        if (!cancelled) setTokens(result.tokens);
      } catch (err) {
        console.error("[DiffHunk] Shiki highlight failed", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [lines, lang]);

  if (lines.length === 0) return null;

  const collapsible = lines.length > previewLines;
  const shown = expanded || !collapsible ? lines : lines.slice(-previewLines);
  const hidden = lines.length - shown.length;
  // Index of shown[0] within lines, so collapsed views index tokens correctly.
  const offset = lines.length - shown.length;

  return (
    <div className={`gh-diff gh-diff--hunk ${className ?? ""}`}>
      <div className="gh-diff__bar">
        <span
          className="gh-diff__stat"
          aria-label={`${stats.additions} additions, ${stats.deletions} deletions`}
        >
          <span className="gh-diff__stat-add">+{stats.additions}</span>
          <span className="gh-diff__stat-del">−{stats.deletions}</span>
        </span>
        {collapsible && (
          <button
            type="button"
            className="gh-diff__expand"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
          >
            {expanded ? "Collapse" : `Show ${hidden} more line${hidden === 1 ? "" : "s"}`}
          </button>
        )}
      </div>
      <div className="gh-diff__body" role="table" aria-label="Diff">
        {shown.map((line, i) => (
          <div key={offset + i} className={diffLineClass(line.type)} role="row">
            <span className="gh-diff__no gh-diff__no--old" aria-hidden>
              {line.oldNo ?? ""}
            </span>
            <span className="gh-diff__no gh-diff__no--new" aria-hidden>
              {line.newNo ?? ""}
            </span>
            <code className="gh-diff__code">{renderLine(line, tokens?.[offset + i])}</code>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Split a diff line into its +/-/space marker and the code content. */
function splitMarker(text: string): { marker: string; content: string } {
  return /^[+\- ]/.test(text)
    ? { marker: text[0], content: text.slice(1) }
    : { marker: "", content: text };
}

/**
 * Grammar token for a file path: the basename's extension when it has one,
 * otherwise the bare basename itself (so extensionless-but-known names like
 * `infra/Dockerfile` still resolve — resolveShikiLang owns the mapping).
 */
function pathLangToken(path: string | null | undefined): string | null {
  if (!path) return null;
  const base = path.split("/").pop() ?? "";
  if (!base) return null;
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot + 1) : base;
}

function renderLine(line: DiffLine, lineTokens: ThemedToken[] | undefined) {
  // Zero-width space keeps blank rows at full height.
  if (line.type === "meta") return line.text.length > 0 ? line.text : "\u200b";
  const { marker, content } = splitMarker(line.text);
  return (
    <>
      {marker && (
        <span className="gh-diff__marker" aria-hidden>
          {marker}
        </span>
      )}
      {lineTokens && content.length > 0
        ? lineTokens.map((t, j) => (
            <span key={j} style={t.color ? { color: t.color } : undefined}>
              {t.content}
            </span>
          ))
        : content.length > 0
          ? content
          : "\u200b"}
    </>
  );
}
