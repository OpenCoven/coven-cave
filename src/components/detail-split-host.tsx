"use client";

/**
 * DetailSplitHost — wraps the main detail surface and adds two things:
 *
 *  1. A **drop zone**: while a sidebar page is being dragged, the main area
 *     lights up with left/right snap targets (modern-desktop style). Dropping
 *     opens that page beside the current one.
 *  2. A **resizable split**: when a secondary page is open it renders beside the
 *     primary in a nested resizable group whose divider *snaps* to clean ratios
 *     (⅓ · ½ · ⅔) and closes when dragged past the near edge.
 *
 * The host always renders (so the drop zone is available even with no split);
 * the split chrome only appears when `secondary` is provided.
 */

import React from "react";
import { Group, Panel, Separator, usePanelRef } from "react-resizable-panels";
import { SeparatorHandle } from "@/components/ui/separator-handle";
import { Icon, CAVE_ICON_SIZE } from "@/lib/icon";
import {
  PAGE_DRAG_START,
  PAGE_DRAG_END,
  type PageDragDetail,
} from "@/lib/page-drag";
import {
  SPLIT_DEFAULT_RATIO,
  SPLIT_MAX_RATIO,
  SPLIT_CLOSE_RATIO,
  nearestSnap,
  resolveSplitRelease,
  dividerOffset,
} from "@/lib/split-snap";

export type DetailSplitHostProps = {
  /** The primary surface (current workspace mode). */
  primary: React.ReactNode;
  /** The secondary page, or null when no split is open. */
  secondary: React.ReactNode | null;
  /** Title shown in the secondary pane header. */
  secondaryTitle: string;
  /** Which side the secondary pane occupies. */
  secondarySide: "left" | "right";
  /** Close the split. */
  onClose: () => void;
  /** A page was dropped into the main area on the given side. */
  onDropPage: (mode: string, side: "left" | "right") => void;
  /** Enable the drag-to-split drop zone (desktop only). */
  enableDrop: boolean;
};

const PCT = (ratio: number) => `${(ratio * 100).toFixed(2)}%`;

