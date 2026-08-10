"use client";

/**
 * ChatRunRail — the right-hand instrument column from the
 * `Coven Cave - Chat Session` design handoff (cave-w716g).
 *
 * Four panels, chosen because the data supports them: TIMELINE, TOOL MIX,
 * DOING NOW, and the done/failed counts. The frame draws four more; see
 * `lib/chat-run-rail.ts` for why PLAN, LEFT, CONTEXT WINDOW and COST are
 * deliberately absent rather than stubbed. The short version: nothing measures
 * them today, and a panel that displays an unmeasured number is worse than no
 * panel.
 *
 * All derivation lives in the pure model; this file only draws it. It reads the
 * SAME activePath the transcript renders, like the spine and minimap, so the
 * rail can never disagree with the conversation beside it.
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  runRailDuration,
  runRailModel,
  runRailTicks,
  type RunRailModel,
} from "@/lib/chat-run-rail";
import { THREAD_INSTRUMENTS_MIN_WIDTH } from "@/components/chat-thread-instruments";
import type { InstrumentTurn } from "@/lib/chat-thread-instruments";

/** A live call's elapsed time moves every second. */
const LIVE_TICK_MS = 1000;
/** Nothing running: the only live readout left is the OPEN age, which changes
 *  by the minute once a session is an hour old. Ticking that at 1s would
 *  re-render an idle transcript 60x more often for an identical string. */
const IDLE_TICK_MS = 60_000;

/** Widest the rail ever gets (mirrors --runrail-max-w in run-rail.css). The
 *  gate spends this before comparing, so admitting the rail can never push the
 *  transcript under the threshold its sibling instruments measure. */
const RAIL_MAX_WIDTH = 300;

/**
 * Local clock for the elapsed readouts. Deliberately a raw interval rather
 * than usePausablePoll: this makes no network request, so the hook's
 * hidden-tab pause would buy nothing (see RAW_INTERVAL_ALLOWLIST in
 * lib/pausable-poll-discipline.test.ts, where this file is listed with the
 * other no-network tickers). Both readouts are derived from timestamps at
 * render, so a missed tick never accumulates error — the next one is correct.
 */
function useNow(active: boolean, intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [active, intervalMs]);
  return now;
}

/**
 * Wide-pane gate, matching the spine and minimap's THREAD_INSTRUMENTS_MIN_WIDTH
 * so all three instruments appear and disappear together.
 *
 * Measures the PARENT ROW, not the transcript scroller the siblings measure.
 * They are overlays and cost the scroller no width; this rail is layout, so
 * measuring the thing it shrinks would oscillate — mount, narrow the scroller
 * under the threshold, unmount, widen it, mount again. The row's width comes
 * from the layout above it and does not move when the rail collapses.
 *
 * The element therefore stays mounted and hides in CSS: returning null would
 * remove the very node whose parent is being observed, and it could never
 * measure its way back.
 */
function useWideEnough(ref: React.RefObject<HTMLElement | null>): boolean {
  const [wide, setWide] = useState(true);
  useLayoutEffect(() => {
    const row = ref.current?.parentElement;
    if (!row || typeof ResizeObserver === "undefined") return;
    // The row must clear the instruments threshold WITH the rail's own width
    // already spent. Comparing the bare row admits the rail at ~1360px, which
    // leaves the transcript ~1100px — below the threshold the spine and minimap
    // measure, so they would disappear while the rail that displaced them
    // stayed. Keep the mirror of RAIL_MAX_WIDTH in run-rail.css in step.
    const measure = () =>
      setWide(row.clientWidth >= THREAD_INSTRUMENTS_MIN_WIDTH + RAIL_MAX_WIDTH);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(row);
    return () => observer.disconnect();
  }, [ref]);
  return wide;
}

function PanelHead({ label, trailing }: { label: string; trailing?: string | null }) {
  return (
    <div className="cave-runrail__head">
      <span className="cave-runrail__label">{label}</span>
      <span className="cave-runrail__rule" aria-hidden />
      {trailing ? <span className="cave-runrail__trailing">{trailing}</span> : null}
    </div>
  );
}

function Counters({ model }: { model: RunRailModel }) {
  // Deliberately "calls", not "steps": these count tool calls, which is what is
  // measured. The frame's DONE/LEFT/FAILED counts steps against a plan that no
  // harness reports, and LEFT is omitted entirely — with nothing declaring a
  // total, "how many remain" would be invented.
  return (
    <div className="cave-runrail__counters">
      <div className="cave-runrail__counter">
        <span className="cave-runrail__count">{model.done}</span>
        <span className="cave-runrail__countlabel">done</span>
      </div>
      <div className="cave-runrail__counter">
        <span className="cave-runrail__count">{model.running}</span>
        <span className="cave-runrail__countlabel">running</span>
      </div>
      <div
        className={`cave-runrail__counter${model.failed > 0 ? " cave-runrail__counter--failed" : ""}`}
      >
        <span className="cave-runrail__count">{model.failed}</span>
        <span className="cave-runrail__countlabel">failed</span>
      </div>
    </div>
  );
}

