"use client";

/**
 * ProfileCard — the Kaito-style stat card for one familiar or the human
 * operator (cave-ujbr): fixed-dark monospace share-card with an identity
 * rail, a four-tile stat band, a trailing-12-month session heatmap, two
 * metric panels with sparklines, a top-collaborators avatar rail, and a
 * footer attribution. Numbers come from the pure model in
 * src/lib/profile-card.ts; fetching lives in profile-card-data.ts.
 */

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  buildProfileCardViewModel,
  loadProfileCardData,
  type ProfileCardData,
  type ProfileCardViewModel,
} from "@/components/profile-card-data";
import { AuthedImage } from "@/components/ui/authed-image";
import { EmptyState } from "@/components/ui/empty-state";
import { SkeletonRows } from "@/components/ui/skeleton";
import { Sparkline } from "@/components/ui/sparkline";
import { Icon } from "@/lib/icon";
import type { ProfileHeatmap, ProfileKind, ProfileSeriesPoint } from "@/lib/profile-card";
import { humanHandle } from "@/lib/profile-card";
import { usePausablePoll } from "@/lib/use-pausable-poll";
import { useUserProfile } from "@/lib/user-profile";
import { userDisplayName } from "@/lib/user-profile-shared";
import type { Familiar } from "@/lib/types";
import "@/styles/profile-card.css";

const SPARK_COLOR = "#e8e8ec";

export function ProfileCardView({ kind, familiarId }: { kind: ProfileKind; familiarId?: string }) {
  const [data, setData] = useState<ProfileCardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await loadProfileCardData(kind, familiarId));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "profile data unavailable");
    } finally {
      setLoading(false);
    }
  }, [kind, familiarId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Activity drifts while familiars work — keep the card live like the
  // analytics page does. Pauses in hidden tabs.
  usePausablePoll(() => void load(), 60_000);

  const vm = useMemo(() => (data ? buildProfileCardViewModel(data) : null), [data]);

  if (loading && !vm) {
    return (
      <main className="pfc-page" aria-busy="true">
        <div className="pfc-loading">
          <SkeletonRows count={8} />
        </div>
      </main>
    );
  }
  if (error && !vm) {
    return (
      <main className="pfc-page">
        <EmptyState
          icon="ph:warning-circle"
          headline="Profile unavailable"
          subtitle={error}
          actions={<button type="button" className="focus-ring pfc-retry" onClick={() => void load()}>Retry</button>}
        />
      </main>
    );
  }
  if (!vm) return null;

  if (vm.kind === "familiar" && !vm.familiar) {
    return (
      <main className="pfc-page">
        <EmptyState
          icon="ph:warning-circle"
          headline="Familiar not found"
          subtitle={`No familiar with id “${familiarId}”. It may have been retired, or the daemon is offline.`}
          actions={
            <Link className="focus-ring pfc-retry" href="/?mode=familiars">
              Back to familiars
            </Link>
          }
        />
      </main>
    );
  }

  return <ProfileCard vm={vm} />;
}

