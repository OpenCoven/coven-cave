"use client";

import type { CSSProperties } from "react";
import { Icon } from "@/lib/icon";
import { FamiliarAvatar } from "@/components/familiar-avatar";
import { FamiliarSwitcher } from "@/components/familiar-switcher";
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

        <button
          type="button"
          className="menu-bar__new focus-ring"
          onClick={() => onChatWithFamiliar(activeFamiliarId)}
          aria-label="Start a new chat"
        >
          <Icon name="ph:chat-circle-dots" width={14} aria-hidden />
          <span>New chat</span>
        </button>
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
