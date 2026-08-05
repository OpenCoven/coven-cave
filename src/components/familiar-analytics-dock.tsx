"use client";

import { memo } from "react";
import type { FamiliarAnalyticsModel } from "@/components/familiar-analytics-data";
import { AuthedImage } from "@/components/ui/authed-image";
import { RelativeTime } from "@/components/ui/relative-time";
import { Icon } from "@/lib/icon";
import { deriveAnalyticsInsight } from "@/lib/familiar-analytics-insight";
import type { ContractReport, FamiliarProperty } from "@/lib/familiar-contract";
import type { SelfHealRequest } from "@/lib/familiar-heal-requests";
import type { ThreadConfidence } from "@/lib/thread-confidence";

/**
 * A dock action row — the prioritized "do this next" list. Derived upstream
 * from the same heal requests the stage's strip shows, so the dock and the
 * stage never disagree about what is wrong.
 */
export type DockAction = {
  key: string;
  label: string;
  why: string;
  sev: SelfHealRequest["severity"];
  request: SelfHealRequest;
};

/** The selected contract property's evidence, built by the parent (the copy
 *  legend and the real violation messages both live with the report). */
export type ContractPropertyDetail = {
  property: FamiliarProperty;
  pass: boolean;
  body: string[];
};

/** Ring geometry — shared by the dock's compact ring and the trust modal. */
const RING_RADIUS = 42;
export const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

/** Map a confidence label to a tier class so every trust readout agrees. */
export function confidenceTier(
  label: ThreadConfidence["label"],
): "low" | "developing" | "reliable" | "trusted" {
  switch (label) {
    case "Trusted": return "trusted";
    case "Reliable": return "reliable";
    case "Developing": return "developing";
    default: return "low";
  }
}

/**
 * The trust ring: a radial read of the weighted thread-confidence score. With
 * no self-reports the arc stays empty and the label reads "no data" — an
 * unmeasured familiar is never rendered as a low-scoring one.
 */
export const TrustRing = memo(function TrustRing({
  confidence,
  size = "sm",
}: {
  confidence: ThreadConfidence;
  /** `lg` is the trust modal's hero ring; `sm` rides in the dock. */
  size?: "sm" | "lg";
}) {
  // One clamped number feeds both the arc and the printed score — an
  // out-of-range value must not let the ring and the digits disagree.
  const score = confidence.hasData ? Math.max(0, Math.min(100, confidence.score)) : null;
  const dash = score === null ? 0 : (score / 100) * RING_CIRCUMFERENCE;
  const tier = confidence.hasData ? confidenceTier(confidence.label) : "none";
  // In the dock the ring sits inside a button that already names the score, so
  // it is decoration. As the trust modal's hero it IS the headline — hiding it
  // would leave assistive tech with no score at all.
  const ringAria = size === "lg"
    ? {
        role: "img" as const,
        "aria-label": score === null
          ? "Trust not measured yet — no thread self-reports"
          : `Trust ${score} of 100, ${confidence.label}, from ${confidence.reportCount} thread report${confidence.reportCount === 1 ? "" : "s"}`,
      }
    : { "aria-hidden": true as const };
  return (
    <span className={`fa-ring fa-ring--${size} fa-ring--${tier}`} {...ringAria}>
      <svg viewBox="0 0 100 100" aria-hidden>
        <circle className="fa-ring__track" cx="50" cy="50" r={RING_RADIUS} />
        <circle
          className="fa-ring__value"
          cx="50"
          cy="50"
          r={RING_RADIUS}
          strokeDasharray={`${dash} ${RING_CIRCUMFERENCE}`}
          transform="rotate(-90 50 50)"
        />
      </svg>
      <span className="fa-ring__label" aria-hidden={size === "lg"}>
        <strong>{score ?? "—"}</strong>
        {size === "lg" ? <span>{confidence.hasData ? confidence.label : "No data"}</span> : null}
      </span>
    </span>
  );
});

/**
 * Renown card — tier, score against the next rung, and the week's movement.
 * Same derivation as the roster cards, so the two surfaces always agree. The
 * meter carries tick marks at the quarter points so progress reads without a
 * number, and the whole card degrades to a plain "unavailable" line when
 * canonical memory can't be read (renown is partly memory-derived).
 */
