"use client";

/**
 * Daily report — the four overlay dialogs.
 *
 * Ported from the Claude Design handoff "Daily Report - Redesign.dc.html"
 * (sessions / reminder / share card / all chapters). The parent owns which
 * modal is open and owns the Escape key; this module owns the dialog chrome,
 * the focus trap, and the rendering of `DayModel` facts.
 *
 * Everything shown here is derived from real model fields. Where the mock
 * showed data the cave does not hold (per-session uncommitted diffs, "fired
 * N of N"), the line is dropped rather than faked, and controls that would
 * need API wiring we do not have (regenerate, download PNG, snooze, mark
 * done, audio narration) are omitted rather than shipped dead.
 */

import { type JSX, type ReactNode, useCallback, useEffect, useRef, useState } from "react";

import type { InboxItem } from "@/lib/cave-inbox";
import { itemHasTarget, itemHref } from "@/lib/daily-report";
import { clockLabel, type Chapter, type DayModel } from "@/lib/daily-report-day";
import { Icon, type IconName } from "@/lib/icon";
import { useFocusTrap } from "@/lib/use-focus-trap";

import "@/styles/daily-report-modals.css";

export type ReportModal = "share" | "sessions" | "reminder" | "chapters" | null;

// ── item vocabulary ─────────────────────────────────────────────────────────

const KIND_LABEL: Record<InboxItem["kind"], string> = {
  reminder: "Reminder",
  agent: "Familiar",
  "response-needed": "Needs reply",
  "daily-summary": "Daily report",
  milestone: "Milestone",
};

const KIND_ICON: Record<InboxItem["kind"], IconName> = {
  reminder: "ph:bell",
  agent: "ph:paw-print-fill",
  "response-needed": "ph:user",
  "daily-summary": "ph:book-open",
  milestone: "ph:sparkle",
};

/** Sessions resume; everything else just opens. */
function actionLabel(item: InboxItem): string {
  return item.link?.kind === "session" || item.sessionId ? "Resume" : "Open";
}

// ── formatting ──────────────────────────────────────────────────────────────

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

const WEEKDAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

/** "Jul 28 · 09:00" for an ISO instant; null when there is nothing to show. */
function fireLabel(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const date = d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return `${date} · ${clockLabel(iso)}`;
}

