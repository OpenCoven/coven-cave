"use client";
// Weave rail (spec §3 route 1 rendering): a familiar's weaves with tension
// rollup. Every status pill traces to a predicate result — the trace
// affordance is on the pill itself, never on descriptor content.
//
// The rail is the list half of the list+detail pair. It scopes by search,
// familiar, and operator status ("does this ask something of me?"), and it
// orders worst-first so the default selection is the weave in most trouble.
import { Icon } from "@/lib/icon";
import {
  matchesScope,
  pillForCoherence,
  shortHash,
  sortWeavesWorstFirst,
  weaveStatus,
  type PillTone,
  type TensionPill,
  type WeaveScope,
  type WeaveStatus,
} from "@/lib/weave-rail";
import type { DegradedFamiliarView, ThreadsMeta, WeaveSummary } from "@/lib/threads-read";

const PILL_CLASS: Record<PillTone, string> = {
  holds: "wv-pill--holds",
  frayed: "wv-pill--frayed",
  snapped: "wv-pill--snapped",
  blocked: "wv-pill--blocked",
  stale: "wv-pill--stale",
  awaiting: "wv-pill--awaiting",
  neutral: "wv-pill--neutral",
};

const DEGRADED_FAMILIAR_PILL: TensionPill = {
  tone: "blocked",
  label: "Blocked",
  detail: "Ward config is unreadable, so protection cannot be verified.",
  icon: "ph:shield-slash",
};

const STATUS_FILTERS: { key: string; value: WeaveStatus | null; label: string }[] = [
  { key: "all", value: null, label: "All" },
  { key: "attention", value: "attention", label: "Attention" },
  { key: "blocked", value: "blocked", label: "Blocked" },
];

export function StatusPill({
  pill,
  quiet,
  onTrace,
  traceLabel,
}: {
  pill: TensionPill;
  /** On a dense row an all-clear pill reads as decoration; render it as text. */
  quiet?: boolean;
  onTrace?: () => void;
  traceLabel?: string;
}) {
  const toneClass = quiet && pill.tone === "holds" ? "wv-pill--quiet" : PILL_CLASS[pill.tone];
  return (
    <>
      <span title={pill.detail} className={`wv-pill ${toneClass}`}>
        <Icon name={pill.icon} aria-hidden />
        {pill.label}
      </span>
      {onTrace ? (
        <button
          type="button"
          onClick={onTrace}
          aria-label={traceLabel ?? `Trace ${pill.label} to source`}
          title="Trace to source"
          className="wv-trace-btn focus-ring"
        >
          <Icon name="ph:path" aria-hidden />
        </button>
      ) : null}
    </>
  );
}

