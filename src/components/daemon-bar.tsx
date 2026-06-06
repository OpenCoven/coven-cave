"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import type { DaemonStatus, Familiar } from "@/lib/types";
import type { InboxItem } from "@/lib/cave-inbox";
import type { InboxPrefs } from "@/lib/cave-inbox-prefs";
import { NotificationBell } from "@/components/notification-bell";
import { Icon } from "@/lib/icon";

export type Mode = "chats" | "board" | "inbox" | "plugins" | "browser" | "schedules" | "calls" | "comux" | "home" | "github" | "calendar";

type Props = {
  mode: Mode;
  onModeChange: (mode: Mode) => void;
  onOpenSearch: () => void;
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
  browser: "Browser",
  schedules: "Automations",
  calls: "Coven Calls",
  comux: "Coven Code",
  github: "GitHub",
  calendar: "Calendar",
};

export function DaemonBar({
  mode,
  onModeChange: _onModeChange,
  onOpenSearch,
  inboxBadgeCount = 0,
  onRunningChange,
  inboxItems = [],
  inboxPrefs,
  familiars = [],
  onOpenInbox,
  onOpenInboxItem,
  onPrefsChanged,
}: Props) {
  const router = useRouter();

  // Poll daemon status silently — other panes react via onRunningChange
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
    return () => { cancelled = true; clearInterval(t); };
  }, [onRunningChange]);

  return (
    <header className="flex h-10 shrink-0 items-center gap-3 border-b border-[var(--border-hairline)] bg-[var(--bg-raised)]/60 px-3">

      {/* Left — brand + current view */}
      <div className="flex w-[160px] shrink-0 items-center gap-2 text-[12px]">
        <span className="bg-gradient-to-r from-[var(--accent-presence)] to-[var(--accent-presence-soft)] bg-clip-text font-semibold tracking-tight text-transparent">
          CovenCave
        </span>
        <span className="text-[var(--text-muted)]">·</span>
        <span className="truncate text-[var(--text-secondary)]">
          {MODE_LABEL[mode] ?? mode}
          {mode === "inbox" && inboxBadgeCount > 0 ? ` · ${inboxBadgeCount}` : ""}
        </span>
      </div>

      {/* Center — search trigger */}
      <button
        type="button"
        onClick={onOpenSearch}
        className="flex flex-1 items-center gap-2 rounded-md border border-[var(--border-hairline)] bg-[var(--bg-base)] px-3 py-1 text-[12px] text-[var(--text-muted)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--text-secondary)]"
      >
        <Icon name="ph:magnifying-glass" width={12} className="shrink-0" />
        <span className="flex-1 text-left">Search</span>
        <kbd className="hidden rounded bg-[var(--bg-raised)] px-1.5 py-0.5 text-[10px] text-[var(--text-muted)] sm:inline">
          ⌘K
        </kbd>
      </button>

      {/* Right — notifications + settings */}
      <div className="flex w-[160px] shrink-0 items-center justify-end gap-1">
        {onOpenInbox && inboxPrefs && onPrefsChanged ? (
          <NotificationBell
            items={inboxItems}
            familiars={familiars}
            prefs={inboxPrefs}
            badgeCount={inboxBadgeCount}
            onOpenInbox={onOpenInbox}
            onOpenItem={onOpenInboxItem}
            onPrefsChanged={onPrefsChanged}
          />
        ) : null}

        <button
          type="button"
          onClick={() => router.push("/settings")}
          title="Settings"
          className="flex h-7 w-7 items-center justify-center rounded-md text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-raised)] hover:text-[var(--text-primary)]"
        >
          <Icon name="ph:gear-six" width={14} />
        </button>
      </div>
    </header>
  );
}
