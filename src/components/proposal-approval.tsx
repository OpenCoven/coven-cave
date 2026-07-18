"use client";
// Proposal approval flow (spec §3.7, threads-986.17.6): staged
// DegradeToProposal writes from ~/.coven/pending/, decided by the principal.
// The UI only forwards decisions — the daemon re-validates, applies or
// refuses, audits, and removes the pending file. Every refusal is visible;
// nothing is optimistic.
import { useCallback, useEffect, useState } from "react";
import { Icon } from "@/lib/icon";
import {
  decisionAvailability,
  decisionOutcomeFromResponse,
  editPreviews,
  fraySummary,
  proposalListModel,
  type DecisionOutcome,
} from "@/lib/proposal-flow";
import type { ProposalView } from "@/lib/threads-read";
import { blockedMessage, surfaceStateFromPayload, type SurfaceState } from "@/lib/weave-rail";

async function fetchProposals(): Promise<SurfaceState<ProposalView[]>> {
  try {
    const res = await fetch("/api/proposals", { cache: "no-store" });
    return surfaceStateFromPayload<ProposalView[]>(await res.json());
  } catch {
    return {
      kind: "blocked",
      why: "daemon-unreachable",
      message: blockedMessage("daemon-unreachable"),
      meta: null,
    };
  }
}

function OutcomeNote({ outcome }: { outcome: DecisionOutcome }) {
  if (outcome.kind === "applied") {
    return (
      <p role="status" className="mt-1 flex items-center gap-1 text-xs text-[var(--ok,#4dbd7a)]">
        <Icon name="ph:check-circle" aria-hidden />
        Decision carried by the daemon ({outcome.decision}) — it re-validated before applying.
      </p>
    );
  }
  return (
    <p role="status" className="mt-1 flex items-center gap-1 text-xs text-[var(--danger,#d95a5a)]">
      <Icon name="ph:shield-slash" aria-hidden />
      {outcome.message}
    </p>
  );
}