const RenownCard = memo(function RenownCard({
  progression,
}: {
  progression: FamiliarAnalyticsModel["progression"];
}) {
  if (!progression) return null;
  const { memoryAvailability, renown, streakDays } = progression;
  const memoryReady = memoryAvailability === "ready";
  const pct = memoryReady ? Math.round(renown.progress * 100) : 0;
  const ceiling = renown.next ? renown.next.tier.min : renown.score;
  return (
    <section
      className="fa-renown"
      aria-label="Renown"
      title={
        !memoryReady
          ? "Canonical memory unavailable — renown can't be computed"
          : renown.next
            ? `Renown ${renown.score} of ${ceiling} — ${renown.next.remaining} to ${renown.next.tier.label}`
            : `Renown ${renown.score} — top of the ladder`
      }
    >
      <span className="fa-renown__glow" aria-hidden />
      <div className="fa-renown__head">
        <span className="fa-renown__crest" aria-hidden>
          <Icon name="ph:trophy-fill" width={12} />
        </span>
        <b className="fa-renown__tier">{memoryReady ? renown.tier.label : "—"}</b>
        <span className="fa-renown__score">
          <b>{memoryReady ? renown.score : "—"}</b>
          <span>/{ceiling}</span>
        </span>
      </div>
      {/* One computed value — the progress fraction — carried into CSS once as
          a custom property. The fill, its sheen and the quarter ticks are all
          styled off it, so the only render-time value is the percentage. */}
      <div
        className="fa-renown__meter"
        role="img"
        aria-label={`${pct}% toward the next rung`}
        style={{ "--fa-renown-pct": `${pct}%` } as React.CSSProperties}
      >
        <i className="fa-renown__fill" />
        <i className="fa-renown__shine" aria-hidden />
      </div>
      <div className="fa-renown__foot">
        <Icon name="ph:lightning-fill" className="fa-renown__bolt" width={11} aria-hidden />
        {!memoryReady ? (
          <span>Renown unavailable</span>
        ) : renown.next ? (
          <>
            <b>{renown.next.remaining} renown</b> to
            <span className="fa-renown__next">{renown.next.tier.label}</span>
          </>
        ) : (
          <b>Top of the ladder</b>
        )}
        <span className="fa-renown__streak">
          <Icon name="ph:flame" width={11} aria-hidden />
          {streakDays > 0 ? `${streakDays}d` : "no streak"}
        </span>
      </div>
    </section>
  );
});

/**
 * The familiar dock — the page's fixed identity column. It answers "who is this
 * and what is wrong with them" without scrolling: identity, renown, trust,
 * the prioritized action list, and the contract check. Everything to its right
 * is evidence for what this column asserts.
 *
 * Collapsing swaps it for a 64px rail of the same signals (avatar, trust score,
 * an attention badge, the two deep-dive entries) so the stage can take the
 * width back without the reader losing the familiar's state.
 */
