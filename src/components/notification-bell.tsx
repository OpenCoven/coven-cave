"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RelativeTime } from "@/components/ui/relative-time";
import { useMinuteTick } from "@/lib/use-minute-tick";
import { useDateTimePrefs } from "@/lib/datetime-format";
import type { InboxItem, ItemKind } from "@/lib/cave-inbox";
import type { Familiar } from "@/lib/types";
import { MUTABLE_KINDS, type InboxPrefs, type MutableKind, type SoundMode } from "@/lib/inbox-prefs-shape";
import { isInboxItemUnread, unreadInboxCount } from "@/lib/inbox-feed";
import { normalizeInboxTitle } from "@/lib/inbox-title";
import { Icon } from "@/lib/icon";
import { useFocusTrap } from "@/lib/use-focus-trap";
import { useAnnouncer } from "@/components/ui/live-region";

type Props = {
  items: InboxItem[];
  familiars: Familiar[];
  prefs: InboxPrefs;
  badgeCount?: number;
  onOpenInbox: () => void;
  onOpenItem?: (item: InboxItem) => void;
  onPrefsChanged: () => void;
};

type KindFilter = "all" | ItemKind;

const KIND_FILTERS: { kind: ItemKind; label: string }[] = [
  { kind: "response-needed", label: "Waiting" },
  { kind: "reminder", label: "Reminders" },
  { kind: "agent", label: "Familiars" },
  { kind: "daily-summary", label: "Reports" },
];

const MUTABLE_KIND_LABELS: Record<MutableKind, string> = {
  reminder: "Reminders",
  agent: "Familiar activity",
  "daily-summary": "Daily reports",
};

// Live per-row timestamp: ticks each minute so a popover left open doesn't
// show a stale "2m ago" forever (cave-jm6t). Rows unmount with the popover,
// so the always-mounted bell trigger pays nothing while closed.
function BellItemTime({ iso, waiting }: { iso: string | null | undefined; waiting: boolean }) {
  useMinuteTick();
  return (
    <div className="mt-1 text-[10px] text-[var(--text-muted)]">
      {waiting ? "Waiting on you" : <RelativeTime iso={iso} fallback="—" />}
    </div>
  );
}

