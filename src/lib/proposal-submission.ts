import type { DaemonResponse } from "./coven-daemon.ts";

export const PROPOSAL_CONTENT_MAX_BYTES = 64 * 1024;
export const PROPOSAL_REQUEST_MAX_BYTES = 512 * 1024;
export type ProposalSubmission = { familiarId: string; target: string; contents: string };
export type SubmissionOutcome =
  | { kind: "applied" }
  | { kind: "staged"; proposalId: string | null }
  | { kind: "held" }
  | { kind: "refused" }
  | { kind: "unavailable" }
  | { kind: "unknown" };

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

export function parseProposalSubmission(value: unknown): ProposalSubmission | null {
  const body = record(value);
  if (!body || Object.keys(body).length !== 3
    || typeof body.familiarId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(body.familiarId)
    || typeof body.target !== "string" || body.target.length === 0 || body.target.length > 1024
    || /[\\\u0000-\u001f:]/.test(body.target)
    || body.target.split("/").some(part => part === "" || part === "." || part === "..")
    || typeof body.contents !== "string"
    || new TextEncoder().encode(body.contents).byteLength > PROPOSAL_CONTENT_MAX_BYTES) return null;
  return { familiarId: body.familiarId, target: body.target, contents: body.contents };
}

/** Only expose confirmed disposition, never arbitrary daemon errors or file contents. */
export function submissionOutcome(response: DaemonResponse<unknown>): SubmissionOutcome {
  const body = record(response.data);
  if (response.ok && body?.ok === true) {
    if (response.status === 200 && body.disposition === "applied") return { kind: "applied" };
    if (response.status === 202 && body.disposition === "held") return { kind: "held" };
    if (response.status === 202 && body.disposition === "staged") {
      const id = body.proposalId;
      return { kind: "staged", proposalId: typeof id === "string"
        && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) ? id : null };
    }
  }
  const code = record(body?.error)?.code;
  if (!response.ok && ((response.status === 403 && ["ward_refused", "protected_proposal_forbidden"].includes(String(code)))
    || (response.status === 404 && code === "familiar_not_found")
    || (response.status === 409 && code === "ward_not_configured"))) return { kind: "refused" };
  // A transport failure or post-write 500 cannot establish that nothing changed.
  return { kind: "unknown" };
}
