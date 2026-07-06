"use client";

import { useMemo } from "react";
import { Icon } from "@/lib/icon";
import type { IconName } from "@/lib/icon";
import { PulseBars } from "@/components/ui/pulse-bars";
import { RelativeTime } from "@/components/ui/relative-time";
import type { FamiliarCardStats } from "@/components/familiars-view-stats";
import type { FamiliarGrowthReport as FamiliarGrowthReportModel, GrowthSignal } from "@/lib/familiar-growth-signals";
import { buildSessionPulse, pulseDelta, pulseTotal } from "@/lib/session-pulse";
import type { RetroOutcome, RetroRun, RetroTrack } from "@/lib/retro-runs";
import type { Familiar, SessionRow } from "@/lib/types";

const TRACKS: RetroTrack[] = ["synthesis", "prompt", "memory"];

function percent(value: number | null): string {
  return value == null ? "No data" : `${Math.round(value * 100)}%`;
}

function scoreLabel(delta: number): string {
  if (delta > 0) return `+${delta.toFixed(2)}`;
  return delta.toFixed(2);
}

function trackLabel(track: RetroTrack): string {
  return track.slice(0, 1).toUpperCase() + track.slice(1);
}

function signalIcon(signal: GrowthSignal): IconName {
  if (signal.kind === "healthy") return "ph:check-circle-bold";
  if (signal.severity === "crit") return "ph:warning-circle-fill";
  if (signal.severity === "warn") return "ph:warning-circle";
  return "ph:info-bold";
}

/** Accept-rate tone aligned with the growth thresholds (0.35 stall / 0.5 low). */
function rateTone(rate: number | null): "good" | "warn" | "bad" | "none" {
  if (rate == null) return "none";
  if (rate < 0.35) return "bad";
  if (rate < 0.5) return "warn";
  return "good";
}

function OutcomePill({ outcome }: { outcome: RetroOutcome }) {
  return (
    <span className={`retro-pill retro-pill--${outcome.toLowerCase()}`}>
      {outcome === "ACCEPT" ? "Accepted" : "Reverted"}
    </span>
  );
}

function RunRow({ run }: { run: RetroRun }) {
  return (
    <article className="retro-run-row growth-run-row">
      <div className="retro-run-row__rail" aria-hidden />
      <div className="retro-run-row__main">
        <div className="retro-run-row__top">
          <div className="retro-run-row__identity">
            <span className="retro-avatar">{run.familiarName.slice(0, 1).toUpperCase()}</span>
            <span className="retro-run-row__names">
              <span className="retro-run-row__familiar">{run.familiarName}</span>
              <span className="retro-run-row__meta">
                {run.familiarRole ? `${run.familiarRole} · ` : ""}
                {run.track} · iteration {run.iteration}
              </span>
            </span>
          </div>
          <OutcomePill outcome={run.outcome} />
        </div>

        <p className="retro-run-row__summary">{run.changeSummary}</p>
        <div className="retro-run-row__stats">
          <span className={`retro-delta ${run.delta >= 0 ? "retro-delta--good" : "retro-delta--bad"}`}>
            {scoreLabel(run.delta)}
          </span>
          <span>{run.metricBefore.toFixed(2)} -&gt; {run.metricAfter.toFixed(2)}</span>
          <RelativeTime iso={run.timestamp} />
        </div>
      </div>
    </article>
  );
}

/** Week-over-week movement chip — the number's direction, not just its value. */
function DeltaChip({ delta }: { delta: number }) {
  const tone = delta > 0 ? "up" : delta < 0 ? "down" : "flat";
  const sign = delta > 0 ? `+${delta}` : delta < 0 ? String(delta) : "±0";
  return (
    <span className={`growth-delta growth-delta--${tone}`}>
      {sign} vs prior 7d
    </span>
  );
}

