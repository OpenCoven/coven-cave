"use client";
// Proposal approval flow (spec §3.7, threads-986.17.6): staged
// DegradeToProposal writes from ~/.coven/pending/, decided by the principal.
// The UI only forwards decisions — the daemon re-validates, applies or
// refuses, audits, and removes the pending file. Every refusal is visible;
// nothing is optimistic.
//
// The queue is a list+detail pair rather than a stack of cards: one decision
// is in front of you at a time, with its authority envelope, its full desired
// contents, and — pinned to the bottom of the pane — the decision itself, so
// the buttons never scroll away from the evidence they act on.
import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { Icon } from "@/lib/icon";
import {
  BlockedSurface,
  SurfaceBanners,
  SurfaceSkeleton,
  ThreadsHeader,
} from "@/components/threads-chrome";
import { StatusPill } from "@/components/weave-rail";
import {
  decisionAvailability,
  decisionOutcomeFromResponse,
  editPreviews,
  fraySummary,
  proposalListModel,
  proposalPill,
  proposalRow,
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
      <p role="status" aria-live="polite" className="wv-outcome wv-outcome--applied">
        <Icon name="ph:check-circle" aria-hidden />
        <span>
          Decision carried by the daemon ({outcome.decision}) — it re-validated before applying. The
          proposal has left the queue and the change is recorded in ward.audit.
        </span>
      </p>
    );
  }
  return (
    <p role="status" aria-live="polite" className="wv-outcome wv-outcome--refused">
      <Icon name="ph:shield-slash" aria-hidden />
      <span>{outcome.message}</span>
    </p>
  );
}

function AuthorityEnvelope({ proposal }: { proposal: ProposalView }) {
  const [open, setOpen] = useState(false);
  const authority = proposal.authority;
  if (!authority || authority.state !== "verified") return null;

  return (
    <section aria-label="Authority envelope">
      <div className="wv-keyfacts">
        <span
          className={`wv-keyfact${authority.lifecycle === "blocked" ? " wv-keyfact--danger" : ""}`}
        >
          <span className="wv-keyfact__label">lifecycle</span>
          {authority.lifecycle}
        </span>
        {authority.approvalPath.vetoDeadline ? (
          <span className="wv-keyfact wv-keyfact--deadline">
            <span className="wv-keyfact__label">veto closes</span>
            {authority.approvalPath.vetoDeadline}
          </span>
        ) : null}
        <button
          type="button"
          className="wv-disclose focus-ring"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          <Icon name="ph:caret-right" className="wv-disclose__caret" aria-hidden />
          Authority details
        </button>
      </div>
      {open ? (
        <dl aria-label="Daemon authority trace" className="wv-authority">
          <dt>approval path</dt>
          <dd>{authority.approvalPath.label}</dd>
          <dt>lifecycle</dt>
          <dd className={authority.lifecycle === "blocked" ? "wv-authority--danger" : undefined}>
            {authority.lifecycle}
          </dd>
          <dt>affected regions</dt>
          <dd>
            {authority.affectedRegions.length > 0
              ? authority.affectedRegions.join(", ")
              : "none reported"}
          </dd>
          <dt>veto deadline</dt>
          <dd
            className={
              authority.approvalPath.vetoDeadline ? "wv-authority--warning" : "wv-authority--muted"
            }
          >
            {authority.approvalPath.vetoDeadline ?? "not reported"}
          </dd>
          <dt>earliest close</dt>
          <dd>{authority.earliestClose ?? "not reported"}</dd>
          <dt>proposal revision</dt>
          <dd>{authority.proposalRevision}</dd>
          <dt>blocked reason</dt>
          <dd className={authority.blockedReason ? "wv-authority--danger" : "wv-authority--muted"}>
            {authority.blockedReason ?? "none reported"}
          </dd>
        </dl>
      ) : null}
    </section>
  );
}

