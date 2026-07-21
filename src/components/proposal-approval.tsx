"use client";
// Proposal approval flow (spec §3.7, threads-986.17.6): staged
// DegradeToProposal writes from ~/.coven/pending/, decided by the principal.
// The UI only forwards decisions — the daemon re-validates, applies or
// refuses, audits, and removes the pending file. Every refusal is visible;
// nothing is optimistic.
import { useCallback, useEffect, useId, useState } from "react";
import { Icon } from "@/lib/icon";
import {
  decisionAvailability,
  decisionOutcomeFromResponse,
  editPreviews,
  fraySummary,
  proposalListModel,
  type DecisionOutcome,
} from "@/lib/proposal-flow";
import {
  responseEnvelopeStateAt,
  useResponseEnvelopeFreshness,
} from "@/lib/response-envelope-freshness";
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
      <p role="status" className="mt-1 flex items-center gap-1 text-xs text-[var(--color-success)]">
        <Icon name="ph:check-circle" aria-hidden />
        Decision carried by the daemon ({outcome.decision}) — it re-validated before applying.
      </p>
    );
  }
  return (
    <p role="status" className="mt-1 flex items-center gap-1 text-xs text-[var(--color-danger)]">
      <Icon name="ph:shield-slash" aria-hidden />
      {outcome.message}
    </p>
  );
}

