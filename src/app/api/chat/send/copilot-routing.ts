import {
  copilotDirectStreamConfigured,
  copilotStreamSpec,
  type CopilotStreamSpec,
} from "../../../../lib/copilot-stream.ts";
import {
  RUNTIME_AVAILABILITY_ERROR_CODES,
  type RuntimeAvailability,
  type RuntimeAvailabilityErrorCode,
} from "../../../../lib/runtime-availability.ts";
import {
  copilotCapabilityFailureMessage,
  type CopilotCapabilityDiagnostic,
} from "../../../../lib/server/copilot-capability-probe.ts";

export type CopilotChatRouting =
  | { mode: "direct-jsonl"; spec: CopilotStreamSpec; compatibilityDiagnostic: null }
  | { mode: "plain"; spec: null; compatibilityDiagnostic: null }
  | {
      mode: "blocked";
      spec: null;
      compatibilityDiagnostic: string;
      failure: Extract<RuntimeAvailability, { state: Exclude<RuntimeAvailability["state"], "ready"> }>;
    };

function blockedFailure(
  state: "probe_failed" | "unsupported_runtime",
  message: string,
): Extract<RuntimeAvailability, { state: Exclude<RuntimeAvailability["state"], "ready"> }> {
  return {
    state,
    runner: "copilot",
    code: RUNTIME_AVAILABILITY_ERROR_CODES[state] as RuntimeAvailabilityErrorCode,
    message,
  };
}

/**
 * Keep the direct JSONL launch behind an explicit, testable capability gate.
 * An unknown, remote, or non-Copilot runtime always follows the generic
 * plain-chat path instead of guessing a stream protocol.
 */
export function resolveCopilotChatRouting(input: {
  harness: string;
  isSshRuntime: boolean;
  capabilityVersion: string | null;
  capabilityDiagnostic?: CopilotCapabilityDiagnostic;
  availability?: RuntimeAvailability;
  launchCommand?: { command: string; fixedArgs: string[] };
  eventProtocols?: unknown;
}): CopilotChatRouting {
  if (input.isSshRuntime || input.harness !== "copilot") {
    return { mode: "plain", spec: null, compatibilityDiagnostic: null };
  }

  const spec = copilotStreamSpec(input.capabilityVersion, input.eventProtocols, input.launchCommand);
  if (spec) return { mode: "direct-jsonl", spec, compatibilityDiagnostic: null };

  // A registry that has not explicitly selected direct JSONL keeps the
  // established Coven transport. Once it does, changing transports after a
  // failed capability/configuration check could run a different launcher than
  // the one just preflighted, so fail closed with runner-specific state.
  if (!copilotDirectStreamConfigured()) {
    return { mode: "plain", spec: null, compatibilityDiagnostic: null };
  }

  if (input.availability && input.availability.state !== "ready") {
    return {
      mode: "blocked",
      spec: null,
      compatibilityDiagnostic: input.availability.message,
      failure: input.availability,
    };
  }

  const capabilityFailure = copilotCapabilityFailureMessage({
    version: input.capabilityVersion,
    diagnostic: input.capabilityDiagnostic,
    availability: input.availability,
  });
  const probeTimedOut = input.capabilityDiagnostic === "probe-timeout";
  const message = capabilityFailure ??
    "This Copilot CLI or JSONL stream configuration is not compatible with Cave chat. Update the Copilot runtime schema or CLI, then try again.";
  return {
    mode: "blocked",
    spec: null,
    compatibilityDiagnostic: message,
    failure: blockedFailure(probeTimedOut ? "probe_failed" : "unsupported_runtime", message),
  };
}

/**
 * Route-level capability preparation with injectable I/O. Keeping the probe
 * and registry functions at this boundary makes the fail-closed launch choice
 * behaviorally testable without starting a local CLI process.
 */
export async function prepareCopilotChatRouting(input: {
  harness: string;
  isSshRuntime: boolean;
  probe: () => Promise<{
    version?: string | null;
    diagnostic?: CopilotCapabilityDiagnostic;
    availability?: RuntimeAvailability;
    launchCommand?: { command: string; fixedArgs: string[] };
  } | null>;
  resolveCompatibility: () => Promise<{ eventProtocols?: unknown } | null>;
}): Promise<CopilotChatRouting> {
  if (input.isSshRuntime || input.harness !== "copilot") {
    return resolveCopilotChatRouting({
      harness: input.harness,
      isSshRuntime: input.isSshRuntime,
      capabilityVersion: null,
    });
  }
  const [capability, compatibility] = await Promise.all([
    input.probe(),
    input.resolveCompatibility(),
  ]);
  return resolveCopilotChatRouting({
    harness: input.harness,
    isSshRuntime: false,
    capabilityVersion: capability?.version ?? null,
    capabilityDiagnostic: capability?.diagnostic,
    availability: capability?.availability,
    launchCommand: capability?.launchCommand,
    eventProtocols: compatibility?.eventProtocols,
  });
}
