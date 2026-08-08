"use client";

/**
 * CodeReviewRail — the Coding Room's right column (cave-0rcku).
 *
 * The `Cody Code Reading v2` frame docks review beside the source: two tabs
 * (Changes, PR), a drag handle, double-click to swap between a reading width
 * and half the room, and a close that leaves a 28px spine still printing the
 * diffstat. That last part is the design decision worth protecting — a closed
 * panel that vanished entirely would make "is there anything to review?"
 * unanswerable without reopening it.
 *
 * Both tabs mount the proven panels (`SessionChangesInner`, `CodeSessionPrPanel`),
 * so this owns geometry, the summary header, and the per-file *viewed*
 * bookkeeping — nothing about git or GitHub.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { Icon } from "@/lib/icon";
import { useAnnouncer } from "@/components/ui/live-region";
import { SessionChangesInner } from "@/components/session-changes-panel";
import {
  CODE_RAIL_SPINE_WIDTH_PX,
  clampCodeRailWidth,
  codeRailDiffBar,
  countCodeRailViewed,
  isCodeRailWide,
  toggleCodeRailViewed,
  toggleCodeRailWidth,
  type CodeRailTab,
  type CodeRailViewedState,
} from "@/lib/code-side-rail";
import type { ChangedFile } from "@/lib/session-changes-api";
import type { SessionRow } from "@/lib/types";

const LazyPr = dynamic(
  () => import("@/components/code-session-pr-panel").then((m) => m.CodeSessionPrPanel),
  { ssr: false },
);

export type CodeReviewRailProps = {
  row: SessionRow;
  projectRoot: string;
  running: boolean;
  tab: CodeRailTab;
  onTabChange: (tab: CodeRailTab) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  widthPx: number;
  onWidthChange: (widthPx: number) => void;
  /** Measured width of the room the rail lives in — clamping needs the box, not
   *  the viewport: the Room can sit beside the app sidebar or inside a split. */
  roomWidthPx: number;
  focusPath?: string | null;
  focusNonce?: number;
};

