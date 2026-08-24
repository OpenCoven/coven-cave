"use client";

/**
 * review-diff-workbench — the dominant surface.
 *
 * The cockpit gives the diff the whole centre column and every pixel of height
 * the rails do not need, because reading the change is the work; the rails
 * report on it. The file list that used to sit here as a column now lives in
 * the rail above (`review-file-rail`).
 *
 * Unresolved review threads render inline at the line they were left on. A
 * thread the deck cannot place — folded away, or past the route's per-file
 * patch budget — is listed at the end rather than dropped, because a
 * reviewer's own open question disappearing because the diff was folded is
 * worse than one shown out of position.
 */

import { useEffect, useMemo, useState } from "react";
import { Icon } from "@/lib/icon";
import type { ReviewWorkItem } from "@/lib/review-landing";
import { StandardSelect } from "@/components/ui/select";
import {
  buildDiffRows,
  hideWhitespaceOnlyDiff,
  parseDiffLines,
  type DiffRow,
} from "./review-deck";
import { interleaveThreads, type DiffThread } from "./review-cockpit";
import { noPatchCopy, STATUS_GLYPH } from "./review-file-tree";
import type { ReviewDiffPreferences } from "./review-preferences";
import type { ReviewFile, ReviewSource } from "./use-review-source";
import { SurfaceEmpty, SurfaceError, SurfaceLoading } from "./surface-room";

const CONTEXT_OPTIONS = [
  { value: "3", label: "3" },
  { value: "5", label: "5" },
  { value: "10", label: "10" },
] as const;

function ThreadNote({ thread, placed }: { thread: DiffThread; placed: boolean }) {
  return (
    <div className="rd-diff-thread" data-placed={placed ? "true" : undefined}>
      <span className="rd-diff-thread-head">
        <Icon name="ph:chat-circle-dots" width={12} height={12} aria-hidden />
        @{thread.author}
        {placed ? null : <small>{thread.where}</small>}
      </span>
      <p>{thread.excerpt}</p>
    </div>
  );
}

