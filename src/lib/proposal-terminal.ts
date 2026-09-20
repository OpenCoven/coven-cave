import { isRecord, isSafeThreadsId } from "./threads-read.ts";

/** Redacted daemon-owned audit receipt. Never carries an approval action. */
export type ProposalTerminalReceipt = {
  auditId: number;
  proposalId: string;
  terminal: "applied" | "vetoed" | "rejected";
  reason: "applied" | "vetoed" | "evidence_diverged" | "revalidation_failed" | "superseded" | "rejected";
  decidedAt: string;
};

export function normalizeProposalTerminal(row: unknown): ProposalTerminalReceipt | null {
  if (!isRecord(row) || !Number.isSafeInteger(row.id) || Number(row.id) < 1
    || typeof row.proposal_id !== "string" || !isSafeThreadsId(row.proposal_id)
    || typeof row.decided_at !== "string"
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(row.decided_at)
    || !Number.isFinite(Date.parse(row.decided_at)) || !(row.detail === null || typeof row.detail === "string")) return null;
  let detail: unknown;
  try { detail = row.detail === null ? null : JSON.parse(row.detail as string); } catch { return null; }
  const receipt = (terminal: ProposalTerminalReceipt["terminal"], reason: ProposalTerminalReceipt["reason"]): ProposalTerminalReceipt =>
    ({ auditId: Number(row.id), proposalId: row.proposal_id as string, terminal, reason, decidedAt: row.decided_at as string });
  // Human decisions without an opened window have no close detail. Their
  // terminal event is the producer confirmation; no window is invented.
  if (detail === null && row.detail === null) {
    if (row.event_type === "proposal_rejected") return receipt("rejected", "rejected");
    if (row.event_type === "proposal_vetoed") return receipt("vetoed", "vetoed");
    return null;
  }
  if (!isRecord(detail)) return null;
  if (row.event_type === "proposal_approved") {
    if (!["auto", "familiar_review", "human_review", "human_required"].includes(String(detail.approval_path_label))
      || !(detail.rationale === null || typeof detail.rationale === "string")
      || (detail.approval_path_label === "human_required" && !(typeof detail.rationale === "string" && detail.rationale.trim()))) return null;
    if (detail.window_close === null && detail.approval_path_label !== "familiar_review") return receipt("applied", "applied");
  }
  // The producer nests the close detail for approvals and emits it directly
  // for veto/rejection. Do not derive a result from absence in pending/.
  const close = row.event_type === "proposal_approved" ? detail.window_close : detail;
  if (!isRecord(close) || !(close.replay_hash_matched === null || typeof close.replay_hash_matched === "boolean")) return null;
  let terminal: ProposalTerminalReceipt["terminal"];
  let reason: ProposalTerminalReceipt["reason"];
  if (row.event_type === "proposal_approved" && close.reason === "applied" && close.replay_hash_matched === true) {
    terminal = "applied"; reason = "applied";
  } else if (row.event_type === "proposal_vetoed" && close.reason === "vetoed" && close.replay_hash_matched === null) {
    terminal = "vetoed"; reason = "vetoed";
  } else if (row.event_type === "proposal_rejected"
    && (close.reason === "evidence_diverged" || close.reason === "revalidation_failed" || close.reason === "superseded")) {
    terminal = "rejected"; reason = close.reason;
  } else return null;
  return receipt(terminal, reason);
}