export function CodeReviewRail({
  row,
  projectRoot,
  running,
  tab,
  onTabChange,
  open,
  onOpenChange,
  widthPx,
  onWidthChange,
  roomWidthPx,
  focusPath,
  focusNonce,
}: CodeReviewRailProps) {
  const { announce } = useAnnouncer();
  const [files, setFiles] = useState<ChangedFile[]>([]);
  const [viewed, setViewed] = useState<CodeRailViewedState>({});
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);

  // Review state is per session: carrying one session's ticks into another
  // would certify files nobody looked at.
  useEffect(() => {
    setViewed({});
  }, [row.id]);

  const toggleViewed = useCallback((file: ChangedFile) => {
    setViewed((current) =>
      toggleCodeRailViewed(current, {
        path: file.path,
        status: file.status,
        additions: file.insertions,
        deletions: file.deletions,
      }),
    );
  }, []);

  // ── Drag to resize ─────────────────────────────────────────────────────────
  // Pointer events on window, not the handle, so a fast drag that outruns the
  // 7px hit area keeps resizing instead of dropping the gesture.
  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      dragRef.current = { startX: event.clientX, startWidth: widthPx };
      const move = (moveEvent: PointerEvent) => {
        const drag = dragRef.current;
        if (!drag) return;
        // The rail is on the right, so dragging left widens it.
        onWidthChange(clampCodeRailWidth(drag.startWidth - (moveEvent.clientX - drag.startX), roomWidthPx));
      };
      const up = () => {
        dragRef.current = null;
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    },
    [onWidthChange, roomWidthPx, widthPx],
  );

  // Keyboard resize: a pointer-only divider is not a control, it is a hazard.
  const onSeparatorKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const step = event.shiftKey ? 64 : 16;
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        onWidthChange(clampCodeRailWidth(widthPx + step, roomWidthPx));
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        onWidthChange(clampCodeRailWidth(widthPx - step, roomWidthPx));
      } else if (event.key === "Enter") {
        event.preventDefault();
        onWidthChange(toggleCodeRailWidth(widthPx, roomWidthPx));
      }
    },
    [onWidthChange, roomWidthPx, widthPx],
  );

  const additions = files.reduce((total, file) => total + (file.insertions ?? 0), 0);
  const deletions = files.reduce((total, file) => total + (file.deletions ?? 0), 0);
  const bar = codeRailDiffBar(additions, deletions);
  const viewedCount = countCodeRailViewed(viewed, files.map((file) => ({
    path: file.path,
    status: file.status,
    additions: file.insertions,
    deletions: file.deletions,
  })));

  if (!open) {
    return (
      <button
        type="button"
        className="focus-ring code-rail__spine"
        style={{ width: CODE_RAIL_SPINE_WIDTH_PX }}
        aria-label="Show the review rail"
        title="Show the review rail"
        onClick={() => {
          onOpenChange(true);
          announce("Review rail shown.");
        }}
      >
        <Icon name="ph:caret-left" width={11} height={11} aria-hidden />
        <span className="code-rail__spine-label">Review</span>
        {files.length ? (
          <span className="code-rail__spine-stat">
            <span className="code-rail__add">+{additions}</span>
            <span className="code-rail__del">&minus;{deletions}</span>
          </span>
        ) : null}
      </button>
    );
  }

  const wide = isCodeRailWide(widthPx, roomWidthPx);

  return (
    <aside
      className="code-rail"
      style={{ width: widthPx }}
      aria-label="Review — changes and pull request"
      data-testid="code-review-rail"
    >
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize the review rail"
        tabIndex={0}
        className="focus-ring code-rail__grip"
        onPointerDown={onPointerDown}
        onDoubleClick={() => onWidthChange(toggleCodeRailWidth(widthPx, roomWidthPx))}
        onKeyDown={onSeparatorKeyDown}
        title="Drag to resize · double-click for half width"
      />
      <div className="code-rail__bar">
        <div role="tablist" aria-label="Review surface" className="code-rail__tabs">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "changes"}
            data-selected={tab === "changes" ? "true" : undefined}
            className="focus-ring code-rail__tab"
            onClick={() => onTabChange("changes")}
          >
            Changes
            {files.length ? <span className="code-rail__tab-count">{files.length}</span> : null}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "pr"}
            data-selected={tab === "pr" ? "true" : undefined}
            className="focus-ring code-rail__tab"
            onClick={() => onTabChange("pr")}
          >
            Pull request
          </button>
        </div>
        <span className="code-rail__spacer" />
        <button
          type="button"
          className="focus-ring code-rail__action"
          aria-pressed={wide}
          aria-label={wide ? "Restore the rail width" : "Widen the rail to half the room"}
          title={wide ? "Restore the rail width" : "Widen the rail to half the room"}
          onClick={() => onWidthChange(toggleCodeRailWidth(widthPx, roomWidthPx))}
        >
          <Icon
            name={wide ? "ph:arrows-in-line-horizontal" : "ph:arrows-out-line-horizontal"}
            width={12}
            height={12}
            aria-hidden
          />
        </button>
        <button
          type="button"
          className="focus-ring code-rail__action"
          aria-label="Hide the review rail"
          title="Hide the review rail"
          onClick={() => {
            onOpenChange(false);
            announce("Review rail hidden.");
          }}
        >
          <Icon name="ph:caret-right" width={12} height={12} aria-hidden />
        </button>
      </div>

      {tab === "changes" ? (
        <>
          {files.length ? (
            <div className="code-rail__summary">
              <div className="code-rail__summary-head">
                <span className="code-rail__summary-label">worktree</span>
                <span className="code-rail__summary-count">{files.length}</span>
                <span className="code-rail__spacer" />
                <span className="code-rail__summary-viewed">
                  {viewedCount} of {files.length} viewed
                </span>
              </div>
              {/* The bar is decoration over numbers that are already printed —
                  colour is never the only channel for the diffstat. */}
              <div className="code-rail__bar-track" aria-hidden="true">
                <span className="code-rail__bar-add" style={{ width: `${bar.addedPct}%` }} />
                <span className="code-rail__bar-del" style={{ width: `${bar.removedPct}%` }} />
              </div>
              <div className="code-rail__summary-stat">
                <span className="code-rail__add">+{additions}</span>
                <span className="code-rail__del">&minus;{deletions}</span>
              </div>
            </div>
          ) : null}
          <div className="code-rail__body">
            <SessionChangesInner
              key={projectRoot}
              projectRoot={projectRoot}
              running={running}
              focusPath={focusPath}
              focusNonce={focusNonce}
              viewed={viewed}
              onToggleViewed={toggleViewed}
              onFilesChange={setFiles}
            />
          </div>
        </>
      ) : (
        <div className="code-rail__body">
          <LazyPr key={row.id} row={row} />
        </div>
      )}
    </aside>
  );
}
