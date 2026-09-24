import type { ProposalSubmission, SubmissionOutcome } from "./proposal-submission.ts";

export const SUBMISSION_MARKER = "cave:proposal-submission:unconfirmed:v1";
export type SubmissionSnapshot = {
  phase: "checking" | "idle" | "pending" | "settled";
  outcome: SubmissionOutcome | null;
};
export const INITIAL_SUBMISSION: SubmissionSnapshot = { phase: "checking", outcome: null };
type MarkerStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** A tab-scoped uncertainty marker contains no familiar, path or file contents. */
export class ProposalSubmissionController {
  private snapshot = INITIAL_SUBMISSION;
  private listeners = new Set<() => void>();
  private readonly storage: MarkerStorage;
  constructor(storage: MarkerStorage) { this.storage = storage; }
  getSnapshot = (): SubmissionSnapshot => this.snapshot;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  private publish(snapshot: SubmissionSnapshot) {
    this.snapshot = snapshot;
    for (const listener of this.listeners) listener();
  }
  hydrate() {
    if (this.snapshot.phase !== "checking") return;
    try {
      this.publish(this.storage.getItem(SUBMISSION_MARKER) === null
        ? { phase: "idle", outcome: null }
        : { phase: "settled", outcome: { kind: "unknown" } });
    } catch {
      this.publish({ phase: "settled", outcome: { kind: "unavailable" } });
    }
  }
  async submit(input: ProposalSubmission, send: (input: ProposalSubmission) => Promise<SubmissionOutcome>): Promise<boolean> {
    if (this.snapshot.phase !== "idle") return false;
    try {
      // Record before sending: a reload cannot silently unlock a lost write.
      this.storage.setItem(SUBMISSION_MARKER, "1");
    } catch {
      this.publish({ phase: "settled", outcome: { kind: "unavailable" } });
      return false;
    }
    this.publish({ phase: "pending", outcome: null });
    let outcome: SubmissionOutcome;
    try { outcome = await send(input); } catch { outcome = { kind: "unknown" }; }
    if (outcome.kind !== "unknown") {
      try { this.storage.removeItem(SUBMISSION_MARKER); } catch { /* Keep conservative reload guard. */ }
    }
    this.publish({ phase: "settled", outcome });
    return true;
  }
  /** Explicit user reconciliation/new-edit action; never called on refresh or remount. */
  reset(): boolean {
    if (this.snapshot.phase !== "settled") return false;
    try { this.storage.removeItem(SUBMISSION_MARKER); } catch { return false; }
    this.publish({ phase: "idle", outcome: null });
    return true;
  }
}

export function parseSubmissionResponse(status: number, value: unknown): SubmissionOutcome {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return { kind: "unknown" };
  const data = value as Record<string, unknown>;
  if (status === 503 && data.kind === "unavailable") return { kind: "unavailable" };
  if (status !== 200) return { kind: "unknown" };
  if (data.kind === "applied" || data.kind === "held" || data.kind === "refused") return { kind: data.kind };
  if (data.kind === "staged" && (data.proposalId === null || (typeof data.proposalId === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(data.proposalId)))) {
    return { kind: "staged", proposalId: data.proposalId };
  }
  return { kind: "unknown" };
}