function everyLabel(everyMs: number): string {
  const minutes = Math.round(everyMs / 60_000);
  if (minutes < 60) return `${minutes}M`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}H`;
  return `${Math.round(hours / 24)}D`;
}

/** The recurrence as a compact mono pill, or null for one-shots. */
function recurrenceLabel(recurrence: InboxItem["recurrence"]): string | null {
  switch (recurrence.type) {
    case "none":
      return null;
    case "interval":
      return `EVERY ${everyLabel(recurrence.everyMs)}`;
    case "daily":
      return `DAILY ${pad2(recurrence.hour)}:${pad2(recurrence.minute)}`;
    case "weekly": {
      const days = recurrence.days
        .filter((d) => d >= 0 && d < 7)
        .map((d) => WEEKDAYS[d])
        .join(" ");
      const at = `${pad2(recurrence.hour)}:${pad2(recurrence.minute)}`;
      return days ? `${days} ${at}` : `WEEKLY ${at}`;
    }
    case "cron":
      return `CRON ${recurrence.expr}`;
  }
}

/** One deterministic line for the share card, built only from day facts. */
function shareSummary(model: DayModel): string {
  const merges = model.shipped.total;
  if (merges === 0) {
    return model.stats.sessions > 0
      ? `${model.stats.sessions} ${model.stats.sessions === 1 ? "session" : "sessions"}, nothing merged yet.`
      : "A quiet day in the cave.";
  }
  const noun = merges === 1 ? "merge" : "merges";
  if (model.projectCount > 0) {
    const projects = `${model.projectCount} ${model.projectCount === 1 ? "project" : "projects"}`;
    return `${merges} ${noun} across ${projects}.`;
  }
  return `${merges} ${noun}.`;
}

/** Rough read time for the chaptered narrative, floored at a minute. */
function readMinutes(chapters: Chapter[]): number {
  const words = chapters.reduce(
    (n, c) => n + `${c.title} ${c.summary}`.trim().split(/\s+/).filter(Boolean).length,
    0,
  );
  return Math.max(1, Math.round(words / 200));
}

// ── shell ───────────────────────────────────────────────────────────────────

type ShellProps = {
  /** Dialog accessible name. */
  label: string;
  /** Mono eyebrow, left of the slash. */
  kicker: string;
  /** Sentence-case title, right of the slash. */
  title: string;
  size: "sessions" | "reminder" | "share" | "chapters";
  onClose: () => void;
  children: ReactNode;
};

function ModalShell({ label, kicker, title, size, onClose, children }: ShellProps): JSX.Element {
  const dialogRef = useRef<HTMLDivElement | null>(null);

  // Repo-wide overlay contract: focus moves in on open, Tab cycles inside,
  // focus returns to the opener on unmount. Escape stays the parent's.
  useFocusTrap(true, dialogRef);

  return (
    <div className="drd-modal-backdrop" onClick={onClose}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        className={`drd-modal-dialog drd-modal-dialog--${size}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="drd-modal-head">
          <span className="drd-modal-kicker">{kicker}</span>
          <span className="drd-modal-sep" aria-hidden="true">
            /
          </span>
          <span className="drd-modal-heading">{title}</span>
          <button
            type="button"
            className="drd-modal-close"
            onClick={onClose}
            aria-label="Close"
          >
            <Icon name="ph:x" aria-hidden />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function EmptyState({
  icon,
  title,
  body,
}: {
  icon: IconName;
  title: string;
  body: string;
}): JSX.Element {
  return (
    <div className="drd-modal-empty">
      <span className="drd-modal-empty__icon">
        <Icon name={icon} aria-hidden />
      </span>
      <span className="drd-modal-empty__title">{title}</span>
      <p className="drd-modal-empty__body">{body}</p>
    </div>
  );
}

// ── sessions ────────────────────────────────────────────────────────────────

function SessionsModal({
  model,
  onClose,
}: {
  model: DayModel;
  onClose: () => void;
}): JSX.Element {
  const items = model.carries.openItems;
  return (
    <ModalShell
      label="Carries into tomorrow"
      kicker="CARRIES INTO TOMORROW"
      title={`${items.length} ${items.length === 1 ? "thread" : "threads"} left mid-thought`}
      size="sessions"
      onClose={onClose}
    >
      <div className="drd-modal-body">
        {items.length === 0 ? (
          <EmptyState
            icon="ph:check-circle"
            title="Nothing carries into tomorrow"
            body="Every thread from this day was answered, merged or closed."
          />
        ) : (
          <div className="drd-modal-list">
            {items.map((item) => (
              <div className="drd-modal-row" key={item.id}>
                <span className="drd-modal-row__glyph">
                  <Icon name={KIND_ICON[item.kind]} aria-hidden />
                </span>
                <span className="drd-modal-row__main">
                  <span className="drd-modal-row__title">{item.title}</span>
                  <span className="drd-modal-row__meta">
                    {KIND_LABEL[item.kind]}
                    {item.familiarId ? ` · ${item.familiarId}` : ""}
                  </span>
                </span>
                {itemHasTarget(item) ? (
                  <a className="drd-modal-row__action" href={itemHref(item)} onClick={onClose}>
                    {actionLabel(item)}
                  </a>
                ) : null}
              </div>
            ))}
            <p className="drd-modal-note">
              Unfinished work is safe where it stands — opening a thread picks it up where the
              familiar stopped.
            </p>
          </div>
        )}
      </div>
    </ModalShell>
  );
}

// ── reminder ────────────────────────────────────────────────────────────────