export function ChatRunRail({
  turns,
  conversationCreatedAt,
  className,
}: {
  turns: InstrumentTurn[];
  conversationCreatedAt?: string;
  className?: string;
}) {
  // Only tick while something is actually running or the age is on screen —
  // an idle transcript should not re-render once a second forever.
  const hasRunning = useMemo(
    () => turns.some((t) => (t.tools ?? []).some((tool) => tool.status === "running")),
    [turns],
  );
  const railRef = useRef<HTMLElement | null>(null);
  const wide = useWideEnough(railRef);
  const now = useNow(hasRunning || Boolean(conversationCreatedAt), hasRunning ? LIVE_TICK_MS : IDLE_TICK_MS);
  const model = useMemo(
    () => runRailModel(turns, { nowMs: now, conversationCreatedAt }),
    [turns, now, conversationCreatedAt],
  );

  // Nothing has run yet: the rail would be five empty boxes. Render nothing
  // rather than furniture around no content.
  if (model.calls === 0) return null;

  const ticks = runRailTicks(model.totalMs);
  const openLabel = runRailDuration(model.openMs);

  return (
    <aside
      ref={railRef}
      className={`cave-runrail${wide ? "" : " cave-runrail--narrow"}${className ? ` ${className}` : ""}`}
      aria-label="Run instruments"
    >
      <Counters model={model} />

      {/* ── TIMELINE ── every tool call, width proportional to its duration */}
      <section className="cave-runrail__panel">
        <PanelHead label="Timeline" trailing={runRailDuration(model.totalMs)} />
        <div
          className="cave-runrail__timeline"
          role="img"
          aria-label={`${model.calls} tool calls over ${runRailDuration(model.totalMs) ?? "no measured time"}`}
        >
          {model.segments.map((segment) => (
            <span
              key={segment.id}
              className={`cave-runrail__seg cave-runrail__seg--${segment.category}${
                segment.status === "error" ? " cave-runrail__seg--error" : ""
              }`}
              style={{ flexGrow: segment.ratio }}
              title={`${segment.category} · ${runRailDuration(segment.durationMs) ?? "—"}`}
            />
          ))}
        </div>
        {ticks.length ? (
          <div className="cave-runrail__axis" aria-hidden>
            {ticks.map((tick, i) => (
              <span key={i}>{runRailDuration(tick)}</span>
            ))}
          </div>
        ) : null}
      </section>

      {/* ── TOOL MIX ── the same calls, grouped by category */}
      <section className="cave-runrail__panel">
        <PanelHead label="Tool mix" trailing={`${model.calls} ${model.calls === 1 ? "call" : "calls"}`} />
        <div className="cave-runrail__mixbar" aria-hidden>
          {model.mix.map((row) => (
            <span
              key={row.category}
              className={`cave-runrail__seg cave-runrail__seg--${row.category}`}
              style={{ flexGrow: row.ratio }}
            />
          ))}
        </div>
        <ul className="cave-runrail__legend">
          {model.mix.map((row) => (
            <li key={row.category}>
              <i className={`cave-runrail__dot cave-runrail__dot--${row.category}`} aria-hidden />
              {row.category} {row.count}
            </li>
          ))}
        </ul>
      </section>

      {/* ── DOING NOW ── heading follows the frame: live / stopped / finished */}
      {model.now ? (
        <section className="cave-runrail__panel">
          <PanelHead
            label={model.now.heading}
            trailing={runRailDuration(model.now.durationMs ?? null)}
          />
          <div
            className={`cave-runrail__now${
              model.now.heading === "Stopped at" ? " cave-runrail__now--error" : ""
            }${model.now.heading === "Doing now" ? " cave-runrail__now--live" : ""}`}
          >
            {/* The command when the call carried one; otherwise the tool's own
                name, which is always known — never an empty box. */}
            {model.now.command ?? model.now.name}
          </div>
        </section>
      ) : null}

      {openLabel ? (
        <div className="cave-runrail__foot">
          <span className="cave-runrail__label">open</span>
          <span className="cave-runrail__trailing">{openLabel}</span>
        </div>
      ) : null}
    </aside>
  );
}