export function DetailSplitHost({
  primary,
  secondary,
  secondaryTitle,
  secondarySide,
  onClose,
  onDropPage,
  enableDrop,
}: DetailSplitHostProps) {
  const hasSplit = secondary != null;

  // ---- Drag-to-split drop zone -------------------------------------------
  const [pageDrag, setPageDrag] = React.useState<PageDragDetail | null>(null);
  const [hoverSide, setHoverSide] = React.useState<"left" | "right" | null>(null);

  React.useEffect(() => {
    if (!enableDrop) return;
    const onStart = (e: Event) => {
      const detail = (e as CustomEvent<PageDragDetail>).detail;
      if (detail?.mode) setPageDrag(detail);
    };
    const onEnd = () => {
      setPageDrag(null);
      setHoverSide(null);
    };
    window.addEventListener(PAGE_DRAG_START, onStart);
    window.addEventListener(PAGE_DRAG_END, onEnd);
    return () => {
      window.removeEventListener(PAGE_DRAG_START, onStart);
      window.removeEventListener(PAGE_DRAG_END, onEnd);
    };
  }, [enableDrop]);

  const handleDrop = (side: "left" | "right") => (e: React.DragEvent) => {
    e.preventDefault();
    const drag = pageDrag;
    setPageDrag(null);
    setHoverSide(null);
    if (drag?.mode) onDropPage(drag.mode, side);
  };

  // ---- Resizable split with snapping -------------------------------------
  const secRef = usePanelRef();
  const ratioRef = React.useRef(SPLIT_DEFAULT_RATIO);
  const draggingRef = React.useRef(false);
  const [dragRatio, setDragRatio] = React.useState<number | null>(null);

  // Reset the live divider tracking whenever a fresh split opens.
  React.useEffect(() => {
    if (hasSplit) {
      ratioRef.current = SPLIT_DEFAULT_RATIO;
      setDragRatio(null);
      draggingRef.current = false;
    }
  }, [hasSplit, secondarySide]);

  const onSecondaryResize = React.useCallback(
    (size: { asPercentage: number }) => {
      const ratio = size.asPercentage / 100;
      ratioRef.current = ratio;
      if (draggingRef.current) setDragRatio(ratio);
    },
    [],
  );

  const beginDividerDrag = React.useCallback(() => {
    draggingRef.current = true;
    setDragRatio(ratioRef.current);
    const finish = () => {
      window.removeEventListener("mouseup", finish);
      window.removeEventListener("pointerup", finish);
      if (!draggingRef.current) return;
      draggingRef.current = false;
      setDragRatio(null);
      const release = resolveSplitRelease(ratioRef.current);
      if (release.action === "close") onClose();
      else if (release.action === "snap") secRef.current?.resize(PCT(release.ratio));
    };
    window.addEventListener("mouseup", finish);
    window.addEventListener("pointerup", finish);
  }, [onClose, secRef]);

  // Keyboard / button snap helpers shown in the pane header.
  const snapTo = (ratio: number) => secRef.current?.resize(PCT(ratio));

  const separator = (
    <Separator className="shell-separator split-host__sep">
      <SeparatorHandle orientation="col" onMouseDown={beginDividerDrag} />
    </Separator>
  );

  const secondaryPanel = (
    <Panel
      id="split-secondary"
      className="split-host__pane-panel flex min-h-0 min-w-0"
      panelRef={secRef}
      defaultSize={PCT(SPLIT_DEFAULT_RATIO)}
      minSize="10%"
      maxSize={PCT(SPLIT_MAX_RATIO)}
      onResize={onSecondaryResize}
    >
      <section className="split-host__pane" aria-label={`${secondaryTitle} (split)`}>
        <header className="split-host__pane-head">
          <span className="split-host__pane-title">
            <Icon name="ph:columns" width={14} height={14} aria-hidden />
            {secondaryTitle}
          </span>
          <span className="split-host__pane-actions">
            <button
              type="button"
              className="split-host__pane-btn"
              title="Snap to a third"
              aria-label="Snap split to a third"
              onClick={() => snapTo(1 / 3)}
            >
              ⅓
            </button>
            <button
              type="button"
              className="split-host__pane-btn"
              title="Snap to half"
              aria-label="Snap split to half"
              onClick={() => snapTo(1 / 2)}
            >
              ½
            </button>
            <button
              type="button"
              className="split-host__pane-btn"
              title="Snap to two thirds"
              aria-label="Snap split to two thirds"
              onClick={() => snapTo(2 / 3)}
            >
              ⅔
            </button>
            <button
              type="button"
              className="split-host__pane-btn split-host__pane-close"
              title="Close split"
              aria-label="Close split"
              onClick={onClose}
            >
              <Icon name="ph:x" width={CAVE_ICON_SIZE.shellToggle} height={CAVE_ICON_SIZE.shellToggle} aria-hidden />
            </button>
          </span>
        </header>
        <div className="split-host__pane-body">{secondary}</div>
      </section>
    </Panel>
  );

  const primaryPanel = (
    <Panel id="split-primary" className="flex min-h-0 min-w-0" minSize="16%">
      <div className="min-h-0 min-w-0 flex-1">{primary}</div>
    </Panel>
  );

  // Live snap guide while dragging the divider.
  const snapPreview = dragRatio != null ? nearestSnap(dragRatio) : null;
  const guideRatio = snapPreview ? snapPreview.ratio : dragRatio;
  const guide =
    dragRatio != null && guideRatio != null ? (
      <div
        className={`split-host__guide${snapPreview ? " split-host__guide--snap" : ""}${
          dragRatio < SPLIT_CLOSE_RATIO ? " split-host__guide--close" : ""
        }`}
        style={{ left: PCT(dividerOffset(guideRatio, secondarySide)) }}
        aria-hidden
      >
        <span className="split-host__guide-chip">
          {dragRatio < SPLIT_CLOSE_RATIO ? "Close" : snapPreview ? snapPreview.label : null}
        </span>
      </div>
    ) : null;

  // Rendered as a Fragment (no wrapper element) so that in the common solo case
  // the primary surface stays a *direct* child of `.shell-detail` — several
  // layout rules depend on `.shell-detail > .cave-mode-fade`. The drop overlay
  // and snap guide are absolutely positioned against `.shell-detail`.
  return (
    <>
      {hasSplit ? (
        <Group className="split-host__group" orientation="horizontal">
          {secondarySide === "left" ? (
            <>
              {secondaryPanel}
              {separator}
              {primaryPanel}
            </>
          ) : (
            <>
              {primaryPanel}
              {separator}
              {secondaryPanel}
            </>
          )}
        </Group>
      ) : (
        primary
      )}

      {guide}

      {pageDrag ? (
        <div className="split-dropzone" data-active="">
          <button
            type="button"
            tabIndex={-1}
            className={`split-dropzone__half split-dropzone__half--left${
              hoverSide === "left" ? " is-hover" : ""
            }`}
            onDragOver={(e) => {
              e.preventDefault();
              setHoverSide("left");
            }}
            onDragLeave={() => setHoverSide((s) => (s === "left" ? null : s))}
            onDrop={handleDrop("left")}
          >
            <span className="split-dropzone__hint">
              <Icon name="ph:columns" width={20} height={20} aria-hidden />
              Open {pageDrag.label} left
            </span>
          </button>
          <button
            type="button"
            tabIndex={-1}
            className={`split-dropzone__half split-dropzone__half--right${
              hoverSide === "right" ? " is-hover" : ""
            }`}
            onDragOver={(e) => {
              e.preventDefault();
              setHoverSide("right");
            }}
            onDragLeave={() => setHoverSide((s) => (s === "right" ? null : s))}
            onDrop={handleDrop("right")}
          >
            <span className="split-dropzone__hint">
              <Icon name="ph:columns" width={20} height={20} aria-hidden />
              Open {pageDrag.label} right
            </span>
          </button>
        </div>
      ) : null}
    </>
  );
}