function ReminderModal({
  model,
  onClose,
}: {
  model: DayModel;
  onClose: () => void;
}): JSX.Element {
  const item = model.carries.nextReminder;
  const when = fireLabel(item?.fireAt);
  const repeat = item ? recurrenceLabel(item.recurrence) : null;

  return (
    <ModalShell
      label="Next reminder"
      kicker="REMINDER"
      title={when ?? "Nothing scheduled"}
      size="reminder"
      onClose={onClose}
    >
      <div className="drd-modal-body">
        {!item ? (
          <EmptyState
            icon="ph:bell"
            title="No reminder scheduled"
            body="Nothing is queued to fire after this day. Ask a familiar to set one and it will show up here."
          />
        ) : (
          <>
            <div className="drd-modal-reminder">
              <span className="drd-modal-reminder__icon">
                <Icon name="ph:bell" aria-hidden />
              </span>
              <div className="drd-modal-reminder__main">
                <div className="drd-modal-reminder__title">{item.title}</div>
                {item.body ? <p className="drd-modal-reminder__body">{item.body}</p> : null}
                <div className="drd-modal-pills">
                  {repeat ? <span className="drd-modal-pill">{repeat}</span> : null}
                  {item.whenText ? (
                    <span className="drd-modal-pill drd-modal-pill--accent">
                      {item.whenText.toUpperCase()}
                    </span>
                  ) : null}
                  <span className="drd-modal-pill">{KIND_LABEL[item.kind].toUpperCase()}</span>
                </div>
              </div>
            </div>
            <div className="drd-modal-foot">
              <a className="drd-modal-link" href={itemHref(item)} onClick={onClose}>
                <Icon name="ph:arrow-square-out" aria-hidden />
                Open in Rituals
              </a>
            </div>
          </>
        )}
      </div>
    </ModalShell>
  );
}

// ── share card ──────────────────────────────────────────────────────────────

