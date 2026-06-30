"use client";

import { useMemo, useState } from "react";
import { parseDiff, diffStats, diffLineClass } from "@/lib/gh-diff";

/**
 * Render a GitHub unified-diff hunk as a colorized, line-numbered diff table.
 *
 * Replaces the old raw `<pre>` (which only showed the last few lines as flat
 * text). Additions are green, deletions red, hunk headers tinted; old/new line
 * numbers sit in gutter columns. Long hunks collapse to the trailing
 * `previewLines` (the context nearest a review comment) with an expand toggle.
 */
export function DiffHunk({
  hunk,
  previewLines = 6,
  className,
}: {
  hunk: string;
  previewLines?: number;
  className?: string;
}) {
  const lines = useMemo(() => parseDiff(hunk), [hunk]);
  const stats = useMemo(() => diffStats(lines), [lines]);
  const [expanded, setExpanded] = useState(false);

  if (lines.length === 0) return null;

  const collapsible = lines.length > previewLines;
  const shown = expanded || !collapsible ? lines : lines.slice(-previewLines);
  const hidden = lines.length - shown.length;

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
          <div key={i} className={diffLineClass(line.type)} role="row">
            <span className="gh-diff__no gh-diff__no--old" aria-hidden>
              {line.oldNo ?? ""}
            </span>
            <span className="gh-diff__no gh-diff__no--new" aria-hidden>
              {line.newNo ?? ""}
            </span>
            <code className="gh-diff__code">{line.text.length > 0 ? line.text : "​"}</code>
          </div>
        ))}
      </div>
    </div>
  );
}
