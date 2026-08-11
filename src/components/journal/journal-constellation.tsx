"use client";

/**
 * Journal entry "Visual" — the memory-constellation sketch from the "Memories
 * Prototype" redesign. Generate reveals a deterministic constellation seeded
 * by the entry's date; regenerate bumps the seed for a fresh arrangement. The
 * per-date bump persists in localStorage, so a generated visual survives
 * reloads without any server state.
 *
 * All colors are theme tokens (the sketch follows the active palette); the
 * brief "sketching…" beat is skipped under prefers-reduced-motion.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/lib/icon";
import { usePrefersReducedMotion } from "@/lib/use-prefers-reduced-motion";
import {
  CONSTELLATION_VIEW,
  constellationPoints,
  constellationSeed,
  readStoredVisualBumps,
  writeStoredVisualBump,
} from "@/lib/journal-constellation";

/** Token-based star palette — index matches ConstellationPoint.c. */
const STAR_COLORS = [
  "var(--accent-presence)",
  "var(--text-muted)",
  "color-mix(in srgb, var(--accent-presence) 60%, var(--text-primary))",
  "color-mix(in srgb, var(--accent-presence) 55%, transparent)",
] as const;

const SKETCH_MS = 900;

export function JournalConstellation({ date, caption }: { date: string; caption: string }) {
  // null = not generated for this day; a number = the seed bump in effect.
  const [bump, setBump] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const reducedMotion = usePrefersReducedMotion();
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    const stored = readStoredVisualBumps();
    setBump(Object.prototype.hasOwnProperty.call(stored, date) ? stored[date] : null);
    setBusy(false);
    window.clearTimeout(timer.current);
  }, [date]);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const generate = () => {
    if (busy) return;
    const next = (bump ?? -1) + 1;
    const reveal = () => {
      setBusy(false);
      setBump(next);
      writeStoredVisualBump(date, next);
    };
    if (reducedMotion) {
      reveal();
      return;
    }
    setBusy(true);
    timer.current = window.setTimeout(reveal, SKETCH_MS);
  };

  const points = useMemo(
    () => (bump === null ? [] : constellationPoints(constellationSeed(date, bump))),
    [date, bump],
  );

  const { width, height, hubX, hubY } = CONSTELLATION_VIEW;

  return (
    <div className="journal-visual">
      <div className="journal-visual__head">
        <h4 className="journal-entry__sec journal-entry__sec-heading">Visual</h4>
        {bump !== null && !busy ? (
          <button type="button" className="journal-visual__regen focus-ring" onClick={generate}>
            <Icon name="ph:arrows-clockwise" width={11} aria-hidden />
            Regenerate
          </button>
        ) : null}
      </div>
      {busy ? (
        <div className="journal-visual__busy" role="status">
          Sketching a memory constellation…
        </div>
      ) : bump === null ? (
        <button type="button" className="journal-visual__gen focus-ring" onClick={generate}>
          <Icon name="ph:sparkle" width={12} aria-hidden />
          Generate a visual for this entry
        </button>
      ) : (
        <>
          <div className="journal-visual__frame">
            <svg
              viewBox={`0 0 ${width} ${height}`}
              role="img"
              aria-label={`Memory constellation for ${date}`}
              className="journal-visual__svg"
            >
              <g stroke="color-mix(in srgb, var(--accent-presence) 40%, transparent)" strokeWidth={0.8}>
                {points.map((p, i) => (
                  <line key={i} x1={hubX} y1={hubY} x2={p.x} y2={p.y} />
                ))}
              </g>
              <g
                stroke="color-mix(in srgb, var(--accent-presence) 30%, transparent)"
                strokeWidth={0.7}
                fill="none"
              >
                {points.slice(0, 4).map((p, i) => {
                  const q = points[(i + 3) % points.length];
                  return q ? <path key={i} d={`M ${p.x} ${p.y} Q ${hubX} ${hubY} ${q.x} ${q.y}`} /> : null;
                })}
              </g>
              <g>
                {points.map((p, i) => (
                  <circle key={i} cx={p.x} cy={p.y} r={p.r} fill={STAR_COLORS[p.c] ?? STAR_COLORS[0]} />
                ))}
              </g>
              <circle cx={hubX} cy={hubY} r={6} fill="var(--accent-presence)" />
              <circle
                cx={hubX}
                cy={hubY}
                r={12}
                fill="none"
                stroke="color-mix(in srgb, var(--accent-presence) 40%, transparent)"
              />
            </svg>
          </div>
          <div className="journal-visual__caption">{caption}</div>
        </>
      )}
    </div>
  );
}
