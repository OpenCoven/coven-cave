"use client";

// "THE DAY" carousel — the always-visible trigger strip plus the expanding
// overlay panel that holds three readings of the same day: SWIMLANES (who
// worked when), CARDS (the headline counts) and GRAPHS (the shapes).
//
// The parent owns `open` and the positioning context (a `position: relative`
// box); it also implements Escape / click-away against the
// `data-panel-trigger="carousel"` / `data-panel="carousel"` attributes below.
// Everything drawn here comes from `DayModel` — no placeholder numbers, and a
// lane with no timestamps renders its counts without a bar rather than faking
// one.

import { type CSSProperties, useState } from "react";

import { clockLabel, type DayModel, type DayTone, type Swimlane } from "@/lib/daily-report-day";
import { Icon } from "@/lib/icon";

import "@/styles/daily-report-carousel.css";

const PANEL_ID = "drd-car-panel";

const VIEWS = ["SWIMLANES", "CARDS", "GRAPHS"] as const;

/** A DayTone never becomes a color here — it becomes a custom property that the
 *  stylesheet reads, so all 21 themes × 2 modes stay honest. */
const TONE_VAR: Record<DayTone, string> = {
  accent: "var(--accent-presence)",
  success: "var(--color-success)",
  warning: "var(--color-warning)",
  danger: "var(--color-danger)",
  muted: "var(--fg-muted)",
};

function toneStyle(tone: DayTone): CSSProperties {
  return { "--drd-tone": TONE_VAR[tone] } as CSSProperties;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function num(n: number): string {
  return n.toLocaleString();
}

/** "15h 38m" — the swimlane footer's SPAN readout. */
function spanLabel(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return "—";
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h === 0) return `${m}m`;
  return `${h}h ${m}m`;
}

/** Evenly spaced polyline points across `width` × `height`, normalized to the
 *  series max. Generated from the real array — the mock's hand-drawn SVG paths
 *  are deliberately not carried over. */
