"use client";

/**
 * review-file-rail — one row that answers "where am I in this change?".
 *
 * It replaces the workbench's file *column*: a column costs width the diff
 * needs, and the diff is the surface being read. The rail keeps the open file
 * visible, windows the rest, and hands the overflow to the full navigator —
 * so search, the directory tree, and keyboard traversal are one click away
 * rather than deleted.
 *
 * The progress cluster sits at the far end because it is the answer to a
 * different question ("how much is left?") than the chips ("which one?").
 */

import { useRef, useState } from "react";
import { Icon } from "@/lib/icon";
import { Popover } from "@/components/ui/popover";
import { fileChipState, fileChipWindow } from "./review-cockpit";
import { ReviewFileNavigator } from "./review-file-navigator";
import type { ReviewFile } from "./use-review-source";

export function ReviewFileRail({
  files,
  filesShown,
  filesTotal,
  openPath,
  capacity,
  reviewed,
  reviewedCount,
  readableCount,
  commentCounts,
  canMarkReviewed,
  onOpen,
  onMarkReviewed,
}: {
  files: readonly ReviewFile[];
  filesShown: number;
  filesTotal: number;
  openPath: string | null;
  capacity: number;
  reviewed: ReadonlySet<string>;
  reviewedCount: number;
  readableCount: number;
  commentCounts: ReadonlyMap<string, number>;
  canMarkReviewed: boolean;
  onOpen: (path: string) => void;
  onMarkReviewed: () => void;
}) {
  const [listOpen, setListOpen] = useState(false);
  const moreRef = useRef<HTMLButtonElement | null>(null);

  const currentIndex = openPath
    ? files.findIndex((file) => file.path === openPath)
    : 0;
  const window = fileChipWindow(files.length, currentIndex, capacity);
  const shown = files.slice(window.start, window.end);
  const currentReviewed = openPath ? reviewed.has(openPath) : false;
  const percent = readableCount === 0 ? 0 : (reviewedCount / readableCount) * 100;
  const complete = readableCount > 0 && reviewedCount >= readableCount;

  return (
    <div className="rd-file-rail">
      <div className="rd-file-chips" role="tablist" aria-label="Changed files">
        {shown.map((file) => {
          const comments = commentCounts.get(file.path) ?? 0;
          const current = file.path === openPath;
          const state = fileChipState({
            current,
            reviewed: reviewed.has(file.path),
            flagged: comments > 0 || file.noPatchReason != null,
          });
          return (
            <button
              key={file.path}
              type="button"
              role="tab"
              aria-selected={current}
              className="rd-file-chip focus-ring"
              data-state={state}
              title={`${file.path} · +${file.additions} −${file.deletions}${
                reviewed.has(file.path) ? " · reviewed" : " · unread"
              }`}
              onClick={() => onOpen(file.path)}
            >
              <i className="rd-file-chip-dot" data-state={state} aria-hidden />
              <span className="rd-file-chip-name">
                {file.path.split("/").pop()}
              </span>
              {comments > 0 ? (
                <span className="rd-file-chip-badge">{comments}</span>
              ) : null}
            </button>
          );
        })}
        {window.hidden > 0 || filesShown < filesTotal ? (
          <>
            <button
              ref={moreRef}
              type="button"
              className="rd-file-chip rd-file-chip--more focus-ring"
              aria-expanded={listOpen}
              aria-haspopup="dialog"
              title={
                window.hidden > 0
                  ? `${window.hidden} more ${window.hidden === 1 ? "file" : "files"} — open the full list`
                  : "Open the full file list"
              }
              onClick={() => setListOpen((open) => !open)}
            >
              <Icon name="ph:dots-three-bold" width={12} height={12} aria-hidden />
              {window.hidden > 0 ? `+${window.hidden}` : "All"}
            </button>
            <Popover
              open={listOpen}
              onOpenChange={setListOpen}
              anchorRef={moreRef}
              placement="bottom-start"
              minWidth={340}
              scrollStrategy="content"
              ariaLabel="All changed files"
              className="rd-file-list-popover"
            >
              <ReviewFileNavigator
                files={files}
                filesShown={filesShown}
                filesTotal={filesTotal}
                openPath={openPath}
                onOpen={(path) => {
                  onOpen(path);
                  setListOpen(false);
                }}
                onCollapse={() => setListOpen(false)}
              />
            </Popover>
          </>
        ) : null}
      </div>

      <div className="rd-file-progress">
        <span
          className="rd-file-progress-label"
          title={`${reviewedCount} of ${readableCount} readable files reviewed on this revision`}
        >
          {reviewedCount}/{readableCount}
        </span>
        <span className="rd-file-progress-track" aria-hidden>
          <i data-complete={complete ? "true" : undefined} style={{ width: `${percent}%` }} />
        </span>
        <button
          type="button"
          className="rd-mark-btn focus-ring"
          data-reviewed={currentReviewed ? "true" : undefined}
          aria-pressed={currentReviewed}
          disabled={!canMarkReviewed}
          title={
            currentReviewed
              ? "Undo — unmark this file (r)"
              : openPath
                ? `Mark ${openPath.split("/").pop()} reviewed (r)`
                : "Open a file to mark it reviewed"
          }
          onClick={onMarkReviewed}
        >
          <Icon
            name={currentReviewed ? "ph:check-circle-fill" : "ph:check"}
            width={12}
            height={12}
            aria-hidden
          />
          {currentReviewed ? "Reviewed" : "Mark reviewed"}
          <kbd aria-hidden>R</kbd>
        </button>
      </div>
    </div>
  );
}
