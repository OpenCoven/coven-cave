"use client";

// The weave map (cave-kgts, redrawn for cave-f8rdi) — who may write where, and
// what backs each claim. Two fixed lanes, writers on the left and protected
// surfaces on the right, with one edge per thread:
//
//   weight  — strands behind the binding (a thicker line is better evidence,
//             not more traffic)
//   tone    — the thread's tension; unknown/stale wear blocked, fail-closed
//   dashed  — a staged write is waiting on your decision
//
// A force layout gave every weave a different silhouette, so no two weaves
// could be compared; fixed lanes make the shape mean something. The List
// toggle carries the identical rows as text — the diagram is never the only
// copy of the data, and memory READS still draw no edge because none can be
// verified yet (Phase 5).

import { buildBipartiteWeaveMap, weaveMapRows, type WeaveMapTone } from "@/lib/weave-map";
import type { AuditEntryView, ProposalView, ThreadView } from "@/lib/threads-read";

const TONE_VAR: Record<WeaveMapTone, string> = {
  holds: "var(--color-success)",
  frayed: "var(--color-warning)",
  snapped: "var(--color-danger)",
  blocked: "var(--border-strong)",
};

const VIEW_WIDTH = 720;
const LANE_LEFT = 168;
const LANE_RIGHT = 552;
const ROW_HEIGHT = 34;
const LANE_PAD = 30;
const MONO_STACK = "var(--font-mono), ui-monospace, monospace";

export function WeaveMapCanvas({
  threads,
  audit,
  proposals,
  asList,
  onPresentation,
  blockedReason,
}: {
  threads: ThreadView[];
  audit: AuditEntryView[];
  proposals: ProposalView[];
  asList: boolean;
  onPresentation: (asList: boolean) => void;
  /** Set when the weave's threads could not be enumerated at all. */
  blockedReason: string | null;
}) {
  const map = buildBipartiteWeaveMap({ threads, proposals });
  const rows = weaveMapRows({ threads, audit, proposals });
  // Height follows the thread count so a one-thread weave is a short band, not
  // a mostly-empty panel; a lane with a single node centres rather than pinning
  // to the top pad, which otherwise reads as a diagram that failed to draw.
  const height = Math.max(120, ROW_HEIGHT * Math.max(threads.length, 2) + 46);
  const spread = (index: number, count: number) =>
    count <= 1 ? height / 2 : LANE_PAD + (index * (height - 2 * LANE_PAD)) / (count - 1);

  return (
    <section aria-label="Weave map">
      <div className="wv-section__head">
        <h3 className="wv-eyebrow">Map</h3>
        <div className="wv-seg" role="group" aria-label="Map presentation">
          <button
            type="button"
            className="wv-seg__btn focus-ring-inset"
            aria-pressed={!asList}
            onClick={() => onPresentation(false)}
          >
            Map
          </button>
          <button
            type="button"
            className="wv-seg__btn focus-ring-inset"
            aria-pressed={asList}
            onClick={() => onPresentation(true)}
          >
            List
          </button>
        </div>
      </div>
      <div className="wv-card">
        {blockedReason !== null ? (
          <p role="status" className="wv-map__blocked">
            No map — {blockedReason}, so no edge can be drawn as evidence.
          </p>
        ) : asList ? (
          <ul className="wv-maplist">
            {rows.map((row) => (
              <li key={row.threadId}>
                <span className="wv-maplist__dot" data-tone={row.tone} aria-hidden />
                <span className="wv-maplist__label">{row.label}</span>
                <span className="wv-maplist__edges">{row.evidence}</span>
              </li>
            ))}
          </ul>
        ) : (
          <div className="wv-map">
            <svg
              viewBox={`0 0 ${VIEW_WIDTH} ${height}`}
              height={height}
              role="img"
              aria-label={`Weave map: ${map.links.length} threads binding ${map.writers.length} writers to ${map.surfaces.length} protected surfaces. The List view carries the same rows as text.`}
            >
              {map.links.map((link) => {
                const y1 = spread(link.writerIndex, map.writers.length);
                const y2 = spread(link.surfaceIndex, map.surfaces.length);
                return (
                  <path
                    key={link.threadId}
                    d={`M${LANE_LEFT} ${y1} C${LANE_LEFT + 130} ${y1} ${LANE_RIGHT - 130} ${y2} ${LANE_RIGHT} ${y2}`}
                    fill="none"
                    stroke={TONE_VAR[link.tone]}
                    strokeWidth={link.pending ? 1.4 : Math.min(1.2 + link.strandCount * 0.5, 3.2)}
                    strokeDasharray={link.pending ? "5 4" : undefined}
                    opacity={link.tone === "holds" ? 0.5 : 0.95}
                  />
                );
              })}
              {map.writers.map((writer, index) => {
                const y = spread(index, map.writers.length);
                return (
                  <g key={writer}>
                    <circle cx={LANE_LEFT} cy={y} r={5} fill="var(--accent-presence)" />
                    <text
                      x={LANE_LEFT - 12}
                      y={y + 4}
                      textAnchor="end"
                      fontSize={11.5}
                      fontFamily={MONO_STACK}
                      fill="var(--text-secondary)"
                    >
                      {writer}
                    </text>
                  </g>
                );
              })}
              {map.surfaces.map((entry, index) => {
                const y = spread(index, map.surfaces.length);
                return (
                  <g key={`${entry.surface}:${index}`}>
                    <rect
                      x={LANE_RIGHT - 4}
                      y={y - 4}
                      width={8}
                      height={8}
                      rx={1.5}
                      fill={TONE_VAR[entry.tone]}
                    />
                    <text
                      x={LANE_RIGHT + 14}
                      y={y + 4}
                      fontSize={11.5}
                      fontFamily={MONO_STACK}
                      fill="var(--text-primary)"
                    >
                      {entry.surface}
                    </text>
                  </g>
                );
              })}
              <text
                x={LANE_LEFT}
                y={height - 6}
                textAnchor="end"
                fontSize={10}
                letterSpacing="0.08em"
                fill="var(--text-muted)"
              >
                WRITERS
              </text>
              <text
                x={LANE_RIGHT + 14}
                y={height - 6}
                fontSize={10}
                letterSpacing="0.08em"
                fill="var(--text-muted)"
              >
                PROTECTED SURFACES
              </text>
            </svg>
          </div>
        )}
        <p className="wv-card__note">
          Weight = strands behind the binding · dashed = a staged write waiting on you. Memory reads
          aren&rsquo;t audited yet, so the map shows verified writes and contracts only.
        </p>
      </div>
    </section>
  );
}
