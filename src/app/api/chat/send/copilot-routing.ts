import {
  copilotStreamSpec,
  type CopilotStreamSpec,
} from "../../../../lib/copilot-stream.ts";

export type CopilotChatRouting =
  | { mode: "direct-jsonl"; spec: CopilotStreamSpec; compatibilityDiagnostic: null }
  | { mode: "plain"; spec: null; compatibilityDiagnostic: string | null };

/**
 * Keep the direct JSONL launch behind an explicit, testable capability gate.
 * An unknown, remote, or non-Copilot runtime always follows the generic
 * plain-chat path instead of guessing a stream protocol.
 */
export function resolveCopilotChatRouting(input: {
  harness: string;
  isSshRuntime: boolean;
  capabilityVersion: string | null;
  eventProtocols?: unknown;
}): CopilotChatRouting {
  if (input.isSshRuntime || input.harness !== "copilot") {
    return { mode: "plain", spec: null, compatibilityDiagnostic: null };
  }

  const spec = copilotStreamSpec(input.capabilityVersion, input.eventProtocols);
  if (spec) return { mode: "direct-jsonl", spec, compatibilityDiagnostic: null };

  return {
    mode: "plain",
    spec: null,
    compatibilityDiagnostic:
      "This Copilot CLI version is not yet compatible with Cave tool activity. Chat continues without live tool details; update the Copilot runtime schema or CLI.",
  };
}
