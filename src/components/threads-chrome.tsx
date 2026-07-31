"use client";
// Shared chrome for the two coven-threads decision surfaces (`/weaves`,
// `/proposals`): the 44px header that carries the breadcrumb and the single
// primary action, the surface banners, and the full-surface blocked state.
//
// Both surfaces are one flow — inspect a weave, decide the write it staged —
// so they share a header rather than each inventing a topbar. The header names
// where you are, offers exactly one way onward, and puts the number of writes
// waiting on you inside that action instead of in a separate counter.
import type { ReactNode } from "react";
import { Icon } from "@/lib/icon";
import type { SurfaceBanner, SurfaceState } from "@/lib/weave-rail";

/** The Memories surface is the parent of both routes. */
export const MEMORIES_HREF = "/?mode=grimoire";

export function ThreadsHeader({
  surface,
  pendingCount,
  listCollapsed,
  onToggleList,
}: {
  surface: "weaves" | "proposals";
  /** null when the proposals queue could not be verified — no badge is shown. */
  pendingCount: number | null;
  listCollapsed: boolean;
  onToggleList: () => void;
}) {
  const toggleLabel = listCollapsed ? "Expand list" : "Collapse list";
  return (
    <header className="wv-head">
      <div className="wv-head__lead">
        <button
          type="button"
          className="wv-toggle focus-ring"
          onClick={onToggleList}
          aria-expanded={!listCollapsed}
          aria-label={toggleLabel}
          title={toggleLabel}
        >
          <Icon name="ph:sidebar-simple" aria-hidden />
        </button>
        <nav className="wv-crumbs" aria-label="Breadcrumb">
          <a className="wv-crumb focus-ring" href={MEMORIES_HREF}>
            <Icon name="ph:arrow-left" aria-hidden />
            Memories
          </a>
          <span className="wv-crumb-sep" aria-hidden>
            /
          </span>
          {surface === "weaves" ? (
            <span className="wv-crumb wv-crumb--current" aria-current="page">
              Weaves
            </span>
          ) : (
            <a className="wv-crumb focus-ring" href="/weaves">
              Weaves
            </a>
          )}
          {surface === "proposals" ? (
            <>
              <span className="wv-crumb-sep" aria-hidden>
                /
              </span>
              <span className="wv-crumb wv-crumb--current" aria-current="page">
                Proposals
              </span>
            </>
          ) : null}
        </nav>
      </div>
      {surface === "weaves" ? (
        <a className="wv-cta focus-ring" href="/proposals">
          Review proposals
          {pendingCount !== null && pendingCount > 0 ? (
            <span className="wv-cta__badge">{pendingCount}</span>
          ) : null}
        </a>
      ) : (
        <a className="wv-ghost focus-ring" href="/weaves">
          <Icon name="ph:arrow-left" aria-hidden />
          Back to weaves
        </a>
      )}
    </header>
  );
}

export function SurfaceBanners({ banners }: { banners: SurfaceBanner[] }) {
  return (
    <>
      {banners.map((banner) => (
        <p key={banner.kind} role="status" className="wv-banner">
          <Icon name={banner.kind === "stale" ? "ph:clock-countdown" : "ph:flask"} aria-hidden />
          <span>{banner.message}</span>
        </p>
      ))}
    </>
  );
}

/**
 * Fail-closed full-surface state. It says what could not be verified, states
 * the rule (nothing is shown as healthy while the source is unverifiable), and
 * offers the two ways out — never a cached or guessed list behind it.
 */
export function BlockedSurface({
  state,
  title,
  rule,
  onRetry,
  children,
}: {
  state: Extract<SurfaceState<unknown>, { kind: "blocked" }>;
  title: string;
  rule: string;
  onRetry: () => void;
  children?: ReactNode;
}) {
  return (
    <div className="wv-center">
      <div role="alert" className="wv-blocked">
        <span className="wv-blocked__title">
          <Icon name="ph:shield-slash" aria-hidden />
          {title}
        </span>
        <p className="wv-blocked__body">{state.message}</p>
        <p className="wv-blocked__rule">{rule}</p>
        <div className="wv-blocked__actions">
          <button type="button" className="wv-cta focus-ring" onClick={onRetry}>
            <Icon name="ph:arrows-clockwise" aria-hidden />
            Retry
          </button>
          {children}
        </div>
        {state.meta ? (
          <p className="wv-blocked__meta">
            last attempt {state.meta.observedAt} · adapter {state.meta.adapter} · cursor{" "}
            {state.meta.sourceCursor}
          </p>
        ) : null}
      </div>
    </div>
  );
}

export function SurfaceSkeleton({ split, label }: { split: boolean; label: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={split ? "wv-loading wv-loading--split" : "wv-loading"}
    >
      {split ? (
        <div className="wv-loading__rail">
          <span className="wv-loading__label">{label}</span>
          {[1, 2, 3, 4, 5, 6, 7].map((row) => (
            <span key={row} className="wv-sk wv-sk--row" />
          ))}
        </div>
      ) : null}
      <div className="wv-loading__pane">
        {split ? null : <span className="wv-loading__label">{label}</span>}
        {split ? (
          <>
            <span className="wv-sk wv-sk--title" />
            <span className="wv-sk wv-sk--block" />
            <span className="wv-sk wv-sk--row" />
            <span className="wv-sk wv-sk--row" />
          </>
        ) : (
          [1, 2, 3, 4].map((row) => <span key={row} className="wv-sk wv-sk--card" />)
        )}
      </div>
    </div>
  );
}