export function FamiliarGrowthReport({
  familiar,
  report,
  sessions,
  stats,
  now,
}: {
  familiar: Familiar;
  report: FamiliarGrowthReportModel;
  sessions: SessionRow[];
  stats?: FamiliarCardStats;
  now?: number;
}) {
  const nowMs = now ?? Date.now();
  const pulse = useMemo(
    () => buildSessionPulse(sessions, familiar.id, nowMs),
    [familiar.id, nowMs, sessions],
  );
  const weekDelta = pulseDelta(pulse);
  const totalSessions14d = pulseTotal(pulse);
  const acceptedRuns = TRACKS.reduce((sum, track) => sum + report.trackStats[track].accepted, 0);
  const totalRuns = TRACKS.reduce((sum, track) => sum + report.trackStats[track].total, 0);

  return (
    <article className="growth-report" aria-label={`Growth report for ${familiar.display_name}`}>
      <header className="growth-report__header">
        <div>
          <p className="retro-eyebrow">
            <Icon name="ph:chart-bar-bold" aria-hidden />
            Growth report for {familiar.display_name}
          </p>
          <h3>{familiar.display_name}</h3>
          <p>{familiar.role || familiar.harness || "Familiar"} performance patterns, activity signals, and growth flags.</p>
        </div>
        <span className={`growth-health growth-health--${report.healthLabel}`}>
          {report.healthLabel}
        </span>
      </header>

      <section className="growth-summary" aria-label="Growth summary">
        <div className="growth-summary__item">
          <Icon name="ph:clock-countdown" aria-hidden />
          <span className="growth-summary__value">{report.sessionsLast7d}</span>
          <p>Sessions last 7d</p>
          <DeltaChip delta={weekDelta.delta} />
        </div>
        <div className="growth-summary__item">
          <Icon name="ph:check-circle-bold" aria-hidden />
          <span className="growth-summary__value">{percent(report.retroAcceptRate)}</span>
          <p>Retro accept rate</p>
          <small>{totalRuns > 0 ? `${acceptedRuns}/${totalRuns} runs accepted` : "no retro runs yet"}</small>
        </div>
        <div className="growth-summary__item">
          <Icon name="ph:brain-bold" aria-hidden />
          <span className="growth-summary__value">{stats ? stats.memoryCount : "—"}</span>
          <p>{stats?.memoryCount === 1 ? "Memory entry" : "Memory entries"}</p>
          <small>
            {stats?.latestMemory ? (
              <>updated <RelativeTime iso={stats.latestMemory.updatedAt} now={nowMs} /></>
            ) : (
              "no memory yet"
            )}
          </small>
        </div>
        <div className="growth-summary__item">
          <Icon name="ph:clock-bold" aria-hidden />
          <span className="growth-summary__value"><RelativeTime iso={report.lastActiveAt} now={nowMs} fallback="never" /></span>
          <p>Last active</p>
        </div>
      </section>

      <section className="growth-section" aria-labelledby="growth-activity">
        <div className="growth-section__head">
          <h4 id="growth-activity">Activity trends</h4>
          <span>{totalSessions14d} session{totalSessions14d === 1 ? "" : "s"} in 14d</span>
        </div>
        <PulseBars
          pulse={pulse}
          size="lg"
          showTips
          label={`Session activity over the last 14 days: ${totalSessions14d} session${totalSessions14d === 1 ? "" : "s"}`}
        />
      </section>

      <section className="growth-section" aria-labelledby="growth-retro-tracks">
        <div className="growth-section__head">
          <h4 id="growth-retro-tracks">Retro performance</h4>
          <span>{report.recentRuns.length} recent runs</span>
        </div>
        <div className="growth-track-grid">
          {TRACKS.map((track) => {
            const item = report.trackStats[track];
            const rate = item.total > 0 ? item.accepted / item.total : null;
            const tone = rateTone(rate);
            return (
              <div key={track} className="growth-track-card">
                <span>{trackLabel(track)}</span>
                <b>{item.total}</b>
                <p>{rate == null ? "no runs yet" : `${percent(rate)} accepted`}</p>
                {rate != null ? (
                  <div className={`growth-track-meter growth-track-meter--${tone}`} aria-hidden>
                    <i style={{ width: `${Math.round(rate * 100)}%` }} />
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
        <div className="growth-run-list">
          {report.recentRuns.length > 0 ? (
            report.recentRuns.map((run) => <RunRow key={run.id} run={run} />)
          ) : (
            <p className="retro-muted">No recent retro runs.</p>
          )}
        </div>
      </section>

      <section className="growth-section" aria-labelledby="growth-opportunities">
        <div className="growth-section__head">
          <h4 id="growth-opportunities">Growth opportunities</h4>
          <span>Derived signals</span>
        </div>
        <div className="growth-signals">
          {report.signals.map((signal) => (
            <div key={`${signal.kind}-${signal.track ?? "all"}`} className={`growth-signal growth-signal--${signal.severity}`}>
              <Icon name={signalIcon(signal)} aria-hidden />
              <span>
                <b>{signal.label}</b>
                <small>{signal.detail}</small>
              </span>
            </div>
          ))}
        </div>
      </section>
    </article>
  );
}
