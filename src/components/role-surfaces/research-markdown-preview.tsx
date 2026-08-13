"use client";

/**
 * Rendered Markdown for a mission's text artifacts (the research log first).
 *
 * The log is written as Markdown by the harness — headings per pass, bullet
 * lists of what was tried, links to sources — and showing it as preformatted
 * text made the reader do the parsing: every `##` and `- ` visible, no heading
 * hierarchy to skim, links not clickable.
 *
 * The serializer is the same browser-only `@create-markdown/preview` chunk chat
 * uses, loaded lazily so it never runs during server render, and its output is
 * unwrapped from the preview shell exactly as message-bubble does.
 */

import { useEffect, useRef, useState } from "react";
import { parse } from "@create-markdown/core";
import { loadMarkdownPreview } from "@/lib/markdown-preview";
import { unwrapPreviewShell } from "@/lib/markdown-preview-shell";

export type ResearchMarkdownPreviewProps = {
  /** Raw Markdown. `null` means "still loading"; empty means "nothing yet". */
  markdown: string | null;
  /** Shown when the document exists but has no content. */
  emptyLabel?: string;
  ariaLabel?: string;
};

export function ResearchMarkdownPreview({
  markdown,
  emptyLabel = "Nothing written yet.",
  ariaLabel = "Research log",
}: ResearchMarkdownPreviewProps) {
  const [html, setHtml] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  // Renders are async and the log re-renders on every poll while a mission
  // runs, so a slow render must never overwrite a newer one.
  const renderToken = useRef(0);

  useEffect(() => {
    const token = ++renderToken.current;
    if (markdown === null || markdown.trim() === "") {
      setHtml(null);
      setFailed(false);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const { renderAsync } = await loadMarkdownPreview();
        // renderAsync takes a parsed document, not raw text — the same
        // parse() → renderAsync() pair chat renders every message through.
        const rendered = await renderAsync(parse(markdown));
        if (cancelled || token !== renderToken.current) return;
        setHtml(unwrapPreviewShell(rendered));
        setFailed(false);
      } catch {
        if (cancelled || token !== renderToken.current) return;
        // Fall back to the raw source rather than showing nothing: an
        // unrenderable log is still readable, and losing it would hide the only
        // account of what the pass actually did.
        setFailed(true);
      }
    })();
    return () => { cancelled = true; };
  }, [markdown]);

  if (markdown === null) {
    return <p className="research-output-empty">Loading…</p>;
  }
  if (markdown.trim() === "") {
    return <p className="research-output-empty">{emptyLabel}</p>;
  }
  if (failed || html === null) {
    return (
      <pre className="research-markdown-preview research-markdown-preview--raw" aria-label={ariaLabel}>
        {markdown}
      </pre>
    );
  }
  return (
    <div
      className="research-markdown-preview"
      aria-label={ariaLabel}
      // Sanitised by the same preview serializer chat renders every assistant
      // message through; the source is a local mission file, never remote HTML.
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
