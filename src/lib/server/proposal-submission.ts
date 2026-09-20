import { callDaemon, type DaemonRequest, type DaemonResponse } from "../coven-daemon.ts";
import { submissionOutcome, type ProposalSubmission, type SubmissionOutcome } from "../proposal-submission.ts";

export async function forwardProposalSubmission(
  input: ProposalSubmission,
  options: {
    fixtureMode?: boolean;
    call?: (request: DaemonRequest) => Promise<DaemonResponse<unknown>>;
  } = {},
): Promise<SubmissionOutcome> {
  if (options.fixtureMode ?? process.env.COVEN_THREADS_ADAPTER === "fixtures") return { kind: "unavailable" };
  try {
    const response = await (options.call ?? callDaemon)({
      method: "POST",
      path: `/api/v1/familiars/${encodeURIComponent(input.familiarId)}/edits`,
      body: { edits: [{ target: input.target, contents: input.contents }] },
      retryTransportFailure: false,
      timeoutMs: 15_000,
      hardTimeoutMs: 15_000,
      maxResponseBytes: 256 * 1024,
    });
    return submissionOutcome(response);
  } catch {
    return { kind: "unknown" };
  }
}