export function WeaveRail({
  weaves,
  degraded,
  familiars,
  scope,
  onScope,
  showStatusFilter,
  selectedWeaveId,
  meta,
  onSelect,
  onTraceDegraded,
}: {
  weaves: WeaveSummary[];
  degraded: DegradedFamiliarView[];
  familiars: string[];
  scope: WeaveScope;
  onScope: (next: WeaveScope) => void;
  /** Hidden when nothing needs attention — a filter with one bucket is noise. */
  showStatusFilter: boolean;
  selectedWeaveId: string | null;
  meta: ThreadsMeta;
  onSelect: (id: string) => void;
  onTraceDegraded: (degraded: DegradedFamiliarView) => void;
}) {
  const visible = sortWeavesWorstFirst(weaves).filter((weave) => matchesScope(weave, scope));
  const visibleDegraded = degraded.filter((entry) => matchesScope(entry, scope));
  const scoped = scope.query.trim().length > 0 || scope.familiar !== null || scope.status !== null;
  const total = weaves.length + degraded.length;

  return (
    <section aria-label="Weaves" className="wv-pane-list">
      <div className="wv-listhead">
        <label className="wv-search">
          <Icon name="ph:magnifying-glass" aria-hidden />
          <span className="sr-only">Search weaves</span>
          <input
            type="search"
            value={scope.query}
            onChange={(e) => onScope({ ...scope, query: e.target.value })}
            placeholder="Search weaves…"
          />
        </label>
        <div className="wv-filters">
          <label className="wv-select-label">
            Familiar
            <select
              className="wv-select focus-ring"
              value={scope.familiar ?? ""}
              onChange={(e) =>
                onScope({ ...scope, familiar: e.target.value === "" ? null : e.target.value })
              }
            >
              <option value="">all</option>
              {familiars.map((familiar) => (
                <option key={familiar} value={familiar}>
                  {familiar}
                </option>
              ))}
            </select>
          </label>
          {showStatusFilter ? (
            <div className="wv-seg" role="group" aria-label="Filter by status">
              {STATUS_FILTERS.map((filter) => (
                <button
                  key={filter.key}
                  type="button"
                  className="wv-seg__btn focus-ring-inset"
                  aria-pressed={scope.status === filter.value}
                  onClick={() => onScope({ ...scope, status: filter.value })}
                >
                  {filter.label}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      <div className="wv-scroll">
        {visible.length === 0 && visibleDegraded.length === 0 ? (
          <div role="status" className="wv-empty">
            <span className="wv-empty__title">
              {scoped ? "No weaves match this scope" : "No weaves yet"}
            </span>
            <p className="wv-empty__body">
              {scoped
                ? `${total} familiar${total === 1 ? " was" : "s were"} verified at the last observation; none match the current scope. This is a filtered empty, not a blocked read.`
                : "No weaves under this filter — verified empty, not blocked. A familiar's enforced pattern of threads appears here once it is woven."}
            </p>
            {scoped ? (
              <button
                type="button"
                className="wv-ghost wv-ghost--sm focus-ring"
                onClick={() => onScope({ query: "", familiar: null, status: null })}
              >
                Clear filters
              </button>
            ) : null}
          </div>
        ) : (
          <ul className="wv-rows">
            {visible.map((weave) => {
              const selected = weave.id === selectedWeaveId;
              return (
                <li
                  key={weave.id}
                  className={`wv-row wv-reveal-scope${selected ? " wv-row--sel" : ""}`}
                >
                  <button
                    type="button"
                    className="wv-row__btn focus-ring-inset"
                    aria-current={selected ? "true" : undefined}
                    onClick={() => onSelect(weave.id)}
                  >
                    <span className="wv-row__line">
                      <span className="wv-row__name">{weave.familiarId || "(unattributed)"}</span>
                      <StatusPill
                        pill={pillForCoherence(weave.coherence)}
                        quiet={weaveStatus(weave) === "healthy"}
                      />
                    </span>
                    <span className="wv-row__line">
                      <span className="wv-row__meta">
                        {weave.threadCount} thread{weave.threadCount === 1 ? "" : "s"}
                      </span>
                      <span className="wv-row__spacer" />
                      <span className="wv-row__hash wv-reveal">
                        weave {shortHash(weave.weaveHash)}
                      </span>
                    </span>
                    {weave.degradedSurfaces.length > 0 ? (
                      <span className="wv-row__warn">
                        <Icon name="ph:warning" aria-hidden />
                        <span>read-only until repair: {weave.degradedSurfaces.join(", ")}</span>
                      </span>
                    ) : null}
                  </button>
                </li>
              );
            })}
            {/* R12: a familiar whose ward config is unreadable gets a row of its
                own — visible and traceable, with no selection or action, so it
                can never be mistaken for a weave whose state was verified. */}
            {visibleDegraded.map((entry) => (
              <li key={`degraded:${entry.familiarId}:${entry.reason}`} className="wv-row">
                <div className="wv-row__btn">
                  <span className="wv-row__line">
                    <span className="wv-row__name">{entry.familiarId}</span>
                    <StatusPill
                      pill={DEGRADED_FAMILIAR_PILL}
                      onTrace={() => onTraceDegraded(entry)}
                      traceLabel={`Trace ${entry.familiarId} ward unreadable to source`}
                    />
                  </span>
                  <span className="wv-row__line">
                    <span className="wv-row__meta">ward unreadable — protection not verifiable</span>
                  </span>
                  <span className="wv-row__warn">
                    <Icon name="ph:warning" aria-hidden />
                    <span>
                      Thread bindings are withheld rather than listed as an empty set — an empty
                      list would read as “nothing to worry about”. {entry.error}
                    </span>
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <p className="wv-footmeta">
        observed {meta.observedAt} · cursor {meta.sourceCursor} · adapter {meta.adapter}
      </p>
    </section>
  );
}
