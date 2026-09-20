// View-model for the proposal approval flow (threads-986.17.6; spec §3.7).
//
// A staged proposal is data, not authority: the decision routes forward to
// the daemon, which re-validates before anything is applied. This module
// derives everything the surface renders — including exactly when decision
// buttons are allowed to exist. Fail-closed derivations:
// - fixtures mode / stale / blocked surface  -> decisions disabled, reason shown
// - corrupt proposal                          -> both actions disabled (R6)
// - decision failure                          -> visible refusal with its queue consequence

import type { ProposalView } from "./threads-read.ts";
import type { SurfaceState, TensionPill } from "./weave-rail.ts";
import { decisionsEnabled, surfaceStateFromPayload } from "./weave-rail.ts";

export type ProposalListModel = {
  /** Parse-ok proposals, oldest staged first (operator clears the queue in order). */
  ok: ProposalView[];
  /** Corrupt files: listed, inspectable, never actionable (R6). */
  corrupt: ProposalView[];
};

export function proposalListModel(proposals: ProposalView[]): ProposalListModel {
  const ok = proposals
    .filter((p) => p.parse === "ok" && p.payload !== null)
    .sort((a, b) => (a.payload?.stagedAt ?? "").localeCompare(b.payload?.stagedAt ?? ""));
  const corrupt = proposals.filter((p) => p.parse === "corrupt");
  return { ok, corrupt };
}

// ---------------------------------------------------------------------------
// Queue presentation
//
// The pill answers "what does this row want from me?", derived from the
// daemon's own lifecycle — never from a local clock or a guess. A proposal
// whose authority envelope is missing or blocked reads blocked, same rule as
// everywhere else on these surfaces.

export function proposalPill(proposal: ProposalView): TensionPill {
  if (proposal.parse === "corrupt" || !proposal.payload) {
    return {
      tone: "blocked",
      label: "Corrupt",
      detail: "Does not parse as a proposal — inspect it on disk.",
      icon: "ph:shield-slash",
    };
  }
  const authority = proposal.authority;
  if (!authority || authority.state === "blocked") {
    return {
      tone: "blocked",
      label: "Blocked",
      detail: "No verified authority envelope — no decision is available.",
      icon: "ph:shield-slash",
    };
  }
  if (authority.state === "legacy") {
    return {
      tone: "awaiting",
      label: "Decide",
      detail: "A legacy review path — approve or reject it here.",
      icon: "ph:caret-right",
    };
  }
  switch (authority.lifecycle) {
    case "blocked":
      return {
        tone: "snapped",
        label: "Blocked",
        detail: "The daemon reports this proposal blocked — no decision is available.",
        icon: "ph:x-circle",
      };
    case "veto-window-open":
      return {
        tone: "frayed",
        label: "Veto window",
        detail: "This auto-approves unless you veto it before the daemon's deadline.",
        icon: "ph:clock-countdown",
      };
    case "ready-for-replay":
      return {
        tone: "neutral",
        label: "Replay",
        detail: "Ready for replay — no human decision is available.",
        icon: "ph:clock",
      };
    default:
      return {
        tone: "awaiting",
        label: "Decide",
        detail: "A decision is available on fresh daemon evidence.",
        icon: "ph:caret-right",
      };
  }
}

/** One queue row: what it touches and when it was staged, never a diff stat. */
export function proposalRow(proposal: ProposalView): {
  key: string;
  title: string;
  surfaces: string;
  stagedAt: string | null;
} {
  const payload = proposal.payload;
  if (proposal.parse === "corrupt" || !payload) {
    return { key: proposal.file, title: "Corrupt staged file", surfaces: proposal.file, stagedAt: null };
  }
  const edits = payload.edits.length;
  return {
    key: proposal.file,
    title: `${payload.writer} → ${payload.familiarId}`,
    surfaces: `${edits} edit${edits === 1 ? "" : "s"} · ${payload.edits.map((e) => e.surface).join(", ")}`,
    stagedAt: payload.stagedAt,
  };
}

// ---------------------------------------------------------------------------
// Decision availability