function ProposalAuthorityTrace({ proposal }: { proposal: ProposalView }) {
  const authority = proposal.authority;
  if (!authority || authority.state !== "verified") return null;

  return (
    <dl
      aria-label="Daemon authority trace"
      className="mt-2 grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 rounded border border-[var(--border-hairline)] bg-[var(--bg-raised)] px-2 py-1.5 text-[length:var(--text-xs)]"
    >
      <dt className="text-[var(--text-muted)]">approval path</dt>
      <dd className="font-mono text-[var(--text-primary)]">{authority.approvalPath.label}</dd>
      <dt className="text-[var(--text-muted)]">lifecycle</dt>
      <dd className="font-mono text-[var(--text-primary)]">{authority.lifecycle}</dd>
      <dt className="text-[var(--text-muted)]">affected regions</dt>
      <dd className="font-mono text-[var(--text-primary)]">
        {authority.affectedRegions.length > 0 ? authority.affectedRegions.join(", ") : "none reported"}
      </dd>
      <dt className="text-[var(--text-muted)]">veto deadline</dt>
      <dd className="font-mono text-[var(--text-primary)]">
        {authority.approvalPath.vetoDeadline ?? "not reported"}
      </dd>
      <dt className="text-[var(--text-muted)]">earliest close</dt>
      <dd className="font-mono text-[var(--text-primary)]">{authority.earliestClose ?? "not reported"}</dd>
      <dt className="text-[var(--text-muted)]">blocked reason</dt>
      <dd className="font-mono text-[var(--text-primary)]">{authority.blockedReason ?? "none reported"}</dd>
    </dl>
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
  const availability = decisionAvailability(state, proposal, note);
  const payload = proposal.payload;
  const noteInputId = useId();
  const noteHelpId = useId();
  const approvalRationaleRequired =
    proposal.authority?.state === "verified" &&
    proposal.authority.approvalPath.variant === "human-approval-with-rationale";
  const disabledApproval =
    availability.allowed
      ? availability.actions.find((action) => action.decision === "approve" && !action.enabled)
      : undefined;

  const decide = useCallback(
    async (decision: "approve" | "reject") => {
      const currentAvailability = decisionAvailability(responseEnvelopeStateAt(state), proposal, note);
      if (!payload || submitting || !currentAvailability.allowed) return;
      const action = currentAvailability.actions.find((candidate) => candidate.decision === decision);
      if (!action?.enabled) return;
      setSubmitting(decision);
      setOutcome(null);
      try {
        const res = await fetch(`/api/proposals/${encodeURIComponent(payload.id)}/${decision}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            note: note.trim().length > 0 ? note.trim() : undefined,
            expectedRevision: currentAvailability.expectedRevision,
          }),
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
    [state, proposal, note, payload, submitting, onDecided],
  );

  if (proposal.parse === "corrupt" || !payload) {
    // R6: corrupt staged file — listed, inspectable, never actionable.
    return (
      <li className="rounded border border-[var(--color-danger)]/40 px-3 py-2">
        <p className="flex items-center gap-2 text-sm font-medium text-[var(--text-primary)]">
          <Icon name="ph:shield-slash" aria-hidden />
          Corrupt staged file
        </p>
        <p className="mt-0.5 font-mono text-[length:var(--text-xs)] text-[var(--text-muted)]">{proposal.file}</p>
        <p className="mt-1 text-xs text-[var(--text-muted)]">
          This file in ~/.coven/pending/ does not parse as a proposal. It cannot be approved or
          rejected from here — inspect it on disk before anything else touches it.
        </p>
      </li>
    );
  }

  return (
    <li className="rounded border border-[var(--border-hairline)] px-3 py-2">
      <header className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium text-[var(--text-primary)]">
            {payload.writer} proposes {payload.edits.length} edit{payload.edits.length === 1 ? "" : "s"}
            {payload.channel ? ` via ${payload.channel}` : ""}
          </p>
          <p className="font-mono text-[length:var(--text-xs)] text-[var(--text-muted)]">
            proposal {payload.id} · thread {payload.threadId}
            {payload.stagedAt ? ` · staged ${payload.stagedAt}` : ""}
          </p>
        </div>
      </header>

      <p className="mt-1 text-xs text-[var(--color-warning)]">{fraySummary(proposal)}</p>
      <ProposalAuthorityTrace proposal={proposal} />

      <div className="mt-2 flex flex-col gap-2">
        {editPreviews(proposal).map((edit) => (
          <div key={edit.surface} className="rounded border border-[var(--border-hairline)] bg-[var(--bg-raised)]">
            <p className="border-b border-[var(--border-hairline)] px-2 py-1 font-mono text-[length:var(--text-xs)] text-[var(--text-primary)]">
              {edit.surface}
              <span className="ml-2 text-[var(--text-muted)]">full desired contents ({edit.encoding})</span>
            </p>
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap px-2 py-1.5 text-[length:var(--text-xs)] text-[var(--text-primary)]">
              {edit.preview}
              {edit.truncated ? "\n… (truncated preview — the staged file holds the rest)" : ""}
            </pre>
          </div>
        ))}
      </div>

      {availability.allowed ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <div className="min-w-48 flex-1">
            <label htmlFor={noteInputId} className="block text-xs font-medium text-[var(--text-primary)]">
              Decision note{" "}
              <span className="font-normal text-[var(--text-muted)]">
                ({approvalRationaleRequired ? "required to approve" : "optional"})
              </span>
            </label>
            <input
              id={noteInputId}
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              aria-describedby={noteHelpId}
              aria-required={approvalRationaleRequired}
              className="focus-ring mt-1 w-full rounded border border-[var(--border-hairline)] bg-[var(--bg-raised)] px-2 py-1 text-xs"
            />
            <p id={noteHelpId} className="mt-1 text-xs text-[var(--text-muted)]">
              {disabledApproval
                ? disabledApproval.disabledReason
                : approvalRationaleRequired
                  ? "The rationale will be recorded with approval. Reject remains available without a note."
                  : "Optional note for the audit log."}
            </p>
          </div>
          {availability.actions.map((action) => (
            <button
              key={action.decision}
              type="button"
              disabled={submitting !== null || !action.enabled}
              onClick={() => void decide(action.decision)}
              className={
                action.decision === "approve"
                  ? "focus-ring inline-flex items-center gap-1 rounded border border-[var(--color-success)]/50 px-2 py-1 text-xs font-medium text-[var(--color-success)] hover:bg-[var(--color-success)]/10 disabled:opacity-50"
                  : "focus-ring inline-flex items-center gap-1 rounded border border-[var(--color-danger)]/50 px-2 py-1 text-xs font-medium text-[var(--color-danger)] hover:bg-[var(--color-danger)]/10 disabled:opacity-50"
              }
            >
              <Icon name={action.decision === "approve" ? "ph:check-circle" : "ph:x-circle"} aria-hidden />
              {submitting === action.decision ? "Forwarding…" : action.label}
            </button>
          ))}
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
  const responseState = useResponseEnvelopeFreshness(state);

  const load = useCallback(async () => {
    setState(await fetchProposals());
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (responseState.kind === "loading") {
    return <p className="text-xs text-[var(--text-muted)]">Reading staged proposals…</p>;
  }
  if (responseState.kind === "blocked") {
    return (
      <div role="status" className="rounded border border-[var(--border-strong)] bg-[var(--bg-raised)] px-3 py-4">
        <p className="flex items-center gap-2 text-sm font-medium text-[var(--text-primary)]">
          <Icon name="ph:shield-slash" aria-hidden />
          Blocked — cannot verify staged proposals
        </p>
        <p className="mt-1 text-xs text-[var(--text-muted)]">{responseState.message}</p>
      </div>
    );
  }

  const model = proposalListModel(responseState.data);

  return (
    <div className="flex flex-col gap-3">
      {responseState.banners.map((banner) => (
        <p
          key={banner.kind}
          role="status"
          className="flex items-center gap-2 rounded border border-dashed border-[var(--border-strong)] bg-[var(--bg-raised)] px-2 py-1 text-xs text-[var(--text-muted)]"
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
              state={responseState}
              onDecided={() => void load()}
            />
          ))}
          {model.corrupt.map((proposal) => (
            <ProposalCard
              key={proposal.file}
              proposal={proposal}
              state={responseState}
              onDecided={() => void load()}
            />
          ))}
        </ul>
      )}
      <p className="text-[length:var(--text-2xs)] text-[var(--text-muted)]">
        observed {responseState.meta.observedAt} · cursor {responseState.meta.sourceCursor} · adapter{" "}
        {responseState.meta.adapter}
      </p>
    </div>
  );
}