export const FamiliarAnalyticsDock = memo(function FamiliarAnalyticsDock({
  model,
  confidence,
  healRequestCount,
  actions,
  contractReport,
  activeProperty,
  contractDetail,
  onPickProperty,
  collapsed,
  onToggleCollapsed,
  onRefresh,
  refreshing,
  onOpenTrust,
  onOpenSignals,
  onOpenModel,
  onAction,
  onReviewContract,
  onExpandContract,
  contractExpanded,
}: {
  model: FamiliarAnalyticsModel;
  confidence: ThreadConfidence;
  healRequestCount: number;
  actions: DockAction[];
  contractReport: ContractReport | null;
  activeProperty: FamiliarProperty | null;
  /** Evidence for {@link activeProperty}; null until a property is selected. */
  contractDetail: ContractPropertyDetail | null;
  onPickProperty: (property: FamiliarProperty) => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onRefresh?: () => void;
  refreshing: boolean;
  onOpenTrust: () => void;
  onOpenSignals: () => void;
  onOpenModel: () => void;
  onAction: (request: SelfHealRequest) => void;
  onReviewContract: () => void;
  onExpandContract: () => void;
  contractExpanded: boolean;
}) {
  const familiarName = model.familiar?.display_name ?? model.familiarId;
  const familiarRole = model.familiar?.role || model.familiar?.harness || "Familiar";
  const sessionsTotal = model.recentSessions.length;
  const streakDays = model.progression?.streakDays ?? 0;
  const lastActive = model.growthReport?.lastActiveAt ?? model.recentSessions[0]?.updated_at ?? null;
  // The dock's one plain-language sentence about this familiar — the same
  // synthesis the roster insight uses, so both surfaces read the same way.
  const insight = deriveAnalyticsInsight(model, healRequestCount, {
    confidence,
    threadReportCount: confidence.reportCount,
  });
  const passCount = contractReport
    ? contractReport.properties.filter((property) => property.pass).length
    : 0;
  const propertyTotal = contractReport?.properties.length ?? 0;
  const avatarFallback = familiarName.slice(0, 1).toUpperCase();

  if (collapsed) {
    return (
      <aside className="fa-dock fa-dock--rail" aria-label="Familiar dock">
        <button
          type="button"
          className="fa-icon-btn focus-ring"
          aria-label="Expand the familiar dock"
          title="Expand the familiar dock"
          onClick={onToggleCollapsed}
        >
          <Icon name="ph:sidebar-simple" width={14} aria-hidden />
        </button>
        <AuthedImage
          className="fa-rail-avatar"
          src={model.familiar?.avatarUrl}
          alt={familiarName}
          fallback={<span className="fa-rail-avatar" aria-hidden>{avatarFallback}</span>}
        />
        <button
          type="button"
          className={`fa-rail-trust focus-ring fa-rail-trust--${confidence.hasData ? confidenceTier(confidence.label) : "none"}`}
          onClick={onOpenTrust}
          title={confidence.hasData ? `Trust ${confidence.score} · ${confidence.label}` : "Trust not measured yet"}
          aria-label={confidence.hasData ? `Trust ${confidence.score}, ${confidence.label}` : "Trust not measured yet"}
        >
          {confidence.hasData ? confidence.score : "—"}
        </button>
        {healRequestCount > 0 ? (
          <span
            className="fa-rail-alert"
            title={`Needs attention · ${healRequestCount} open request${healRequestCount === 1 ? "" : "s"}`}
          >
            <Icon name="ph:warning-circle" width={14} aria-hidden />
            <span className="sr-only">
              {healRequestCount} open self-heal request{healRequestCount === 1 ? "" : "s"}
            </span>
          </span>
        ) : null}
        <button
          type="button"
          className="fa-icon-btn fa-icon-btn--accent focus-ring"
          onClick={onOpenSignals}
          title="Thread signals"
          aria-label="Thread signals"
        >
          <Icon name="ph:waveform-bold" width={14} aria-hidden />
        </button>
        <button
          type="button"
          className="fa-icon-btn fa-icon-btn--accent focus-ring"
          onClick={onOpenModel}
          title="Model performance"
          aria-label="Model performance"
        >
          <Icon name="ph:thumbs-up" width={14} aria-hidden />
        </button>
        {onRefresh ? (
          <button
            type="button"
            className={`fa-icon-btn fa-icon-btn--foot focus-ring${refreshing ? " is-refreshing" : ""}`}
            onClick={onRefresh}
            disabled={refreshing}
            title="Refresh analytics"
            aria-label="Refresh analytics"
          >
            <Icon name="ph:arrows-clockwise-bold" width={13} aria-hidden />
          </button>
        ) : null}
      </aside>
    );
  }

  return (
    <aside className="fa-dock" aria-label="Familiar dock">
      <nav className="fa-dock__crumb" aria-label="Breadcrumb">
        <button
          type="button"
          className="fa-icon-btn fa-icon-btn--xs focus-ring"
          aria-label="Collapse the familiar dock"
          title="Collapse the familiar dock"
          onClick={onToggleCollapsed}
        >
          <Icon name="ph:sidebar-simple" width={12} aria-hidden />
        </button>
        <span className="fa-dock__crumb-trail">
          <a href="/dashboard/familiars/growth">Familiars</a>
          <span aria-hidden> / </span>
          <b>Analytics</b>
        </span>
        {/* Analytics and the profile card are two reads of one familiar; the
            crossing link keeps them one destination apart in both directions. */}
        <a
          className="fa-dock__crumb-profile focus-ring"
          href={`/dashboard/familiars/${encodeURIComponent(model.familiarId)}/profile`}
          title={`Open ${familiarName}'s profile card`}
        >
          Profile →
        </a>
        {onRefresh ? (
          <button
            type="button"
            className={`fa-icon-btn fa-icon-btn--xs focus-ring${refreshing ? " is-refreshing" : ""}`}
            aria-label="Refresh familiar analytics"
            title="Refresh familiar analytics"
            disabled={refreshing}
            onClick={onRefresh}
          >
            <Icon name="ph:arrows-clockwise-bold" width={12} aria-hidden />
          </button>
        ) : null}
      </nav>

      <section className="fa-identity" aria-label="Familiar">
        <span className="fa-identity__glow" aria-hidden />
        <div className="fa-identity__head">
          <span className="fa-identity__portrait">
            <AuthedImage
              className="fa-identity__avatar"
              src={model.familiar?.avatarUrl}
              alt={familiarName}
              fallback={<span className="fa-identity__avatar" aria-hidden>{avatarFallback}</span>}
            />
            <span className="fa-identity__presence" aria-hidden />
          </span>
          <span className="fa-identity__meta">
            <span className="fa-identity__name-row">
              <b className="fa-identity__name">{familiarName}</b>
              {model.progression && model.progression.memoryAvailability === "ready" ? (
                <span className="fa-identity__tier">{model.progression.renown.tier.label}</span>
              ) : null}
            </span>
            <span className="fa-identity__role">{familiarRole}</span>
            <span className="fa-identity__active">
              <i aria-hidden />
              {lastActive ? <>Active · <RelativeTime iso={lastActive} /></> : "No sessions yet"}
            </span>
          </span>
        </div>
        <div className="fa-identity__stats">
          <span title="Sessions on record for this familiar">
            <b>{sessionsTotal}</b>
            <span>sessions</span>
          </span>
          <span title={streakDays > 0 ? `${streakDays}-day ritual streak` : "A session today starts a streak"}>
            <b className="fa-identity__streak">
              <Icon name="ph:flame" width={12} aria-hidden />
              {streakDays > 0 ? `${streakDays}d` : "—"}
            </b>
            <span>streak</span>
          </span>
          <span title={confidence.hasData ? `Trust ${confidence.score} · ${confidence.label}` : "Trust not measured yet"}>
            <b className="fa-identity__trust">{confidence.hasData ? confidence.score : "—"}</b>
            <span>trust</span>
          </span>
        </div>
      </section>

      <RenownCard progression={model.progression} />

      <button
        type="button"
        className="fa-trust-card focus-ring"
        onClick={onOpenTrust}
        title="How this score is computed"
      >
        <TrustRing confidence={confidence} />
        <span className="fa-trust-card__meta">
          <span className="fa-trust-card__eyebrow">Trust</span>
          <b className="fa-trust-card__label">
            {confidence.hasData ? confidence.label : "Not measured"}
          </b>
          <span className="fa-trust-card__sub">
            {confidence.hasData
              ? `from ${confidence.reportCount} report${confidence.reportCount === 1 ? "" : "s"} · details`
              : "no thread self-reports yet"}
          </span>
        </span>
        <Icon name="ph:arrows-out-simple" className="fa-trust-card__go" width={12} aria-hidden />
      </button>

      <section className={`fa-attention fa-insight--${insight.tone}`} aria-label="Needs attention">
        <div className="fa-attention__head">
          <Icon
            name={insight.tone === "good" ? "ph:check-circle-bold" : "ph:warning-circle"}
            width={14}
            aria-hidden
          />
          <b>{insight.tone === "good" && actions.length === 0 ? "All clear" : "Needs attention"}</b>
          {actions.length > 0 ? (
            <span className="fa-attention__count">
              {actions.length} action{actions.length === 1 ? "" : "s"}
            </span>
          ) : null}
        </div>
        <p className="fa-attention__lede">{insight.text}</p>
        {actions.length > 0 ? (
          <ul className="fa-attention__list">
            {actions.map((action, index) => (
              <li key={action.key}>
                <button
                  type="button"
                  className={`fa-attention__row fa-attention__row--${action.sev} focus-ring`}
                  title={action.why}
                  onClick={() => onAction(action.request)}
                >
                  <span className="fa-attention__n" aria-hidden>{index + 1}</span>
                  <span className="fa-attention__label">{action.label}</span>
                  <span className="fa-attention__go" aria-hidden>
                    <Icon name="ph:arrow-right" width={11} />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <section className="fa-contract-card" aria-label="Contract compliance">
        <span className="fa-contract-card__glow" aria-hidden />
        <div className="fa-contract-card__head">
          <span className="fa-contract-card__crest" aria-hidden>
            <Icon name="ph:file-text" width={12} />
          </span>
          <b>Contract</b>
          {contractReport ? (
            <span className="fa-contract-card__score">
              <b>{passCount}</b>
              <span>/{propertyTotal} pass</span>
            </span>
          ) : (
            <span className="fa-contract-card__score">
              <span>no report</span>
            </span>
          )}
          <button
            type="button"
            className="fa-icon-btn fa-icon-btn--xs focus-ring"
            onClick={onExpandContract}
            aria-expanded={contractExpanded}
            title={contractExpanded ? "Collapse the contract panel" : "Expand the contract panel"}
            aria-label={contractExpanded ? "Collapse the contract panel" : "Expand the contract panel"}
          >
            <Icon
              name={contractExpanded ? "ph:arrows-in-simple" : "ph:arrows-out-simple"}
              width={11}
              aria-hidden
            />
          </button>
        </div>
        {contractReport ? (
          <>
            <div className="fa-contract-card__bars" aria-hidden>
              {contractReport.properties.map((property) => (
                <i
                  key={property.property}
                  className={`fa-contract-card__bar${property.pass ? " is-pass" : " is-fail"}`}
                />
              ))}
            </div>
            <ul className="fa-contract-card__list">
              {contractReport.properties.map((property) => (
                <li key={property.property}>
                  <button
                    type="button"
                    className={`fa-contract-item${property.pass ? " is-pass" : " is-fail"}${activeProperty === property.property ? " is-active" : ""} focus-ring`}
                    aria-expanded={activeProperty === property.property}
                    title={
                      property.pass
                        ? `${property.property} — satisfied`
                        : `${property.property} — failing, select for what's missing`
                    }
                    onClick={() => onPickProperty(property.property)}
                  >
                    <Icon
                      name={property.pass ? "ph:check-circle-bold" : "ph:warning-circle"}
                      width={13}
                      aria-hidden
                    />
                    <span className="fa-contract-item__name">{property.property}</span>
                    <span className="fa-contract-item__verdict">{property.pass ? "PASS" : "FAIL"}</span>
                    <Icon name="ph:caret-right" className="fa-contract-item__go" width={10} aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
            {contractDetail ? (
              <div
                className={`fa-contract-detail${contractDetail.pass ? " is-pass" : " is-fail"}`}
              >
                <div className="fa-contract-detail__head">
                  <Icon
                    name={contractDetail.pass ? "ph:check-circle-bold" : "ph:warning-circle"}
                    width={13}
                    aria-hidden
                  />
                  <b>{contractDetail.property}</b>
                  <span className="fa-contract-detail__status">
                    {contractDetail.pass ? "SATISFIED" : "FAILING"}
                  </span>
                </div>
                <p className="fa-contract-detail__body">{contractDetail.body.join(" ")}</p>
              </div>
            ) : (
              <p className="fa-contract-card__hint">
                Select a property for the evidence behind its verdict.
              </p>
            )}
            {/* A failing contract means this familiar is operating as an agent,
                not a familiar. Mirror the Studio Contract tab: one click opens
                a chat seeded with the rehabilitation brief. */}
            {!contractReport.pass ? (
              <button type="button" className="fa-primary-btn focus-ring" onClick={onReviewContract}>
                <Icon name="ph:sparkle-bold" width={13} aria-hidden />
                Review and resolve
              </button>
            ) : null}
          </>
        ) : (
          <p className="fa-contract-card__empty">
            This familiar&rsquo;s identity contract hasn&rsquo;t been evaluated yet.
          </p>
        )}
      </section>
    </aside>
  );
});
