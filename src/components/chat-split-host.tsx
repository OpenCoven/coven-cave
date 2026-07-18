"use client";

/**
 * ChatSplitHost — wraps the chat surface and adds two things:
 *
 *  1. A **drop zone**: while a thread-rail conversation is being dragged, the
 *     chat area lights up with a live snap preview — the nearest edge (left /
 *     right / above / below) is resolved from the pointer position and the
 *     half the pane will occupy glows. Dropping opens that conversation there.
 *  2. A **resizable pane strip**: dropped conversations render beside (row) or
 *     stacked with (column) the primary chat in a react-resizable-panels group,
 *     each secondary pane with its own slim header (title · open as main · ✕).
 *
 * The chat sibling of DetailSplitHost (workspace pages); geometry and layout
 * rules live in `@/lib/chat-split`.
 */

import React from "react";
import { Group, Panel, Separator } from "react-resizable-panels";
import { SeparatorHandle } from "@/components/ui/separator-handle";
import { Icon, CAVE_ICON_SIZE } from "@/lib/icon";
import {
  CHAT_SESSION_DRAG_END,
  CHAT_SESSION_DRAG_MIME,
  CHAT_SESSION_DRAG_START,
  CHAT_SPLIT_PRIMARY,
  chatDropPreviewRect,
  chatDropZoneLabel,
  chatSplitQuadRows,
  emitChatSessionDragEnd,
  emitChatSessionDragStart,
  resolveChatDropZone,
  type ChatDropZone,
  type ChatSessionDragDetail,
  type ChatSplitAxis,
  type ChatSplitSizes,
} from "@/lib/chat-split";

export type ChatSplitTile = {
  /** CHAT_SPLIT_PRIMARY or a session id. */
  id: string;
  title: string;
  content: React.ReactNode;
};

export type ChatSplitHostProps = {
  /** Panes in layout order; must contain the primary tile. */
  panes: ChatSplitTile[];
  axis: ChatSplitAxis;
  /** Enable the drag-to-split drop zone (desktop, full-width chat only). */
  enableDrop: boolean;
  /** A conversation was dropped on the given snap zone. */
  onDropSession: (sessionId: string, zone: ChatDropZone) => void;
  /** Close one dropped pane. */
  onClosePane: (sessionId: string) => void;
  /** Promote a dropped pane to be the primary chat. */
  onPromotePane?: (sessionId: string) => void;
  /** The pane holding logical focus (visible affordance + keyboard target). */
  focusedPaneId?: string | null;
  /** A pane received pointer/keyboard focus. */
  onFocusPane?: (paneId: string) => void;
  /** Persisted pane sizes (RRP flex weights by pane id) to restore at mount.
   *  Applied only when the map covers exactly the current pane set — a stale
   *  or partial map falls back to an even layout. */
  sizes?: ChatSplitSizes;
  /** A user drag/keyboard resize settled ({} = divider double-click reset). */
  onSizesChange?: (sizes: ChatSplitSizes) => void;
};

/** DOM marker carrying the pane id, so keyboard focus moves can land real
 *  focus on the pane container (`[data-chat-split-pane="<id>"]`). */
export const CHAT_SPLIT_PANE_ATTR = "data-chat-split-pane";

const PANEL_ID_PREFIX = "chat-split-";