function ShareModal({
  model,
  dateLabel,
  shareImageUrl,
  onClose,
}: {
  model: DayModel;
  dateLabel: string;
  shareImageUrl?: string | null;
  onClose: () => void;
}): JSX.Element {
  const [copied, setCopied] = useState(false);
  const revertRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (revertRef.current) clearTimeout(revertRef.current);
    },
    [],
  );

  const copy = useCallback(() => {
    const write = navigator.clipboard?.writeText(window.location.href);
    if (!write) return;
    void write.then(
      () => {
        setCopied(true);
        if (revertRef.current) clearTimeout(revertRef.current);
        revertRef.current = setTimeout(() => setCopied(false), 2000);
      },
      () => setCopied(false),
    );
  }, []);

  const stats: { value: string; label: string; success?: boolean }[] = [
    { value: String(model.shipped.total), label: "PRS MERGED" },
    { value: String(model.stats.sessions), label: "SESSIONS" },
    { value: `+${model.additions.toLocaleString()}`, label: "LINES", success: true },
    { value: `${model.streak.current}d`, label: "STREAK" },
  ];

  return (
    <ModalShell
      label="Share card"
      kicker="SHARE CARD"
      title={`${dateLabel} · 1200×630`}
      size="share"
      onClose={onClose}
    >
      <div className="drd-modal-body">
        {shareImageUrl ? (
          <div className="drd-modal-card drd-modal-card--image">
            <img src={shareImageUrl} alt="" />
          </div>
        ) : (
          <div className="drd-modal-card">
            <p className="drd-modal-card__kicker">COVENCAVE · DAILY REPORT</p>
            <p className="drd-modal-card__date">{dateLabel}</p>
            <p className="drd-modal-card__line">{shareSummary(model)}</p>
            <div className="drd-modal-card__stats">
              {stats.map((stat) => (
                <div className="drd-modal-card__stat" key={stat.label}>
                  <div
                    className={
                      stat.success
                        ? "drd-modal-card__value drd-modal-card__value--success"
                        : "drd-modal-card__value"
                    }
                  >
                    {stat.value}
                  </div>
                  <div className="drd-modal-card__label">{stat.label}</div>
                </div>
              ))}
            </div>
          </div>
        )}
        <div className="drd-modal-foot">
          <span className="drd-modal-note drd-modal-note--inline">
            The card freezes with the day&rsquo;s facts.
          </span>
          <button type="button" className="drd-modal-button" onClick={copy}>
            {copied ? (
              <>
                <Icon name="ph:check-circle" aria-hidden />
                Link copied
              </>
            ) : (
              <>
                <Icon name="ph:link-simple" aria-hidden />
                Copy link
              </>
            )}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

// ── chapters ────────────────────────────────────────────────────────────────

function ChaptersModal({
  model,
  dateLabel,
  narrativeByline,
  onClose,
}: {
  model: DayModel;
  dateLabel: string;
  narrativeByline?: string | null;
  onClose: () => void;
}): JSX.Element {
  const chapters = model.chapters;
  const first = clockLabel(model.window.firstAt);
  const last = clockLabel(model.window.lastAt);

  return (
    <ModalShell
      label="The whole day"
      kicker="THE WHOLE DAY"
      title={`${chapters.length} ${chapters.length === 1 ? "chapter" : "chapters"} · ${readMinutes(chapters)} min read`}
      size="chapters"
      onClose={onClose}
    >
      <div className="drd-modal-body drd-modal-body--read">
        {chapters.length === 0 ? (
          <EmptyState
            icon="ph:book-open"
            title="A day without chapters"
            body="Nothing timestamped happened, so there is no narrative to tell yet."
          />
        ) : (
          <>
            {first && last ? (
              <p className="drd-modal-lede">
                From {first} to {last}.
              </p>
            ) : null}
            <h2 className="drd-modal-day">{dateLabel}</h2>

            {chapters.map((chapter) => {
              const merges = chapter.events.filter((e) => e.kind === "merge");
              return (
                <section className="drd-modal-chapter" key={chapter.ordinal}>
                  <div className="drd-modal-chapter__head">
                    <span className="drd-modal-chapter__ordinal">
                      {chapter.ordinal} · {clockLabel(chapter.startAt)}
                    </span>
                    <h3 className="drd-modal-chapter__title">{chapter.title}</h3>
                  </div>
                  <p className="drd-modal-chapter__body">{chapter.summary}</p>
                  {merges.length > 0 ? (
                    <div className="drd-modal-merges">
                      {merges.map((merge) => (
                        <span className="drd-modal-merge" key={merge.id}>
                          {merge.detail ? (
                            <span className="drd-modal-merge__ref">{merge.detail}</span>
                          ) : null}
                          {merge.label}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </section>
              );
            })}

            <div className="drd-modal-foot drd-modal-foot--read">
              {narrativeByline ? (
                <span className="drd-modal-byline">
                  <Icon name="ph:sparkle" aria-hidden />
                  {narrativeByline}
                </span>
              ) : null}
              <button
                type="button"
                className="drd-modal-button drd-modal-button--primary"
                onClick={onClose}
              >
                Back to the day
              </button>
            </div>
          </>
        )}
      </div>
    </ModalShell>
  );
}

// ── entry point ─────────────────────────────────────────────────────────────

export function DayModals({
  modal,
  onClose,
  model,
  dateLabel,
  shareImageUrl,
  narrativeByline,
}: {
  modal: ReportModal;
  onClose: () => void;
  model: DayModel;
  dateLabel: string;
  shareImageUrl?: string | null;
  narrativeByline?: string | null;
}): JSX.Element | null {
  if (!modal) return null;

  // Keyed so switching modals remounts the shell — the focus trap re-captures
  // the opener instead of restoring focus into a dialog that just closed.
  switch (modal) {
    case "sessions":
      return <SessionsModal key="sessions" model={model} onClose={onClose} />;
    case "reminder":
      return <ReminderModal key="reminder" model={model} onClose={onClose} />;
    case "share":
      return (
        <ShareModal
          key="share"
          model={model}
          dateLabel={dateLabel}
          shareImageUrl={shareImageUrl}
          onClose={onClose}
        />
      );
    case "chapters":
      return (
        <ChaptersModal
          key="chapters"
          model={model}
          dateLabel={dateLabel}
          narrativeByline={narrativeByline}
          onClose={onClose}
        />
      );
  }
}
