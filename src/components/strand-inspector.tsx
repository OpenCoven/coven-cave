"use client";
// Strand inspection (spec §3 route 4, threads-986.17.5): per-strand detail
// for all five kinds; on a Frayed thread the blamed strand renders the
// current-vs-expected diff; lineage deep-links strand → ward_audit entries.
import { useEffect, useState } from "react";
import { Icon } from "@/lib/icon";
import {
  annotateLineage,
  blamedStrandId,
  lineageLine,
  strandDetailRows,
  strandDiff,
} from "@/lib/strand-inspect";
import type { AuditEntryView, StrandView, ThreadView } from "@/lib/threads-read";
import { blockedMessage, surfaceStateFromPayload, type SurfaceState } from "@/lib/weave-rail";

async function fetchSurface<T>(url: string): Promise<SurfaceState<T>> {
  try {
    const res = await fetch(url, { cache: "no-store" });
    return surfaceStateFromPayload<T>(await res.json());
  } catch {
    return {
      kind: "blocked",
      why: "daemon-unreachable",
      message: blockedMessage("daemon-unreachable"),
      meta: null,
    };
  }
}

function DiffBlock({ strand }: { strand: StrandView }) {
  const diff = strandDiff(strand);
  if (!diff) return null;
  return (
    <div
      aria-label="Current vs expected"
      className="mt-2 rounded border border-[var(--warn,#d9a53c)]/40 bg-[var(--bg-raised)] px-2 py-1.5"
    >
      <p className="mb-1 inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--warn,#d9a53c)]">
        <Icon name="ph:warning" aria-hidden />
        current vs expected
      </p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 font-mono text-[11px]">
        <dt className="text-[var(--text-muted)]">expected</dt>
        <dd className="break-all text-[var(--ok,#4dbd7a)]">{diff.expected || "(empty)"}</dd>
        <dt className="text-[var(--text-muted)]">observed</dt>
        <dd className={`break-all ${diff.observed === null ? "text-[var(--text-muted)]" : "text-[var(--danger,#d95a5a)]"}`}>
          {diff.observed === null
            ? "(could not observe — treated as blocked, not healthy)"
            : diff.observed || "(empty)"}
        </dd>
        <dt className="text-[var(--text-muted)]">observed at</dt>
        <dd className="text-[var(--text-primary)]">{diff.observedAt ?? "(unknown)"}</dd>
      </dl>
    </div>
  );
}

export function StrandInspector({
  thread,
  knownProposalIds,
}: {
  thread: ThreadView;
  knownProposalIds: ReadonlySet<string>;
}) {
  const [strandsState, setStrandsState] = useState<SurfaceState<StrandView[]>>({ kind: "loading" });
  const [auditState, setAuditState] = useState<SurfaceState<AuditEntryView[]>>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    setStrandsState({ kind: "loading" });
    setAuditState({ kind: "loading" });
    void fetchSurface<StrandView[]>(`/api/threads/${encodeURIComponent(thread.id)}/strands`).then(
      (state) => {
        if (!cancelled) setStrandsState(state);
      },
    );
    void fetchSurface<AuditEntryView[]>(`/api/threads/${encodeURIComponent(thread.id)}/audit`).then(
      (state) => {
        if (!cancelled) setAuditState(state);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [thread.id]);

  const blamed = blamedStrandId(thread.tension);

  return (
    <section aria-label="Strand inspection" className="flex min-w-0 flex-col gap-3">
      <header>
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">
          Strands of {thread.surface} <span className="text-[var(--text-muted)]">→</span> {thread.writer}
        </h3>
        <p className="text-xs text-[var(--text-muted)]">
          Each strand is one fiber of commitment inside this thread — the thread survives a channel
          iff its strands survive that channel.
        </p>
      </header>

      {strandsState.kind === "loading" ? (
        <p className="text-xs text-[var(--text-muted)]">Reading strands…</p>
      ) : strandsState.kind === "blocked" ? (
        <p role="status" className="text-xs text-[var(--text-muted)]">
          <Icon name="ph:shield-slash" aria-hidden /> {strandsState.message}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {strandsState.data.length === 0 ? (
            <li className="text-xs text-[var(--warn,#d9a53c)]">
              No strands — this thread carries no commitments, so required-strand checks fray it on
              every structured channel.
            </li>
          ) : (
            strandsState.data.map((strand) => {
              const isBlamed = strand.id === blamed;
              return (
                <li
                  key={strand.id}
                  className={`rounded border px-2 py-1.5 ${
                    isBlamed
                      ? "border-[var(--warn,#d9a53c)]/60"
                      : "border-[var(--border,#333)]"
                  }`}
                >
                  <p className="flex items-center gap-2 text-xs font-medium text-[var(--text-primary)]">
                    {strand.kind}
                    {isBlamed ? (
                      <span className="inline-flex items-center gap-1 rounded-full border border-[var(--warn,#d9a53c)]/40 px-1.5 text-[10px] text-[var(--warn,#d9a53c)]">
                        <Icon name="ph:warning" aria-hidden />
                        blamed by the fray
                      </span>
                    ) : null}
                  </p>
                  <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-[11px]">
                    {strandDetailRows(strand).map((row) => (
                      <div key={row.label} className="contents">
                        <dt className="text-[var(--text-muted)]">{row.label}</dt>
                        <dd className={`break-all text-[var(--text-primary)] ${row.mono ? "font-mono" : ""}`}>
                          {row.value}
                        </dd>
                      </div>
                    ))}
                  </dl>
                  <DiffBlock strand={strand} />
                </li>
              );
            })
          )}
        </ul>
      )}

      <section aria-label="Audit lineage">
        <h4 className="text-xs font-semibold text-[var(--text-primary)]">
          Lineage — ward.audit entries for this thread
        </h4>
        {auditState.kind === "loading" ? (
          <p className="text-xs text-[var(--text-muted)]">Reading audit lineage…</p>
        ) : auditState.kind === "blocked" ? (
          <p role="status" className="text-xs text-[var(--text-muted)]">
            <Icon name="ph:shield-slash" aria-hidden /> {auditState.message}
          </p>
        ) : auditState.data.length === 0 ? (
          <p className="text-xs text-[var(--text-muted)]">
            No audit entries reference this thread yet — verified empty, not an error.
          </p>
        ) : (
          <ol className="mt-1 flex flex-col gap-1">
            {annotateLineage(auditState.data, knownProposalIds).map(({ entry, unresolvedProposalRef }) => (
              <li key={entry.id} className="rounded border border-[var(--border,#333)] px-2 py-1 font-mono text-[11px] text-[var(--text-primary)]">
                {lineageLine(entry)}
                {entry.proposalId ? (
                  <span className={`ml-1 ${unresolvedProposalRef ? "text-[var(--warn,#d9a53c)]" : "text-[var(--text-muted)]"}`}>
                    proposal {entry.proposalId}
                    {unresolvedProposalRef ? " (unresolved reference)" : ""}
                  </span>
                ) : null}
                <span className="ml-1 text-[var(--text-muted)]">· recorded {entry.recordedAt}</span>
              </li>
            ))}
          </ol>
        )}
        {auditState.kind === "ready" ? (
          <p className="mt-1 text-[10px] text-[var(--text-muted)]">
            cursor {auditState.meta.sourceCursor} · observed {auditState.meta.observedAt}
          </p>
        ) : null}
      </section>
    </section>
  );
}
