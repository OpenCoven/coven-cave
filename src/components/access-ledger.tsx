"use client";

import "@/styles/access-ledger.css";

import type { ReactNode } from "react";
import { formatClock, formatDate, useDateTimePrefs } from "@/lib/datetime-format";
import { relativeTimeSigned } from "@/lib/relative-time";

/**
 * The access ledger — one row grammar for every surface that decides who may
 * reach the Cave: paired client apps (Settings → Client access), remote
 * devices (Settings → Phone → Device access) and familiar access groups
 * (Chat → Projects → Groups). A record is a divided row, not a boxed card:
 * a status seal, a title with its status word, a mono identity line, a
 * relative-time meta line, and the actions the record allows.
 *
 * The seal is the one live element. It pulses only while a request waits on
 * the human — that is the single state here that is alive — and holds still
 * under reduced motion. Color never carries meaning alone: every seal sits
 * beside a status word.
 */
export type AccessTone = "pending" | "good" | "bad" | "muted";

export function AccessSeal({ tone, live = false }: { tone: AccessTone; live?: boolean }) {
  return <span className="access-seal" data-tone={tone} data-live={live ? "true" : undefined} aria-hidden="true" />;
}

/** The status word beside a title: "pending", "active", "revoked"… */
export function AccessStatus({
  tone,
  children,
  className,
}: {
  tone: AccessTone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span className={`access-status${className ? ` ${className}` : ""}`} data-tone={tone}>
      {children}
    </span>
  );
}

/**
 * A timestamp a person can read ("3m ago", "in 4m"), exact on hover. The
 * `<time dateTime>` carries the ISO instant, so a record's expiry stays
 * machine-readable. Future instants read "in …", past ones "… ago".
 */
export function AccessTime({
  value,
  fallback = "never",
  now,
}: {
  value: number | null | undefined;
  fallback?: ReactNode;
  now?: number;
}) {
  const prefs = useDateTimePrefs();
  const date = typeof value === "number" ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return <>{fallback}</>;
  const iso = date.toISOString();
  const exact = `${formatDate(iso, prefs, { year: true, weekday: true })} at ${formatClock(iso, prefs)}`;
  return (
    <time dateTime={iso} title={exact}>
      {relativeTimeSigned(iso, now, prefs.density)}
    </time>
  );
}

/** Meta facts joined by middle dots: "Requested 2m ago · expires in 3m". */
export function AccessMeta({ items, className }: { items: ReactNode[]; className?: string }) {
  const present = items.filter((item) => item !== null && item !== undefined && item !== false);
  if (present.length === 0) return null;
  return (
    <p className={`access-ledger__meta${className ? ` ${className}` : ""}`}>
      {present.map((item, index) => (
        <span key={index} className="access-ledger__fact">
          {index > 0 ? <span className="access-ledger__sep" aria-hidden="true">·</span> : null}
          {item}
        </span>
      ))}
    </p>
  );
}

/**
 * A short code the person compares against another screen before deciding.
 * Set large enough to read across a desk, with the characters spaced so
 * neighbours don't fuse.
 */
export function AccessCode({ label, code }: { label: string; code: string }) {
  return (
    <span className="access-code">
      <span className="access-code__label">{label}</span>
      <code className="access-code__value">{code}</code>
    </span>
  );
}

export function AccessRow({
  tone,
  live = false,
  settled = false,
  title,
  status,
  lead,
  identity,
  tags,
  meta,
  actions,
  revealActions = false,
  children,
  className,
  titleAs = "h3",
}: {
  tone: AccessTone;
  live?: boolean;
  /** A record whose decision is made reads quieter than one still open. */
  settled?: boolean;
  title: ReactNode;
  status?: ReactNode;
  /** The first thing under the title — a code to verify before deciding. */
  lead?: ReactNode;
  identity?: ReactNode;
  tags?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  /** Quiet destructive actions (Revoke) earn visibility on hover or focus of
   *  the row; touch shows them always (design language §8). */
  revealActions?: boolean;
  children?: ReactNode;
  className?: string;
  titleAs?: "h3" | "h4" | "div";
}) {
  const Title = titleAs;
  return (
    <article
      className={`access-ledger__row reveal-scope${settled ? " access-ledger__row--settled" : ""}${className ? ` ${className}` : ""}`}
    >
      <AccessSeal tone={tone} live={live} />
      <div className="access-ledger__body">
        <div className="access-ledger__headline">
          <Title className="access-ledger__title">{title}</Title>
          {status}
        </div>
        {lead ? <div className="access-ledger__lead">{lead}</div> : null}
        {identity ? <p className="access-ledger__identity">{identity}</p> : null}
        {tags}
        {meta}
        {children}
      </div>
      {actions ? (
        <div className={`access-ledger__actions${revealActions ? " reveal-on-hover" : ""}`}>{actions}</div>
      ) : null}
    </article>
  );
}

/** Rows stack inside one panel; the panel's own border is the only box. */
export function AccessLedger({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={`access-ledger${className ? ` ${className}` : ""}`}>{children}</div>;
}
