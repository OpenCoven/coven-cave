"use client";

import { useEffect } from "react";
import type { DaemonStatus, Familiar } from "@/lib/types";
import type { InboxItem } from "@/lib/cave-inbox";
import type { InboxPrefs } from "@/lib/cave-inbox-prefs";
import { NotificationBell } from "@/components/notification-bell";

export type Mode = "chats" | "board" | "inbox" | "plugins";

type Props = {
  mode: Mode;
  onModeChange: (mode: Mode) => void;
  inboxBadgeCount?: number;
  onRunningChange?: (running: boolean) => void;
  inboxItems?: InboxItem[];
  inboxPrefs?: InboxPrefs;
  familiars?: Familiar[];
  onOpenInbox?: () => void;
  onOpenInboxItem?: (item: InboxItem) => void;
  onPrefsChanged?: () => void;
};

const MODE_LABEL: Record<Mode, string> = {
  chats: "Chats",
  board: "Board",
  inbox: "Inbox",
  plugins: "Plugins",
};

export function DaemonBar({
  mode,
  onModeChange,
  inboxBadgeCount = 0,
  onRunningChange,
  inboxItems = [],
  inboxPrefs,
  familiars = [],
  onOpenInbox,
  onOpenInboxItem,
  onPrefsChanged,
}: Props) {
  // Daemon status is polled silently so other panes (chat list, familiar rail)
  // can react via `onRunningChange`. The header no longer renders the status —
  // start/stop happens via /doctor or the CLI.
  useEffect(() => {
    if (!onRunningChange) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch("/api/daemon/status", { cache: "no-store" });
        const json = (await res.json()) as DaemonStatus;
        if (!cancelled) onRunningChange(json.running === true);
      } catch {
        if (!cancelled) onRunningChange(false);
      }
    };
    void tick();
    const t = setInterval(tick, 5000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [onRunningChange]);

  return (
    <header className="flex items-center justify-between border-b border-[--border-hairline] bg-[--bg-raised]/60 px-3 py-1.5 text-xs">
      <div className="flex items-center gap-3">
        <span className="font-semibold tracking-tight">CovenCave</span>
        <nav className="flex items-center gap-0.5">
          {(["chats", "board", "inbox", "plugins"] as const).map((m) => {
            const active = mode === m;
            const label =
              m === "inbox" && inboxBadgeCount > 0
                ? `${MODE_LABEL[m]} · ${inboxBadgeCount}`
                : MODE_LABEL[m];
            return (
              <button
                key={m}
                onClick={() => onModeChange(m)}
                className={`rounded-md px-2.5 py-1 text-[11px] transition-colors ${
                  active
                    ? "bg-[--bg-raised] text-[--text-primary]"
                    : "text-[--text-secondary] hover:bg-[--bg-raised] hover:text-[--text-primary]"
                }`}
              >
                {label}
              </button>
            );
          })}
        </nav>
      </div>

      <div className="flex items-center gap-2">
        {onOpenInbox && inboxPrefs && onPrefsChanged ? (
          <NotificationBell
            items={inboxItems}
            familiars={familiars}
            prefs={inboxPrefs}
            onOpenInbox={onOpenInbox}
            onOpenItem={onOpenInboxItem}
            onPrefsChanged={onPrefsChanged}
          />
        ) : null}
      </div>
    </header>
  );
}