function linePoints(values: number[], width: number, height: number): string {
  if (values.length === 0) return "";
  const max = Math.max(...values, 0);
  const denom = max > 0 ? max : 1;
  const step = values.length > 1 ? width / (values.length - 1) : 0;
  return values
    .map((value, index) => {
      const x = values.length > 1 ? index * step : width / 2;
      const y = height - (Math.max(0, value) / denom) * height;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

/** The same series closed against the baseline, for the soft area fill. */
function areaPoints(values: number[], width: number, height: number): string {
  const line = linePoints(values, width, height);
  if (!line) return "";
  return `0,${height} ${line} ${width},${height}`;
}

/** Average `values` down to `count` buckets — keeps the trigger sparkline
 *  legible without inventing data. */
function bucket(values: number[], count: number): number[] {
  if (values.length === 0 || count <= 0) return [];
  const size = Math.ceil(values.length / count);
  const out: number[] = [];
  for (let i = 0; i < values.length; i += size) {
    const slice = values.slice(i, i + size);
    out.push(slice.length ? Math.max(...slice) : 0);
  }
  return out;
}

function pct(value: number): string {
  return `${Math.max(0, Math.min(100, value)).toFixed(2)}%`;
}

// ── trigger ─────────────────────────────────────────────────────────────────

function MiniStat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <span className="drd-car-stat">
      <span className="drd-car-stat-label">{label}</span>
      <span className="drd-car-stat-value" data-accent={accent ? "true" : undefined}>
        {value}
      </span>
    </span>
  );
}

function TriggerSpark({ hours }: { hours: number[] }) {
  const bars = bucket(hours, 12);
  const peak = Math.max(...bars, 0);
  return (
    <span className="drd-car-spark" aria-hidden>
      {bars.map((value, index) => {
        const height = peak > 0 ? Math.max(14, (value / peak) * 100) : 14;
        return (
          <span
            key={index}
            className="drd-car-spark-bar"
            data-lit={peak > 0 && value > 0 ? "true" : undefined}
            style={{ "--drd-bar": pct(height), "--drd-mix": pct(peak > 0 ? (value / peak) * 100 : 0) } as CSSProperties}
          />
        );
      })}
    </span>
  );
}

// ── view 0 · swimlanes ──────────────────────────────────────────────────────

function LaneRow({ lane }: { lane: Swimlane }) {
  const counts = `${num(lane.sessionCount)} ${lane.sessionCount === 1 ? "session" : "sessions"} · ${num(lane.mergeCount)} ${lane.mergeCount === 1 ? "merge" : "merges"}`;
  return (
    <>
      <span className="drd-car-lane-name" style={toneStyle(lane.tone)}>
        <span className="drd-car-lane-badge" aria-hidden>
          <Icon name="ph:paw-print-fill" aria-hidden />
        </span>
        <span className="drd-car-lane-text">{lane.name}</span>
      </span>
      <div className="drd-car-lane-track" style={toneStyle(lane.tone)}>
        <span className="drd-car-lane-night" aria-hidden />
        {lane.span ? (
          <span
            className="drd-car-lane-span"
            aria-hidden
            style={{ "--drd-left": pct(lane.span.leftPct), "--drd-width": pct(Math.max(1, lane.span.widthPct)) } as CSSProperties}
          />
        ) : (
          <span className="drd-car-lane-empty">no timestamped work</span>
        )}
        {lane.marks.map((mark, index) => (
          <span
            key={`${mark.pct}-${index}`}
            className="drd-car-lane-mark"
            title={mark.label}
            style={{ ...toneStyle(mark.tone), "--drd-left": pct(mark.pct) } as CSSProperties}
          />
        ))}
        <span className="drd-car-lane-counts">{counts}</span>
      </div>
    </>
  );
}

function SwimlanesView({ model }: { model: DayModel }) {
  const hasDangerMark = model.swimlanes.some((lane) => lane.marks.some((mark) => mark.tone === "danger"));
  return (
    <div className="drd-car-view drd-car-view-lanes">
      <div className="drd-car-lane-grid">
        <span />
        <div className="drd-car-axis" aria-hidden>
          <span className="drd-car-axis-tick" data-at="0">
            00
          </span>
          <span className="drd-car-axis-tick" data-at="25">
            06
          </span>
          <span className="drd-car-axis-tick" data-at="50">
            12
          </span>
          <span className="drd-car-axis-tick" data-at="75">
            18
          </span>
          <span className="drd-car-axis-tick" data-at="100">
            24
          </span>
        </div>

        {model.swimlanes.map((lane) => (
          <LaneRow key={lane.familiarId} lane={lane} />
        ))}

        <span />
        <div className="drd-car-lane-footer">
          <span className="drd-car-legend">
            <span className="drd-car-legend-swatch" style={toneStyle("accent")} aria-hidden />
            SESSION
          </span>
          <span className="drd-car-legend">
            <span className="drd-car-legend-swatch" style={toneStyle("success")} aria-hidden />
            MERGE
          </span>
          {hasDangerMark ? (
            <span className="drd-car-legend">
              <span className="drd-car-legend-swatch" style={toneStyle("danger")} aria-hidden />
              FLAGGED
            </span>
          ) : null}
          <span className="drd-car-lane-window">
            <span>
              FIRST TOUCH <b>{clockLabel(model.window.firstAt) || "—"}</b>
            </span>
            <span>
              LAST TOUCH <b>{clockLabel(model.window.lastAt) || "—"}</b>
            </span>
            <span>
              SPAN <b>{spanLabel(model.window.spanMinutes)}</b>
            </span>
          </span>
        </div>
      </div>
    </div>
  );
}

// ── view 1 · cards ──────────────────────────────────────────────────────────

function CardSpark({ hours, tone }: { hours: number[]; tone: DayTone }) {
  const series = bucket(hours, 8);
  return (
    <svg
      className="drd-car-card-spark"
      viewBox="0 0 200 30"
      preserveAspectRatio="none"
      style={toneStyle(tone)}
      aria-hidden
    >
      <polygon className="drd-car-spark-area" points={areaPoints(series, 200, 30)} />
      <polyline className="drd-car-spark-line" points={linePoints(series, 200, 30)} />
    </svg>
  );
}

function CardsView({ model }: { model: DayModel }) {
  const quietBits: string[] = [];
  if (model.stats.responses === 0) quietBits.push("0 responses waiting");
  if (model.stats.familiars === 0) quietBits.push("0 familiar updates");
  if ((model.stats.cardsCompleted ?? 0) === 0) quietBits.push("0 cards completed");
  const linesBars = bucket(model.hours, 6);
  const linesPeak = Math.max(...linesBars, 0);
  const nextReminder = model.carries.nextReminder;

  return (
    <div className="drd-car-view drd-car-view-cards">
      <article className="drd-car-card">
        <span className="drd-car-card-icon" style={toneStyle("success")}>
          <Icon name="ph:graph" aria-hidden />
        </span>
        <div className="drd-car-card-figure">{num(model.stats.sessions)}</div>
        <div className="drd-car-card-label">{model.stats.sessions === 1 ? "Session updated" : "Sessions updated"}</div>
        <CardSpark hours={model.hours} tone="success" />
      </article>

      <article className="drd-car-card" data-feature="true">
        <span className="drd-car-card-icon" style={toneStyle("accent")}>
          <Icon name="ph:git-pull-request" aria-hidden />
        </span>
        <div className="drd-car-card-figure" data-glow="true">
          {num(model.shipped.total)}
        </div>
        <div className="drd-car-card-label">{model.shipped.total === 1 ? "PR merged" : "PRs merged"}</div>
        <CardSpark hours={model.hours} tone="accent" />
      </article>

      <article className="drd-car-card">
        <span className="drd-car-card-icon" style={toneStyle("muted")}>
          <Icon name="ph:code" aria-hidden />
        </span>
        <div className="drd-car-card-figure drd-car-card-add">+{num(model.additions)}</div>
        <div className="drd-car-card-sub drd-car-card-del">−{num(model.deletions)}</div>
        <div className="drd-car-card-label">Lines changed</div>
        <div className="drd-car-card-bars" style={toneStyle("success")} aria-hidden>
          {linesBars.map((value, index) => (
            <span
              key={index}
              className="drd-car-card-bar"
              data-lit={linesPeak > 0 && value >= linesPeak ? "true" : undefined}
              style={{ "--drd-bar": pct(linesPeak > 0 ? Math.max(8, (value / linesPeak) * 100) : 8) } as CSSProperties}
            />
          ))}
        </div>
      </article>

      <article className="drd-car-card">
        <span className="drd-car-card-icon" style={toneStyle("warning")}>
          <Icon name="ph:bell" aria-hidden />
        </span>
        <div className="drd-car-card-figure">{num(model.stats.reminders)}</div>
        <div className="drd-car-card-label">{model.stats.reminders === 1 ? "Reminder fired" : "Reminders fired"}</div>
        {nextReminder ? <div className="drd-car-card-note">next · {nextReminder.title}</div> : null}
        <CardSpark hours={model.hours} tone="warning" />
      </article>

      {quietBits.length > 0 ? (
        <article className="drd-car-card" data-quiet="true">
          <div className="drd-car-card-kicker">QUIET TODAY</div>
          <div className="drd-car-card-quiet-list">
            {quietBits.map((bit) => (
              <span key={bit}>{bit}</span>
            ))}
          </div>
          <div className="drd-car-card-note">Their sections are hidden.</div>
        </article>
      ) : null}
    </div>
  );
}

// ── view 2 · graphs ─────────────────────────────────────────────────────────

function HeatCell({ hour, intensity, count }: { hour: number; intensity: number; count: number }) {
  const quiet = intensity <= 0 || count <= 0;
  const title = quiet
    ? `${pad2(hour)}:00 · quiet`
    : `${pad2(hour)}:00 · ${num(count)} ${count === 1 ? "event" : "events"} · ${Math.round(intensity * 100)}% of peak`;
  return (
    <div
      className="drd-car-heat-cell"
      data-quiet={quiet ? "true" : undefined}
      title={title}
      style={{ "--drd-mix": pct(24 + intensity * 66) } as CSSProperties}
    />
  );
}

function GraphsView({ model }: { model: DayModel }) {
  // The real merge counts for the trailing week — a boolean shipped/not series
  // draws a flat line that says nothing about the shape of the week.
  const trendSeries = model.trend.map((point) => point.merges);
  const trendHasData = model.trend.some((point) => point.hasReport);
  return (
    <div className="drd-car-view drd-car-view-graphs">
      <section className="drd-car-heat">
        <header className="drd-car-heat-head">
          <span className="drd-car-kicker">ACTIVITY BY HOUR</span>
          {model.window.peakLabel ? (
            <span className="drd-car-heat-peak">
              PEAK <b>{model.window.peakLabel}</b>
            </span>
          ) : null}
          <span className="drd-car-heat-scale" aria-hidden>
            LESS
            <span className="drd-car-heat-key" data-quiet="true" />
            <span className="drd-car-heat-key" data-step="1" />
            <span className="drd-car-heat-key" data-step="2" />
            <span className="drd-car-heat-key" data-step="3" />
            <span className="drd-car-heat-key" data-step="4" />
            MORE
          </span>
        </header>
        <div className="drd-car-heat-grid">
          {model.hours.map((intensity, hour) => (
            <HeatCell key={hour} hour={hour} intensity={intensity} count={model.hourCounts[hour] ?? 0} />
          ))}
        </div>
        <div className="drd-car-heat-axis" aria-hidden>
          <span>00</span>
          <span>04</span>
          <span>08</span>
          <span>12</span>
          <span>16</span>
          <span>20</span>
          <span>23</span>
        </div>
      </section>

      <div className="drd-car-graph-row">
        <section className="drd-car-projects">
          <div className="drd-car-kicker">LINES BY PROJECT</div>
          {model.projects.length > 0 ? (
            <div className="drd-car-project-list">
              {model.projects.map((project) => {
                const total = project.additions + project.deletions;
                const addShare = total > 0 ? (project.additions / total) * project.share * 100 : 0;
                const delShare = total > 0 ? (project.deletions / total) * project.share * 100 : 0;
                return (
                  <div className="drd-car-project" key={project.key}>
                    <div className="drd-car-project-head">
                      <span className="drd-car-project-name">{project.label}</span>
                      <span className="drd-car-project-counts">
                        +{num(project.additions)} −{num(project.deletions)}
                      </span>
                    </div>
                    <div className="drd-car-project-bar" aria-hidden>
                      <span
                        className="drd-car-project-add"
                        style={{ "--drd-width": pct(addShare) } as CSSProperties}
                      />
                      <span
                        className="drd-car-project-del"
                        style={{ "--drd-width": pct(delShare) } as CSSProperties}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="drd-car-empty-note">No line counts for this day.</p>
          )}
        </section>

        <section className="drd-car-streak">
          <div className="drd-car-kicker">MERGES · LAST 7 DAYS</div>
          {trendHasData ? (
            <div className="drd-car-streak-body">
              <svg
                className="drd-car-streak-chart"
                viewBox="0 0 300 72"
                preserveAspectRatio="none"
                style={toneStyle("accent")}
                aria-hidden
              >
                <polygon className="drd-car-spark-area" points={areaPoints(trendSeries, 300, 72)} />
                <polyline className="drd-car-spark-line" points={linePoints(trendSeries, 300, 72)} />
              </svg>
              <div className="drd-car-streak-foot">
                <span>{model.trend[0]?.label}</span>
                <span className="drd-car-streak-best">
                  {num(Math.max(...trendSeries))} peak · {num(model.shipped.total)} today
                </span>
              </div>
            </div>
          ) : (
            <p className="drd-car-empty-note">No recent history yet.</p>
          )}
        </section>

        <section className="drd-car-tiles">
          <div className="drd-car-tile">
            <div className="drd-car-tile-label">BUSIEST HOUR</div>
            <div className="drd-car-tile-value">{model.window.peakLabel ?? "—"}</div>
          </div>
          <div className="drd-car-tile">
            <div className="drd-car-tile-label">ACTIVE HOURS</div>
            <div className="drd-car-tile-value">
              {num(model.window.coverageHours)} <span className="drd-car-tile-unit">of 24</span>
            </div>
          </div>
          <div className="drd-car-tile">
            <div className="drd-car-tile-label">LONGEST RUN</div>
            <div className="drd-car-tile-value">{model.window.longestRunHours}h</div>
          </div>
          <div className="drd-car-tile">
            <div className="drd-car-tile-label">MERGES / HOUR</div>
            <div className="drd-car-tile-value">{model.window.mergesPerHour}</div>
          </div>
        </section>
      </div>
    </div>
  );
}

// ── shell ───────────────────────────────────────────────────────────────────

export function DayCarousel({
  model,
  open,
  onToggle,
}: {
  model: DayModel;
  open: boolean;
  onToggle: () => void;
}) {
  const [view, setView] = useState(0);

  const busiest = model.swimlanes[0] ?? null;
  const first = clockLabel(model.window.firstAt);
  const last = clockLabel(model.window.lastAt);
  const windowLabel = first && last ? `${first} — ${last}` : first || last || "—";

  const step = (delta: number) => {
    setView((current) => (current + delta + VIEWS.length) % VIEWS.length);
  };

  return (
    <div className="drd-car">
      <button
        type="button"
        className="drd-car-trigger"
        data-panel-trigger="carousel"
        aria-expanded={open}
        aria-controls={PANEL_ID}
        onClick={onToggle}
      >
        <span className="drd-car-brand">
          <Icon name="ph:chart-bar-bold" aria-hidden />
          <span className="drd-car-brand-text">THE DAY</span>
        </span>
        <MiniStat label="FAMILIARS" value={num(model.swimlanes.length)} />
        <MiniStat label="WINDOW" value={windowLabel} />
        <MiniStat label="PEAK" value={model.window.peakLabel ?? "—"} accent />
        <MiniStat label="COVERAGE" value={`${num(model.window.coverageHours)}/24 h`} />
        <MiniStat label="MERGES" value={num(model.shipped.total)} accent />
        <MiniStat label="BUSIEST" value={busiest ? `${busiest.name} · ${num(busiest.mergeCount)}` : "—"} />
        <span className="drd-car-spark-cell">
          <TriggerSpark hours={model.hours} />
        </span>
        <span className="drd-car-affordance">
          <span className="drd-car-affordance-text">
            {open ? "COLLAPSE" : "EXPAND"}
            <Icon name={open ? "ph:caret-up" : "ph:caret-down"} aria-hidden />
          </span>
        </span>
      </button>

      {open ? (
        <div className="drd-car-panel" data-panel="carousel" id={PANEL_ID}>
          <div className="drd-car-panel-head">
            <span className="drd-car-kicker">{model.quiet ? "THE DAY" : "THE DAY, THREE WAYS"}</span>
            {model.quiet ? null : (
              <>
                <div className="drd-car-segmented" role="group" aria-label="Choose a view">
                  {VIEWS.map((name, index) => (
                    <button
                      key={name}
                      type="button"
                      className="drd-car-seg"
                      aria-pressed={view === index}
                      onClick={() => setView(index)}
                    >
                      {name}
                    </button>
                  ))}
                </div>
                <div className="drd-car-nav">
                  <button type="button" className="drd-car-arrow" onClick={() => step(-1)} aria-label="Previous view">
                    <Icon name="ph:caret-left" aria-hidden />
                  </button>
                  <span className="drd-car-dots" aria-hidden>
                    {VIEWS.map((name, index) => (
                      <span key={name} className="drd-car-dot" data-on={view === index ? "true" : undefined} />
                    ))}
                  </span>
                  <button type="button" className="drd-car-arrow" onClick={() => step(1)} aria-label="Next view">
                    <Icon name="ph:caret-right" aria-hidden />
                  </button>
                </div>
              </>
            )}
          </div>

          {model.quiet ? (
            <div className="drd-car-quiet">
              <span className="drd-car-quiet-icon" aria-hidden>
                <Icon name="ph:moon" aria-hidden />
              </span>
              <p className="drd-car-quiet-title">A quiet day.</p>
              <p className="drd-car-quiet-body">
                Nothing carried a timestamp, so there is no shape to draw. The counts above are the whole story.
              </p>
            </div>
          ) : view === 0 ? (
            <SwimlanesView model={model} />
          ) : view === 1 ? (
            <CardsView model={model} />
          ) : (
            <GraphsView model={model} />
          )}
        </div>
      ) : null}
    </div>
  );
}
