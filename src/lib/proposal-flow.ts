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
import type { SurfaceState } from "./weave-rail.ts";
import { decisionsEnabled } from "./weave-rail.ts";

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
  | { kind: "applied"; decision: "approve" | "reject" }
  | { kind: "refused"; decision: "approve" | "reject"; why: string; message: string };

const REFUSAL_MESSAGES: Record<string, string> = {
  "daemon-unavailable": "No daemon to carry the decision — nothing was applied; the proposal stays pending.",
  "daemon-unreachable": "The daemon did not answer — nothing was applied; the proposal stays pending.",
  "daemon-endpoint-missing": "The daemon does not accept decisions yet — nothing was applied.",
  "daemon-timeout": "The daemon timed out — nothing was applied; the proposal stays pending.",
  "proposal-corrupt": "The proposal is corrupt — the decision was not applied.",
  "proposal-refused": "The daemon re-validated and refused the decision — nothing was applied, and the proposal may no longer be pending.",
  "not-found": "No staged proposal by that id — it may already be decided.",
  "invalid-id": "That proposal id is not valid.",
};

export function decisionOutcomeFromResponse(
  decision: "approve" | "reject",
  status: number,
  payload: unknown,
): DecisionOutcome {
  const body = (typeof payload === "object" && payload !== null ? payload : {}) as {
    blocked?: unknown;
    why?: unknown;
  };
  if (status === 200 && body.blocked !== true) {
    return { kind: "applied", decision };
  }
  const why = typeof body.why === "string" ? body.why : `http-${status}`;
  return {
    kind: "refused",
    decision,
    why,
    message: REFUSAL_MESSAGES[why] ?? "The decision was refused — nothing was applied.",
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