export function ReviewDiffWorkbench({
  selected,
  workItem,
  source,
  openFile,
  threads,
  selectedPrUrl,
  preferences,
  reviewedCount,
  readableCount,
  hasNextUnread,
  onOpenUrl,
  onPreferences,
  onNextUnread,
}: {
  selected: boolean;
  workItem: ReviewWorkItem | null;
  source: ReviewSource;
  openFile: ReviewFile | null;
  threads: readonly DiffThread[];
  selectedPrUrl: string | null;
  preferences: ReviewDiffPreferences;
  reviewedCount: number;
  readableCount: number;
  hasNextUnread: boolean;
  onOpenUrl: (url: string) => void;
  onPreferences: (patch: Partial<ReviewDiffPreferences>) => void;
  onNextUnread: () => void;
}) {
  const [expandedFolds, setExpandedFolds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  useEffect(() => {
    setExpandedFolds(new Set());
  }, [source.openPath, workItem?.revision]);

  const noPatch = openFile ? noPatchCopy(openFile.noPatchReason) : null;
  const parsed = useMemo(
    () => (source.openPatch.text ? parseDiffLines(source.openPatch.text) : []),
    [source.openPatch.text],
  );
  const visibleLines = useMemo(
    () => (preferences.hideWhitespace ? hideWhitespaceOnlyDiff(parsed) : parsed),
    [parsed, preferences.hideWhitespace],
  );
  const rows = useMemo(
    () => buildDiffRows(visibleLines, preferences.contextLines, expandedFolds),
    [expandedFolds, preferences.contextLines, visibleLines],
  );
  const woven = useMemo(
    () =>
      interleaveThreads<DiffRow>(
        rows,
        threads,
        openFile?.path ?? "",
        (row) => (row.kind === "line" ? row.line.newLine : null),
      ),
    [openFile?.path, rows, threads],
  );

  const revisionLabel = workItem
    ? `${reviewedCount} of ${readableCount} files read on ${
        workItem.kind === "pull-request"
          ? `head ${workItem.revision.slice(0, 7)}`
          : "this revision"
      }`
    : "no revision open";

  return (
    <section className="rd-diff-card" aria-label="Unified diff">
      <header className="rd-diff-head">
        {openFile ? (
          <>
            <span className="rd-diff-badge" data-status={openFile.status}>
              {STATUS_GLYPH[openFile.status]}
            </span>
            <span className="rd-diff-path" title={openFile.path}>
              {openFile.path}
            </span>
            <span className="rd-add">+{openFile.additions}</span>
            <span className="rd-del">−{openFile.deletions}</span>
            {openFile.noPatchReason ? (
              <span className="rd-diff-flag">NO PATCH</span>
            ) : null}
            {source.openPatch.truncated ? (
              <span className="rd-diff-flag">TRUNCATED</span>
            ) : null}
          </>
        ) : (
          <span className="rd-diff-path">Changed file</span>
        )}
        <span className="rd-spacer" />
        <label className="rd-diff-option">
          <input
            type="checkbox"
            checked={preferences.hideWhitespace}
            onChange={(event) =>
              onPreferences({ hideWhitespace: event.target.checked })
            }
          />
          Hide whitespace pairs
        </label>
        <span className="rd-diff-option">
          Context
          <StandardSelect
            label="Diff context lines"
            className="rd-context-select"
            value={String(preferences.contextLines) as "3" | "5" | "10"}
            options={[...CONTEXT_OPTIONS]}
            onChange={(value) =>
              onPreferences({ contextLines: Number(value) as 3 | 5 | 10 })
            }
          />
        </span>
        {selectedPrUrl ? (
          <a
            className="rd-diff-link focus-ring"
            href={`${selectedPrUrl}/files`}
            onClick={(event) => {
              event.preventDefault();
              onOpenUrl(`${selectedPrUrl}/files`);
            }}
          >
            <Icon name="ph:arrow-square-out" width={11} height={11} aria-hidden />
            GitHub
          </a>
        ) : null}
      </header>

      <div className="rd-diff rd-scroll" tabIndex={0}>
        {!selected ? (
          <SurfaceEmpty
            iconName="ph:git-diff"
            title="Pick a session from the queue."
            hint="Linked pull requests are read from GitHub; sessions with only local changes show their working tree."
          />
        ) : source.phase === "loading" ? (
          <SurfaceLoading
            label={
              source.kind === "pull-request"
                ? "Reading the pull request diff…"
                : "Reading the working tree…"
            }
          />
        ) : source.phase === "error" ? (
          <SurfaceError
            title={source.error ?? "Couldn't read the change."}
            hint="Nothing was approved or merged. Retry, or open the pull request on GitHub."
            onRetry={source.retry}
          />
        ) : source.files.length === 0 ? (
          <SurfaceEmpty
            iconName="ph:check"
            title={
              source.kind === "pull-request"
                ? "This pull request changes no files."
                : "No working changes"
            }
            hint={
              source.kind === "pull-request"
                ? "GitHub returned an empty file list for this pull request."
                : "This workload landed clean — nothing remains in the working tree to diff."
            }
          />
        ) : noPatch ? (
          <div className="rd-nopatch" role="status">
            <span className="rd-nopatch-title">
              <Icon name="ph:file-text" width={14} height={14} aria-hidden />
              {noPatch.title}
            </span>
            <span className="rd-nopatch-hint">{noPatch.hint}</span>
            {selectedPrUrl ? (
              <a
                className="focus-ring"
                href={`${selectedPrUrl}/files`}
                onClick={(event) => {
                  event.preventDefault();
                  onOpenUrl(`${selectedPrUrl}/files`);
                }}
              >
                <Icon name="ph:github-logo" width={12} height={12} aria-hidden />
                Open the file on GitHub
              </a>
            ) : null}
          </div>
        ) : source.openPatch.phase === "loading" ? (
          <SurfaceLoading label="Loading diff…" />
        ) : source.openPatch.phase === "error" ? (
          <SurfaceError
            title={source.openPatch.error ?? "Couldn't load the diff."}
            hint="Check the file, then retry."
            onRetry={() => source.openPath && source.open(source.openPath)}
          />
        ) : visibleLines.length === 0 && parsed.length > 0 ? (
          <SurfaceEmpty
            title="Only whitespace-only pairs are hidden."
            hint="Turn off Hide whitespace pairs to read the complete patch."
          />
        ) : rows.length === 0 ? (
          <SurfaceEmpty title="No diff to show." />
        ) : (
          <>
            <div
              className="rd-diff-table"
              role="table"
              aria-label={openFile?.path ?? "Unified diff"}
            >
              {woven.rows.map((row) =>
                row.kind === "thread" ? (
                  <ThreadNote key={row.key} thread={row.thread} placed />
                ) : row.kind === "fold" ? (
                  <button
                    key={row.key}
                    type="button"
                    className="rd-diff-fold focus-ring-inset"
                    title={`Reveal ${row.hidden.length} unchanged ${row.hidden.length === 1 ? "line" : "lines"}`}
                    onClick={() =>
                      setExpandedFolds((current) => {
                        const next = new Set(current);
                        next.add(row.key);
                        return next;
                      })
                    }
                  >
                    <Icon
                      name="ph:arrows-out-simple"
                      width={12}
                      height={12}
                      aria-hidden
                    />
                    {row.label}
                  </button>
                ) : (
                  <div
                    key={row.key}
                    className="rd-diff-line"
                    data-kind={row.line.kind}
                    role="row"
                  >
                    <span className="rd-diff-number" aria-hidden>
                      {row.line.oldLine ?? ""}
                    </span>
                    <span className="rd-diff-number" aria-hidden>
                      {row.line.newLine ?? ""}
                    </span>
                    <span className="rd-diff-mark" data-kind={row.line.kind} aria-hidden>
                      {row.line.mark}
                    </span>
                    <span className="rd-diff-text" role="cell">
                      {row.line.text}
                    </span>
                  </div>
                ),
              )}
            </div>

            {woven.unplaced.length > 0 ? (
              <section className="rd-diff-unplaced" aria-label="Threads outside the visible diff">
                <span className="rd-eyebrow">
                  {woven.unplaced.length} thread
                  {woven.unplaced.length === 1 ? "" : "s"} not on a visible line
                </span>
                {woven.unplaced.map((thread) => (
                  <ThreadNote key={thread.id} thread={thread} placed={false} />
                ))}
              </section>
            ) : null}

            <div className="rd-diff-end">
              <span>
                {hasNextUnread
                  ? `End of file — ${readableCount - reviewedCount} left in this change.`
                  : readableCount > 0 && reviewedCount >= readableCount
                    ? "Every readable file read on this revision."
                    : "End of file."}
              </span>
              <button
                type="button"
                className="rd-btn rd-btn--xs focus-ring"
                disabled={source.files.length < 2}
                onClick={onNextUnread}
              >
                {hasNextUnread ? "Next unread" : "Next file"}
                <kbd aria-hidden>J</kbd>
              </button>
            </div>
          </>
        )}
      </div>

      <footer className="rd-diff-foot">
        <span>{revisionLabel}</span>
        <span className="rd-spacer" />
        <span className="rd-diff-keys">
          j/k file · [ ] item · r reviewed · f queue · e inspector · ? help
        </span>
      </footer>
    </section>
  );
}
