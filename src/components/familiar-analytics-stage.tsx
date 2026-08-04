"use client";

import { memo, useCallback, useEffect, useRef, useState } from "react";
import {
  ANALYTICS_WINDOWS,
  DEFAULT_WINDOW,
  deriveScopedActivityCadence,
  type WindowId,
} from "@/lib/analytics-window";
import type { FamiliarAnalyticsModel } from "@/components/familiar-analytics-data";
import { PulseBars } from "@/components/ui/pulse-bars";
import { RelativeTime } from "@/components/ui/relative-time";
import { Icon } from "@/lib/icon";
import type { SelfHealRequest } from "@/lib/familiar-heal-requests";
import { pulseTotal, type PulseDay } from "@/lib/session-pulse";
import type { SessionRow } from "@/lib/types";

// ─── Scope: one lens and one time window for the whole stage ─────────────────

export type LensId = "all" | "crit" | "contract" | "skills";
export const DEFAULT_LENS: LensId = "all";
export type { WindowId } from "@/lib/analytics-window";
export { ANALYTICS_WINDOWS, DEFAULT_WINDOW, withinWindow } from "@/lib/analytics-window";

/** Does this heal request survive the lens? Lenses read real request fields —
 *  severity, source, and action kind — so a lens can never show a phantom. */
export function matchesLens(request: SelfHealRequest, lens: LensId): boolean {
  switch (lens) {
    case "crit": return request.severity === "crit";
    case "contract": return request.source === "contract";
    case "skills": return request.actionKind === "request-skill";
    default: return true;
  }
}

const LENS_DEFS: { id: LensId; label: string; icon: Parameters<typeof Icon>[0]["name"]; title: string }[] = [
  { id: "all", label: "Everything", icon: "ph:squares-four", title: "No filter — the whole picture" },
  { id: "crit", label: "Critical", icon: "ph:warning-circle", title: "Only critical requests" },
  { id: "contract", label: "Contract", icon: "ph:file-text", title: "Contract and ward.toml work only" },
  { id: "skills", label: "Skills", icon: "ph:sparkle", title: "Skill access gaps only" },
];

/**
 * The stage's scope bar: one lens and one time window applied to everything
 * below it. Both chips carry live counts so the reader can see what a lens
 * would narrow to before spending a click on it, and Reset only appears once
 * the scope is actually off its default.
 */
