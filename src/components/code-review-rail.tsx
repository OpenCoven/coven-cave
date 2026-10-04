"use client";

/**
 * CodeReviewRail — the Coding Desk's right column (cave-0rcku).
 *
 * The `Cody Code Reading v2` frame docks review beside the source: two tabs
 * (Changes, PR), a drag handle, double-click to swap between a reading width
 * and half the room, and a close that leaves a 28px spine still printing the
 * diffstat. That last part is the design decision worth protecting — a closed
 * panel that vanished entirely would make "is there anything to review?"
 * unanswerable without reopening it.
 *
 * Both tabs mount the proven panels (`SessionChangesInner`, `CodeSessionPrPanel`),
 * so this owns geometry and the summary header — nothing about git or GitHub.
 * The per-file *viewed* bookkeeping moved up to the workbench (#5705) so the
 * desk header can print review progress while the rail is a spine, and so
 * "Next unviewed" can open the file in the viewer AND focus its diff here.
 */

import { useCallback, useEffect, useId, useRef } from "react";
import dynamic from "next/dynamic";
import { Icon } from "@/lib/icon";
import { useAnnouncer } from "@/components/ui/live-region";
import { SessionChangesInner } from "@/components/session-changes-panel";
import { AfsPane } from "@/components/afs-pane";
import {
  CODE_RAIL_MIN_WIDTH_PX,
  clampCodeRailWidth,
  codeRailDiffBar,
  countCodeRailViewed,
  isCodeRailWide,
  toggleCodeRailWidth,
  type CodeRailTab,
  type CodeRailViewedState,
  codeRailShapeOf,
} from "@/lib/code-side-rail";
import { codeTablistKeyTarget } from "@/lib/code-tablist-keys";
import type { ChangedFile } from "@/lib/session-changes-api";
import type { SessionRow } from "@/lib/types";