export function ProfileCard({ vm }: { vm: ProfileCardViewModel }) {
  const snapshot = useUserProfile();
  const isHuman = vm.kind === "human";
  const profile = isHuman ? vm.userProfile ?? snapshot?.profile ?? null : null;

  const name = isHuman ? userDisplayName(profile) : vm.familiar?.display_name ?? "familiar";
  const handle = isHuman ? humanHandle(profile?.name) : vm.familiar?.id ?? "";
  const bio = isHuman
    ? [profile?.pronouns, profile?.bio].filter(Boolean).join(" · ") || "operator of this coven"
    : [vm.familiar?.role, vm.familiar?.description].filter(Boolean).join(" · ");

  return (
    <main className="pfc-page">
      <nav className="pfc-topnav" aria-label="Profile">
        <Link className="focus-ring pfc-topnav-link" href="/?mode=familiars">
          ← Familiars
        </Link>
        {vm.kind === "familiar" && vm.familiar ? (
          <Link
            className="focus-ring pfc-topnav-link"
            href={`/dashboard/familiars/${encodeURIComponent(vm.familiar.id)}/analytics`}
          >
            Analytics →
          </Link>
        ) : (
          <Link className="focus-ring pfc-topnav-link" href="/?mode=settings">
            Settings →
          </Link>
        )}
      </nav>

      {vm.errors.length > 0 ? (
        <p className="pfc-callout" role="alert">
          <Icon name="ph:warning-circle" aria-hidden /> {vm.errors.join(" · ")}
        </p>
      ) : null}

      <article className="pfc-card" data-kind={vm.kind}>
        <aside className="pfc-rail">
          <div className="pfc-wordmark">{vm.kind}</div>
          <div className="pfc-avatar" style={avatarTint(vm.familiar)}>
            {isHuman ? (
              snapshot?.avatar.objectUrl ? (
                // Same-origin blob URL resolved by the user-profile store.
                // eslint-disable-next-line @next/next/no-img-element
                <img src={snapshot.avatar.objectUrl} alt={name} />
              ) : (
                <span className="pfc-avatar-initial" aria-hidden>{initialOf(name)}</span>
              )
            ) : (
              <AuthedImage
                src={vm.familiar?.avatarUrl}
                alt={name}
                fallback={<span className="pfc-avatar-initial" aria-hidden>{initialOf(name)}</span>}
              />
            )}
          </div>
          <h1 className="pfc-nameplate">{name}</h1>
          <p className="pfc-handle">@{handle}</p>
          {bio ? <p className="pfc-bio">{bio}</p> : null}
          <div className="pfc-rail-chip">
            <span className="pfc-rail-chip-label">coven<br />sessions</span>
            <strong className="pfc-rail-chip-value">{vm.model.sessionsTotal}</strong>
          </div>
        </aside>

        <div className="pfc-main">
          <div className="pfc-stat-band">
            {vm.model.statTiles.map((tile) => (
              <div className="pfc-stat" key={tile.label}>
                <span className="pfc-stat-label">{tile.label}</span>
                <strong className="pfc-stat-value">{tile.value}</strong>
              </div>
            ))}
          </div>

          <HeatmapPanel heatmap={vm.model.heatmap} />

          <div className="pfc-panels">
            <MetricPanel
              titlePrefix="coven"
              titleStrong="sessions"
              big={String(vm.model.sessionsPanel.total)}
              series={vm.model.sessionsPanel.cumulative}
              sideLabel="busiest day"
              sideBig={vm.model.sessionsPanel.busiestDay ? String(vm.model.sessionsPanel.busiestDay.count) : "—"}
              sideSub={vm.model.sessionsPanel.busiestDay?.key ?? "no sessions yet"}
              bottomLabel="top"
              bottomBig={`${vm.model.sessionsPanel.sharePct}%`}
              bottomSub="of coven sessions"
            />
            <MetricPanel
              titlePrefix="activity"
              titleStrong="streak"
              big={`${vm.model.streakPanel.current}d`}
              series={vm.model.streakPanel.weekly}
              sideLabel="longest streak"
              sideBig={`${vm.model.streakPanel.longest}d`}
              sideSub="last 12m"
              bottomLabel="active days"
              bottomBig={`${vm.model.streakPanel.activeDaysPct}%`}
              bottomSub="of last 12 months"
            />
          </div>

          <CollaboratorsRail vm={vm} />
        </div>

        <footer className="pfc-foot">
          <span>COVEN CAVE (based on l12m session data)</span>
          <span className="pfc-foot-brand">
            <Icon name="ph:sparkle-bold" aria-hidden /> coven
          </span>
        </footer>
      </article>
    </main>
  );
}

function initialOf(name: string): string {
  return (name.trim().slice(0, 1) || "?").toUpperCase();
}

function avatarTint(familiar: Familiar | null): React.CSSProperties | undefined {
  if (!familiar?.color) return undefined;
  return { background: familiar.color };
}