export const ScopeBar = memo(function ScopeBar({
  lens,
  window: windowId,
  onLens,
  onWindow,
  onReset,
  healRequests,
  sessionCount,
  reportCount,
}: {
  lens: LensId;
  window: WindowId;
  onLens: (lens: LensId) => void;
  onWindow: (window: WindowId) => void;
  onReset: () => void;
  healRequests: SelfHealRequest[];
  sessionCount: number;
  reportCount: number;
}) {
  const active = lens !== DEFAULT_LENS || windowId !== DEFAULT_WINDOW;
  const windowTitle = ANALYTICS_WINDOWS.find((entry) => entry.id === windowId)?.title ?? "";
  const scoped = healRequests.filter((request) => matchesLens(request, lens)).length;
  const summary = lens === DEFAULT_LENS
    ? `${sessionCount} session${sessionCount === 1 ? "" : "s"} · ${reportCount} report${reportCount === 1 ? "" : "s"} · ${windowTitle.toLowerCase()}`
    : `${scoped} of ${healRequests.length} requests · ${sessionCount} session${sessionCount === 1 ? "" : "s"} · ${windowTitle.toLowerCase()}`;
  return (
    <div className="fa-scope" role="group" aria-label="Analytics scope">
      <span className="fa-scope__legend">
        <span className="fa-scope__crest" aria-hidden>
          <Icon name="ph:funnel" width={13} />
        </span>
        Lens
      </span>
      <div className="fa-scope__chips">
        {LENS_DEFS.map((def) => (
          <button
            key={def.id}
            type="button"
            className={`fa-chip fa-chip--${def.id}${lens === def.id ? " is-active" : ""} focus-ring`}
            aria-pressed={lens === def.id}
            title={def.title}
            onClick={() => onLens(def.id)}
          >
            <span className="fa-chip__rail" aria-hidden />
            <Icon name={def.icon} width={13} aria-hidden />
            {def.label}
            <b className="fa-chip__n">
              {def.id === "all"
                ? healRequests.length
                : healRequests.filter((request) => matchesLens(request, def.id)).length}
            </b>
          </button>
        ))}
      </div>
      <span className="fa-scope__rule" aria-hidden />
      <span className="fa-scope__legend">
        <span className="fa-scope__crest fa-scope__crest--plain" aria-hidden>
          <Icon name="ph:clock-counter-clockwise" width={13} />
        </span>
        Window
      </span>
      <div className="fa-segmented" role="group" aria-label="Time window">
        {ANALYTICS_WINDOWS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            className={`fa-segmented__btn${windowId === entry.id ? " is-active" : ""} focus-ring`}
            aria-pressed={windowId === entry.id}
            title={entry.title}
            onClick={() => onWindow(entry.id)}
          >
            {entry.label}
          </button>
        ))}
      </div>
      <span className="fa-scope__rule" aria-hidden />
      <span className={`fa-scope__summary fa-scope__summary--${lens}`}>
        <i aria-hidden />
        {summary}
      </span>
      {active ? (
        <button type="button" className="fa-scope__reset focus-ring" onClick={onReset} title="Reset lens and window">
          <Icon name="ph:arrow-counter-clockwise" width={12} aria-hidden />
          Reset
        </button>
      ) : null}
    </div>
  );
});

// ─── Stat band: three flip cards, a signals entry, and the pulse ─────────────

/** A two-faced stat card. The front is the glanceable number; the back is the
 *  breakdown that number hides. Flipping is a real 3D rotation, and both faces
 *  live in the DOM so the card's height never jumps. */
function FlipStat({
  label,
  flipped,
  onFlip,
  front,
  back,
  ariaLabel,
}: {
  label: string;
  flipped: boolean;
  onFlip: () => void;
  front: React.ReactNode;
  back: React.ReactNode;
  ariaLabel: string;
}) {
  return (
    <button
      type="button"
      className="fa-stat fa-stat--flip focus-ring"
      aria-label={ariaLabel}
      aria-pressed={flipped}
      title={flipped ? `${label} — flip back` : `${label} — flip for details`}
      onClick={onFlip}
    >
      <span className={`fa-stat__pivot${flipped ? " is-flipped" : ""}`}>
        <span className="fa-stat__face">{front}</span>
        <span className="fa-stat__face fa-stat__face--back">{back}</span>
      </span>
    </button>
  );
}

function StatHead({ label, icon }: { label: string; icon: Parameters<typeof Icon>[0]["name"] }) {
  return (
    <span className="fa-stat__head">
      {label}
      <Icon name={icon} className="fa-stat__hint" width={11} aria-hidden />
    </span>
  );
}

/** Session rows are "done" unless the status says otherwise. */
function isFailed(session: SessionRow): boolean {
  return /(error|fail|killed|crash)/i.test(session.status);
}

