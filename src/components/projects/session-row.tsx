"use client";

import { useState, type CSSProperties } from "react";

import { Icon } from "@/lib/icon";
import { RelativeTime } from "@/components/ui/relative-time";
import { modelIcon, modelLabel } from "@/lib/model-label";
import type { SessionRow } from "@/lib/types";
import { stripLeadingTrailingEmoji } from "@/lib/cave-chat-titles";
import type { ProjectsDensity } from "@/lib/projects/projects-ui-state";
import { sessionGlyph, glyphToneClass, stripTaskPrefix } from "@/lib/projects/session-glyph";
import { ContextMenu, openContextMenuAt, type ContextMenuState } from "@/components/ui/context-menu";
import { PopoverItem, PopoverSeparator } from "@/components/ui/popover";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import { chatDotClass, type MoveTarget } from "./projects-shared";

// A chat under a project card: click opens it (via the agents-open-session
// event the chat surface already listens for); the handle drags it to reorder
// within the project or onto another project card to move it. The trash button
// deletes the chat with a two-step confirm, mirroring the Chats list.
//
// In select mode the leading drag handle becomes a checkbox and the row's
// primary click toggles selection instead of opening the chat, so several chats
// can be deleted together via the card's bulk toolbar.
export function ProjectChatRow({
  session,
  displayTitle,
  onOpen,
  onDelete,
  selectMode,
  selected,
  onToggleSelect,
  density,
  moveTargets,
  onMoveSession,
}: {
  session: SessionRow;
  displayTitle?: string;
  onOpen: () => void;
  onDelete: (id: string) => Promise<void>;
  selectMode: boolean;
  selected: boolean;
  onToggleSelect: (id: string) => void;
  density: ProjectsDensity;
  moveTargets: MoveTarget[];
  onMoveSession: (sessionId: string, targetRoot: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: session.id,
  });
  const style: CSSProperties = { transform: CSS.Translate.toString(transform), transition };
  const title = stripLeadingTrailingEmoji(stripTaskPrefix(displayTitle ?? (session.title || "(untitled chat)")));
  const glyph = sessionGlyph(session);
  const branch = session.git?.branch ?? null;
  const diff = session.diff ?? null;
  const hasDiff = !!diff && (diff.additions > 0 || diff.deletions > 0);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [menu, setMenu] = useState<ContextMenuState>(null);
  const [menuView, setMenuView] = useState<"root" | "move">("root");
  const activate = () => (selectMode ? onToggleSelect(session.id) : onOpen());
  return (
    <li
      ref={setNodeRef}
      style={style}
      data-dragging={isDragging ? "true" : undefined}
      className="group/pc relative rounded-md data-[dragging=true]:z-10 data-[dragging=true]:bg-[var(--bg-raised)] data-[dragging=true]:opacity-90 data-[dragging=true]:shadow-[0_8px_24px_oklch(0_0_0/35%)] data-[dragging=true]:ring-1 data-[dragging=true]:ring-[var(--border-strong)]"
    >
      <div
        role={selectMode ? "checkbox" : "button"}
        aria-checked={selectMode ? selected : undefined}
        tabIndex={0}
        data-proj-nav
        data-proj-label={title}
        onContextMenu={(e) => {
          setMenuView("root");
          openContextMenuAt(setMenu)(e);
        }}
        onClick={activate}
        onKeyDown={(e) => {
          // ARIA button/checkbox pattern: Enter and Space both activate.
          // preventDefault on Space stops the page from scrolling when focused.
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            activate();
          }
        }}
        data-selected={selectMode && selected ? "true" : undefined}
        className={`focus-ring projects-session-row flex w-full items-center gap-2 px-4 text-left text-[12px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] data-[selected=true]:bg-[var(--accent-presence)]/10 data-[selected=true]:text-[var(--text-primary)] ${density === "compact" ? "py-0.5" : "py-1"}`}
      >
        {selectMode ? (
          <span
            aria-hidden
            className={`grid h-3.5 w-3.5 shrink-0 place-items-center rounded border ${
              selected
                ? "border-[var(--accent-presence)] bg-[var(--accent-presence)] text-[var(--text-primary)]"
                : "border-[var(--border-strong)] text-transparent"
            }`}
          >
            <Icon name="ph:check-bold" width={9} aria-hidden />
          </span>
        ) : (
          <button
            type="button"
            {...attributes}
            {...listeners}
            onClick={(e) => e.stopPropagation()}
            title="Drag to reorder or move to another project"
            aria-label={`Move ${title}`}
            className="grid h-4 w-3 shrink-0 cursor-grab touch-none place-items-center text-[var(--text-muted)] opacity-0 transition-opacity hover:text-[var(--text-secondary)] focus-visible:opacity-100 group-hover/pc:opacity-100 [@media(pointer:coarse)]:opacity-100"
          >
            <Icon name="ph:dots-six-vertical" width={10} aria-hidden />
          </button>
        )}
        <span
          className={`grid h-3.5 w-3.5 shrink-0 place-items-center ${glyphToneClass(glyph.tone)}`}
          title={glyph.label}
          aria-label={glyph.label}
          role="img"
        >
          {glyph.icon ? (
            <Icon name={glyph.icon} width={13} className={glyph.spin ? "animate-spin" : undefined} aria-hidden />
          ) : (
            <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${chatDotClass(session.status)}`} />
          )}
        </span>
        <span className="min-w-0 flex-1 truncate" title={title}>{title}</span>
        {selectMode ? null : (
          <span className="flex shrink-0 items-center gap-2 text-[10px] text-[var(--text-muted)]">
            {density === "comfortable" && session.model ? (
              <span
                className="hidden items-center gap-0.5 rounded-[4px] bg-[var(--bg-raised)]/70 px-1 py-px font-medium sm:inline-flex"
                title={`Model: ${session.model}`}
              >
                <Icon name={modelIcon(session.model)} width={10} aria-hidden />
                <span className="truncate">{modelLabel(session.model)}</span>
              </span>
            ) : null}
            {density === "comfortable" && branch ? (
              <span className="hidden max-w-[10rem] items-center gap-0.5 truncate font-mono sm:inline-flex" title={`Branch: ${branch}`}>
                <Icon name="ph:git-branch-bold" width={10} aria-hidden />
                <span className="truncate">{branch}</span>
              </span>
            ) : null}
            {density === "comfortable" && hasDiff ? (
              <span className="hidden items-center gap-1 font-mono sm:inline-flex" title={`+${diff!.additions} −${diff!.deletions}`}>
                <span className="text-[var(--color-success)]">+{diff!.additions}</span>
                <span className="text-[var(--color-danger)]">−{diff!.deletions}</span>
              </span>
            ) : null}
            <RelativeTime iso={session.updated_at} className="tabular-nums" />
          </span>
        )}
        {selectMode ? null : confirmDelete ? (
          <span className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setConfirmDelete(false);
              }}
              className="focus-ring rounded px-1.5 py-0.5 text-[10px] text-[var(--text-muted)] hover:bg-[var(--bg-hover)]"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={deleting}
              onClick={async (e) => {
                e.stopPropagation();
                setDeleting(true);
                await onDelete(session.id);
                setDeleting(false);
                setConfirmDelete(false);
              }}
              className="focus-ring rounded border border-[var(--color-danger)]/50 bg-[var(--color-danger)]/10 px-1.5 py-0.5 text-[10px] text-[var(--color-danger)] hover:bg-[var(--color-danger)]/15 disabled:opacity-50"
            >
              Delete
            </button>
          </span>
        ) : (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setConfirmDelete(true);
            }}
            title="Delete thread"
            aria-label={`Delete thread ${title}`}
            className="focus-ring grid h-5 w-5 shrink-0 place-items-center rounded text-[var(--text-muted)] opacity-55 transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--color-danger)] focus-visible:opacity-100 group-hover/pc:opacity-100 [@media(pointer:coarse)]:opacity-100"
          >
            <Icon name="ph:x-bold" width={10} aria-hidden />
          </button>
        )}
      </div>
      <ContextMenu
        state={menu}
        onClose={() => { setMenu(null); setMenuView("root"); }}
        ariaLabel={`Actions for ${title}`}
      >
        {menuView === "root" ? (
          <>
            <PopoverItem icon="ph:chat-circle-dots-bold" onSelect={() => { setMenu(null); onOpen(); }}>
              Open chat
            </PopoverItem>
            {moveTargets.length > 0 ? (
              <PopoverItem icon="ph:folder-open-bold" onSelect={() => setMenuView("move")}>
                Move to project…
              </PopoverItem>
            ) : null}
            <PopoverSeparator />
            <PopoverItem icon="ph:trash-bold" danger onSelect={() => { setMenu(null); setConfirmDelete(true); }}>
              Delete chat…
            </PopoverItem>
          </>
        ) : (
          <>
            <PopoverItem icon="ph:caret-left" onSelect={() => setMenuView("root")}>
              Back
            </PopoverItem>
            <PopoverSeparator />
            {moveTargets.map((target) => (
              <PopoverItem
                key={target.id}
                icon="ph:folder-simple-dashed"
                onSelect={() => { setMenu(null); setMenuView("root"); onMoveSession(session.id, target.root); }}
              >
                {target.name}
              </PopoverItem>
            ))}
          </>
        )}
      </ContextMenu>
    </li>
  );
}
