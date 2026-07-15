"use client";

import { useState } from "react";

import { Icon } from "@/lib/icon";
import { Button } from "@/components/ui/button";
import { RelativeTime } from "@/components/ui/relative-time";
import { modelIcon, modelLabel } from "@/lib/model-label";
import type { SessionRow } from "@/lib/types";
import { stripLeadingTrailingEmoji } from "@/lib/cave-chat-titles";
import { sessionGlyph, glyphToneClass, stripTaskPrefix } from "@/lib/projects/session-glyph";
import { ContextMenu, openContextMenuAt, type ContextMenuState } from "@/components/ui/context-menu";
import { PopoverItem, PopoverSeparator } from "@/components/ui/popover";

import { chatDotClass, type MoveTarget } from "./projects-shared";

// A chat under the selected project: click opens it (via the
// agents-open-session event the chat surface already listens for); the context
// menu moves it to another project (the same Cave-local override + undo path
// the old drag-and-drop used). The trash button deletes the chat with a
// two-step confirm, mirroring the Chats list.
//
// In select mode the row's role flips to checkbox and its primary click
// toggles selection instead of opening the chat, so several chats can be
// deleted together via the section's bulk toolbar.
export function ProjectChatRow({
  session,
  displayTitle,
  onOpen,
  onDelete,
  selectMode,
  selected,
  onToggleSelect,
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
  moveTargets: MoveTarget[];
  onMoveSession: (sessionId: string, targetRoot: string) => void;
}) {
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
    <li className="group/pc relative rounded-[var(--radius-control)]">
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
        className="focus-ring projects-session-row flex w-full items-center gap-2 px-4 py-1 text-left text-[12px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] data-[selected=true]:bg-[var(--accent-presence)]/10 data-[selected=true]:text-[var(--text-primary)]"
      >
        {selectMode ? (
          <span
            aria-hidden
            className={`grid h-3.5 w-3.5 shrink-0 place-items-center rounded-[var(--radius-control)] border ${
              selected
                ? "border-[var(--accent-presence)] bg-[var(--accent-presence)] text-[var(--text-primary)]"
                : "border-[var(--border-strong)] text-transparent"
            }`}
          >
            <Icon name="ph:check-bold" width={9} aria-hidden />
          </span>
        ) : null}
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
            {session.model ? (
              <span
                className="hidden items-center gap-0.5 rounded-[var(--radius-control)] bg-[var(--bg-raised)]/70 px-1 py-px font-medium sm:inline-flex"
                title={`Model: ${session.model}`}
              >
                <Icon name={modelIcon(session.model)} width={10} aria-hidden />
                <span className="truncate">{modelLabel(session.model)}</span>
              </span>
            ) : null}
            {branch ? (
              <span className="hidden max-w-[10rem] items-center gap-0.5 truncate font-mono sm:inline-flex" title={`Branch: ${branch}`}>
                <Icon name="ph:git-branch-bold" width={10} aria-hidden />
                <span className="truncate">{branch}</span>
              </span>
            ) : null}
            {hasDiff ? (
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
            <Button
              variant="ghost"
              size="xs"
              onClick={(e) => {
                e.stopPropagation();
                setConfirmDelete(false);
              }}
              className="rounded-[var(--radius-control)] px-1.5 py-0.5 text-[10px] text-[var(--text-muted)] hover:bg-[var(--bg-hover)]"
            >
              Cancel
            </Button>
            <Button
              variant="danger-ghost"
              size="xs"
              disabled={deleting}
              onClick={async (e) => {
                e.stopPropagation();
                setDeleting(true);
                await onDelete(session.id);
                setDeleting(false);
                setConfirmDelete(false);
              }}
              className="rounded-[var(--radius-control)] border border-[var(--color-danger)]/50 bg-[var(--color-danger)]/10 px-1.5 py-0.5 text-[10px] text-[var(--color-danger)] hover:bg-[var(--color-danger)]/15 disabled:opacity-50"
            >
              Delete
            </Button>
          </span>
        ) : (
          <Button
            variant="ghost"
            size="xs"
            onClick={(e) => {
              e.stopPropagation();
              setConfirmDelete(true);
            }}
            title="Delete thread"
            aria-label={`Delete thread ${title}`}
            className="grid h-5 w-5 shrink-0 place-items-center rounded-[var(--radius-control)] p-0 text-[var(--text-muted)] opacity-55 transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--color-danger)] focus-visible:opacity-100 group-hover/pc:opacity-100 [@media(pointer:coarse)]:opacity-100"
            leadingIcon="ph:x-bold"
          />
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