function HeatmapPanel({ heatmap }: { heatmap: ProfileHeatmap }) {
  const columns = heatmap.weeks.length;
  const summary = `Session activity, last 12 months: ${heatmap.total} session${heatmap.total === 1 ? "" : "s"} across ${heatmap.activeDays} active day${heatmap.activeDays === 1 ? "" : "s"}.`;
  return (
    <section className="pfc-heatmap-panel">
      <header className="pfc-heatmap-head">
        <h2>coven session activity</h2>
        <span className="pfc-legend" aria-hidden>
          LESS
          {[0, 1, 2, 3, 4].map((level) => (
            <i key={level} className="pfc-cell" data-level={level} />
          ))}
          MORE
        </span>
      </header>
      <div className="pfc-heatmap" role="img" aria-label={summary}>
        <div className="pfc-heatmap-grid" aria-hidden>
          {heatmap.weeks.map((week, weekIndex) => (
            <div className="pfc-week" key={weekIndex}>
              {week.map((cell, dayIndex) =>
                cell ? (
                  <i
                    key={cell.key}
                    className="pfc-cell"
                    data-level={cell.level}
                    title={`${cell.key}: ${cell.count} session${cell.count === 1 ? "" : "s"}`}
                  />
                ) : (
                  <i key={`pad-${dayIndex}`} className="pfc-cell pfc-cell--pad" />
                ),
              )}
            </div>
          ))}
        </div>
        <div
          className="pfc-heatmap-months"
          aria-hidden
          style={{ gridTemplateColumns: `repeat(${columns}, 1fr)` }}
        >
          {heatmap.monthLabels.map((month) => (
            <span key={`${month.label}-${month.index}`} style={{ gridColumnStart: month.index + 1 }}>
              {month.label}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

function MetricPanel(props: {
  titlePrefix: string;
  titleStrong: string;
  big: string;
  series: ProfileSeriesPoint[];
  sideLabel: string;
  sideBig: string;
  sideSub: string;
  bottomLabel: string;
  bottomBig: string;
  bottomSub: string;
}) {
  return (
    <section className="pfc-panel">
      <div className="pfc-panel-left">
        <h2 className="pfc-panel-title">
          {props.titlePrefix} <strong>{props.titleStrong}</strong>
        </h2>
        <strong className="pfc-panel-big">{props.big}</strong>
        <div className="pfc-panel-spark">
          <Sparkline points={props.series} color={SPARK_COLOR} height={44} />
        </div>
      </div>
      <div className="pfc-panel-right">
        <span className="pfc-panel-label">{props.sideLabel}</span>
        <strong className="pfc-panel-mid">{props.sideBig}</strong>
        <span className="pfc-panel-sub">{props.sideSub}</span>
        <hr className="pfc-panel-rule" />
        <span className="pfc-panel-label">{props.bottomLabel}</span>
        <strong className="pfc-panel-mid">{props.bottomBig}</strong>
        <span className="pfc-panel-sub">{props.bottomSub}</span>
      </div>
    </section>
  );
}

function CollaboratorsRail({ vm }: { vm: ProfileCardViewModel }) {
  const byId = new Map(vm.familiars.map((familiar) => [familiar.id, familiar]));
  const collaborators = vm.model.collaborators
    .map((entry) => byId.get(entry.familiarId))
    .filter((familiar): familiar is Familiar => Boolean(familiar));

  return (
    <section className="pfc-collab">
      <h2>top collaborators</h2>
      {collaborators.length === 0 ? (
        <p className="pfc-collab-empty">no shared sessions yet</p>
      ) : (
        <ul className="pfc-collab-row">
          {collaborators.map((familiar) => (
            <li key={familiar.id}>
              <Link
                className="focus-ring pfc-collab-tile"
                href={`/dashboard/familiars/${encodeURIComponent(familiar.id)}/profile`}
                aria-label={`Open profile for ${familiar.display_name}`}
                title={familiar.display_name}
              >
                <AuthedImage
                  src={familiar.avatarUrl}
                  alt=""
                  fallback={<span className="pfc-avatar-initial" aria-hidden>{initialOf(familiar.display_name)}</span>}
                />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