export type ProposalDecision = "approve" | "reject";

export type DecisionAction = {
  decision: ProposalDecision;
  label: "Approve" | "Reject" | "Veto";
  enabled: boolean;
  disabledReason?: string;
};

export type DecisionAvailability =
  | { allowed: true; actions: DecisionAction[]; expectedRevision?: string }
  | { allowed: false; actions: []; reason: string };

function decisionsUnavailable(reason: string): DecisionAvailability {
  return { allowed: false, actions: [], reason };
}

/**
 * A decision may only be offered when the surface is fresh, verified, and the
 * daemon is the adapter — approving against fixtures or stale state would be
 * deciding on evidence nobody verified (R5/R9).
 */
export function decisionAvailability(
  state: SurfaceState<ProposalView[]>,
  proposal: ProposalView,
  note = "",
): DecisionAvailability {
  if (proposal.parse === "corrupt") {
    return decisionsUnavailable(
      "This staged file is corrupt — it cannot be approved or rejected; inspect it on disk.",
    );
  }
  if (state.kind !== "ready") {
    return decisionsUnavailable("The proposals list is blocked — decisions need verified state.");
  }
  if (state.meta.adapter === "fixtures") {
    return decisionsUnavailable(
      "Fixture data — there is no daemon to carry a decision. Approvals stay disabled.",
    );
  }
  if (!decisionsEnabled(state)) {
    return decisionsUnavailable("This view is stale — refresh before deciding.");
  }

  const authority = proposal.authority;
  if (!authority) {
    return decisionsUnavailable("This proposal has no verified authority envelope — decisions stay disabled.");
  }
  if (authority.state === "blocked") {
    return decisionsUnavailable(`Proposal authority is blocked (${authority.why}) — no decision is available.`);
  }
  if (authority.state === "legacy") {
    return {
      allowed: true,
      actions: [
        { decision: "approve", label: "Approve", enabled: true },
        { decision: "reject", label: "Reject", enabled: true },
      ],
    };
  }

  if (authority.lifecycle === "ready-for-replay") {
    return decisionsUnavailable("This proposal is ready for replay — no human decision is available.");
  }
  if (authority.lifecycle === "blocked") {
    return decisionsUnavailable("The daemon reports this proposal blocked — no decision is available.");
  }
  if (authority.lifecycle === "veto-window-open") {
    if (
      authority.availableDecisions.length !== 1 ||
      authority.availableDecisions[0] !== "reject"
    ) {
      return decisionsUnavailable("The veto authority envelope is inconsistent — no decision is available.");
    }
    return {
      allowed: true,
      expectedRevision: authority.proposalRevision,
      actions: [{ decision: "reject", label: "Veto", enabled: true }],
    };
  }

  const actions = authority.availableDecisions.map<DecisionAction>((decision) => {
    if (decision === "approve") {
      const enabled =
        authority.approvalPath.variant !== "human-approval-with-rationale" ||
        note.trim().length > 0;
      return {
        decision,
        label: "Approve",
        enabled,
        ...(enabled
          ? {}
          : {
              disabledReason:
                "Approval is disabled until you add a rationale. Reject remains available without a note.",
            }),
      };
    }
    return { decision, label: "Reject", enabled: true };
  });
  if (actions.length === 0) {
    return decisionsUnavailable("The daemon offers no human decision for this proposal.");
  }
  return {
    allowed: true,
    expectedRevision: authority.proposalRevision,
    actions,
  };
}

// ---------------------------------------------------------------------------
// Decision outcome from the POST response (route §3.7 status mapping)

export type DecisionOutcome =
  | { kind: "confirmed"; decision: "approve" | "reject"; terminal: "approved" | "rejected" | "vetoed" | "superseded" }
  | { kind: "refused" | "unconfirmed"; decision: "approve" | "reject"; why: string; message: string };