export const StatBand = memo(function StatBand({
  model,
  sessions,
  now,
  windowDays,
  healRequests,
  reportCount,
  queueCount,
  pulseOpen,
  onTogglePulse,
  onOpenSignals,
  onSelectDay,
  selectedDayKey,
}: {
  model: FamiliarAnalyticsModel;
  /** Window-scoped sessions — the number the Activity card reports. */
  sessions: SessionRow[];
  /** Shared scope clock and duration for the Activity card's breakdown. */
  now: number;
  windowDays: number | null;
  /** Lens-scoped heal requests — the number the Self-heal card reports. */
  healRequests: SelfHealRequest[];
  reportCount: number;
  queueCount: number;
  pulseOpen: boolean;
  onTogglePulse: () => void;
  onOpenSignals: () => void;
  onSelectDay: (day: PulseDay) => void;
  selectedDayKey: string | null;
}) {
  const [flipped, setFlipped] = useState<{ activity: boolean; contract: boolean; heal: boolean }>({
    activity: false,
    contract: false,
    heal: false,
  });
  const flip = useCallback((key: "activity" | "contract" | "heal") => {
    setFlipped((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const pulse = model.sessionPulse;
  const pulseSessions = pulseTotal(pulse);
  const { activeNow, busiest, lastActive, perWeek } = deriveScopedActivityCadence(sessions, now, windowDays);
  const failed = sessions.filter(isFailed).length;
  const completed = sessions.length - failed;

  const contract = model.contractReport;
  const passCount = contract ? contract.properties.filter((property) => property.pass).length : 0;
  const failing = contract ? contract.properties.filter((property) => !property.pass) : [];

  const bySeverity: { key: SelfHealRequest["severity"]; label: string }[] = [
    { key: "crit", label: "critical" },
    { key: "warn", label: "warning" },
    { key: "info", label: "info" },
  ];

  return (
    <div className="fa-stats" aria-label="Headline metrics">
      <FlipStat
        label="Activity"
        ariaLabel={`Activity — ${sessions.length} sessions in window. Flip for the cadence breakdown.`}
        flipped={flipped.activity}
        onFlip={() => flip("activity")}
        front={
          <>
            <StatHead label="Activity" icon="ph:arrows-clockwise" />
            <b className={`fa-stat__value${activeNow ? " is-good" : ""}`}>{activeNow ? "Active" : "Idle"}</b>
            <span className="fa-stat__sub">
              {sessions.length} session{sessions.length === 1 ? "" : "s"} in window
            </span>
          </>
        }
        back={
          <>
            <StatHead label="Cadence" icon="ph:arrow-u-up-left" />
            <span className="fa-stat__row">Per week<b>{perWeek}</b></span>
            <span className="fa-stat__row">
              Busiest day<b>{busiest && busiest.count > 0 ? `${busiest.label} · ${busiest.count}` : "—"}</b>
            </span>
            <span className="fa-stat__row">
              Completed<b className="is-good">{completed}/{sessions.length}</b>
            </span>
            <span className="fa-stat__row">
              Last active<b>{lastActive ? <RelativeTime iso={lastActive} /> : "never"}</b>
            </span>
          </>
        }
      />

      <FlipStat
        label="Contract"
        ariaLabel={
          contract
            ? `Contract ${passCount} of ${contract.properties.length} passing. Flip for the failing properties.`
            : "Contract not evaluated. Flip for details."
        }
        flipped={flipped.contract}
        onFlip={() => flip("contract")}
        front={
          <>
            <StatHead label="Contract" icon="ph:arrows-clockwise" />
            <b className={`fa-stat__value${contract ? (contract.pass ? " is-good" : " is-warn") : ""}`}>
              {contract ? `${passCount}/${contract.properties.length}` : "—"}
            </b>
            <span className="fa-stat__sub">
              {contract ? (contract.pass ? "passing" : "needs review") : "not evaluated"}
            </span>
          </>
        }
        back={
          <>
            <StatHead
              label={
                failing.length > 0
                  ? `${failing.length} failing propert${failing.length === 1 ? "y" : "ies"}`
                  : "All properties pass"
              }
              icon="ph:arrow-u-up-left"
            />
            {failing.slice(0, 3).map((property) => (
              <span key={property.property} className="fa-stat__row fa-stat__row--fail">
                <Icon name="ph:warning-circle" width={12} aria-hidden />
                {property.property}
              </span>
            ))}
            {contract ? (
              <>
                {/* Pass/fail split as one bar. Both counts ride in as custom
                    properties so the two segments size themselves in CSS. */}
                <span
                  className="fa-stat__split"
                  aria-hidden
                  style={{
                    "--fa-pass": Math.max(passCount, 0.001),
                    "--fa-fail": Math.max(failing.length, 0.001),
                  } as React.CSSProperties}
                >
                  <i className="is-pass" />
                  <i className="is-fail" />
                </span>
                <span className="fa-stat__foot">
                  {passCount} pass · {contract.violations.length} violation
                  {contract.violations.length === 1 ? "" : "s"}
                </span>
              </>
            ) : null}
          </>
        }
      />

      <FlipStat
        label="Self-heal"
        ariaLabel={`Self-heal — ${healRequests.length} open requests. Flip for the severity breakdown.`}
        flipped={flipped.heal}
        onFlip={() => flip("heal")}
        front={
          <>
            <StatHead label="Self-heal" icon="ph:arrows-clockwise" />
            <b className={`fa-stat__value${healRequests.length === 0 ? " is-good" : " is-warn"}`}>
              {healRequests.length}
            </b>
            <span className="fa-stat__sub">open request{healRequests.length === 1 ? "" : "s"}</span>
          </>
        }
        back={
          <>
            <StatHead
              label={`${healRequests.filter((request) => request.severity === "crit").length} critical first`}
              icon="ph:arrow-u-up-left"
            />
            {bySeverity.map((severity) => {
              const n = healRequests.filter((request) => request.severity === severity.key).length;
              const pct = healRequests.length > 0 ? (n / healRequests.length) * 100 : 0;
              return (
                <span key={severity.key} className={`fa-stat__meter fa-stat__meter--${severity.key}`}>
                  <i className="fa-stat__meter-dot" aria-hidden />
                  <span className="fa-stat__meter-label">{severity.label}</span>
                  <span className="fa-stat__meter-track" aria-hidden>
                    <i style={{ width: `${pct}%` }} />
                  </span>
                  <b>{n}</b>
                </span>
              );
            })}
          </>
        }
      />

      <button
        type="button"
        className="fa-stat fa-stat--link focus-ring"
        onClick={onOpenSignals}
        title="Open thread signals"
      >
        <StatHead label="Signals" icon="ph:arrows-out-simple" />
        <b className="fa-stat__value">{reportCount}</b>
        <span className="fa-stat__sub">
          report{reportCount === 1 ? "" : "s"} · {queueCount} queued
        </span>
      </button>

      <section className="fa-stat fa-stat--pulse" aria-label="14-day pulse">
        <span className="fa-stat__head">
          14-day pulse
          <button
            type="button"
            className="fa-icon-btn fa-icon-btn--xs focus-ring"
            onClick={onTogglePulse}
            aria-expanded={pulseOpen}
            title={pulseOpen ? "Collapse the activity detail" : "Expand the activity detail"}
            aria-label={pulseOpen ? "Collapse the activity detail" : "Expand the activity detail"}
          >
            <Icon
              name={pulseOpen ? "ph:arrows-in-simple" : "ph:arrows-out-simple"}
              width={11}
              aria-hidden
            />
          </button>
        </span>
        <PulseBars
          pulse={pulse}
          label={`14-day activity: ${pulseSessions} session${pulseSessions === 1 ? "" : "s"}. Select a day to filter recent sessions.`}
          size="md"
          showTips
          onSelectDay={onSelectDay}
          selectedKey={selectedDayKey}
        />
        <span className="fa-stat__foot">
          {pulseSessions} session{pulseSessions === 1 ? "" : "s"} · last active{" "}
          {lastActive ? <RelativeTime iso={lastActive} /> : "never"}
        </span>
      </section>
    </div>
  );
});

// ─── Self-heal strip ────────────────────────────────────────────────────────

const HEAL_ACTION_ICON: Record<SelfHealRequest["actionKind"], Parameters<typeof Icon>[0]["name"]> = {
  "fix-contract": "ph:file-text",
  "write-memory": "ph:brain",
  "request-skill": "ph:lock-simple",
  manual: "ph:wrench-bold",
};

const HEAL_ACTION_LABEL: Record<SelfHealRequest["actionKind"], string> = {
  "fix-contract": "Fix contract",
  "write-memory": "Capture memory",
  "request-skill": "Request skill",
  manual: "Review",
};

/** Cards per viewport page — the dot pager and the arrows both step by one
 *  full track width, so this is only used to size the dot count. */
const HEAL_PAGE_SIZE = 5;

/**
 * The self-heal strip — every open request, laid out as one horizontally
 * scrolling track instead of a truncated grid. It is drag-scrollable (a real
 * grab-and-throw, with a 4px threshold so a drag never fires a card's click),
 * arrow- and dot-pageable, and the dots reflect the true scroll position
 * because the track reports its own scroll back up.
 */
export const SelfHealStrip = memo(function SelfHealStrip({
  requests,
  totalRequests,
  onInspect,
  onTrace,
  onViewAll,
}: {
  requests: SelfHealRequest[];
  /** Unscoped total, so the header can say "6 of 11" under a lens. */
  totalRequests: number;
  onInspect: (request: SelfHealRequest) => void;
  onTrace: (request: SelfHealRequest) => void;
  onViewAll: () => void;
}) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [page, setPage] = useState(0);
  const pageCount = Math.max(1, Math.ceil(requests.length / HEAL_PAGE_SIZE));

  // Drag-to-scroll. The listeners live on window so a fast drag that leaves
  // the track still tracks and still releases; `moved` gates the click so a
  // throw never opens the card it started on.
  const onPointerDown = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    const el = trackRef.current;
    if (!el || event.button !== 0) return;
    const startX = event.clientX;
    const startLeft = el.scrollLeft;
    let moved = 0;
    el.classList.add("is-grabbing");
    const previousBehavior = el.style.scrollBehavior;
    el.style.scrollBehavior = "auto";
    const move = (ev: MouseEvent) => {
      const dx = ev.clientX - startX;
      moved = Math.max(moved, Math.abs(dx));
      if (moved > 4) {
        el.scrollLeft = startLeft - dx;
        ev.preventDefault();
      }
    };
    const up = (ev: MouseEvent) => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up, true);
      el.classList.remove("is-grabbing");
      el.style.scrollBehavior = previousBehavior;
      if (moved > 4) {
        ev.stopPropagation();
        ev.preventDefault();
      }
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up, true);
  }, []);

  const onScroll = useCallback(() => {
    const el = trackRef.current;
    if (!el || !el.clientWidth) return;
    const next = Math.round(el.scrollLeft / el.clientWidth);
    setPage((prev) => (prev === next ? prev : next));
  }, []);

  const step = useCallback((direction: 1 | -1) => {
    const el = trackRef.current;
    if (!el) return;
    el.scrollBy({ left: direction * el.clientWidth * 0.92, behavior: "smooth" });
  }, []);

  const goToPage = useCallback((index: number) => {
    const el = trackRef.current;
    if (!el) return;
    el.scrollTo({ left: index * el.clientWidth, behavior: "smooth" });
  }, []);

  // A shrinking list (a lens change) can strand the pager past the end.
  useEffect(() => {
    if (page > pageCount - 1) goToPage(0);
  }, [goToPage, page, pageCount]);

  if (requests.length === 0) {
    return (
      <section className="fa-heal-band" aria-label="Self-heal requests">
        <div className="fa-band-head">
          <span className="fa-band-crest fa-band-crest--warn" aria-hidden>
            <Icon name="ph:wrench-bold" width={13} />
          </span>
          <b className="fa-band-title">Self-heal requests</b>
          <span className="fa-band-count">0 open</span>
        </div>
        <p className="fa-heal-band__empty">
          <Icon name="ph:check-circle-bold" width={15} aria-hidden />
          {totalRequests > 0
            ? "Nothing matches this lens — widen it to see the rest."
            : "Nothing needs attention right now."}
        </p>
      </section>
    );
  }

  return (
    <section className="fa-heal-band" aria-label="Self-heal requests">
      <div className="fa-band-head">
        <span className="fa-band-crest fa-band-crest--warn" aria-hidden>
          <Icon name="ph:wrench-bold" width={13} />
        </span>
        <b className="fa-band-title">Self-heal requests</b>
        <span className="fa-band-count">
          {requests.length === totalRequests
            ? `${requests.length} open`
            : `${requests.length} of ${totalRequests}`}
        </span>
        <span className="fa-band-hint">
          <Icon name="ph:hand-grabbing" width={12} aria-hidden />
          drag to scroll · select a card for detail
        </span>
        <button type="button" className="fa-ghost-btn focus-ring" onClick={onViewAll} title="Open the full request board">
          <Icon name="ph:arrows-out-simple" width={11} aria-hidden />
          Board
        </button>
        {pageCount > 1 ? (
          <>
            <span className="fa-dots" role="group" aria-label="Request pages">
              {Array.from({ length: pageCount }, (_, index) => (
                <button
                  key={index}
                  type="button"
                  className={`fa-dots__dot${index === page ? " is-active" : ""} focus-ring`}
                  aria-label={`Go to request page ${index + 1}`}
                  aria-current={index === page ? "true" : undefined}
                  onClick={() => goToPage(index)}
                />
              ))}
            </span>
            <span className="fa-band-page">{page + 1} / {pageCount}</span>
            <button
              type="button"
              className="fa-icon-btn fa-icon-btn--xs focus-ring"
              onClick={() => step(-1)}
              aria-label="Previous requests"
            >
              <Icon name="ph:caret-left" width={11} aria-hidden />
            </button>
            <button
              type="button"
              className="fa-icon-btn fa-icon-btn--xs focus-ring"
              onClick={() => step(1)}
              aria-label="More requests"
            >
              <Icon name="ph:caret-right" width={11} aria-hidden />
            </button>
          </>
        ) : null}
      </div>
      <div
        ref={trackRef}
        className="fa-heal-track"
        onMouseDown={onPointerDown}
        onScroll={onScroll}
        tabIndex={0}
        role="list"
        aria-label={`${requests.length} open self-heal requests`}
      >
        {requests.map((request, index) => (
          <article
            key={request.id}
            className={`fa-heal-card fa-heal-card--${request.severity}`}
            role="listitem"
          >
            <span className="fa-heal-card__ghost" aria-hidden>{index + 1}</span>
            <span className="fa-heal-card__wash" aria-hidden />
            <button
              type="button"
              className="fa-heal-card__open focus-ring"
              onClick={() => onInspect(request)}
              title="Open request details"
            >
              <span className="fa-heal-card__crest" aria-hidden>
                <Icon name={HEAL_ACTION_ICON[request.actionKind]} width={12} />
              </span>
              <span className="fa-heal-card__ident">
                <b className="fa-heal-card__title">{request.title}</b>
                <span className="fa-heal-card__source">{request.source}</span>
              </span>
            </button>
            <p className="fa-heal-card__detail">{request.detail}</p>
            <div className="fa-heal-card__foot">
              <button
                type="button"
                className="fa-heal-card__btn focus-ring"
                onClick={() => onInspect(request)}
              >
                {request.suggestedAction || HEAL_ACTION_LABEL[request.actionKind]}
              </button>
              <button
                type="button"
                className="fa-heal-card__trace focus-ring"
                title="Trace the thread behind this request"
                aria-label={`Trace ${request.title}`}
                onClick={() => onTrace(request)}
              >
                <Icon name="ph:tree-structure" width={11} aria-hidden />
              </button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
});

// ─── Activity detail overlay ────────────────────────────────────────────────

/**
 * The pulse blown up: every day in the window with its count, plus the four
 * readings the bar chart implies but never states — peak, mean, the quiet day,
 * and how long since the last session.
 */
export const PulseOverlay = memo(function PulseOverlay({
  pulse,
  lastActive,
  streakDays,
  onClose,
  onSelectDay,
  selectedDayKey,
}: {
  pulse: PulseDay[];
  lastActive: string | null;
  streakDays: number;
  onClose: () => void;
  onSelectDay: (day: PulseDay) => void;
  selectedDayKey: string | null;
}) {
  const total = pulseTotal(pulse);
  const max = Math.max(1, ...pulse.map((day) => day.count));
  const peak = pulse.reduce<PulseDay | null>(
    (best, day) => (best === null || day.count > best.count ? day : best),
    null,
  );
  const quiet = pulse.reduce<PulseDay | null>(
    (worst, day) => (worst === null || day.count < worst.count ? day : worst),
    null,
  );
  const mean = pulse.length > 0 ? total / pulse.length : 0;
  // A region, not a dialog: this expands in flow inside the stage, takes no
  // focus and traps none. role="dialog" would have AT announce a modal that
  // never arrives.
  return (
    <section className="fa-pulse-panel" aria-label={`Activity — last ${pulse.length} days`}>
      <div className="fa-pulse-panel__head">
        <Icon name="ph:chart-line-up" width={15} aria-hidden />
        <b>Activity — last {pulse.length} days</b>
        <span className="fa-band-count">
          {total} session{total === 1 ? "" : "s"}
          {peak && peak.count > 0 ? ` · peak ${peak.label}` : ""}
        </span>
        <span className="fa-band-hint">select a bar to filter the session list</span>
        <button type="button" className="fa-ghost-btn focus-ring" onClick={onClose} title="Collapse · Esc">
          <Icon name="ph:arrows-in-simple" width={12} aria-hidden />
          Collapse
        </button>
      </div>
      <div className="fa-pulse-panel__chart">
        {pulse.map((day) => (
          <button
            key={day.key}
            type="button"
            className={`fa-pulse-day${day.count === 0 ? " is-empty" : ""}${day.key === selectedDayKey ? " is-selected" : ""} focus-ring`}
            aria-pressed={day.key === selectedDayKey}
            title={`${day.label} · ${day.count} session${day.count === 1 ? "" : "s"}`}
            onClick={() => onSelectDay(day)}
          >
            <b>{day.count}</b>
            <i style={{ height: `${day.count === 0 ? 4 : Math.max(12, (day.count / max) * 100)}%` }} aria-hidden />
            <span>{day.label}</span>
          </button>
        ))}
      </div>
      <div className="fa-pulse-panel__stats">
        <span className="fa-pulse-stat fa-pulse-stat--good">
          <b>{peak?.count ?? 0}</b>
          <span>Peak day{peak && peak.count > 0 ? ` · ${peak.label}` : ""}</span>
          <small>
            {mean > 0 && peak ? `${(peak.count / mean).toFixed(1)}× the ${pulse.length}-day mean` : "no sessions yet"}
          </small>
        </span>
        <span className="fa-pulse-stat fa-pulse-stat--accent">
          <b>{mean.toFixed(1)}</b>
          <span>Sessions per day</span>
          <small>{total} over {pulse.length} days</small>
        </span>
        <span className="fa-pulse-stat fa-pulse-stat--warn">
          <b>{quiet?.count ?? 0}</b>
          <span>Quiet day{quiet ? ` · ${quiet.label}` : ""}</span>
          <small>{pulse.filter((day) => day.count === 0).length} empty days in the window</small>
        </span>
        <span className="fa-pulse-stat">
          <b>{lastActive ? <RelativeTime iso={lastActive} /> : "—"}</b>
          <span>Since last session</span>
          <small>{streakDays > 0 ? `${streakDays}-day streak alive` : "no streak running"}</small>
        </span>
      </div>
    </section>
  );
});
