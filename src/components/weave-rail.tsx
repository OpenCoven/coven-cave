"use client";
// Weave rail (spec §3 route 1 rendering): a familiar's weaves with tension
// rollup. Every status pill traces to a predicate result — the trace
// affordance is on the pill itself, never on descriptor content.
import { Icon } from "@/lib/icon";
import {
  pillForCoherence,
  pillForTension,
  shortHash,
  type TensionPill,
} from "@/lib/weave-rail";
import type { DegradedFamiliarView, ThreadsMeta, WeaveSummary } from "@/lib/threads-read";

const PILL_CLASSES: Record<TensionPill["tone"], string> = {
  holds: "bg-[color-mix(in_oklch,var(--color-success)_15%,transparent)] text-[var(--color-success)] border-[var(--color-success)]/40",
  frayed: "bg-[color-mix(in_oklch,var(--color-warning)_15%,transparent)] text-[var(--color-warning)] border-[var(--color-warning)]/40",
  snapped: "bg-[color-mix(in_oklch,var(--color-danger)_15%,transparent)] text-[var(--color-danger)] border-[var(--color-danger)]/40",
  blocked: "bg-[var(--bg-raised)] text-[var(--text-muted)] border-[var(--border-strong)]",
  stale: "bg-[var(--bg-raised)] text-[var(--text-muted)] border-dashed border-[var(--border-strong)]",
};

const DEGRADED_FAMILIAR_PILL: TensionPill = {
  tone: "blocked",
  label: "Blocked",
  detail: "Ward config is unreadable, so protection cannot be verified.",
  icon: "ph:shield-slash",
};

export function StatusPill({
  pill,
  onTrace,
  traceLabel,
}: {
  pill: TensionPill;
  onTrace?: () => void;
  traceLabel?: string;
}) {
  return (
    <span className="inline-flex items-center gap-1">
      <span
        title={pill.detail}
        className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${PILL_CLASSES[pill.tone]}`}
      >
        <Icon name={pill.icon} aria-hidden />
        {pill.label}
      </span>
      {onTrace ? (
        <button
          type="button"
          onClick={onTrace}
          aria-label={traceLabel ?? `Trace ${pill.label} to source`}
          title="Trace to source"
          className="focus-ring inline-flex items-center rounded p-0.5 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
        >
          <Icon name="ph:path" aria-hidden />
        </button>
      ) : null}
    </span>
  );
}

export function WeaveRail({
  weaves,
  degraded,
  familiars,
  familiarFilter,
  selectedWeaveId,
  meta,
  onSelect,
  onFilter,
  onTrace,
  onTraceDegraded,
}: {
  weaves: WeaveSummary[];
  degraded: DegradedFamiliarView[];
  familiars: string[];
  familiarFilter: string | null;
  selectedWeaveId: string | null;
  meta: ThreadsMeta;
  onSelect: (id: string) => void;
  onFilter: (familiar: string | null) => void;
  onTrace: (weave: WeaveSummary) => void;
  onTraceDegraded: (degraded: DegradedFamiliarView) => void;
}) {
  const visible = familiarFilter ? weaves.filter((w) => w.familiarId === familiarFilter) : weaves;
  const visibleDegraded = familiarFilter ? degraded.filter((d) => d.familiarId === familiarFilter) : degraded;
  return (
    <section aria-label="Weave rail" className="flex min-w-0 flex-col gap-2">
      <header className="flex items-center justify-between gap-2 px-1">
        <h2 className="text-sm font-semibold text-[var(--text-primary)]">Weaves</h2>
        <label className="flex items-center gap-1 text-xs text-[var(--text-muted)]">
          Familiar
          <select
            value={familiarFilter ?? ""}
            onChange={(e) => onFilter(e.target.value === "" ? null : e.target.value)}
            className="focus-ring rounded border border-[var(--border-hairline)] bg-[var(--bg-raised)] px-1 py-0.5 text-xs"
          >
            <option value="">all</option>
            {familiars.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </label>
      </header>
      {visible.length === 0 && visibleDegraded.length === 0 ? (
        <p className="px-2 py-4 text-xs text-[var(--text-muted)]">
          No weaves under this filter — verified empty, not blocked. A familiar&apos;s enforced
          pattern of threads appears here once it is woven.
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {visible.map((weave) => {
            const rollupPill = pillForTension(weave.tensionRollup);
            const coherencePill = pillForCoherence(weave.coherence);
            const selected = weave.id === selectedWeaveId;
            return (
              <li
                key={weave.id}
                className={`rounded border-l-2 px-2 py-2 transition-colors ${
                  selected
                    ? "border-[var(--accent-presence)] bg-[var(--bg-raised)]/60"
                    : "border-transparent hover:bg-[var(--bg-raised)]"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => onSelect(weave.id)}
                    aria-current={selected ? "true" : undefined}
                    className="focus-ring-inset min-w-0 flex-1 text-left"
                  >
                    <span className="block truncate text-sm text-[var(--text-primary)]">
                      {weave.familiarId || "(unattributed)"}
                    </span>
                    <span className="block truncate text-xs text-[var(--text-muted)]">
                      {weave.threadCount} thread{weave.threadCount === 1 ? "" : "s"} · weave{" "}
                      {shortHash(weave.weaveHash)}
                    </span>
                  </button>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <StatusPill pill={rollupPill} onTrace={() => onTrace(weave)} traceLabel={`Trace ${weave.familiarId} rollup to source`} />
                    <StatusPill pill={coherencePill} />
                  </div>
                </div>
                {weave.degradedSurfaces.length > 0 ? (
                  <p className="mt-1 text-xs text-[var(--color-warning)]">
                    read-only until repair: {weave.degradedSurfaces.join(", ")}
                  </p>
                ) : null}
              </li>
            );
          })}
          {visibleDegraded.map((entry) => (
            <li
              key={`degraded:${entry.familiarId}:${entry.reason}`}
              className="rounded border-l-2 border-[var(--border-strong,#555)] bg-[var(--bg-raised)]/40 px-2 py-2"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-[var(--text-primary)]">{entry.familiarId}</span>
                  <span className="block truncate text-xs text-[var(--text-muted)]">
                    ward unreadable — protection not verifiable
                  </span>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <StatusPill
                    pill={DEGRADED_FAMILIAR_PILL}
                    onTrace={() => onTraceDegraded(entry)}
                    traceLabel={`Trace ${entry.familiarId} ward unreadable to source`}
                  />
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
      <footer className="px-2 text-[length:var(--text-2xs)] text-[var(--text-muted)]">
        observed {meta.observedAt} · cursor {meta.sourceCursor} · adapter {meta.adapter}
      </footer>
    </section>
  );
}