export function NotificationBell({
  items,
  familiars,
  prefs,
  badgeCount,
  onOpenInbox,
  onOpenItem,
  onPrefsChanged,
}: Props) {
  useDateTimePrefs(); // subscribe: re-render when the date/time density pref changes
  const [open, setOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [kindFilter, setKindFilter] = useState<KindFilter>("all");
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const { announce } = useAnnouncer();

  // Every bell mutation is a fire-and-forget fetch whose UI feedback arrives
  // via the inbox SSE reconcile — so a network failure or 5xx used to be a
  // silent no-op (the click did nothing and the rejection was unhandled).
  // Route them through one guard that verifies res.ok and announces failures.
  const mutate = useCallback(
    async (run: () => Promise<Response>, failureMessage: string): Promise<boolean> => {
      try {
        const res = await run();
        if (!res.ok) throw new Error(String(res.status));
        return true;
      } catch {
        announce(failureMessage, "assertive");
        return false;
      }
    },
    [announce],
  );

  // Trap focus while the popover is open: Escape closes, Tab cycles inside,
  // and closing restores focus to whatever opened it (the bell trigger for
  // keyboard users). Same pattern as github-action-popover.
  useFocusTrap(open, popoverRef, { onEscape: () => setOpen(false) });

  const familiarName = useCallback(
    (id: string | null | undefined) =>
      id ? familiars.find((f) => f.id === id)?.display_name ?? id : null,
    [familiars],
  );

  const toggleMute = useCallback(
    async (familiarId: string) => {
      const ok = await mutate(
        () =>
          fetch("/api/inbox/prefs", {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ toggleMuteFor: familiarId }),
          }),
        "Mute change failed — check your connection.",
      );
      if (ok) onPrefsChanged();
    },
    [mutate, onPrefsChanged],
  );

  const toggleKindMute = useCallback(
    async (kind: MutableKind) => {
      const ok = await mutate(
        () =>
          fetch("/api/inbox/prefs", {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ toggleMuteKind: kind }),
          }),
        "Mute change failed — check your connection.",
      );
      if (ok) onPrefsChanged();
    },
    [mutate, onPrefsChanged],
  );

  const setSound = useCallback(
    async (mode: SoundMode, name?: string) => {
      const ok = await mutate(
        () =>
          fetch("/api/inbox/prefs", {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ sound: { mode, name } }),
          }),
        "Sound change failed — check your connection.",
      );
      if (ok) onPrefsChanged();
    },
    [mutate, onPrefsChanged],
  );

  // Items shown in the dropdown: most-recent fired + the loudest pending alerts
  // (response-needed bridge first), narrowed by the active kind chip. Cap to 30
  // (the list scrolls; the old cap of 10 hid older notifications entirely).
  const feed = useMemo(() => {
    const firedSorted = items
      .filter((i) => i.status === "fired")
      .sort((a, b) =>
        (b.firedAt ?? b.updatedAt).localeCompare(a.firedAt ?? a.updatedAt),
      );
    const ephemeral = items.filter(
      (i) => i.status === "pending" && i.kind === "response-needed",
    );
    return [...ephemeral, ...firedSorted];
  }, [items]);

  const recent = useMemo(
    () =>
      (kindFilter === "all" ? feed : feed.filter((i) => i.kind === kindFilter)).slice(0, 30),
    [feed, kindFilter],
  );

  // Only offer chips for kinds that actually have notifications — an empty
  // filter is a dead end, not a management tool.
  const kindChips = useMemo(
    () => KIND_FILTERS.filter(({ kind }) => feed.some((i) => i.kind === kind)),
    [feed],
  );

  // Badge and list share one unread definition (unreadInboxCount) so they can
  // never disagree the way the old escalations-poll badge did.
  const derivedBadgeCount = useMemo(() => unreadInboxCount(items), [items]);
  const displayBadgeCount = badgeCount ?? derivedBadgeCount;

  const unreadIds = useMemo(
    () => items.filter(isInboxItemUnread).map((i) => i.id),
    [items],
  );

  // Acknowledge without resolving: reading quiets the badge, the item stays
  // listed until dismissed/done. Ephemeral response-needed rows (eph:*) are
  // client-synthesized and have nothing to mark server-side.
  const markRead = useCallback(
    async (id: string) => {
      if (id.startsWith("eph:")) return;
      await mutate(
        () =>
          fetch("/api/inbox/bulk", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ action: "read", ids: [id] }),
          }),
        "Mark read failed — check your connection.",
      );
    },
    [mutate],
  );

  const markAllRead = useCallback(async () => {
    await mutate(
      () =>
        fetch("/api/inbox/bulk", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "read", all: true }),
        }),
      "Mark all read failed — check your connection.",
    );
  }, [mutate]);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", onDown);
    return () => window.removeEventListener("pointerdown", onDown);
  }, [open]);

  const dismiss = useCallback(
    async (id: string) => {
      await mutate(
        () => fetch(`/api/inbox/${id}/dismiss`, { method: "POST" }),
        "Dismiss failed — check your connection.",
      );
    },
    [mutate],
  );

  // Fired notifications are the dismissible stack; response-needed bridges
  // aren't dismissed here (they need a reply, not a clear).
  const dismissableIds = useMemo(
    () => items.filter((i) => i.status === "fired").map((i) => i.id),
    [items],
  );

  const dismissAll = useCallback(async () => {
    // One atomic bulk dismiss (single file write + broadcast server-side) —
    // replaces the old N-fetch fan-out that raced its own SSE reconciles.
    await mutate(
      () =>
        fetch("/api/inbox/bulk", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "dismiss", all: true }),
        }),
      "Notifications could not be dismissed — check your connection.",
    );
  }, [mutate]);

  const snooze = useCallback(
    async (id: string) => {
      await mutate(
        () =>
          fetch(`/api/inbox/${id}/snooze`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ minutes: 10 }),
          }),
        "Snooze failed — check your connection.",
      );
    },
    [mutate],
  );

  return (
    <div ref={wrapRef} className="notification-bell relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={`notification-bell__trigger focus-ring relative grid h-7 w-7 place-items-center rounded-[var(--radius-control)] border border-[var(--border-hairline)] transition-colors ${
          displayBadgeCount > 0
            ? "text-[var(--color-warning)] hover:bg-[var(--bg-hover)]"
            : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
        }`}
        title={`${displayBadgeCount} unread`}
        aria-label={`Notifications, ${displayBadgeCount} unread`}
      >
        <Icon name="ph:bell-fill" aria-hidden />

        {displayBadgeCount > 0 ? (
          <span
            aria-hidden
            className="absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-[var(--color-danger)] px-1 text-[9px] font-bold leading-none text-[var(--text-primary)]"
          >
            {displayBadgeCount > 9 ? "9+" : displayBadgeCount}
          </span>
        ) : null}
      </button>

      {open ? (
        <div
          ref={popoverRef}
          role="dialog"
          aria-label="Notifications"
          tabIndex={-1}
          className="notification-bell__popover glass-overlay group/popover absolute right-0 top-full z-50 mt-1 w-[400px] rounded-xl border border-[var(--border-strong)] shadow-2xl"
        >
          <div className="notification-bell__header flex items-center justify-between border-b border-[var(--border-hairline)] px-3 py-2">
            <span className="text-[11px] font-medium text-[var(--text-primary)]">
              Notifications
            </span>
            <div className="notification-bell__header-actions flex items-center gap-1.5">
              <button
                onClick={() => setSettingsOpen((v) => !v)}
                className="notification-bell__settings-btn touch-always-visible focus-ring grid h-5 w-5 place-items-center rounded text-[var(--text-muted)] opacity-0 transition-opacity hover:text-[var(--text-primary)] group-hover/popover:opacity-100 focus-visible:opacity-100"
                title="Notification settings"
                aria-label="Notification settings"
              >
                <Icon name="ph:gear-six-bold" aria-hidden />
              </button>
              {unreadIds.length > 0 ? (
                <button
                  onClick={() => void markAllRead()}
                  className="notification-bell__mark-all-read focus-ring rounded text-[11px] text-[var(--text-muted)] transition-colors hover:text-[var(--text-primary)]"
                  title={`Mark all ${unreadIds.length} unread notification${unreadIds.length !== 1 ? "s" : ""} as read`}
                >
                  Mark read
                </button>
              ) : null}
              {dismissableIds.length > 0 ? (
                <button
                  onClick={() => void dismissAll()}
                  className="notification-bell__clear-all focus-ring rounded text-[11px] text-[var(--text-muted)] transition-colors hover:text-[var(--text-primary)]"
                  title={`Dismiss all ${dismissableIds.length} notification${dismissableIds.length !== 1 ? "s" : ""}`}
                >
                  Clear all
                </button>
              ) : null}
              <button
                onClick={() => {
                  setOpen(false);
                  onOpenInbox();
                }}
                className="notification-bell__open-inbox focus-ring rounded text-[11px] text-[var(--text-muted)] transition-colors hover:text-[var(--accent-presence)]"
              >
                Open Rituals →
              </button>
            </div>
          </div>

          {settingsOpen ? (
            <div className="border-b border-[var(--border-hairline)] bg-[var(--bg-raised)]/40 p-3 text-[11px]">
              <div className="mb-2 text-[10px] uppercase tracking-widest text-[var(--text-secondary)]">
                Sound
              </div>
              <div className="mb-3 flex flex-wrap gap-1">
                {(
                  [
                    { mode: "default" as SoundMode, label: "Default" },
                    { mode: "silent" as SoundMode, label: "Silent" },
                    { mode: "named" as SoundMode, label: "Glass", name: "Glass" },
                    { mode: "named" as SoundMode, label: "Pop", name: "Pop" },
                    { mode: "named" as SoundMode, label: "Funk", name: "Funk" },
                  ] as const
                ).map((opt) => {
                  const active =
                    prefs.sound.mode === opt.mode &&
                    (opt.mode !== "named" ||
                      prefs.sound.name === ("name" in opt ? opt.name : undefined));
                  return (
                    <button
                      key={opt.label}
                      onClick={() =>
                        setSound(opt.mode, "name" in opt ? opt.name : undefined)
                      }
                      aria-pressed={active}
                      className={`focus-ring rounded border px-2 py-0.5 text-[10px] transition-colors ${
                        active
                          ? "border-[color-mix(in_oklch,var(--accent-presence)_55%,transparent)] bg-[color-mix(in_oklch,var(--accent-presence)_20%,transparent)] text-[var(--text-primary)]"
                          : "border-[var(--border-strong)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                      }`}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>

              <div className="mb-1.5 text-[10px] uppercase tracking-widest text-[var(--text-secondary)]">
                Quiet kinds
              </div>
              <div className="mb-3 flex flex-wrap gap-1">
                {MUTABLE_KINDS.map((kind) => {
                  const muted = prefs.mutedKinds.includes(kind);
                  return (
                    <button
                      key={kind}
                      onClick={() => void toggleKindMute(kind)}
                      aria-pressed={muted}
                      title={
                        muted
                          ? `${MUTABLE_KIND_LABELS[kind]} are quiet — no toast or sound. Click to unmute.`
                          : `Quiet ${MUTABLE_KIND_LABELS[kind].toLowerCase()} — they still land in the inbox, without toast or sound.`
                      }
                      className={`focus-ring rounded border px-2 py-0.5 text-[10px] transition-colors ${
                        muted
                          ? "border-[color-mix(in_oklch,var(--color-warning)_45%,transparent)] bg-[color-mix(in_oklch,var(--color-warning)_14%,transparent)] text-[var(--color-warning)]"
                          : "border-[var(--border-strong)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                      }`}
                    >
                      {MUTABLE_KIND_LABELS[kind]}
                    </button>
                  );
                })}
              </div>

              <div className="mb-1.5 text-[10px] uppercase tracking-widest text-[var(--text-secondary)]">
                Muted familiars
              </div>
              <ul className="max-h-32 space-y-0.5 overflow-y-auto">
                {familiars.length === 0 ? (
                  <li className="text-[10px] text-[var(--text-muted)]">No familiars yet.</li>
                ) : null}
                {familiars.map((f) => {
                  const muted = prefs.mutedFamiliars.includes(f.id);
                  return (
                    <li key={f.id} className="flex items-center justify-between">
                      <span className="truncate text-[var(--text-secondary)]" title={f.display_name}>{f.display_name}</span>
                      <button
                        onClick={() => toggleMute(f.id)}
                        aria-pressed={muted}
                        aria-label={`${muted ? "Unmute" : "Mute"} ${f.display_name}`}
                        className={`focus-ring rounded border px-1.5 py-0.5 text-[10px] transition-colors ${
                          muted
                            ? "border-[color-mix(in_oklch,var(--color-warning)_45%,transparent)] bg-[color-mix(in_oklch,var(--color-warning)_14%,transparent)] text-[var(--color-warning)]"
                            : "border-[var(--border-strong)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                        }`}
                      >
                        {muted ? "muted" : "mute"}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}
          {kindChips.length > 1 ? (
            <div
              role="group"
              aria-label="Filter notifications by kind"
              className="notification-bell__filters flex flex-wrap gap-1 border-b border-[var(--border-hairline)] px-3 py-2"
            >
              {[{ kind: "all" as const, label: "All" }, ...kindChips].map(({ kind, label }) => {
                const active = kindFilter === kind;
                const count =
                  kind === "all" ? feed.length : feed.filter((i) => i.kind === kind).length;
                return (
                  <button
                    key={kind}
                    onClick={() => setKindFilter(kind)}
                    aria-pressed={active}
                    className={`focus-ring rounded-full border px-2 py-0.5 text-[10px] transition-colors ${
                      active
                        ? "border-[color-mix(in_oklch,var(--accent-presence)_55%,transparent)] bg-[color-mix(in_oklch,var(--accent-presence)_20%,transparent)] text-[var(--text-primary)]"
                        : "border-[var(--border-hairline)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                    }`}
                  >
                    {label} <span aria-hidden className="opacity-60">{count}</span>
                  </button>
                );
              })}
            </div>
          ) : null}
          <ul className="notification-bell__list max-h-[420px] overflow-y-auto p-2 text-xs">
            {recent.length === 0 ? (
              <li className="px-2 py-6 text-center text-[11px] text-[var(--text-muted)]">
                {kindFilter === "all" ? "No notifications." : "Nothing in this filter."}
              </li>
            ) : null}
            {recent.map((it) => {
              const fname = it.familiarId ? familiarName(it.familiarId) : null;
              const muted = it.familiarId ? prefs.mutedFamiliars.includes(it.familiarId) : false;
              const unread = isInboxItemUnread(it);
              return (
                <li
                  key={it.id}
                  className={`mb-1 rounded-md border p-2.5 ${
                    unread
                      ? "border-[color-mix(in_oklch,var(--accent-presence)_30%,var(--border-hairline))] bg-[var(--bg-raised)]/70"
                      : "border-[var(--border-hairline)] bg-[var(--bg-raised)]/40"
                  }`}
                >
                  <div className="flex items-start gap-2.5">
                    <Icon
                      name={
                        it.kind === "response-needed"
                          ? "ph:chat-circle-dots-fill"
                          : it.kind === "daily-summary"
                          ? "ph:newspaper"
                          : it.kind === "agent"
                          ? "ph:magic-wand-fill"
                          : "ph:alarm-fill"
                      }
                      className="mt-0.5 shrink-0 text-[var(--text-muted)]"
                      width="0.95rem"
                      height="0.95rem"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 items-center gap-1.5">
                        {unread ? (
                          <>
                            <span
                              aria-hidden
                              className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--accent-presence)]"
                            />
                            <span className="sr-only">Unread:</span>
                          </>
                        ) : null}
                        <div className="truncate text-[12px] font-medium text-[var(--text-primary)]" title={normalizeInboxTitle(it.title)}>{normalizeInboxTitle(it.title)}</div>
                      </div>
                      {it.body ? (
                        <div className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-[var(--text-muted)]">
                          {it.body}
                        </div>
                      ) : null}
                      <BellItemTime
                        iso={it.status === "fired" ? it.firedAt : it.updatedAt}
                        waiting={it.kind === "response-needed"}
                      />
                    </div>
                    {it.familiarId ? (
                      <button
                        onClick={() => void toggleMute(it.familiarId!)}
                        title={muted ? `Unmute ${fname}` : `Mute ${fname}`}
                        aria-label={muted ? `Unmute ${fname}` : `Mute ${fname}`}
                        className="notification-bell__mute touch-always-visible focus-ring grid h-5 w-5 shrink-0 place-items-center rounded text-[var(--text-muted)] opacity-0 transition-opacity hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] group-hover/popover:opacity-100 focus-visible:opacity-100"
                      >
                        <Icon
                          name={muted ? "ph:bell-slash-fill" : "ph:bell-slash"}
                          aria-hidden
                          width="0.85rem"
                          height="0.85rem"
                        />
                      </button>
                    ) : null}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {onOpenItem ? (
                      <BellBtn
                        primary
                        onClick={() => {
                          // Opening acknowledges the item, but the parent's
                          // onOpenItem handler already marks it read (every
                          // open-path funnels through markInboxItemRead) — so
                          // the bell must not POST a second, redundant read.
                          setOpen(false);
                          onOpenItem(it);
                        }}
                      >
                        Open
                      </BellBtn>
                    ) : null}
                    {unread && it.kind !== "response-needed" ? (
                      <BellBtn
                        onClick={() => void markRead(it.id)}
                        title="Mark as read — keeps the notification, quiets the badge"
                      >
                        Read
                      </BellBtn>
                    ) : null}
                    {it.kind !== "response-needed" ? (
                      <>
                        <BellBtn onClick={() => void snooze(it.id)} title="Snooze 10 minutes">
                          Snooze
                        </BellBtn>
                        <BellBtn onClick={() => void dismiss(it.id)}>Dismiss</BellBtn>
                      </>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function BellBtn({
  children,
  onClick,
  title,
  primary,
}: {
  children: React.ReactNode;
  onClick: () => void;
  title?: string;
  primary?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`notification-bell__action focus-ring rounded border px-2 py-0.5 text-[10px] transition-colors ${
        primary
          ? "border-[var(--border-strong)] bg-[var(--bg-raised)] text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
          : "border-[var(--border-hairline)] bg-transparent text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
      }`}
    >
      {children}
    </button>
  );
}