/** Uncertain writes survive selection changes until a fresh authoritative read. */
export function reconcileDecisionOutcomes(
  current: ReadonlyMap<string, DecisionOutcome>,
  event: { kind: "outcome"; proposalId: string; outcome: DecisionOutcome }
    | { kind: "refresh"; state: SurfaceState<unknown>; covered: ReadonlyMap<string, DecisionOutcome> },
): ReadonlyMap<string, DecisionOutcome> {
  if (event.kind === "refresh") {
    if (!decisionsEnabled(event.state)) return current;
    return new Map([...current].filter(([id, outcome]) => event.covered.get(id) !== outcome));
  }
  if (event.outcome.kind !== "unconfirmed") return current;
  return new Map(current).set(event.proposalId, event.outcome);
}

const REFUSAL_MESSAGES: Record<string, string> = {
  "daemon-endpoint-missing": "The daemon does not accept decisions yet. Update the daemon before trying again.",
  "proposal-corrupt": "The proposal is corrupt. Inspect its source before deciding.",
  "proposal-refused": "The daemon refused the decision. Refresh to inspect its current state.",
  "not-found": "No staged proposal by that id. Refresh to inspect the current state.",
  "invalid-id": "That proposal id is not valid. Refresh the proposal list.",
};

function outcomeRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

export function decisionOutcomeFromResponse(
  decision: "approve" | "reject",
  status: number,
  payload: unknown,
  proposalId: string,
): DecisionOutcome {
  const body = outcomeRecord(payload);
  const data = outcomeRecord(body?.data);
  const meta = outcomeRecord(body?.meta);
  const terminal = data?.decision;
  const matchesDecision = decision === "approve"
    ? terminal === "approved"
    : terminal === "rejected" || terminal === "vetoed" || terminal === "superseded";
  if (
    status === 200 && body?.blocked === false && meta?.adapter === "daemon"
    && decisionsEnabled(surfaceStateFromPayload(payload))
    && data?.ok === true && proposalId.length > 0 && data.proposalId === proposalId && matchesDecision
  ) {
    return { kind: "confirmed", decision, terminal: terminal as "approved" | "rejected" | "vetoed" | "superseded" };
  }
  const why = typeof body?.why === "string" ? body.why : `http-${status}`;
  const refusal = body?.blocked === true && status !== 200 ? REFUSAL_MESSAGES[why] : undefined;
  return {
    kind: refusal ? "refused" : "unconfirmed",
    decision,
    why,
    message: refusal ?? "The decision outcome is not confirmed. Refresh and inspect the daemon’s current state before deciding again.",
  };
}

// ---------------------------------------------------------------------------
// Edits preview (§2.6: full desired contents, never diffs)

export type EditPreview = {
  surface: string;
  encoding: "utf8" | "base64";
  /** utf8: the contents; base64: a size label — binary is not pretty-printed. */
  preview: string;
  truncated: boolean;
};

const PREVIEW_LIMIT = 2000;

export function editPreviews(proposal: ProposalView): EditPreview[] {
  if (!proposal.payload) return [];
  return proposal.payload.edits.map((edit) => {
    if (edit.contents.encoding === "base64") {
      const bytes = Math.floor((edit.contents.data.length * 3) / 4);
      return {
        surface: edit.surface,
        encoding: "base64",
        preview: `(binary contents, ~${bytes} bytes base64-staged)`,
        truncated: false,
      };
    }
    const text = edit.contents.data;
    const truncated = text.length > PREVIEW_LIMIT;
    return {
      surface: edit.surface,
      encoding: "utf8",
      preview: truncated ? text.slice(0, PREVIEW_LIMIT) : text,
      truncated,
    };
  });
}

/** One referent-bound line describing why this write was degraded to a proposal. */
export function fraySummary(proposal: ProposalView): string {
  const fray = proposal.payload?.fray;
  if (!fray) return "Staged after a gate verdict.";
  if (fray.state === "frayed") {
    return `Degraded to a proposal: the thread frayed (${fray.reason.kind}) on ${fray.channel ?? "an unrecognized channel"} — the write was staged instead of applied.`;
  }
  if (fray.state === "snapped") {
    return `Staged while the thread was snapped (${fray.reason.kind}) — nothing can apply until a fresh authority ceremony.`;
  }
  return "Staged after a gate verdict this surface cannot fully verify — decide with care.";
}