function ProposalCard({
  proposal,
  state,
  onDecided,
}: {
  proposal: ProposalView;
  state: SurfaceState<ProposalView[]>;
  onDecided: () => void;
}) {
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState<"approve" | "reject" | null>(null);
  const [outcome, setOutcome] = useState<DecisionOutcome | null>(null);
  const availability = decisionAvailability(state, proposal);
  const payload = proposal.payload;

  const decide = useCallback(
    async (decision: "approve" | "reject") => {
      if (!payload || submitting) return;
      setSubmitting(decision);
      setOutcome(null);
      try {
        const res = await fetch(`/api/proposals/${encodeURIComponent(payload.id)}/${decision}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(note.trim().length > 0 ? { note: note.trim() } : {}),
        });
        const body: unknown = await res.json().catch(() => null);
        const result = decisionOutcomeFromResponse(decision, res.status, body);
        setOutcome(result);
        if (result.kind === "applied") onDecided();
      } catch {
        setOutcome(decisionOutcomeFromResponse(decision, 0, { blocked: true, why: "daemon-unreachable" }));
      } finally {
        setSubmitting(null);
      }
    },
    [payload, note, submitting, onDecided],
  );

  if (proposal.parse === "corrupt" || !payload) {
    // R6: corrupt staged file — listed, inspectable, never actionable.
    return (
      <li className="rounded border border-[var(--danger,#d95a5a)]/40 px-3 py-2">
        <p className="flex items-center gap-2 text-sm font-medium text-[var(--text-primary)]">
          <Icon name="ph:shield-slash" aria-hidden />
          Corrupt staged file
        </p>
        <p className="mt-0.5 font-mono text-[11px] text-[var(--text-muted)]">{proposal.file}</p>
        <p className="mt-1 text-xs text-[var(--text-muted)]">
          This file in ~/.coven/pending/ does not parse as a proposal. It cannot be approved or
          rejected from here — inspect it on disk before anything else touches it.
        </p>
      </li>
    );
  }

  return (
    <li className="rounded border border-[var(--border,#333)] px-3 py-2">
      <header className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium text-[var(--text-primary)]">
            {payload.writer} proposes {payload.edits.length} edit{payload.edits.length === 1 ? "" : "s"}
            {payload.channel ? ` via ${payload.channel}` : ""}
          </p>
          <p className="font-mono text-[11px] text-[var(--text-muted)]">
            proposal {payload.id} · thread {payload.threadId}
            {payload.stagedAt ? ` · staged ${payload.stagedAt}` : ""}
          </p>
        </div>
      </header>

      <p className="mt-1 text-xs text-[var(--warn,#d9a53c)]">{fraySummary(proposal)}</p>

      <div className="mt-2 flex flex-col gap-2">
        {editPreviews(proposal).map((edit) => (
          <div key={edit.surface} className="rounded border border-[var(--border,#333)] bg-[var(--bg-raised)]">
            <p className="border-b border-[var(--border,#333)] px-2 py-1 font-mono text-[11px] text-[var(--text-primary)]">
              {edit.surface}
              <span className="ml-2 text-[var(--text-muted)]">full desired contents ({edit.encoding})</span>
            </p>
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap px-2 py-1.5 text-[11px] text-[var(--text-primary)]">
              {edit.preview}
              {edit.truncated ? "\n… (truncated preview — the staged file holds the rest)" : ""}
            </pre>
          </div>
        ))}
      </div>

      {availability.allowed ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="optional note for the audit log"
            aria-label="Decision note"
            className="focus-ring min-w-48 flex-1 rounded border border-[var(--border,#333)] bg-[var(--bg-raised)] px-2 py-1 text-xs"
          />
          <button
            type="button"
            disabled={submitting !== null}
            onClick={() => void decide("approve")}
            className="focus-ring inline-flex items-center gap-1 rounded border border-[var(--ok,#4dbd7a)]/50 px-2 py-1 text-xs font-medium text-[var(--ok,#4dbd7a)] hover:bg-[var(--ok,#4dbd7a)]/10 disabled:opacity-50"
          >
            <Icon name="ph:check-circle" aria-hidden />
            {submitting === "approve" ? "Forwarding…" : "Approve"}
          </button>
          <button
            type="button"
            disabled={submitting !== null}
            onClick={() => void decide("reject")}
            className="focus-ring inline-flex items-center gap-1 rounded border border-[var(--danger,#d95a5a)]/50 px-2 py-1 text-xs font-medium text-[var(--danger,#d95a5a)] hover:bg-[var(--danger,#d95a5a)]/10 disabled:opacity-50"
          >
            <Icon name="ph:x-circle" aria-hidden />
            {submitting === "reject" ? "Forwarding…" : "Reject"}
          </button>
        </div>
      ) : (
        <p role="status" className="mt-2 flex items-center gap-1 text-xs text-[var(--text-muted)]">
          <Icon name="ph:shield-slash" aria-hidden />
          {availability.reason}
        </p>
      )}
      {outcome ? <OutcomeNote outcome={outcome} /> : null}
    </li>
  );
}

export function ProposalApproval() {
  const [state, setState] = useState<SurfaceState<ProposalView[]>>({ kind: "loading" });

  const load = useCallback(async () => {
    setState(await fetchProposals());
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (state.kind === "loading") {
    return <p className="text-xs text-[var(--text-muted)]">Reading staged proposals…</p>;
  }
  if (state.kind === "blocked") {
    return (
      <div role="status" className="rounded border border-[var(--border-strong,#555)] bg-[var(--bg-raised)] px-3 py-4">
        <p className="flex items-center gap-2 text-sm font-medium text-[var(--text-primary)]">
          <Icon name="ph:shield-slash" aria-hidden />
          Blocked — cannot verify staged proposals
        </p>
        <p className="mt-1 text-xs text-[var(--text-muted)]">{state.message}</p>
      </div>
    );
  }

  const model = proposalListModel(state.data);

  return (
    <div className="flex flex-col gap-3">
      {state.banners.map((banner) => (
        <p
          key={banner.kind}
          role="status"
          className="flex items-center gap-2 rounded border border-dashed border-[var(--border-strong,#555)] bg-[var(--bg-raised)] px-2 py-1 text-xs text-[var(--text-muted)]"
        >
          <Icon name={banner.kind === "stale" ? "ph:clock-countdown" : "ph:flask"} aria-hidden />
          {banner.message}
        </p>
      ))}

      {model.ok.length === 0 && model.corrupt.length === 0 ? (
        <p className="text-xs text-[var(--text-muted)]">
          Nothing pending — no writes are waiting on your decision. Verified empty, not an error.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {model.ok.map((proposal) => (
            <ProposalCard
              key={proposal.file}
              proposal={proposal}
              state={state}
              onDecided={() => void load()}
            />
          ))}
          {model.corrupt.map((proposal) => (
            <ProposalCard
              key={proposal.file}
              proposal={proposal}
              state={state}
              onDecided={() => void load()}
            />
          ))}
        </ul>
      )}
      <p className="text-[10px] text-[var(--text-muted)]">
        observed {state.meta.observedAt} · cursor {state.meta.sourceCursor} · adapter {state.meta.adapter}
      </p>
    </div>
  );
}