export function ChatSplitHost({
  panes,
  axis,
  enableDrop,
  onDropSession,
  onClosePane,
  onPromotePane,
  focusedPaneId,
  onFocusPane,
  sizes,
  onSizesChange,
}: ChatSplitHostProps) {
  const hasSplit = panes.length > 1;
  // A full split renders as a 2×2 grid (nested groups) instead of a four-up
  // strip; rows are dealt in reading order so focus/eviction order holds.
  const quadRows = chatSplitQuadRows(panes);

  // Bumped by a divider double-click: remounts the group with no restored
  // sizes, which is exactly "reset to an even split".
  const [resetNonce, setResetNonce] = React.useState(0);

  // Restore persisted sizes only when they describe exactly this pane set —
  // RRP would otherwise honor the stale weights it recognizes and squeeze
  // the rest, which reads as a corrupted layout. The quad grid always mounts
  // even: its weights live in three nested groups, which the flat per-pane
  // map can't describe honestly.
  const defaultLayout = React.useMemo(() => {
    if (!sizes || quadRows) return undefined;
    const ids = panes.map((tile) => tile.id);
    const keys = Object.keys(sizes);
    if (keys.length !== ids.length || !ids.every((id) => id in sizes)) return undefined;
    return Object.fromEntries(ids.map((id) => [`${PANEL_ID_PREFIX}${id}`, sizes[id]!]));
  }, [sizes, panes, quadRows]);

  // ---- Drag-to-split drop zone -------------------------------------------
  const [drag, setDrag] = React.useState<ChatSessionDragDetail | null>(null);
  const [zone, setZone] = React.useState<ChatDropZone | null>(null);
  const overlayRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    if (!enableDrop) return;
    const onStart = (e: Event) => {
      const detail = (e as CustomEvent<ChatSessionDragDetail>).detail;
      if (detail?.sessionId) setDrag(detail);
    };
    const onEnd = () => {
      setDrag(null);
      setZone(null);
    };
    window.addEventListener(CHAT_SESSION_DRAG_START, onStart);
    window.addEventListener(CHAT_SESSION_DRAG_END, onEnd);
    return () => {
      window.removeEventListener(CHAT_SESSION_DRAG_START, onStart);
      window.removeEventListener(CHAT_SESSION_DRAG_END, onEnd);
    };
  }, [enableDrop]);

  const zoneFromPointer = React.useCallback((e: React.DragEvent): ChatDropZone | null => {
    const el = overlayRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    return resolveChatDropZone(rect.width, rect.height, e.clientX - rect.left, e.clientY - rect.top);
  }, []);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setZone(zoneFromPointer(e));
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const sessionId = e.dataTransfer.getData(CHAT_SESSION_DRAG_MIME) || drag?.sessionId || "";
    const dropZone = zoneFromPointer(e) ?? zone;
    setDrag(null);
    setZone(null);
    if (sessionId && dropZone) onDropSession(sessionId, dropZone);
  };

  const preview = zone ? chatDropPreviewRect(zone) : null;

  const renderTile = (tile: ChatSplitTile) => {
    if (tile.id === CHAT_SPLIT_PRIMARY) {
      // The primary chat keeps its own header — no extra chrome.
      return <div className="chat-split__pane-body">{tile.content}</div>;
    }
    return (
      <section
        className="chat-split__tile"
        aria-label={`${tile.title} (split pane)`}
        aria-describedby={enableDrop ? `chat-split-hint-${tile.id}` : undefined}
      >
        {/* title tooltips aren't reliably announced — the reposition hint
            (drag OR the keyboard shortcut) rides an sr-only description. */}
        {enableDrop ? (
          <span className="sr-only" id={`chat-split-hint-${tile.id}`}>
            Drag this pane&apos;s header, or press Control or Command with Alt, Shift and an
            arrow key while the pane is focused, to reposition it.
          </span>
        ) : null}
        {/* The header is the pane's drag handle: dragging it re-enters the
            same session-drag protocol the thread rail uses, so the snap
            overlay lights up and dropping MOVES the pane (the layout's
            dedupe re-inserts an open session at the drop edge). Buttons
            inside stay clickable — a drag only starts past the threshold. */}
        <header
          className="chat-split__pane-head"
          draggable={enableDrop}
          title={enableDrop ? "Drag to reposition this pane" : undefined}
          onDragStart={(e) => {
            e.dataTransfer.setData(CHAT_SESSION_DRAG_MIME, tile.id);
            e.dataTransfer.effectAllowed = "move";
            emitChatSessionDragStart({ sessionId: tile.id, title: tile.title });
          }}
          onDragEnd={() => emitChatSessionDragEnd()}
        >
          <span className="chat-split__pane-title" title={tile.title}>
            {enableDrop ? (
              <Icon
                name="ph:dots-six-vertical"
                className="chat-split__pane-grip"
                width={13}
                height={13}
                aria-hidden
              />
            ) : (
              <Icon name="ph:chats-circle" width={13} height={13} aria-hidden />
            )}
            <span className="chat-split__pane-title-text">{tile.title}</span>
          </span>
          <span className="chat-split__pane-actions">
            {onPromotePane ? (
              <button
                type="button"
                className="chat-split__pane-btn"
                title="Open as main chat"
                aria-label={`Open ${tile.title} as main chat`}
                onClick={() => onPromotePane(tile.id)}
              >
                <Icon
                  name="ph:arrows-out-simple"
                  width={CAVE_ICON_SIZE.shellToggle}
                  height={CAVE_ICON_SIZE.shellToggle}
                  aria-hidden
                />
              </button>
            ) : null}
            <button
              type="button"
              className="chat-split__pane-btn chat-split__pane-close"
              title="Close pane"
              aria-label={`Close ${tile.title} pane`}
              onClick={() => onClosePane(tile.id)}
            >
              <Icon
                name="ph:x"
                width={CAVE_ICON_SIZE.shellToggle}
                height={CAVE_ICON_SIZE.shellToggle}
                aria-hidden
              />
            </button>
          </span>
        </header>
        <div className="chat-split__pane-body">{tile.content}</div>
      </section>
    );
  };

  const renderPanePanel = (tile: ChatSplitTile, minSize: string) => (
    <Panel
      id={`chat-split-${tile.id}`}
      className="chat-split__pane-panel flex min-h-0 min-w-0"
      // Pixel floors so a divider can't crush a conversation into
      // letter soup; stacked panes need less than side-by-side ones.
      minSize={minSize}
      {...{ [CHAT_SPLIT_PANE_ATTR]: tile.id }}
      tabIndex={-1}
      data-focused={focusedPaneId === tile.id ? "true" : undefined}
      onFocusCapture={() => onFocusPane?.(tile.id)}
      onPointerDownCapture={() => onFocusPane?.(tile.id)}
    >
      {renderTile(tile)}
    </Panel>
  );

  const resetSeparator = (orientation: "row" | "col") => (
    <Separator
      className="shell-separator chat-split__sep"
      onDoubleClick={() => {
        // Reset to an even split: remount. Only the strip persists weights —
        // clearing them from quad would wipe the saved ≤3-pane layout for a
        // grid that never reads the map in the first place.
        if (!quadRows) onSizesChange?.({});
        setResetNonce((nonce) => nonce + 1);
      }}
    >
      <SeparatorHandle orientation={orientation} />
    </Separator>
  );

  return (
    <>
      {hasSplit ? (
        quadRows ? (
          // Four panes: a 2×2 grid — nested groups keep every divider
          // draggable (the outer row divider + each row's column divider)
          // where a four-up strip would crush panes below readability.
          <Group
            key={`quad|${panes.map((tile) => tile.id).join("|")}|${resetNonce}`}
            className="chat-split__group"
            orientation="vertical"
          >
            {quadRows.map((row, rowIndex) => (
              <React.Fragment key={row.map((tile) => tile.id).join("|")}>
                {rowIndex > 0 ? resetSeparator("row") : null}
                <Panel
                  id={`chat-split-quad-row-${rowIndex}`}
                  className="chat-split__quad-row flex min-h-0 min-w-0"
                  minSize="160px"
                >
                  <Group className="chat-split__group chat-split__group--inner" orientation="horizontal">
                    {row.map((tile, colIndex) => (
                      <React.Fragment key={tile.id}>
                        {colIndex > 0 ? resetSeparator("col") : null}
                        {renderPanePanel(tile, "280px")}
                      </React.Fragment>
                    ))}
                  </Group>
                </Panel>
              </React.Fragment>
            ))}
          </Group>
        ) : (
          <Group
            // Remount on pane-set changes (mirrors DetailSplitHost, cave-hivd):
            // RRP squeezes a panel added to a live group below its min — a fresh
            // mount re-lays every pane out evenly. The reset nonce rides the same
            // key: divider double-click remounts into an even layout.
            key={`${axis}|${panes.map((tile) => tile.id).join("|")}|${resetNonce}`}
            className="chat-split__group"
            orientation={axis === "row" ? "horizontal" : "vertical"}
            defaultLayout={defaultLayout}
            onLayoutChanged={(layout, meta) => {
              // Only user-driven resizes persist — mount/constraint recomputes
              // would clobber the stored weights with defaults.
              if (!meta.isUserInteraction || !onSizesChange) return;
              const next: ChatSplitSizes = {};
              for (const [panelId, weight] of Object.entries(layout)) {
                if (panelId.startsWith(PANEL_ID_PREFIX)) {
                  next[panelId.slice(PANEL_ID_PREFIX.length)] = weight;
                }
              }
              onSizesChange(next);
            }}
          >
            {panes.map((tile, i) => (
              <React.Fragment key={tile.id}>
                {i > 0 ? resetSeparator(axis === "row" ? "col" : "row") : null}
                {renderPanePanel(tile, axis === "row" ? "280px" : "160px")}
              </React.Fragment>
            ))}
          </Group>
        )
      ) : (
        panes[0]?.content ?? null
      )}

      {enableDrop && drag ? (
        <div
          ref={overlayRef}
          className="chat-split__dropzone"
          data-zone={zone ?? undefined}
          onDragOver={handleDragOver}
          onDragLeave={(e) => {
            // Only clear when actually leaving the overlay (not entering the
            // pointer-events:none preview child).
            if (e.currentTarget === e.target) setZone(null);
          }}
          onDrop={handleDrop}
        >
          {preview && zone ? (
            <div
              className="chat-split__preview"
              style={{
                left: `${preview.left}%`,
                top: `${preview.top}%`,
                width: `${preview.width}%`,
                height: `${preview.height}%`,
              }}
              aria-hidden
            >
              <span className="chat-split__hint">
                <Icon
                  name={zone === "top" || zone === "bottom" ? "ph:rows" : "ph:columns"}
                  width={16}
                  height={16}
                  aria-hidden
                />
                Open {drag.title} {chatDropZoneLabel(zone)}
              </span>
            </div>
          ) : (
            <span className="chat-split__hint chat-split__hint--idle">
              <Icon name="ph:squares-four" width={16} height={16} aria-hidden />
              Drag toward an edge to split
            </span>
          )}
        </div>
      ) : null}
    </>
  );
}
