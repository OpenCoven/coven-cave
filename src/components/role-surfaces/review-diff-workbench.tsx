"use client";

import { useEffect, useMemo, useState } from "react";
import { Icon } from "@/lib/icon";
import type { ReviewWorkItem } from "@/lib/review-landing";
import { StandardSelect } from "@/components/ui/select";
import {
  buildDiffRows,
  hideWhitespaceOnlyDiff,
  parseDiffLines,
} from "./review-deck";
import { noPatchCopy } from "./review-file-tree";
import { ReviewFileNavigator, ReviewFileSpine } from "./review-file-navigator";
import {
  reviewProofState,
  type ReviewProofState,
} from "./review-progress";
import type { ReviewDiffPreferences } from "./review-preferences";
import type { ReviewFile, ReviewSource } from "./use-review-source";
import { SurfaceEmpty, SurfaceError, SurfaceLoading } from "./surface-room";

const PROOF_LABELS: Record<ReviewProofState, string> = {
  unread: "unread",
  reading: "reading",
  reviewed: "reviewed",
  commented: "has review comments",
  unavailable: "patch unavailable",
};

const CONTEXT_OPTIONS = [
  { value: "3", label: "3 lines" },
  { value: "5", label: "5 lines" },
  { value: "10", label: "10 lines" },
] as const;

function ReviewProofRibbon({
  files,
  openPath,
  reviewed,
  commentCounts,
  onOpen,
}: {
  files: readonly ReviewFile[];
  openPath: string | null;
  reviewed: ReadonlySet<string>;
  commentCounts: ReadonlyMap<string, number>;
  onOpen: (path: string) => void;
}) {
  return (
    <nav className="rd-proof-ribbon" aria-label="Review proof ribbon">
      <span className="rd-proof-title">Proof</span>
      <span className="rd-proof-track" aria-hidden />
      <span className="rd-proof-files">
        {files.map((file) => {
          const comments = commentCounts.get(file.path) ?? 0;
          const state = reviewProofState({
            path: file.path,
            currentPath: openPath,
            reviewed,
            unavailable: file.noPatchReason != null,
            commentCount: comments,
          });
          return (
            <button
              key={file.path}
              type="button"
              className="rd-proof-mark focus-ring"
              data-state={state}
              data-current={file.path === openPath ? "true" : undefined}
              aria-label={`${file.path}: ${PROOF_LABELS[state]}${comments > 0 ? `, ${comments} unresolved ${comments === 1 ? "thread" : "threads"}` : ""}`}
              title={`${file.path} — ${PROOF_LABELS[state]}`}
              onClick={() => onOpen(file.path)}
            >
              <span aria-hidden />
              {comments > 0 ? <small>{comments}</small> : null}
            </button>
          );
        })}
      </span>
    </nav>
  );
}

