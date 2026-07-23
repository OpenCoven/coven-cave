"use client";

import { useId, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { FieldLabel } from "@/components/automations/cron-detail-primitives";
import type { InboxItem, LinkRef } from "@/lib/cave-inbox";
import type { Recurrence } from "@/lib/inbox-recurrence";
import { inboxKindLabel } from "@/lib/inbox-feed";
import { formatClock, formatTimestamp, readDateTimePrefs } from "@/lib/datetime-format";
import { parseGitHubItemUrl } from "@/lib/github-item-url";
import { humanRecurrence } from "@/lib/automations/automation-entry";
import { relativeTimeSigned } from "@/lib/relative-time";
import { useFocusTrap } from "@/lib/use-focus-trap";
import { Icon } from "@/lib/icon";

function linkLabel(link: LinkRef): string {
  if (link.kind === "url") {
    const gh = parseGitHubItemUrl(link.ref);
    if (gh) return `Open in GitHub · ${gh.repo} #${gh.number}`;
    return link.ref;
  }
  if (link.kind === "card") return "Card";
  if (link.kind === "session") return "Session";
  return "Memory";
}

function scheduleTime(hour: number, minute: number): string {
  return formatClock(new Date(2000, 0, 1, hour, minute, 0).toISOString());
}

const humanSchedule = (rec: Recurrence | undefined | null): string =>
  humanRecurrence(rec, scheduleTime);

function relTime(iso: string | undefined | null): string {
  return iso ? relativeTimeSigned(iso) : "—";
}

// A one-time (non-recurring) reminder that has already fired behaves like a
// notification, not a schedule: Done/Snooze/Delete matter, Run-now/Pause do
// not (there's nothing left to run or pause — see the fired/one-time example
// in the "Rituals side panel" design pass, cave-notif-panel).
function isFiredOneTimeReminder(item: InboxItem): boolean {
  return (
    item.kind === "reminder" &&
    (!item.recurrence || item.recurrence.type === "none") &&
    (item.status === "fired" || item.status === "done")
  );
}

function tagStyle(kind: "outline" | "neutral" | "accent"): { background: string; border?: string; color: string } {
  if (kind === "accent") {
    return { background: "var(--accent-presence)", color: "var(--accent-presence-foreground)" };
  }
  if (kind === "neutral") {
    return { background: "var(--bg-base)", border: "1px solid var(--border-hairline)", color: "var(--text-muted)" };
  }
  return { background: "transparent", border: "1px solid var(--border-hairline)", color: "var(--text-secondary)" };
}

function DetailTag({ children, tone = "outline" }: { children: ReactNode; tone?: "outline" | "neutral" | "accent" }) {
  return (
    <span
      className="inline-flex shrink-0 items-center rounded px-2 py-0.5 text-[length:var(--text-2xs)] font-medium uppercase tracking-wide"
      style={tagStyle(tone)}
    >
      {children}
    </span>
  );
}

// ── Detail panel (slides in on row click) ────────────────────────────────────
export function DetailPanel({
  item,
  familiarLabel,
  busyId,
  onClose,
  runNow,
  togglePaused,
  stopRecurrence,
  removeItem,
  onEdit,
  onOpenLink,
  onDone,
  onReopen,
  onSnooze10,
  onSnooze60,
  onSnoozeTomorrow,
  onCancelSnooze,
  onToggleMute,
  onToggleRead,
}: {
  item: InboxItem;
  familiarLabel: (fid?: string | null) => string | null;
  busyId: string | null;
  onClose: () => void;
  runNow: (id: string) => void;
  togglePaused: (item: InboxItem) => void;
  stopRecurrence: (id: string) => void;
  removeItem: (id: string) => void;
  onEdit?: (item: InboxItem) => void;
  onOpenLink?: (link: LinkRef) => void;
  onDone?: (item: InboxItem) => void;
  onReopen?: (item: InboxItem) => void;
  onSnooze10?: (item: InboxItem) => void;
  onSnooze60?: (item: InboxItem) => void;
  onSnoozeTomorrow?: (item: InboxItem) => void;
  onCancelSnooze?: (item: InboxItem) => void;
  onToggleMute?: (item: InboxItem) => void;
  onToggleRead?: (item: InboxItem) => void;
}) {
  const paused = item.status === "dismissed" && item.recurrence?.type !== "none";
  const isRecurring = item.recurrence && item.recurrence.type !== "none";
  const isDailySummary = item.kind === "daily-summary";
  // Agent / response-needed items open this panel from the Activity tab too.
  // Those are records, not schedules — the schedule fields and the
  // Run/Pause/Edit mutations only make sense for actual reminders.
  const isReminder = item.kind === "reminder";
  const busy = busyId === item.id;
  const unread = item.status === "fired" && !item.readAt;
  const isDone = item.status === "done";
  const now = Date.now();
  const isSnoozed =
    item.status === "pending" &&
    !!item.snoozeUntil &&
    Date.parse(item.snoozeUntil) > now;
  const oneTimeNotification = isFiredOneTimeReminder(item);
  const [snoozeOpen, setSnoozeOpen] = useState(false);

  // The detail panel is a dialog: trap focus, close on Escape, and restore focus
  // to the row that opened it (useFocusTrap does the return-focus). aria-modal is
  // deliberately omitted — on desktop the list stays an interactive sibling, and
  // on mobile it's display:none, so claiming the rest is inert would be a lie.
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useFocusTrap(true, panelRef, { onEscape: onClose });

  return (
    <div ref={panelRef} role="dialog" aria-labelledby={titleId} tabIndex={-1}
      className="flex h-full flex-col border-l border-[var(--border-hairline)] bg-[var(--bg-raised)] focus:outline-none">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[var(--border-hairline)] px-5 py-3">
        <div className="flex items-center gap-2 min-w-0">
          <h2 id={titleId} className="truncate text-[length:var(--text-base)] font-semibold text-[var(--text-primary)]">
            {isDailySummary ? "Daily summary details" : isReminder ? "Reminder details" : "Activity details"}
          </h2>
          {unread && (
            <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-[var(--radius-pill)] bg-[var(--accent-presence)]" />
          )}
          <span className="sr-only">{unread ? "Unread" : ""}</span>
        </div>
        <Button
          variant="ghost"
          size="xs"
          onClick={onClose}
          aria-label="Close"
          className="shrink-0 rounded-[var(--radius-control)] p-1 text-[var(--text-muted)] transition-colors hover:bg-[color-mix(in_oklch,var(--foreground)_6%,transparent)]"
          leadingIcon="ph:x"
        />
      </div>

      {/* Snoozed / done banners — state the panel is currently in, mirroring
          the header pills the row itself would show. */}
      {isSnoozed && (
        <div className="flex items-center justify-between gap-2 border-b border-[var(--border-hairline)] bg-[color-mix(in_oklch,var(--accent-presence)_12%,transparent)] px-5 py-2 text-[length:var(--text-xs)] text-[var(--text-secondary)]">
          <span>Snoozed — until {formatTimestamp(item.snoozeUntil!, readDateTimePrefs())}</span>
          {onCancelSnooze && (
            <Button variant="ghost" size="xs" onClick={() => onCancelSnooze(item)} disabled={busy}
              className="shrink-0 rounded-[var(--radius-control)] px-1.5 py-0.5 text-[length:var(--text-xs)] font-medium text-[var(--text-primary)] underline-offset-2 hover:underline disabled:opacity-40">
              Cancel
            </Button>
          )}
        </div>
      )}
      {isDone && (
        <div className="flex items-center gap-2 border-b border-[var(--border-hairline)] bg-[var(--bg-base)] px-5 py-2 text-[length:var(--text-xs)] text-[var(--text-secondary)]">
          <Icon name="ph:check-circle-fill" width={13} className="text-[var(--accent-presence)]" aria-hidden />
          <span>Marked done — it won&apos;t fire again</span>
        </div>
      )}

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-5 py-5 space-y-5">
        <div className="flex flex-wrap gap-1.5">
          <DetailTag tone="neutral">{inboxKindLabel(item.kind)}</DetailTag>
          {isReminder && <DetailTag tone="neutral">{isRecurring ? "Recurring" : "One-time"}</DetailTag>}
        </div>

        <div>
          <p className="mb-1 text-[length:var(--text-2xs)] font-semibold uppercase tracking-widest text-[var(--text-muted)]">Name</p>
          <p className="text-[length:var(--text-md)] font-medium text-[var(--text-primary)]">
            {item.title}
          </p>
        </div>

        {item.body && (
          <div>
            <p className="mb-1 text-[length:var(--text-2xs)] font-semibold uppercase tracking-widest text-[var(--text-muted)]">Description</p>
            <p className="text-[length:var(--text-sm)] leading-relaxed text-[var(--text-secondary)]">
              {item.body}
            </p>
          </div>
        )}

        <div className="grid grid-cols-2 gap-4">
          {isReminder && !oneTimeNotification && (
            <div>
              <FieldLabel>Schedule</FieldLabel>
              <p className="text-[length:var(--text-sm)] text-[var(--text-primary)]">
                {humanSchedule(item.recurrence)}
              </p>
            </div>
          )}
          {isReminder && oneTimeNotification && (
            <div>
              <FieldLabel>Scheduled</FieldLabel>
              <p
                className="text-[length:var(--text-sm)] text-[var(--text-primary)]"
                title={item.fireAt ? formatTimestamp(item.fireAt, readDateTimePrefs()) : undefined}
              >
                {item.fireAt ? formatTimestamp(item.fireAt, readDateTimePrefs()) : "—"}
              </p>
              {item.firedAt && (
                <p className="text-[length:var(--text-xs)] text-[var(--text-muted)]">fired {relTime(item.firedAt)}</p>
              )}
            </div>
          )}
          <div>
            <FieldLabel>Status</FieldLabel>
            <p className="text-[length:var(--text-sm)] capitalize" style={{ color: paused ? "var(--text-muted)" : "var(--text-primary)" }}>
              {paused ? "Paused" : isSnoozed ? "Snoozed" : item.status}
            </p>
          </div>
          {isReminder && !oneTimeNotification && (
            <div>
              <FieldLabel>Next run</FieldLabel>
              <p
                className="text-[length:var(--text-sm)] text-[var(--text-primary)]"
                title={item.fireAt ? formatTimestamp(item.fireAt, readDateTimePrefs()) : undefined}
              >
                {relTime(item.fireAt)}
              </p>
            </div>
          )}
          {!oneTimeNotification && (
            <div>
              <FieldLabel>{isDailySummary ? "Sent" : isReminder ? "Last run" : "Received"}</FieldLabel>
              <p
                className="text-[length:var(--text-sm)]"
                style={{ color: item.firedAt ? "var(--color-success)" : "var(--text-muted)" }}
                title={item.firedAt ? formatTimestamp(item.firedAt, readDateTimePrefs()) : undefined}
              >
                {item.firedAt ? relTime(item.firedAt) : isReminder ? "Never" : "—"}
              </p>
            </div>
          )}
        </div>

        {/* Notifications — mark read/unread and mute delivery for this one
            item, distinct from the kind-/familiar-level mutes in the bell's
            settings panel. Every control here actually changes state. */}
        <div>
          <FieldLabel>Notifications</FieldLabel>
          <div className="rounded-[var(--radius-control)] border border-[var(--border-hairline)] overflow-hidden">
            <div className="flex items-center justify-between gap-3 px-3 py-2.5">
              <div className="min-w-0">
                <p className="text-[length:var(--text-sm)] text-[var(--text-primary)]">Delivery</p>
                <p className="text-[length:var(--text-xs)] text-[var(--text-muted)]">
                  {item.muted ? "Muted — no toast, sound, or system alert" : "Toast, sound, and system alert on fire"}
                </p>
              </div>
              {onToggleMute && (
                <Button
                  variant={item.muted ? "secondary" : "ghost"}
                  size="xs"
                  disabled={busy}
                  onClick={() => onToggleMute(item)}
                  aria-pressed={!!item.muted}
                  leadingIcon={item.muted ? "ph:bell-slash-fill" : "ph:bell-slash"}
                  className={`shrink-0 rounded-[var(--radius-control)] px-2.5 py-1 text-[length:var(--text-xs)] disabled:opacity-40${item.muted ? "" : " border border-[var(--border-hairline)] text-[var(--text-secondary)]"}`}
                >
                  {item.muted ? "Muted" : "Mute"}
                </Button>
              )}
            </div>
            <div className="h-px bg-[var(--border-hairline)]" />
            <div className="flex items-center justify-between gap-3 px-3 py-2.5">
              <div className="min-w-0">
                <p className="text-[length:var(--text-sm)] text-[var(--text-primary)]">Read state</p>
                <p className="text-[length:var(--text-xs)] text-[var(--text-muted)]">Reading quiets the badge; the item stays listed</p>
              </div>
              {onToggleRead && (
                <Button
                  variant="ghost"
                  size="xs"
                  disabled={busy || item.status !== "fired"}
                  onClick={() => onToggleRead(item)}
                  className="shrink-0 whitespace-nowrap rounded-[var(--radius-control)] border border-[var(--border-hairline)] px-2.5 py-1 text-[length:var(--text-xs)] text-[var(--text-secondary)] disabled:opacity-40"
                >
                  {item.readAt ? "Mark unread" : "Mark read"}
                </Button>
              )}
            </div>
          </div>
        </div>

        {familiarLabel(item.familiarId) && (
          <div>
            <p className="mb-1 text-[length:var(--text-2xs)] font-semibold uppercase tracking-widest text-[var(--text-muted)]">Familiar</p>
            <span className="inline-flex items-center gap-1.5 rounded-[var(--radius-control)] border border-[var(--border-hairline)] bg-[var(--bg-base)] px-2.5 py-1 text-[length:var(--text-xs)] text-[var(--text-secondary)]">
              {familiarLabel(item.familiarId)}
            </span>
          </div>
        )}

        {item.link && (
          <div>
            <p className="mb-1 text-[length:var(--text-2xs)] font-semibold uppercase tracking-widest text-[var(--text-muted)]">Link</p>
            <Button
              variant="ghost"
              size="xs"
              leadingIcon="ph:link"
              onClick={() => item.link && onOpenLink?.(item.link)}
              className="max-w-full rounded-[var(--radius-control)] border border-[var(--border-hairline)] bg-[var(--bg-base)] px-2.5 py-1 text-[length:var(--text-xs)] text-[var(--text-secondary)] transition-colors hover:bg-[color-mix(in_oklch,var(--foreground)_6%,transparent)]"
            >
              <span className="truncate">{linkLabel(item.link)}</span>
            </Button>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="border-t border-[var(--border-hairline)] px-5 py-4 space-y-2">
        {isReminder && oneTimeNotification ? (
          <>
            <div className="grid grid-cols-2 gap-2">
              <Button
                variant="primary"
                fullWidth
                disabled={busy}
                onClick={() => (isDone ? onReopen?.(item) : onDone?.(item))}
                className="rounded-[var(--radius-control)] py-2 text-[length:var(--text-sm)] font-medium transition-colors disabled:opacity-40"
              >
                {isDone ? "Reopen" : "Done"}
              </Button>
              <Button
                variant="secondary"
                fullWidth
                disabled={busy || isDone}
                onClick={() => setSnoozeOpen((v) => !v)}
                aria-expanded={snoozeOpen}
                className="rounded-[var(--radius-control)] border-[var(--border-hairline)] py-2 text-[length:var(--text-sm)] font-medium text-[var(--text-secondary)] transition-colors hover:bg-[color-mix(in_oklch,var(--foreground)_6%,transparent)] disabled:opacity-40"
              >
                Snooze…
              </Button>
            </div>
            {snoozeOpen && !isDone && (
              <div className="flex flex-wrap justify-center gap-1.5 py-0.5">
                <Button variant="ghost" size="xs" disabled={busy} onClick={() => { onSnooze10?.(item); setSnoozeOpen(false); }}
                  className="rounded-[var(--radius-pill)] border border-[var(--border-hairline)] px-3 py-1 text-[length:var(--text-xs)] disabled:opacity-40">
                  10 min
                </Button>
                <Button variant="ghost" size="xs" disabled={busy} onClick={() => { onSnooze60?.(item); setSnoozeOpen(false); }}
                  className="rounded-[var(--radius-pill)] border border-[var(--border-hairline)] px-3 py-1 text-[length:var(--text-xs)] disabled:opacity-40">
                  1 hour
                </Button>
                <Button variant="ghost" size="xs" disabled={busy} onClick={() => { onSnoozeTomorrow?.(item); setSnoozeOpen(false); }}
                  className="rounded-[var(--radius-pill)] border border-[var(--border-hairline)] px-3 py-1 text-[length:var(--text-xs)] disabled:opacity-40">
                  Tomorrow, 9 AM
                </Button>
              </div>
            )}
            <div className="flex justify-center gap-4 pt-0.5">
              {onEdit && (
                <Button variant="ghost" size="xs" onClick={() => onEdit(item)} disabled={busy}
                  className="rounded-[var(--radius-control)] p-0.5 text-[length:var(--text-xs)] text-[var(--text-muted)] transition-colors disabled:opacity-40 hover:underline">
                  Edit
                </Button>
              )}
              <Button variant="ghost" size="xs" onClick={() => removeItem(item.id)} disabled={busy}
                className="rounded-[var(--radius-control)] p-0.5 text-[length:var(--text-xs)] text-[var(--color-danger)] transition-colors disabled:opacity-40 hover:underline">
                Delete
              </Button>
            </div>
          </>
        ) : (
          <>
            {onEdit && isReminder && (
              <Button
                variant="secondary"
                fullWidth
                disabled={busy}
                onClick={() => onEdit(item)}
                className="justify-center rounded-[var(--radius-control)] py-2 text-[length:var(--text-sm)] font-medium transition-colors hover:bg-[color-mix(in_oklch,var(--foreground)_6%,transparent)] disabled:opacity-40 [border-color:var(--border-hairline)]! [color:var(--text-secondary)]!"
                leadingIcon="ph:pencil-simple"
              >
                Edit
              </Button>
            )}
            {isReminder && (
              <>
                <Button
                  variant="primary"
                  fullWidth
                  disabled={busy || paused}
                  onClick={() => runNow(item.id)}
                  className="rounded-[var(--radius-control)] py-2 text-[length:var(--text-sm)] font-medium transition-colors disabled:opacity-40"
                >
                  Run now
                </Button>
                <Button
                  variant="secondary"
                  fullWidth
                  disabled={busy}
                  onClick={() => togglePaused(item)}
                  className="rounded-[var(--radius-control)] py-2 text-[length:var(--text-sm)] font-medium transition-colors hover:bg-[color-mix(in_oklch,var(--foreground)_6%,transparent)] disabled:opacity-40 [border-color:var(--border-hairline)]! [color:var(--text-secondary)]!"
                >
                  {paused ? "Resume" : "Pause"}
                </Button>
              </>
            )}
            {isRecurring && isReminder && (
              <Button
                variant="secondary"
                fullWidth
                disabled={busy}
                onClick={() => stopRecurrence(item.id)}
                className="rounded-[var(--radius-control)] py-2 text-[length:var(--text-sm)] font-medium transition-colors hover:bg-[color-mix(in_oklch,var(--foreground)_6%,transparent)] disabled:opacity-40 [border-color:var(--border-hairline)]! [color:var(--text-secondary)]!"
              >
                Stop repeating
              </Button>
            )}
            <Button
              variant="danger-ghost"
              fullWidth
              disabled={busy}
              onClick={() => removeItem(item.id)}
              className="rounded-[var(--radius-control)] py-2 text-[length:var(--text-sm)] font-medium transition-colors hover:bg-[color-mix(in_oklch,var(--color-danger)_12%,transparent)] disabled:opacity-40 [color:var(--color-danger)]!"
            >
              Delete
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