function StagedContents({ proposal }: { proposal: ProposalView }) {
  const previews = editPreviews(proposal);
  const [openSurfaces, setOpenSurfaces] = useState<Record<string, boolean>>({});
  if (previews.length === 0) return null;
  return (
    <section aria-label="Staged contents">
      <div className="wv-section__head">
        <h3 className="wv-eyebrow">Full desired contents</h3>
        <span className="wv-section__aside">
          The whole file as it would be written — not a diff
        </span>
      </div>
      <div className="wv-edits">
        {previews.map((edit) => {
          const open = openSurfaces[edit.surface] ?? previews.length === 1;
          const lines = edit.preview.split("\n").length;
          return (
            <div key={edit.surface} className="wv-edit">
              <button
                type="button"
                className="wv-edit__btn focus-ring-inset"
                aria-expanded={open}
                onClick={() =>
                  setOpenSurfaces((current) => ({ ...current, [edit.surface]: !open }))
                }
              >
                <Icon name="ph:caret-right" className="wv-edit__caret" aria-hidden />
                <span className="wv-edit__surface">{edit.surface}</span>
                <span className="wv-edit__meta">
                  full desired contents ({edit.encoding}) · {lines} line{lines === 1 ? "" : "s"}
                </span>
              </button>
              {open ? (
                <pre className="wv-edit__pre">
                  {edit.preview}
                  {edit.truncated ? "\n… (truncated preview — the staged file holds the rest)" : ""}
                </pre>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function ProposalDetail({
  proposal,
  state,
  onDecided,
  onBack,
}: {
  proposal: ProposalView;
  state: SurfaceState<ProposalView[]>;
  onDecided: () => void;
  onBack: () => void;
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
  const disabledApproval = availability.allowed
    ? availability.actions.find((action) => action.decision === "approve" && !action.enabled)
    : undefined;
  const vetoOnly =
    availability.allowed && availability.actions.every((action) => action.label === "Veto");

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

  const frayState = payload?.fray.state;

  return (
    <section aria-label="Proposal decision" className="wv-pane-detail">
      <div className="wv-detail-body wv-detail-body--proposal">
        <button
          type="button"
          className="wv-ghost wv-only-narrow wv-back-narrow focus-ring"
          onClick={onBack}
        >
          <Icon name="ph:arrow-left" aria-hidden />
          Back to queue
        </button>

        {/* Not .wv-detail-head__main: that carries flex-grow for the weave
            header's ROW layout, and in this column it would swallow the free
            space and push the evidence to the bottom of the pane. */}
        <header className="wv-proposal-head">
          <h2 className="wv-detail-title">
            {proposal.parse === "corrupt" || !payload
              ? "Corrupt staged file"
              : `${payload.writer} proposes ${payload.edits.length} edit${payload.edits.length === 1 ? "" : "s"} to ${payload.familiarId}`}
            <StatusPill pill={proposalPill(proposal)} />
          </h2>
          <p className="wv-ids">
            {proposal.parse === "corrupt" || !payload
              ? proposal.file
              : `proposal ${payload.id} · thread ${payload.threadId}${payload.channel ? ` · via ${payload.channel}` : ""}${payload.stagedAt ? ` · staged ${payload.stagedAt}` : ""}`}
          </p>
        </header>

        {proposal.parse === "corrupt" || !payload ? (
          // R6: corrupt staged file — listed, inspectable, never actionable.
          <p className="wv-why wv-why--snapped">
            <Icon name="ph:shield-slash" aria-hidden />
            <span>
              This file in ~/.coven/pending/ does not parse as a proposal. It is listed so it cannot
              be missed, and it cannot be approved or rejected from here — inspect it on disk before
              anything else touches it.
            </span>
          </p>
        ) : (
          <p className={`wv-why ${frayState === "snapped" ? "wv-why--snapped" : "wv-why--frayed"}`}>
            <Icon name={frayState === "snapped" ? "ph:x-circle" : "ph:warning"} aria-hidden />
            <span>{fraySummary(proposal)}</span>
          </p>
        )}

        <AuthorityEnvelope proposal={proposal} />
        <StagedContents proposal={proposal} />

        <section
          aria-label="Decision"
          className={`wv-decision${availability.allowed ? " wv-decision--live" : ""}`}
        >
          <div className="wv-decision__head">
            <span className="wv-decision__dot" aria-hidden />
            <h3 className="wv-eyebrow">
              {availability.allowed ? "Your decision" : "No decision available"}
            </h3>
          </div>
          {availability.allowed ? (
            <div className="wv-decision__form">
              <div>
                <label htmlFor={noteInputId} className="wv-note-label">
                  Decision note{" "}
                  <span>({approvalRationaleRequired ? "required to approve" : "optional"})</span>
                </label>
                <textarea
                  id={noteInputId}
                  rows={2}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  aria-describedby={noteHelpId}
                  aria-required={approvalRationaleRequired}
                  placeholder={
                    vetoOnly
                      ? "Describe why this write should not stand…"
                      : "Describe why this write should stand…"
                  }
                  className="wv-note focus-ring"
                />
                <p
                  id={noteHelpId}
                  className={`wv-note-help${disabledApproval ? " wv-note-help--required" : ""}`}
                >
                  {disabledApproval
                    ? disabledApproval.disabledReason
                    : approvalRationaleRequired
                      ? "The rationale will be recorded with approval. Reject remains available without a note."
                      : "Optional note for the audit log."}
                </p>
              </div>
              <div className="wv-actions">
                {availability.actions.map((action) => (
                  <button
                    key={action.decision}
                    type="button"
                    disabled={submitting !== null || !action.enabled}
                    onClick={() => void decide(action.decision)}
                    className={`wv-act focus-ring ${action.decision === "approve" ? "wv-act--approve" : "wv-act--reject"}`}
                  >
                    <Icon
                      name={action.decision === "approve" ? "ph:check-circle" : "ph:x-circle"}
                      aria-hidden
                    />
                    {submitting === action.decision ? "Forwarding…" : action.label}
                  </button>
                ))}
                <p className="wv-actions__note">
                  The daemon re-validates before applying. Nothing here is applied optimistically.
                </p>
              </div>
            </div>
          ) : (
            <p role="status" className="wv-refused">
              <Icon name="ph:shield-slash" aria-hidden />
              <span>{availability.reason}</span>
            </p>
          )}
          {outcome ? <OutcomeNote outcome={outcome} /> : null}
        </section>
      </div>
    </section>
  );
}

export function ProposalApproval() {
  const [state, setState] = useState<SurfaceState<ProposalView[]>>({ kind: "loading" });
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [narrowPane, setNarrowPane] = useState<"list" | "detail">("list");
  const responseState = useResponseEnvelopeFreshness(state);

  const load = useCallback(async () => {
    setState({ kind: "loading" });
    setState(await fetchProposals());
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // A weave's "Review it" deep-links straight at the staged write it named, so
  // the operator lands on the decision rather than on a queue to search.
  const requestedProposalId = useMemo(() => {
    if (typeof window === "undefined") return null;
    return new URLSearchParams(window.location.search).get("proposal");
  }, []);

  const model = responseState.kind === "ready" ? proposalListModel(responseState.data) : null;
  const queue = useMemo(() => (model ? [...model.ok, ...model.corrupt] : []), [model]);

  useEffect(() => {
    if (selectedFile !== null || queue.length === 0) return;
    const requested = requestedProposalId
      ? queue.find((proposal) => proposal.payload?.id === requestedProposalId)
      : undefined;
    setSelectedFile((requested ?? queue[0]).file);
    if (requested) setNarrowPane("detail");
  }, [queue, requestedProposalId, selectedFile]);

  const pendingCount = model ? model.ok.length : null;
  const header = (
    <ThreadsHeader
      surface="proposals"
      pendingCount={pendingCount}
      listCollapsed={collapsed}
      onToggleList={() => setCollapsed((value) => !value)}
    />
  );

  if (responseState.kind === "loading") {
    return (
      <div className="wv-page">
        {header}
        <SurfaceSkeleton split={false} label="Reading staged proposals…" />
      </div>
    );
  }

  if (responseState.kind === "blocked") {
    return (
      <div className="wv-page">
        {header}
        <BlockedSurface
          state={responseState}
          title="Blocked — cannot verify staged proposals"
          rule="Decisions stay disabled while the queue is unverifiable. Anything already staged remains staged."
          onRetry={() => void load()}
        >
          <a className="wv-ghost focus-ring" href="/weaves">
            Inspect weaves
          </a>
        </BlockedSurface>
      </div>
    );
  }

  if (queue.length === 0) {
    return (
      <div className="wv-page">
        {header}
        <SurfaceBanners banners={responseState.banners} />
        <div className="wv-center">
          <div role="status" className="wv-verified-empty">
            <span className="wv-verified-empty__seal">
              <Icon name="ph:seal-check" aria-hidden />
            </span>
            <h2>Nothing pending</h2>
            <p>
              No write is waiting on your decision. The daemon answered and the queue is empty —
              Verified empty, not an error.
            </p>
            <a className="wv-ghost focus-ring" href="/weaves">
              <Icon name="ph:arrow-left" aria-hidden />
              Inspect weaves
            </a>
            <p className="wv-blocked__meta">
              observed {responseState.meta.observedAt} · cursor {responseState.meta.sourceCursor} ·
              adapter {responseState.meta.adapter}
            </p>
          </div>
        </div>
      </div>
    );
  }

  const selected = queue.find((proposal) => proposal.file === selectedFile) ?? queue[0];

  return (
    <div className="wv-page">
      {header}
      <div className="wv-strip">
        <p className="wv-strip__lede">
          <b>
            {pendingCount} write{pendingCount === 1 ? " is" : "s are"} waiting on your decision.
          </b>{" "}
          A proposal is data, not authority: decisions are forwarded to the daemon, which
          re-validates before anything is written. This page never applies edits itself.
        </p>
      </div>
      <SurfaceBanners banners={responseState.banners} />

      <div className="wv-grid" data-pane={narrowPane} data-collapsed={collapsed ? "true" : "false"}>
        <section aria-label="Proposal queue" className="wv-pane-list">
          <div className="wv-listhead wv-listhead--tight">
            <h2 className="wv-eyebrow">Queue — oldest first</h2>
            <span className="wv-row__hash">{queue.length} staged</span>
          </div>
          <div className="wv-scroll">
            <ul className="wv-rows">
              {queue.map((proposal) => {
                const row = proposalRow(proposal);
                const isSelected = proposal.file === selected.file;
                return (
                  <li
                    key={row.key}
                    className={`wv-row${isSelected ? " wv-row--sel" : ""}`}
                  >
                    <button
                      type="button"
                      className="wv-row__btn focus-ring-inset"
                      aria-current={isSelected ? "true" : undefined}
                      onClick={() => {
                        setSelectedFile(proposal.file);
                        setNarrowPane("detail");
                      }}
                    >
                      <span className="wv-row__line">
                        <span className="wv-row__name">{row.title}</span>
                        <StatusPill pill={proposalPill(proposal)} />
                      </span>
                      <span className="wv-row__line">
                        <span className="wv-row__meta">{row.surfaces}</span>
                      </span>
                      <span className="wv-row__stamp">
                        <Icon name="ph:clock" aria-hidden />
                        staged {row.stagedAt ?? "(time not reported)"}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
          <p className="wv-footmeta">
            observed {responseState.meta.observedAt} · cursor {responseState.meta.sourceCursor} ·
            adapter {responseState.meta.adapter}
          </p>
        </section>

        <ProposalDetail
          key={selected.file}
          proposal={selected}
          state={responseState}
          onDecided={() => {
            setSelectedFile(null);
            void load();
          }}
          onBack={() => setNarrowPane("list")}
        />
      </div>
    </div>
  );
}
