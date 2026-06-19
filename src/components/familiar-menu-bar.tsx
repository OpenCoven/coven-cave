"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { Icon } from "@/lib/icon";
import { FamiliarAvatar } from "@/components/familiar-avatar";
import { FamiliarSwitcher } from "@/components/familiar-switcher";
import { Popover } from "@/components/ui/popover";
import { computePresence, REMOTE_HARNESSES } from "@/lib/presence";
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
  /** Change the active-familiar scope (the switcher menu's "All"/per-familiar). */
  onSelectFamiliar: (id: string | null) => void;
  /** Jump to the task board. */
  onViewTasks: () => void;
  /** Jump to the inbox / schedules. */
  onViewInbox: () => void;
};

// How many familiars get a one-click chat avatar before the rest fold into the
// switcher menu. Keeps the bar legible on narrower desktop widths.
const MAX_QUICK_CHAT = 6;

function fmtBadge(n: number): string {
  return n > 99 ? "99+" : String(n);
}

/**
 * A slim, always-visible desktop top menu bar with exactly two jobs: start a
 * chat with a familiar (the avatar strip + switcher on the left) and view tasks
 * (the Tasks/Inbox buttons with live counts on the right). It is the desktop
 * counterpart to the mobile `.top-bar` (which stays hidden ≥1024px); this bar
 * is hidden below 1024px so the two never both render.
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
  onSelectFamiliar,
  onViewTasks,
  onViewInbox,
}: Props) {
  const quickChat = familiars.slice(0, MAX_QUICK_CHAT);

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

        {quickChat.length > 0 ? (
          <ul className="menu-bar__familiars" aria-label="Chat with a familiar">
            {quickChat.map((f) => {
              const needsReply = responseNeeded?.has(f.id) ?? false;
              const presence = computePresence({
                familiar: f,
                sessions,
                needsReply,
                isRemoteHarness: f.harness ? REMOTE_HARNESSES.has(f.harness) : false,
              });
              return (
                <li key={f.id}>
                  <button
                    type="button"
                    className="menu-bar__familiar focus-ring"
                    style={{ ["--familiar-accent" as string]: f.color } as CSSProperties}
                    onClick={() => onChatWithFamiliar(f.id)}
                    aria-label={`Chat with ${f.display_name}`}
                    title={`Chat with ${f.display_name} · ${presence.label}`}
                  >
                    <FamiliarAvatar familiar={f} size="sm" />
                    <span className={`menu-bar__presence ${presence.dot}`} aria-hidden />
                    {needsReply ? <span className="menu-bar__familiar-unread" aria-hidden /> : null}
                  </button>
                </li>
              );
            })}
          </ul>
        ) : null}

        <NewChatMenu
          familiars={familiars}
          activeFamiliarId={activeFamiliarId}
          onChatWithFamiliar={onChatWithFamiliar}
          onComposeChat={onComposeChat}
        />
      </div>

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
