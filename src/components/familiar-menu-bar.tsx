"use client";

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Icon } from "@/lib/icon";
import { FamiliarSwitcher } from "@/components/familiar-switcher";
import { Popover } from "@/components/ui/popover";
import type { ResolvedFamiliar } from "@/lib/familiar-resolve";
import type { SessionRow } from "@/lib/types";

type Props = {
  familiars: ResolvedFamiliar[];
  activeFamiliarId: string | null;
  sessions: SessionRow[];
  responseNeeded?: Set<string>;
  /** Open task count (board cards not yet done) — drives the Tasks badge. */
  taskCount: number;
  /** Items needing attention — drives the Inbox badge. */
  inboxCount: number;
  /** Start a chat with a familiar (`null` = the active/default familiar). */
  onChatWithFamiliar: (id: string | null) => void;
  /** Start a chat with a familiar and an opening message (auto-sent on entry). */
  onComposeChat: (id: string | null, prompt: string) => void;
  /** Open the shared context-aware search palette. */
  onOpenSearch: () => void;
  /** Shared top-search query, mirrored with the mobile top bar and palette. */
  searchQuery: string;
  /** Update shared top-search query. */
  onSearchQueryChange: (query: string) => void;
  /** Change the active-familiar scope (the switcher menu's "All"/per-familiar). */
  onSelectFamiliar: (id: string | null) => void;
  /** Jump to the task board. */
  onViewTasks: () => void;
  /** Jump to the inbox / schedules. */
  onViewInbox: () => void;
};

function fmtBadge(n: number): string {
  return n > 99 ? "99+" : String(n);
}

/**
 * A slim, always-visible desktop top menu bar with the familiar selector,
 * global search, and task/inbox counters. It is the desktop counterpart to the
 * mobile `.top-bar` (which stays hidden ≥1024px); this bar is hidden below
 * 1024px so the two never both render.
 */
export function FamiliarMenuBar({
  familiars,
  activeFamiliarId,
  sessions,
  responseNeeded,
  taskCount,
  inboxCount,
  onChatWithFamiliar,
  onComposeChat,
  onOpenSearch,
  searchQuery,
  onSearchQueryChange,
  onSelectFamiliar,
  onViewTasks,
  onViewInbox,
}: Props) {
  return (
    <nav className="menu-bar" aria-label="Chat with familiars and view tasks">
      <div className="menu-bar__group menu-bar__group--chat">
        <FamiliarSwitcher
          familiars={familiars}
          activeFamiliarId={activeFamiliarId}
          sessions={sessions}
          responseNeeded={responseNeeded}
          onSelectFamiliar={onSelectFamiliar}
          placement="bottom-start"
          labeled
        />

        <NewChatMenu
          familiars={familiars}
          activeFamiliarId={activeFamiliarId}
          onChatWithFamiliar={onChatWithFamiliar}
          onComposeChat={onComposeChat}
        />
      </div>

      <form
        className="menu-bar__search"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          onOpenSearch();
        }}
      >
        <Icon name="ph:magnifying-glass" width={13} className="menu-bar__search-icon" aria-hidden />
        <input
          type="search"
          className="menu-bar__search-input"
          value={searchQuery}
          onChange={(e) => onSearchQueryChange(e.target.value)}
          onFocus={onOpenSearch}
          placeholder="Search or ask Salem..."
          aria-label="Search anything or ask Salem"
          autoComplete="off"
          spellCheck={false}
        />
        <kbd>⌘K</kbd>
      </form>

      <div className="menu-bar__group menu-bar__group--tasks">
        <button
          type="button"
          className="menu-bar__task focus-ring"
          onClick={onViewTasks}
          aria-label={taskCount > 0 ? `View tasks — ${taskCount} open` : "View tasks"}
        >
          <Icon name="ph:kanban" width={15} aria-hidden />
          <span>Tasks</span>
          {taskCount > 0 ? <span className="menu-bar__badge">{fmtBadge(taskCount)}</span> : null}
        </button>
        <button
          type="button"
          className="menu-bar__task focus-ring"
          onClick={onViewInbox}
          aria-label={inboxCount > 0 ? `View inbox — ${inboxCount} need attention` : "View inbox"}
        >
          <Icon name="ph:tray" width={15} aria-hidden />
          <span>Inbox</span>
          {inboxCount > 0 ? (
            <span className="menu-bar__badge menu-bar__badge--alert">{fmtBadge(inboxCount)}</span>
          ) : null}
        </button>
      </div>
    </nav>
  );
}

