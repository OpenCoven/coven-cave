"use client";

import "@/styles/notification-bell.css";
import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { InboxDailyReportRow } from "@/components/automations/inbox-daily-report-row";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { IconButton } from "@/components/ui/icon-button";
import { RelativeTime } from "@/components/ui/relative-time";
import { useMinuteTick } from "@/lib/use-minute-tick";
import { useDateTimePrefs } from "@/lib/datetime-format";
import type { InboxItem, ItemKind } from "@/lib/cave-inbox";
import type { Familiar } from "@/lib/types";
import { MUTABLE_KINDS, type InboxPrefs, type MutableKind, type SoundMode } from "@/lib/inbox-prefs-shape";
import { collapseInboxSeries, isInboxItemPastDue, isInboxItemUnread, unreadInboxCount } from "@/lib/inbox-feed";
import {
  buildNotificationSections,
  notificationRowItems,
  notificationRowLatest,
  type NotificationRow,
} from "@/lib/notification-feed";
import { normalizeInboxTitle } from "@/lib/inbox-title";
import { Icon, CAVE_ICON_SIZE } from "@/lib/icon";
import type { IconName } from "@/lib/icon";
import { useFocusTrap } from "@/lib/use-focus-trap";
import { isMacDesktopShell } from "@/lib/tauri-platform";
import { DEFAULT_SNOOZE_OPTIONS, snoozedUntilLabel } from "@/lib/snooze-options";
import { useAnnouncer } from "@/components/ui/live-region";

type Props = {
  items: InboxItem[];
  familiars: Familiar[];
  prefs: InboxPrefs;
  badgeCount?: number;
  onOpenInbox: () => void;
  /** Opens what a row is about. The host decides where: Rituals for most
   *  items, the report page for a daily report, the chat for a waiting reply. */
  onOpenItem?: (item: InboxItem) => void;
  onPrefsChanged: () => void;
};

type KindFilter = "all" | "past-due" | ItemKind;

const KIND_FILTERS: { kind: ItemKind; label: string }[] = [
  { kind: "response-needed", label: "Waiting" },
  { kind: "reminder", label: "Reminders" },
  { kind: "agent", label: "Familiars" },
  { kind: "daily-summary", label: "Reports" },
  { kind: "milestone", label: "Milestones" },
];

const MUTABLE_KIND_LABELS: Record<MutableKind, string> = {
  reminder: "Reminders",
  agent: "Familiar activity",
  "daily-summary": "Daily reports",
  milestone: "Milestones",
};

/** How long Undo stays offered after a dismiss. */
const UNDO_WINDOW_MS = 8_000;

/** Rows the popover shows; the rest are a click away in Rituals. */
const MAX_ROWS = 30;

function notificationIcon(kind: ItemKind): IconName {
  if (kind === "response-needed") return "ph:chat-circle-dots-fill";
  if (kind === "daily-summary") return "ph:newspaper";
  if (kind === "agent") return "ph:magic-wand-fill";
  if (kind === "milestone") return "ph:flag";
  return "ph:alarm-fill";
}

/** Where opening a row goes, said once for assistive tech and the tooltip. */
function openDestination(kind: ItemKind): string {
  if (kind === "response-needed") return "Opens the chat";
  if (kind === "daily-summary") return "Opens the report";
  return "Opens in Rituals";
}

function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

// Live per-row timestamp: ticks each minute so a popover left open doesn't
// show a stale "2m ago" forever (cave-jm6t). Rows unmount with the popover,
// so the always-mounted bell trigger pays nothing while closed.
function BellItemTime({ iso, waiting }: { iso: string | null | undefined; waiting: boolean }) {
  useMinuteTick();
  return waiting ? <>Waiting on you</> : <RelativeTime iso={iso} fallback="—" />;
}

