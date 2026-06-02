"use client";

import { useEffect } from "react";
import type { DaemonStatus, Familiar } from "@/lib/types";
import type { InboxItem } from "@/lib/cave-inbox";
import type { InboxPrefs } from "@/lib/cave-inbox-prefs";
import { NotificationBell } from "@/components/notification-bell";
import { HealthStrip } from "@/components/health-strip";

export type Mode = "chats" | "board" | "inbox" | "plugins" | "vals-inbox" | "browser" | "schedules" | "calls" | "comux" | "home";

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
  home: "Home",
  chats: "Chats",
  board: "Board",
  inbox: "Inbox",
  plugins: "Plugins",
  "vals-inbox": "Val's Inbox",
  browser: "Browser",
  schedules: "Automations",
  calls: "Coven Calls",
  comux: "Coven Code",
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
    <header className="flex items-center justify-between border-b border-[var(--border-hairline)] bg-[var(--bg-raised)]/60 px-3 py-1.5 text-xs">
      <div className="flex items-center gap-2">
        <span className="bg-gradient-to-r from-[var(--accent-presence)] to-[var(--accent-presence-soft)] bg-clip-text font-semibold tracking-tight text-transparent">
          CovenCave
        </span>
        <span className="text-[var(--text-muted)]">·</span>
        <span className="text-[var(--text-secondary)] capitalize">
          {MODE_LABEL[mode] ?? mode}
          {mode === "inbox" && inboxBadgeCount > 0 ? ` · ${inboxBadgeCount}` : ""}
        </span>
      </div>

      <div className="flex items-center gap-3">
        <HealthStrip familiars={familiars} />
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