/**
 * The "New chat" control: a button that opens a small quick-chat dropdown — pick
 * a familiar and (optionally) type an opening message. Submitting with text
 * starts the chat and auto-sends the message; submitting empty just opens a
 * blank chat with the selected familiar.
 */
function NewChatMenu({
  familiars,
  activeFamiliarId,
  onChatWithFamiliar,
  onComposeChat,
}: {
  familiars: ResolvedFamiliar[];
  activeFamiliarId: string | null;
  onChatWithFamiliar: (id: string | null) => void;
  onComposeChat: (id: string | null, prompt: string) => void;
}) {
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(activeFamiliarId);

  // Each time the dropdown opens, default the selection to the active familiar
  // (or the first one) and focus the composer so you can type straight away.
  useEffect(() => {
    if (!open) return;
    setSelectedId(activeFamiliarId ?? familiars[0]?.id ?? null);
    const t = window.setTimeout(() => textareaRef.current?.focus(), 0);
    return () => window.clearTimeout(t);
  }, [open, activeFamiliarId, familiars]);

  const selectedName = familiars.find((f) => f.id === selectedId)?.display_name ?? "a familiar";

  const autoGrow = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, []);

  const handleStart = useCallback(() => {
    const prompt = text.trim();
    if (prompt) onComposeChat(selectedId, prompt);
    else onChatWithFamiliar(selectedId);
    setText("");
    setOpen(false);
  }, [text, selectedId, onComposeChat, onChatWithFamiliar]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      // plain Enter sends; Shift+Enter inserts a newline
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleStart();
      }
    },
    [handleStart],
  );

  return (
    <>
      <button
        type="button"
        ref={triggerRef}
        className="menu-bar__new focus-ring"
        onClick={() => setOpen((v) => !v)}
        aria-label="Start a new chat"
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <Icon name="ph:chat-circle-dots" width={14} aria-hidden />
        <span>New chat</span>
      </button>
      <Popover
        open={open}
        onOpenChange={setOpen}
        anchorRef={triggerRef}
        placement="bottom-start"
        minWidth={300}
        className="menu-bar__compose"
      >
        <div className="menu-bar__compose-row">
          <label className="menu-bar__compose-label" htmlFor="menu-bar-compose-familiar">
            To
          </label>
          <select
            id="menu-bar-compose-familiar"
            className="menu-bar__compose-select"
            value={selectedId ?? ""}
            onChange={(e) => setSelectedId(e.target.value || null)}
          >
            {familiars.map((f) => (
              <option key={f.id} value={f.id}>
                {f.display_name}
              </option>
            ))}
          </select>
        </div>
        <textarea
          ref={textareaRef}
          className="menu-bar__compose-input"
          placeholder={`Ask ${selectedName} anything…`}
          rows={3}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            autoGrow();
          }}
          onKeyDown={handleKeyDown}
          aria-label="Message"
          enterKeyHint="send"
        />
        <div className="menu-bar__compose-actions">
          <button type="button" className="menu-bar__compose-send focus-ring" onClick={handleStart}>
            <span>Open chat</span>
            <kbd className="menu-bar__compose-kbd" aria-hidden>
              ↵
            </kbd>
          </button>
        </div>
      </Popover>
    </>
  );
}