type UndoOffer = {
  /** Items the dismiss moved; Undo restores exactly these. */
  ids: string[];
  /** Of those, the ones that were unread, so Undo can make them unread again. */
  unreadIds: string[];
  message: string;
};

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
  // "Glass", "Pop" and "Funk" are macOS system sounds. Only the macOS shell
  // can play them, so Windows, Linux and browser tabs get Default and Silent
  // (#5970). Resolved after mount so server and first client markup agree.
  const [namedSoundsAvailable, setNamedSoundsAvailable] = useState(false);
  useEffect(() => {
    setNamedSoundsAvailable(isMacDesktopShell());
  }, []);
  const [kindFilter, setKindFilter] = useState<KindFilter>("all");
  // The row whose inline snooze choices are showing, if any.
  const [snoozingRowId, setSnoozingRowId] = useState<string | null>(null);
  // Phones: the row whose labeled actions are showing (its "More" is open).
  const [actionsRowId, setActionsRowId] = useState<string | null>(null);
  const [undo, setUndo] = useState<UndoOffer | null>(null);
  const undoTimerRef = useRef<number | undefined>(undefined);
  const undoButtonRef = useRef<HTMLButtonElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const titleId = useId();
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
  // (response-needed bridge first), narrowed by the active kind chip.
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

  // Collapse every occurrence of the same repeating schedule into ONE row —
  // a daily stand-up that fired five times reads "×5", not five entries
  // burying everything else (cave-w7z0).
  const grouped = useMemo(() => collapseInboxSeries(feed), [feed]);

  // Past due = reminders whose moment passed and are still waiting (the pure
  // isInboxItemPastDue predicate). A group is past due when any member is.
  const pastDueGroups = useMemo(
    () => grouped.filter((g) => g.items.some((i) => isInboxItemPastDue(i))),
    [grouped],
  );

  // Filtering to zero must never strand the user: when the last past-due item
  // is handled, the chip disappears — fall back to All instead of an empty
  // list with no way out.
  useEffect(() => {
    if (kindFilter === "past-due" && pastDueGroups.length === 0) setKindFilter("all");
  }, [kindFilter, pastDueGroups.length]);

  const filteredGroups = useMemo(
    () =>
      kindFilter === "all"
        ? grouped
        : kindFilter === "past-due"
          ? pastDueGroups
          : grouped.filter((g) => g.latest.kind === kindFilter),
    [grouped, pastDueGroups, kindFilter],
  );

  // Needs you first, daily reports folded into one row, the rest by day
  // (#6483). Recomputed when the popover opens so day headings stay right.
  const sections = useMemo(
    () => buildNotificationSections(filteredGroups, Date.now(), MAX_ROWS),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `open` refreshes "now"
    [filteredGroups, open],
  );

  // Only offer chips for kinds that actually have notifications — an empty
  // filter is a dead end, not a management tool.
  const kindChips = useMemo(
    () => KIND_FILTERS.filter(({ kind }) => grouped.some((g) => g.latest.kind === kind)),
    [grouped],
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
  // listed until dismissed/done. Takes the whole id set of a series row — one
  // atomic bulk POST, not a per-occurrence fan-out. Ephemeral response-needed
  // rows (eph:*) are client-synthesized and have nothing to mark server-side.
  const markRead = useCallback(
    async (ids: string[]) => {
      const real = ids.filter((id) => !id.startsWith("eph:"));
      if (real.length === 0) return;
      await mutate(
        () =>
          fetch("/api/inbox/bulk", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ action: "read", ids: real }),
          }),
        "Mark read failed — check your connection.",
      );
    },
    [mutate],
  );

  // The way back from an accidental Read: the row lights up again.
  const markUnread = useCallback(
    async (ids: string[]) => {
      const real = ids.filter((id) => !id.startsWith("eph:"));
      if (real.length === 0) return;
      await mutate(
        () =>
          fetch("/api/inbox/bulk", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ action: "unread", ids: real }),
          }),
        "Mark unread failed — check your connection.",
      );
    },
    [mutate],
  );

  const markAllRead = useCallback(async () => {
    const ok = await mutate(
      () =>
        fetch("/api/inbox/bulk", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "read", all: true }),
        }),
      "Mark all read failed — check your connection.",
    );
    if (ok) announce("All notifications marked read");
  }, [announce, mutate]);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", onDown);
    return () => window.removeEventListener("pointerdown", onDown);
  }, [open]);

  useEffect(() => () => window.clearTimeout(undoTimerRef.current), []);
  useEffect(() => {
    if (open) return;
    setSnoozingRowId(null);
    setActionsRowId(null);
  }, [open]);

  // Return focus to a row control after its choices close. A control can be
  // rendered twice (inline icons on wide screens, labeled actions on phones,
  // one of them display:none), so focus the one that is actually showing.
  const focusShown = useCallback((selector: string) => {
    requestAnimationFrame(() => {
      const nodes = popoverRef.current?.querySelectorAll<HTMLElement>(selector) ?? [];
      for (const node of nodes) {
        if (node.getClientRects().length > 0) {
          node.focus();
          return;
        }
      }
    });
  }, []);

  // Offer Undo for a dismiss that just succeeded. Focus moves to Undo only
  // when it was inside the popover (the dismissed row's own button is about
  // to disappear), so keyboard users are never dropped on the page.
  const offerUndo = useCallback(
    (offer: UndoOffer) => {
      window.clearTimeout(undoTimerRef.current);
      setUndo(offer);
      undoTimerRef.current = window.setTimeout(() => setUndo(null), UNDO_WINDOW_MS);
      announce(`${offer.message}. Undo is available.`);
      if (popoverRef.current?.contains(document.activeElement)) {
        requestAnimationFrame(() => undoButtonRef.current?.focus());
      }
    },
    [announce],
  );

  const undoOfferFor = useCallback(
    (ids: string[], message: string): UndoOffer => {
      const byId = new Map(items.map((item) => [item.id, item]));
      return {
        ids,
        unreadIds: ids.filter((id) => {
          const item = byId.get(id);
          return item ? isInboxItemUnread(item) : false;
        }),
        message,
      };
    },
    [items],
  );

  // Dismiss a row — for a collapsed repeating-schedule row that's EVERY
  // occurrence in the series, as one atomic bulk POST (single file write +
  // broadcast server-side, same shape as clear-all).
  const dismiss = useCallback(
    async (ids: string[]) => {
      const real = ids.filter((id) => !id.startsWith("eph:"));
      if (real.length === 0) return;
      const offer = undoOfferFor(
        real,
        real.length === 1
          ? `Dismissed “${normalizeInboxTitle(items.find((item) => item.id === real[0])?.title ?? "notification")}”`
          : `Dismissed ${plural(real.length, "notification")}`,
      );
      const ok = await mutate(
        () =>
          fetch("/api/inbox/bulk", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ action: "dismiss", ids: real }),
          }),
        "Dismiss failed — check your connection.",
      );
      if (ok) offerUndo(offer);
    },
    [items, mutate, offerUndo, undoOfferFor],
  );

  // Fired notifications are the dismissible stack; response-needed bridges
  // aren't dismissed here (they need a reply, not a clear).
  const dismissableIds = useMemo(
    () => items.filter((i) => i.status === "fired").map((i) => i.id),
    [items],
  );

  const dismissAll = useCallback(async () => {
    const offer = undoOfferFor(dismissableIds, `Cleared ${plural(dismissableIds.length, "notification")}`);
    // One atomic bulk dismiss (single file write + broadcast server-side) —
    // replaces the old N-fetch fan-out that raced its own SSE reconciles.
    const ok = await mutate(
      () =>
        fetch("/api/inbox/bulk", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "dismiss", all: true }),
        }),
      "Notifications could not be dismissed — check your connection.",
    );
    if (ok) offerUndo(offer);
  }, [dismissableIds, mutate, offerUndo, undoOfferFor]);

  // Undo: back onto the fired stack, then unread again where it was unread.
  // Two sequential POSTs: restore must land before unread can apply.
  const restore = useCallback(async () => {
    const offer = undo;
    if (!offer) return;
    window.clearTimeout(undoTimerRef.current);
    setUndo(null);
    const restored = await mutate(
      () =>
        fetch("/api/inbox/bulk", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "restore", ids: offer.ids }),
        }),
      "Undo failed — check your connection.",
    );
    if (!restored) return;
    if (offer.unreadIds.length > 0) {
      await mutate(
        () =>
          fetch("/api/inbox/bulk", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ action: "unread", ids: offer.unreadIds }),
          }),
        "Undo failed — check your connection.",
      );
    }
    announce(offer.ids.length === 1 ? "Notification restored" : `${plural(offer.ids.length, "notification")} restored`);
  }, [announce, mutate, undo]);

  const snooze = useCallback(
    async (id: string, minutes: number) => {
      const ok = await mutate(
        () =>
          fetch(`/api/inbox/${id}/snooze`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ minutes }),
          }),
        "Snooze failed — check your connection.",
      );
      if (ok) announce(snoozedUntilLabel(Date.now() + minutes * 60_000));
    },
    [announce, mutate],
  );

  // Opening acknowledges the row. The host's onOpenItem marks the opened item
  // read (every open path funnels through markInboxItemRead), so only the
  // OTHER unread items the row stands for need a read here.
  const openRow = useCallback(
    (row: NotificationRow) => {
      if (!onOpenItem) return;
      const latest = notificationRowLatest(row);
      const others = notificationRowItems(row)
        .filter(isInboxItemUnread)
        .map((m) => m.id)
        .filter((id) => id !== latest.id);
      if (others.length > 0) void markRead(others);
      setOpen(false);
      onOpenItem(latest);
    },
    [markRead, onOpenItem],
  );

  const closeSnooze = useCallback(
    (rowId: string) => {
      setSnoozingRowId(null);
      focusShown(`[data-snooze-trigger="${CSS.escape(rowId)}"], [data-actions-trigger="${CSS.escape(rowId)}"]`);
    },
    [focusShown],
  );

  const closeActions = useCallback(
    (rowId: string) => {
      setActionsRowId(null);
      focusShown(`[data-actions-trigger="${CSS.escape(rowId)}"]`);
    },
    [focusShown],
  );

  // The first choice takes focus when a row's choices open.
  useEffect(() => {
    if (!snoozingRowId) return;
    popoverRef.current?.querySelector<HTMLButtonElement>("[data-snooze-first]")?.focus();
  }, [snoozingRowId]);
  useEffect(() => {
    if (!actionsRowId) return;
    popoverRef.current?.querySelector<HTMLButtonElement>("[data-actions-first]")?.focus();
  }, [actionsRowId]);

  const renderRow = (row: NotificationRow) => {
    const latest = notificationRowLatest(row);
    const members = notificationRowItems(row);
    const count = members.length;
    const title = normalizeInboxTitle(latest.title);
    const unreadIdsInRow = members.filter(isInboxItemUnread).map((m) => m.id);
    const unread = unreadIdsInRow.length > 0;
    const waiting = latest.kind === "response-needed";
    const pastDue = members.some((m) => isInboxItemPastDue(m));
    const fname = latest.familiarId ? familiarName(latest.familiarId) : null;
    const muted = latest.familiarId ? prefs.mutedFamiliars.includes(latest.familiarId) : false;
    const isReports = row.kind === "reports";
    const canSnooze = !waiting && !isReports && latest.status === "fired";
    const snoozing = snoozingRowId === row.id;
    const actionsOpen = actionsRowId === row.id;
    const destination = openDestination(latest.kind);
    const toggleRead = () => void (unread ? markRead(unreadIdsInRow) : markUnread([latest.id]));
    const dismissRow = () => void dismiss(members.map((m) => m.id));
    const toggleRowMute = () => void toggleMute(latest.familiarId!);
    // Escape closes a row's choices, not the whole popover.
    const closeOnEscape = (close: () => void) => (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      close();
    };

    return (
      <li
        key={row.id}
        className={`notification-row reveal-scope${unread ? " notification-row--unread" : ""}${isReports ? " notification-row--reports" : ""}`}
        data-kind={latest.kind}
      >
        <div className="notification-row__main">
          <button
            type="button"
            className="notification-row__open focus-ring-inset"
            onClick={() => openRow(row)}
            disabled={!onOpenItem}
          >
            {isReports ? (
              <>
                {unread ? <span className="sr-only">Unread: </span> : null}
                <InboxDailyReportRow item={latest} showRead={false} />
                {count > 1 ? (
                  <span className="notification-row__meta">
                    {count - 1} earlier {count - 1 === 1 ? "report" : "reports"} folded in
                  </span>
                ) : null}
              </>
            ) : (
              <>
                <span className="notification-row__icon" aria-hidden>
                  <Icon name={notificationIcon(latest.kind)} width="0.95rem" height="0.95rem" />
                </span>
                <span className="notification-row__body">
                  <span className="notification-row__head">
                    {unread ? (
                      <>
                        <span aria-hidden className="notification-row__dot" />
                        <span className="sr-only">Unread: </span>
                      </>
                    ) : null}
                    <span className="notification-row__title">{title}</span>
                    {row.kind === "group" && count > 1 ? (
                      <span
                        className="notification-bell__series-count notification-row__tag"
                        title={`${count} notifications from this repeating schedule, grouped`}
                      >
                        ×{count}
                        <span className="sr-only"> notifications from this repeating schedule</span>
                      </span>
                    ) : null}
                    {pastDue ? (
                      <span className="notification-bell__past-due-tag notification-row__tag notification-row__tag--warning">
                        Past due
                      </span>
                    ) : null}
                  </span>
                  {latest.body ? <span className="notification-row__text">{latest.body}</span> : null}
                  <span className="notification-row__meta">
                    {fname ? <span className="notification-row__familiar">{fname}</span> : null}
                    <BellItemTime iso={latest.status === "fired" ? latest.firedAt : latest.updatedAt} waiting={waiting} />
                  </span>
                </span>
              </>
            )}
            <span className="sr-only">. {destination}</span>
          </button>

          {waiting ? null : (
            <div className="notification-row__actions notification-row__actions--inline">
              <IconButton
                size="sm"
                icon={unread ? "ph:check" : "ph:circle"}
                className="notification-bell__action reveal-on-hover"
                aria-label={
                  unread
                    ? count > 1
                      ? `Mark all ${count} read: ${title}`
                      : `Mark read: ${title}`
                    : `Mark unread: ${title}`
                }
                title={unread ? "Mark read — keeps it listed, quiets the badge" : "Mark unread"}
                onClick={toggleRead}
              />
              {canSnooze ? (
                <IconButton
                  size="sm"
                  icon="ph:clock-countdown"
                  className="notification-bell__action reveal-on-hover"
                  aria-label={`Snooze: ${title}`}
                  aria-expanded={snoozing}
                  title="Snooze"
                  data-snooze-trigger={row.id}
                  onClick={() => (snoozing ? closeSnooze(row.id) : setSnoozingRowId(row.id))}
                />
              ) : null}
              <IconButton
                size="sm"
                icon="ph:x"
                className="notification-bell__action reveal-on-hover"
                aria-label={count > 1 ? `Dismiss all ${count}: ${title}` : `Dismiss: ${title}`}
                title={count > 1 ? `Dismiss all ${count}` : "Dismiss"}
                onClick={dismissRow}
              />
              {latest.familiarId && fname ? (
                <IconButton
                  size="sm"
                  icon={muted ? "ph:bell-slash-fill" : "ph:bell-slash"}
                  className="notification-bell__mute reveal-on-hover"
                  aria-label={muted ? `Unmute ${fname}` : `Mute ${fname}`}
                  title={muted ? `Unmute ${fname}` : `Mute ${fname} — no toast or sound`}
                  aria-pressed={muted}
                  onClick={toggleRowMute}
                />
              ) : null}
            </div>
          )}
          {/* Phones: four 44px controls leave a title no room, so the row
              carries one More button that opens its actions, labeled, below. */}
          {waiting ? null : (
            <IconButton
              size="sm"
              icon="ph:dots-three"
              className="notification-bell__action notification-row__more"
              aria-label={`More actions: ${title}`}
              aria-expanded={actionsOpen}
              data-actions-trigger={row.id}
              onClick={() => {
                setSnoozingRowId(null);
                if (actionsOpen) closeActions(row.id);
                else setActionsRowId(row.id);
              }}
            />
          )}
        </div>

        {actionsOpen ? (
          <div
            role="group"
            aria-label={`Actions for ${title}`}
            className="notification-row__sheet"
            onKeyDown={closeOnEscape(() => closeActions(row.id))}
          >
            <button
              type="button"
              className="notification-bell__action notification-row__choice focus-ring"
              data-actions-first=""
              onClick={() => {
                setActionsRowId(null);
                toggleRead();
              }}
            >
              {unread ? (count > 1 ? `Mark all ${count} read` : "Mark read") : "Mark unread"}
            </button>
            {canSnooze ? (
              <button
                type="button"
                className="notification-bell__action notification-row__choice focus-ring"
                onClick={() => {
                  setActionsRowId(null);
                  setSnoozingRowId(row.id);
                }}
              >
                Snooze…
              </button>
            ) : null}
            <button
              type="button"
              className="notification-bell__action notification-row__choice focus-ring"
              onClick={() => {
                setActionsRowId(null);
                dismissRow();
              }}
            >
              {count > 1 ? `Dismiss all ${count}` : "Dismiss"}
            </button>
            {latest.familiarId && fname ? (
              <button
                type="button"
                className="notification-bell__action notification-row__choice focus-ring"
                aria-pressed={muted}
                onClick={() => {
                  setActionsRowId(null);
                  toggleRowMute();
                }}
              >
                {muted ? `Unmute ${fname}` : `Mute ${fname}`}
              </button>
            ) : null}
          </div>
        ) : null}

        {snoozing ? (
          <div
            role="group"
            aria-label={`Snooze ${title} for`}
            className="notification-row__snooze"
            onKeyDown={closeOnEscape(() => closeSnooze(row.id))}
          >
            <span className="notification-row__snooze-label" aria-hidden>
              Snooze for
            </span>
            {DEFAULT_SNOOZE_OPTIONS.map((option, index) => (
              <button
                key={option.label}
                type="button"
                className="notification-bell__action notification-row__choice focus-ring"
                data-snooze-first={index === 0 ? "" : undefined}
                onClick={() => {
                  setSnoozingRowId(null);
                  void snooze(latest.id, option.minutes());
                }}
              >
                {option.label}
              </button>
            ))}
            <button
              type="button"
              className="notification-bell__action notification-row__choice notification-row__choice--quiet focus-ring"
              onClick={() => closeSnooze(row.id)}
            >
              Cancel
            </button>
          </div>
        ) : null}
      </li>
    );
  };

  const hasRows = sections.total > 0;

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
        {/* Fill (not hue) is the second unread channel: the glyph solidifies
            while the count chip stays border+tint, so the two read as one
            warning-hued control with distinct treatments.

            Sized with the same headerAction token as every other action glyph
            in the mobile top bar. BOTH dimensions are deliberate: Icon defaults
            width and height to 1em independently, so passing neither (as this
            call previously did) leaves the glyph scaling with the inherited
            font-size, and passing width alone still leaves height at 1em. On
            desktop the top-chrome rule in desktop-chrome.css narrows this to
            --icon-sm, exactly as it does for the menu-bar siblings. */}
        <Icon
          name={displayBadgeCount > 0 ? "ph:bell-fill" : "ph:bell"}
          width={CAVE_ICON_SIZE.headerAction}
          height={CAVE_ICON_SIZE.headerAction}
          aria-hidden
        />

        {displayBadgeCount > 0 ? (
          <span aria-hidden className="notification-bell__badge">
            {displayBadgeCount > 9 ? "9+" : displayBadgeCount}
          </span>
        ) : null}
      </button>

      {open ? (
        <div
          ref={popoverRef}
          role="dialog"
          aria-labelledby={titleId}
          tabIndex={-1}
          className="notification-bell__popover glass-overlay absolute right-0 top-full z-50 mt-1 w-[400px] rounded-xl border border-[var(--border-strong)] shadow-2xl"
        >
          <div className="notification-bell__header">
            <div className="notification-bell__heading">
              <h2 id={titleId} className="notification-bell__title">
                Notifications
              </h2>
              {displayBadgeCount > 0 ? (
                <span className="notification-bell__count">{displayBadgeCount} unread</span>
              ) : null}
            </div>
            <div className="notification-bell__header-actions">
              {unreadIds.length > 0 ? (
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => void markAllRead()}
                  className="notification-bell__mark-all-read"
                  title={`Mark all ${plural(unreadIds.length, "unread notification")} as read`}
                >
                  Mark all read
                </Button>
              ) : null}
              {dismissableIds.length > 0 ? (
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => void dismissAll()}
                  className="notification-bell__clear-all"
                  title={`Dismiss all ${plural(dismissableIds.length, "notification")} — you can undo`}
                >
                  Clear all
                </Button>
              ) : null}
              <IconButton
                size="sm"
                icon="ph:gear-six"
                onClick={() => setSettingsOpen((v) => !v)}
                className="notification-bell__settings-btn"
                aria-label="Notification settings"
                aria-expanded={settingsOpen}
                title="Notification settings"
              />
            </div>
          </div>

          {settingsOpen ? (
            <div className="notification-bell__settings">
              <div className="notification-bell__settings-label">Sound</div>
              <div className="notification-bell__settings-options">
                {(
                  [
                    { mode: "default" as SoundMode, label: "Default" },
                    { mode: "silent" as SoundMode, label: "Silent" },
                    ...(namedSoundsAvailable
                      ? ([
                          { mode: "named" as SoundMode, label: "Glass", name: "Glass" },
                          { mode: "named" as SoundMode, label: "Pop", name: "Pop" },
                          { mode: "named" as SoundMode, label: "Funk", name: "Funk" },
                        ] as const)
                      : []),
                  ] as const
                ).map((opt) => {
                  const active =
                    prefs.sound.mode === opt.mode &&
                    (opt.mode !== "named" ||
                      prefs.sound.name === ("name" in opt ? opt.name : undefined));
                  return (
                    <button
                      key={opt.label}
                      type="button"
                      onClick={() =>
                        setSound(opt.mode, "name" in opt ? opt.name : undefined)
                      }
                      aria-pressed={active}
                      className="notification-bell__toggle focus-ring"
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>

              <div className="notification-bell__settings-label">Quiet kinds</div>
              <div className="notification-bell__settings-options">
                {MUTABLE_KINDS.map((kind) => {
                  const muted = prefs.mutedKinds.includes(kind);
                  return (
                    <button
                      key={kind}
                      type="button"
                      onClick={() => void toggleKindMute(kind)}
                      aria-pressed={muted}
                      title={
                        muted
                          ? `${MUTABLE_KIND_LABELS[kind]} are quiet — no toast or sound. Click to unmute.`
                          : `Quiet ${MUTABLE_KIND_LABELS[kind].toLowerCase()} — they still land here, without toast or sound.`
                      }
                      className="notification-bell__toggle notification-bell__toggle--quiet focus-ring"
                    >
                      {MUTABLE_KIND_LABELS[kind]}
                    </button>
                  );
                })}
              </div>

              <div className="notification-bell__settings-label">Muted familiars</div>
              <ul className="notification-bell__familiars">
                {familiars.length === 0 ? (
                  <li className="notification-bell__settings-empty">No familiars yet.</li>
                ) : null}
                {familiars.map((f) => {
                  const muted = prefs.mutedFamiliars.includes(f.id);
                  return (
                    <li key={f.id} className="notification-bell__familiar">
                      <span className="truncate" title={f.display_name}>{f.display_name}</span>
                      <button
                        type="button"
                        onClick={() => toggleMute(f.id)}
                        aria-pressed={muted}
                        aria-label={`${muted ? "Unmute" : "Mute"} ${f.display_name}`}
                        className="notification-bell__toggle notification-bell__toggle--quiet focus-ring"
                      >
                        {muted ? "Muted" : "Mute"}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}
          {kindChips.length > 1 || pastDueGroups.length > 0 ? (
            <div
              role="group"
              aria-label="Filter notifications"
              className="notification-bell__filters"
            >
              {[{ kind: "all" as const, label: "All" }, ...kindChips].map(({ kind, label }) => {
                const active = kindFilter === kind;
                const count =
                  kind === "all"
                    ? grouped.length
                    : grouped.filter((g) => g.latest.kind === kind).length;
                return (
                  <button
                    key={kind}
                    type="button"
                    onClick={() => setKindFilter(kind)}
                    aria-pressed={active}
                    className="notification-bell__chip focus-ring"
                  >
                    {label} <span aria-hidden className="opacity-60">{count}</span>
                  </button>
                );
              })}
              {pastDueGroups.length > 0 ? (
                // Warning-tinted so the overdue slice is findable at a glance —
                // this is a status filter, not a kind, hence the distinct hue.
                <button
                  type="button"
                  onClick={() => setKindFilter("past-due")}
                  aria-pressed={kindFilter === "past-due"}
                  title="Only reminders whose time has passed and are still waiting on you"
                  className="notification-bell__past-due-chip notification-bell__chip notification-bell__chip--warning focus-ring"
                >
                  Past due <span aria-hidden className="opacity-70">{pastDueGroups.length}</span>
                </button>
              ) : null}
            </div>
          ) : null}

          <div className="notification-bell__list">
            {!hasRows ? (
              kindFilter === "all" ? (
                <EmptyState
                  compact
                  icon="ph:check-circle"
                  headline="You're all caught up"
                  subtitle="Replies waiting on you, reminders and familiar updates land here."
                />
              ) : (
                <EmptyState
                  compact
                  headline="Nothing in this filter"
                  actions={
                    <Button size="xs" variant="secondary" onClick={() => setKindFilter("all")}>
                      Show all
                    </Button>
                  }
                />
              )
            ) : null}
            {sections.needsYou.length > 0 ? (
              <section className="notification-bell__section notification-bell__section--needs" aria-labelledby={`${titleId}-needs`}>
                <h3 id={`${titleId}-needs`} className="notification-bell__section-title">
                  Needs you <span className="notification-bell__section-count">{sections.needsYou.length}</span>
                </h3>
                <ul className="notification-bell__rows">{sections.needsYou.map(renderRow)}</ul>
              </section>
            ) : null}
            {sections.updates.map((day) => (
              <section key={day.day} className="notification-bell__section" aria-labelledby={`${titleId}-${day.day}`}>
                <h3 id={`${titleId}-${day.day}`} className="notification-bell__section-title">
                  {day.label}
                </h3>
                <ul className="notification-bell__rows">{day.rows.map(renderRow)}</ul>
              </section>
            ))}
          </div>

          <div className="notification-bell__footer">
            {undo ? (
              <div className="notification-bell__undo">
                <span className="notification-bell__undo-text">{undo.message}</span>
                <Button
                  ref={undoButtonRef}
                  size="xs"
                  variant="secondary"
                  leadingIcon="ph:arrow-counter-clockwise"
                  onClick={() => void restore()}
                >
                  Undo
                </Button>
              </div>
            ) : null}
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                onOpenInbox();
              }}
              className="notification-bell__open-inbox focus-ring"
            >
              Open Rituals
              {sections.hidden > 0 ? (
                <span className="notification-bell__more-count">· {sections.hidden} more</span>
              ) : null}
              <Icon name="ph:arrow-right" width={12} height={12} aria-hidden />
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