const RAIL_TABS: ReadonlyArray<{ id: CodeRailTab; label: string }> = [
  { id: "changes", label: "Changes" },
  { id: "pr", label: "Pull request" },
  // The agent filesystem delta, which is not the checkout's working tree. The
  // pane hides itself when the daemon reports afs: false, so the tab can lead
  // to an empty surface on an older daemon.
  { id: "filesystem", label: "Filesystem" },
];

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
  /** False on the narrow Review step, where the rail fills the room and the
   *  grip and widen control could change nothing visible (#5729). */
  resizable?: boolean;
  /** On the narrow Review step the rail is that step's tabpanel. */
  stepPanel?: { id: string; labelledBy: string };
  focusPath?: string | null;
  focusNonce?: number;
  /** Open the full-width PR reader. Absent when the session has no PR. */
  onOpenFullPr?: () => void;
  /** The live changed-file list — the workbench's `useWorktreeChanges` summary (#5705). */
  files: ChangedFile[];
  viewed: CodeRailViewedState;
  onToggleViewed: (file: ChangedFile) => void;
  /** The next unviewed file, or null when every file is viewed. */
  nextUnviewed: ChangedFile | null;
  onOpenNextUnviewed: () => void;
  /** The changes panel's own fetched list, or null while it is not mounted, so
   *  the room can notice the two snapshots disagreeing (#5720 review). */
  onPanelFilesChange?: (files: ChangedFile[] | null) => void;
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
  resizable = true,
  stepPanel,
  focusPath,
  focusNonce,
  onOpenFullPr,
  files,
  viewed,
  onToggleViewed,
  nextUnviewed,
  onOpenNextUnviewed,
  onPanelFilesChange,
}: CodeReviewRailProps) {
  const { announce } = useAnnouncer();
  const tabIdBase = useId();
  const tabId = (id: CodeRailTab) => `${tabIdBase}-tab-${id}`;
  const panelId = `${tabIdBase}-panel`;
  const tabRefs = useRef(new Map<CodeRailTab, HTMLButtonElement>());
  // The AbortController rides along so an unmount mid-drag can tear the window
  // listeners down — typed rather than cast, so the field is real.
  const dragRef = useRef<{ pointerId: number; startX: number; startWidth: number; controller: AbortController } | null>(null);

  // ── Drag to resize ─────────────────────────────────────────────────────────
  // Pointer events on window, not the handle, so a fast drag that outruns the
  // 7px hit area keeps resizing instead of dropping the gesture.
  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      const controller = new AbortController();
      dragRef.current = { pointerId: event.pointerId, startX: event.clientX, startWidth: widthPx, controller };
      // One width per frame (#5745): pointermove fires faster than paint, and
      // each width re-rendered the whole desk.
      let frame = 0;
      let pending: number | null = null;
      const flush = () => {
        frame = 0;
        if (pending !== null) onWidthChange(pending);
        pending = null;
      };
      const move = (moveEvent: PointerEvent) => {
        const drag = dragRef.current;
        if (!drag || moveEvent.pointerId !== drag.pointerId) return;
        // The rail is on the right, so dragging left widens it.
        pending = clampCodeRailWidth(drag.startWidth - (moveEvent.clientX - drag.startX), roomWidthPx);
        if (!frame) frame = requestAnimationFrame(flush);
      };
      const end = (endEvent: PointerEvent) => {
        if (endEvent.pointerId !== dragRef.current?.pointerId) return;
        if (frame) cancelAnimationFrame(frame);
        flush();
        controller.abort();
        dragRef.current = null;
      };
      window.addEventListener("pointermove", move, { signal: controller.signal });
      window.addEventListener("pointerup", end, { signal: controller.signal });
      // A touch or pen gesture can end in pointercancel — same fix as the
      // terminal drawer's grip (#5707 review).
      window.addEventListener("pointercancel", end, { signal: controller.signal });
    },
    [onWidthChange, roomWidthPx, widthPx],
  );

  // The panel only exists on the Changes tab of an open rail; anywhere else
  // there is no second snapshot to reconcile.
  const panelMounted = open && tab === "changes";
  useEffect(() => {
    if (!panelMounted) onPanelFilesChange?.(null);
  }, [onPanelFilesChange, panelMounted]);

  // A drag interrupted by an unmount would otherwise leave two window
  // listeners alive holding this component's closure.
  useEffect(() => {
    return () => dragRef.current?.controller.abort();
  }, []);

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
  const viewedCount = countCodeRailViewed(viewed, files.map(codeRailShapeOf));

  if (!open) {
    return (
      <button
        type="button"
        className="focus-ring code-rail__spine"
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

  // One tab stop for the strip; arrows move and select (#5729). Each tab had
  // its own Tab stop before.
  const onTabKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    const next = codeTablistKeyTarget(event, index, RAIL_TABS.length);
    if (next === null) return;
    event.preventDefault();
    const target = RAIL_TABS[next].id;
    onTabChange(target);
    tabRefs.current.get(target)?.focus();
  };

  return (
    <aside
      className="code-rail"
      style={{ width: widthPx }}
      aria-label="Review — changes and pull request"
      data-testid="code-review-rail"
      id={stepPanel?.id}
      role={stepPanel ? "tabpanel" : undefined}
      aria-labelledby={stepPanel?.labelledBy}
    >
      {resizable ? (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize the review rail"
          // A focusable splitter says where it is (#5781), as the terminal
          // drawer's does: the bounds dragging allows, and the width now.
          aria-valuemin={CODE_RAIL_MIN_WIDTH_PX}
          aria-valuemax={clampCodeRailWidth(Number.MAX_SAFE_INTEGER, roomWidthPx)}
          aria-valuenow={widthPx}
          tabIndex={0}
          className="focus-ring code-rail__grip"
          onPointerDown={onPointerDown}
          onDoubleClick={() => onWidthChange(toggleCodeRailWidth(widthPx, roomWidthPx))}
          onKeyDown={onSeparatorKeyDown}
          title="Drag to resize · double-click for half width"
        />
      ) : null}
      <div className="code-rail__bar">
        <div role="tablist" aria-label="Review surface" className="code-rail__tabs">
          {RAIL_TABS.map(({ id, label }, index) => (
            <button
              key={id}
              ref={(node) => {
                if (node) tabRefs.current.set(id, node);
                else tabRefs.current.delete(id);
              }}
              type="button"
              role="tab"
              id={tabId(id)}
              aria-selected={tab === id}
              aria-controls={tab === id ? panelId : undefined}
              tabIndex={tab === id ? 0 : -1}
              data-selected={tab === id ? "true" : undefined}
              className="focus-ring code-rail__tab"
              onClick={() => onTabChange(id)}
              onKeyDown={(event) => onTabKeyDown(event, index)}
            >
              {label}
              {id === "changes" && files.length ? <span className="code-rail__tab-count">{files.length}</span> : null}
            </button>
          ))}
        </div>
        <span className="code-rail__spacer" />
        {/* The rail is a sidebar; a conversation, a commit list and a unified
            diff are not sidebar shapes. This is the frame's "Full PR view". */}
        {tab === "pr" && onOpenFullPr ? (
          <button type="button" className="focus-ring code-rail__full" onClick={onOpenFullPr}>
            Full PR view
          </button>
        ) : null}
        {resizable ? (
          <button
            type="button"
            className="focus-ring code-rail__action"
            aria-pressed={wide}
            // One name; aria-pressed carries the state (#5729).
            aria-label="Widen the rail"
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
        ) : null}
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

      <div className="code-rail__panel" role="tabpanel" id={panelId} aria-labelledby={tabId(tab)}>
        {tab === "changes" ? (
          <>
            {files.length ? (
              <div className="code-rail__summary">
                {/* Review progress only. "Worktree", the count and the +/−
                    figures print once, in the changes panel header right below
                    — printing them here too was the same line twice (#5718). */}
                <div className="code-rail__summary-head">
                  <span className="code-rail__summary-viewed">
                    {viewedCount} of {files.length} viewed
                  </span>
                  <button
                    type="button"
                    className="focus-ring code-rail__next"
                    disabled={!nextUnviewed}
                    title={nextUnviewed ? `Open ${nextUnviewed.path}` : "Every changed file is viewed"}
                    onClick={onOpenNextUnviewed}
                  >
                    Next unviewed
                    <Icon name="ph:arrow-right" width={11} height={11} aria-hidden />
                  </button>
                </div>
                {/* The bar is decoration over numbers the changes panel header
                    prints directly below — colour is never the only channel for
                    the diffstat. */}
                <div className="code-rail__bar-track" aria-hidden="true">
                  <span className="code-rail__bar-add" style={{ width: `${bar.addedPct}%` }} />
                  <span className="code-rail__bar-del" style={{ width: `${bar.removedPct}%` }} />
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
                onToggleViewed={onToggleViewed}
                onFilesChange={onPanelFilesChange}
              // Drafts follow the session, so a late work-root change keeps
              // the commit message and Create PR (#5745).
              draftKey={`session:${row.id}`}
              />
            </div>
          </>
        ) : tab === "filesystem" ? (
          <div className="code-rail__body">
            <AfsPane key={row.id} sessionId={row.id} />
          </div>
        ) : (
          <div className="code-rail__body">
            <LazyPr key={row.id} row={row} />
          </div>
        )}
      </div>
    </aside>
  );
}