export function ReviewDiffWorkbench({
  selected,
  workItem,
  source,
  selectedPrUrl,
  navCollapsed,
  preferences,
  reviewed,
  reviewedCount,
  readableCount,
  commentCounts,
  onOpenUrl,
  onToggleNav,
  onPreferences,
  onMarkReviewed,
  onPreviousUnread,
  onNextUnread,
}: {
  selected: boolean;
  workItem: ReviewWorkItem | null;
  source: ReviewSource;
  selectedPrUrl: string | null;
  navCollapsed: boolean;
  preferences: ReviewDiffPreferences;
  reviewed: ReadonlySet<string>;
  reviewedCount: number;
  readableCount: number;
  commentCounts: ReadonlyMap<string, number>;
  onOpenUrl: (url: string) => void;
  onToggleNav: () => void;
  onPreferences: (patch: Partial<ReviewDiffPreferences>) => void;
  onMarkReviewed: () => void;
  onPreviousUnread: () => void;
  onNextUnread: () => void;
}) {
  const [expandedFolds, setExpandedFolds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  useEffect(() => {
    setExpandedFolds(new Set());
  }, [source.openPath, workItem?.revision]);

  const openFile = useMemo(
    () => source.files.find((file) => file.path === source.openPath) ?? null,
    [source.files, source.openPath],
  );
  const noPatch = openFile ? noPatchCopy(openFile.noPatchReason) : null;
  const parsed = useMemo(
    () => (source.openPatch.text ? parseDiffLines(source.openPatch.text) : []),
    [source.openPatch.text],
  );
  const visibleLines = useMemo(
    () =>
      preferences.hideWhitespace
        ? hideWhitespaceOnlyDiff(parsed)
        : parsed,
    [parsed, preferences.hideWhitespace],
  );
  const rows = useMemo(
    () =>
      buildDiffRows(
        visibleLines,
        preferences.contextLines,
        expandedFolds,
      ),
    [expandedFolds, preferences.contextLines, visibleLines],
  );
  const currentReadable = Boolean(openFile && openFile.noPatchReason == null);
  const currentReviewed = openFile ? reviewed.has(openFile.path) : false;

  return (
    <section
      className="rd-panel rd-viewer"
      aria-label="Changed files and diff"
      key={workItem?.revision ?? "empty"}
    >
      <div className="rd-viewer-split">
        {selected && source.phase === "ready" && source.files.length > 0 ? (
          <>
            <ReviewProofRibbon
              files={source.files}
              openPath={source.openPath}
              reviewed={reviewed}
              commentCounts={commentCounts}
              onOpen={source.open}
            />
            {navCollapsed ? (
              <ReviewFileSpine
                files={source.files}
                openPath={source.openPath}
                filtered={false}
                truncated={source.filesShown < source.filesTotal}
                onExpand={onToggleNav}
              />
            ) : (
              <ReviewFileNavigator
                files={source.files}
                filesShown={source.filesShown}
                filesTotal={source.filesTotal}
                openPath={source.openPath}
                onOpen={source.open}
                onCollapse={onToggleNav}
              />
            )}
          </>
        ) : null}

        <div className="rd-diff-column">
          <div className="rd-diff-toolbar">
            {openFile ? (
              <>
                <span className="rd-diff-status" data-status={openFile.status}>
                  {openFile.status}
                </span>
                <span className="rd-diff-path" title={openFile.path}>
                  {openFile.path}
                </span>
                <span className="rd-add">+{openFile.additions}</span>
                <span className="rd-del">−{openFile.deletions}</span>
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
              Hide whitespace-only pairs
            </label>
            <span className="rd-diff-option">
              Context
              <StandardSelect
                label="Diff context lines"
                className="rd-context-select"
                value={String(preferences.contextLines) as "3" | "5" | "10"}
                options={[...CONTEXT_OPTIONS]}
                onChange={(value) =>
                  onPreferences({
                    contextLines: Number(value) as 3 | 5 | 10,
                  })
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
                <Icon
                  name="ph:arrow-square-out"
                  width={11}
                  height={11}
                  aria-hidden
                />
                GitHub
              </a>
            ) : null}
          </div>

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
                    <Icon
                      name="ph:github-logo"
                      width={12}
                      height={12}
                      aria-hidden
                    />
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
                onRetry={() =>
                  source.openPath && source.open(source.openPath)
                }
              />
            ) : visibleLines.length === 0 && parsed.length > 0 ? (
              <SurfaceEmpty
                title="Only whitespace-only pairs are hidden."
                hint="Turn off Hide whitespace-only pairs to read the complete patch."
              />
            ) : rows.length === 0 ? (
              <SurfaceEmpty title="No diff to show." />
            ) : (
              <div className="rd-diff-table" role="table" aria-label={openFile?.path ?? "Unified diff"}>
                {source.truncated || source.openPatch.truncated ? (
                  <p className="rd-diff-trunc" role="status">
                    Patch truncated server-side at the route&apos;s per-file budget — the tail isn&apos;t shown.
                  </p>
                ) : null}
                {rows.map((row) =>
                  row.kind === "fold" ? (
                    <button
                      key={row.key}
                      type="button"
                      className="rd-diff-fold focus-ring-inset"
                      onClick={() =>
                        setExpandedFolds((current) => {
                          const next = new Set(current);
                          next.add(row.key);
                          return next;
                        })
                      }
                    >
                      <Icon name="ph:arrows-out-simple" width={12} height={12} aria-hidden />
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
                      <span
                        className="rd-diff-mark"
                        data-kind={row.line.kind}
                        aria-hidden
                      >
                        {row.line.mark}
                      </span>
                      <span className="rd-diff-text" role="cell">
                        {row.line.text}
                      </span>
                    </div>
                  ),
                )}
              </div>
            )}
          </div>

          <footer className="rd-proof-progress" aria-label="Reviewed-file progress">
            <span className="rd-proof-progress-copy">
              <strong>{reviewedCount} of {readableCount}</strong>
              <span>readable files reviewed on this revision</span>
            </span>
            <progress
              className="rd-proof-progress-track"
              value={reviewedCount}
              max={Math.max(readableCount, 1)}
              aria-label={`${reviewedCount} of ${readableCount} readable files reviewed`}
            />
            <button
              type="button"
              className="rd-icon-btn focus-ring"
              aria-label="Previous unread file"
              title="Previous unread file"
              disabled={readableCount === 0}
              onClick={onPreviousUnread}
            >
              <Icon name="ph:caret-up" width={12} height={12} aria-hidden />
            </button>
            <button
              type="button"
              className="rd-btn rd-btn--reviewed focus-ring"
              disabled={!currentReadable || !workItem}
              aria-pressed={currentReviewed}
              onClick={onMarkReviewed}
            >
              <Icon
                name={currentReviewed ? "ph:check-circle-fill" : "ph:circle"}
                width={13}
                height={13}
                aria-hidden
              />
              {currentReviewed ? "Reviewed" : "Mark reviewed"}
            </button>
            <button
              type="button"
              className="rd-icon-btn focus-ring"
              aria-label="Next unread file"
              title="Next unread file"
              disabled={readableCount === 0}
              onClick={onNextUnread}
            >
              <Icon name="ph:caret-down" width={12} height={12} aria-hidden />
            </button>
          </footer>
        </div>
      </div>
    </section>
  );
}
