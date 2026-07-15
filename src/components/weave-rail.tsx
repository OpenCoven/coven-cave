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
import type { ThreadsMeta, WeaveSummary } from "@/lib/threads-read";

const PILL_CLASSES: Record<TensionPill["tone"], string> = {
  holds: "bg-[var(--ok-soft,rgba(80,180,120,0.15))] text-[var(--ok,#4dbd7a)] border-[var(--ok,#4dbd7a)]/40",
  frayed: "bg-[var(--warn-soft,rgba(220,170,60,0.15))] text-[var(--warn,#d9a53c)] border-[var(--warn,#d9a53c)]/40",
  snapped: "bg-[var(--danger-soft,rgba(220,90,90,0.15))] text-[var(--danger,#d95a5a)] border-[var(--danger,#d95a5a)]/40",
  blocked: "bg-[var(--bg-raised)] text-[var(--text-muted)] border-[var(--border-strong,#555)]",
  stale: "bg-[var(--bg-raised)] text-[var(--text-muted)] border-dashed border-[var(--border-strong,#555)]",
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
  familiars,
  familiarFilter,
  selectedWeaveId,
  meta,
  onSelect,
  onFilter,
  onTrace,
}: {
  weaves: WeaveSummary[];
  familiars: string[];
  familiarFilter: string | null;
  selectedWeaveId: string | null;
  meta: ThreadsMeta;
  onSelect: (id: string) => void;
  onFilter: (familiar: string | null) => void;
  onTrace: (weave: WeaveSummary) => void;
}) {
  const visible = familiarFilter ? weaves.filter((w) => w.familiarId === familiarFilter) : weaves;
  return (
    <section aria-label="Weave rail" className="flex min-w-0 flex-col gap-2">
      <header className="flex items-center justify-between gap-2 px-1">
        <h2 className="text-sm font-semibold text-[var(--text-primary)]">Weaves</h2>
        <label className="flex items-center gap-1 text-xs text-[var(--text-muted)]">
          Familiar
          <select
            value={familiarFilter ?? ""}
            onChange={(e) => onFilter(e.target.value === "" ? null : e.target.value)}
            className="focus-ring rounded border border-[var(--border,#333)] bg-[var(--bg-raised)] px-1 py-0.5 text-xs"
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
      {visible.length === 0 ? (
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
                  <p className="mt-1 text-xs text-[var(--warn,#d9a53c)]">
                    read-only until repair: {weave.degradedSurfaces.join(", ")}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      <footer className="px-2 text-[10px] text-[var(--text-muted)]">
        observed {meta.observedAt} · cursor {meta.sourceCursor} · adapter {meta.adapter}
      </footer>
    </section>
  );
}
