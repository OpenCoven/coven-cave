"use client";
// Strand inspection (spec §3 route 4, threads-986.17.5): per-strand detail
// for all five kinds; on a Frayed thread the blamed strand renders the
// current-vs-expected diff; lineage deep-links strand → ward_audit entries.
//
// This is the body of an opened thread row rather than a third pane: the
// question "why did this thread fray?" is answered where the fray is named,
// so nothing about one thread's verdict lives a scroll away from the verdict.
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
    <div aria-label="Current vs expected" className="wv-diff">
      <p className="wv-diff__title">
        <Icon name="ph:warning" aria-hidden />
        current vs expected
      </p>
      <dl>
        <dt>expected</dt>
        <dd className="wv-diff__expected">{diff.expected || "(empty)"}</dd>
        <dt>observed</dt>
        <dd className={diff.observed === null ? "wv-diff__unobserved" : "wv-diff__observed"}>
          {diff.observed === null
            ? "(could not observe — treated as blocked, not healthy)"
            : diff.observed || "(empty)"}
        </dd>
        <dt>observed at</dt>
        <dd className="wv-diff__at">{diff.observedAt ?? "(unknown)"}</dd>
      </dl>
    </div>
  );
}

export function StrandInspector({
  thread,
  knownProposalIds,
  auditState,
  onTraceThread,
}: {
  thread: ThreadView;
  knownProposalIds: ReadonlySet<string>;
  /**
   * ward.audit for THIS thread, read once per weave by the view and passed
   * down. Re-reading it here duplicated a request the parent had already made
   * for every thread in the weave. It stays a SurfaceState so a thread whose
   * audit read was blocked still says so in its own lineage rather than
   * borrowing a neighbour's verified-empty.
   */
  auditState: SurfaceState<AuditEntryView[]>;
  onTraceThread: () => void;
}) {
  const [strandsState, setStrandsState] = useState<SurfaceState<StrandView[]>>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    setStrandsState({ kind: "loading" });
    void fetchSurface<StrandView[]>(`/api/threads/${encodeURIComponent(thread.id)}/strands`).then(
      (state) => {
        if (!cancelled) setStrandsState(state);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [thread.id]);

  const blamed = blamedStrandId(thread.tension);

  return (
    <div className="wv-thread__body">
      <section aria-label="Strand inspection">
        <div className="wv-subhead">
          <h4>Strands</h4>
          <span className="wv-subhead__rule">
            Each strand is one fiber of commitment — a thread survives a channel only if its
            strands survive that channel
          </span>
          <button type="button" className="wv-ghost wv-ghost--sm focus-ring" onClick={onTraceThread}>
            <Icon name="ph:path" aria-hidden />
            Trace verdict
          </button>
        </div>

        {strandsState.kind === "loading" ? (
          <p className="wv-quiet">Reading strands…</p>
        ) : strandsState.kind === "blocked" ? (
          <p role="status" className="wv-quiet">
            <Icon name="ph:shield-slash" aria-hidden /> {strandsState.message}
          </p>
        ) : (
          <ul className="wv-strands">
            {strandsState.data.length === 0 ? (
              <li className="wv-chips__none">
                No strands — this thread carries no commitments, so required-strand checks fray it on
                every structured channel.
              </li>
            ) : (
              strandsState.data.map((strand) => {
                const isBlamed = strand.id === blamed;
                return (
                  <li key={strand.id} className={`wv-strand${isBlamed ? " wv-strand--blamed" : ""}`}>
                    <div className="wv-strand__head">
                      <Icon
                        name={isBlamed ? "ph:warning" : "ph:seal-check"}
                        className={isBlamed ? "wv-strand__warn" : "wv-strand__seal"}
                        aria-hidden
                      />
                      <span className="wv-strand__kind">{strand.kind}</span>
                      {isBlamed ? (
                        <span className="wv-blamed-badge">
                          <Icon name="ph:warning" aria-hidden />
                          blamed by the fray
                        </span>
                      ) : null}
                    </div>
                    <dl className="wv-dl">
                      {strandDetailRows(strand).map((row) => (
                        <div key={row.label} className="contents">
                          <dt>{row.label}</dt>
                          <dd>{row.value}</dd>
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
      </section>

      <section aria-label="Audit lineage">
        <h4 className="wv-subhead__title-only">Lineage — ward.audit entries for this thread</h4>
        {auditState.kind === "loading" ? (
          <p className="wv-quiet">Reading audit lineage…</p>
        ) : auditState.kind === "blocked" ? (
          <p role="status" className="wv-quiet">
            <Icon name="ph:shield-slash" aria-hidden /> {auditState.message}
          </p>
        ) : auditState.data.length === 0 ? (
          <p className="wv-quiet">
            No audit entries reference this thread yet — verified empty, not an error.
          </p>
        ) : (
          <ol className="wv-lineage">
            {annotateLineage(auditState.data, knownProposalIds).map(
              ({ entry, unresolvedProposalRef }) => (
                <li key={entry.id}>
                  <span>{lineageLine(entry)}</span>
                  {entry.proposalId ? (
                    <a
                      className={`wv-lineage__ref${unresolvedProposalRef ? " wv-lineage__ref--unresolved" : ""}`}
                      href={`/proposals?proposal=${encodeURIComponent(entry.proposalId)}`}
                    >
                      proposal {entry.proposalId}
                      {unresolvedProposalRef ? " (unresolved reference)" : ""}
                    </a>
                  ) : null}
                  <span className="wv-lineage__ref">· recorded {entry.recordedAt}</span>
                </li>
              ),
            )}
          </ol>
        )}
        {auditState.kind === "ready" ? (
          <p className="wv-blocked__meta">
            cursor {auditState.meta.sourceCursor} · observed {auditState.meta.observedAt}
          </p>
        ) : null}
      </section>
    </div>
  );
}
