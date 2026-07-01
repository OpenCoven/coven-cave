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
import { workspaceTileVariant } from "@/lib/workspace-tiles";

export type DetailSplitTile = {
  id: string;
  title: string;
  content: React.ReactNode;
};

export type DetailSplitHostProps = {
  /** The primary surface (current workspace mode). */
  primary: React.ReactNode;
  /** Secondary pages/companions shown beside the primary, capped by Workspace. */
  secondaryTiles: DetailSplitTile[];
  /** Which side the secondary pane occupies. */
  secondarySide: "left" | "right";
  /** Close every secondary tile. */
  onClose: () => void;
  /** Close one secondary tile. */
  onCloseTile: (id: string) => void;
  /** A page was dropped into the main area on the given side. */
  onDropPage: (mode: string, side: "left" | "right") => void;
  /** Enable the drag-to-split drop zone (desktop only). */
  enableDrop: boolean;
};

const PCT = (ratio: number) => `${(ratio * 100).toFixed(2)}%`;

export function DetailSplitHost({
  primary,
  secondaryTiles,
  secondarySide,
  onClose,
  onCloseTile,
  onDropPage,
  enableDrop,
}: DetailSplitHostProps) {
  const hasSplit = secondaryTiles.length > 0;
  const primaryTile = React.useMemo<DetailSplitTile>(
    () => ({ id: "primary", title: "Current", content: primary }),
    [primary],
  );
  const tiles = React.useMemo(
    () =>
      secondaryTiles.length === 1 && secondarySide === "left"
        ? [secondaryTiles[0]!, primaryTile]
        : [primaryTile, ...secondaryTiles],
    [primaryTile, secondarySide, secondaryTiles],
  );
  const variant = workspaceTileVariant(tiles.length);
  const [activeTileId, setActiveTileId] = React.useState("primary");

  React.useEffect(() => {
    if (!tiles.some((tile) => tile.id === activeTileId)) setActiveTileId("primary");
  }, [activeTileId, tiles]);

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
    if (secondaryTiles.length === 1) {
      ratioRef.current = SPLIT_DEFAULT_RATIO;
      setDragRatio(null);
      draggingRef.current = false;
    }
  }, [secondaryTiles.length, secondarySide]);

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

  const legacySecondaryTile = secondaryTiles[0] ?? null;
  const mobileSwitcher = hasSplit ? (
    <div className="split-host__mobile-switcher" role="tablist" aria-label="Open pages">
      {tiles.map((tile) => (
        <button
          key={tile.id}
          type="button"
          role="tab"
          aria-selected={activeTileId === tile.id}
          className="split-host__mobile-tab"
          onClick={() => setActiveTileId(tile.id)}
        >
          {tile.title}
        </button>
      ))}
    </div>
  ) : null;

  const secondaryPanel = legacySecondaryTile ? (
    <Panel
      id="split-secondary"
      className="split-host__pane-panel split-host__tile-panel flex min-h-0 min-w-0"
      data-active={activeTileId === legacySecondaryTile.id}
      panelRef={secRef}
      defaultSize={PCT(SPLIT_DEFAULT_RATIO)}
      minSize="10%"
      maxSize={PCT(SPLIT_MAX_RATIO)}
      onResize={onSecondaryResize}
    >
      <section className="split-host__pane split-host__tile" aria-label={`${legacySecondaryTile.title} (split)`}>
        <header className="split-host__pane-head">
          <span className="split-host__pane-title">
            <Icon name="ph:columns" width={14} height={14} aria-hidden />
            {legacySecondaryTile.title}
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
              onClick={() => onCloseTile(legacySecondaryTile.id)}
            >
              <Icon name="ph:x" width={CAVE_ICON_SIZE.shellToggle} height={CAVE_ICON_SIZE.shellToggle} aria-hidden />
            </button>
          </span>
        </header>
        <div className="split-host__pane-body">{legacySecondaryTile.content}</div>
      </section>
    </Panel>
  ) : null;

  const primaryPanel = (
    <Panel
      id="split-primary"
      className="split-host__tile-panel flex min-h-0 min-w-0"
      data-active={activeTileId === "primary"}
      minSize="16%"
    >
      <div className="min-h-0 min-w-0 flex-1">{primary}</div>
    </Panel>
  );

  const renderGridTile = (tile: DetailSplitTile) => {
    const isPrimary = tile.id === "primary";
    return (
      <section
        key={tile.id}
        className={`split-host__pane split-host__tile${isPrimary ? " split-host__tile--primary" : ""}`}
        data-active={activeTileId === tile.id}
        aria-label={isPrimary ? tile.title : `${tile.title} (split)`}
      >
        <header className="split-host__pane-head">
          <span className="split-host__pane-title">
            <Icon name={isPrimary ? "ph:rows" : "ph:columns"} width={14} height={14} aria-hidden />
            {tile.title}
          </span>
          {!isPrimary ? (
            <span className="split-host__pane-actions">
              <button
                type="button"
                className="split-host__pane-btn split-host__pane-close"
                title="Close split"
                aria-label={`Close ${tile.title} split`}
                onClick={() => onCloseTile(tile.id)}
              >
                <Icon name="ph:x" width={CAVE_ICON_SIZE.shellToggle} height={CAVE_ICON_SIZE.shellToggle} aria-hidden />
              </button>
            </span>
          ) : null}
        </header>
        <div className="split-host__pane-body">{tile.content}</div>
      </section>
    );
  };

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
        secondaryTiles.length === 1 ? (
          <>
            {mobileSwitcher}
            <Group className="split-host__group" data-variant={variant} orientation="horizontal">
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
          </>
        ) : (
          <>
            {mobileSwitcher}
            <div className="split-host__group split-host__grid" data-variant={variant}>
              {tiles.map(renderGridTile)}
            </div>
          </>
        )
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
