import { createCovenAutomationsClient, CovenClientError, normalizeCovenError } from "@opencoven/coven-client";
import type { CovenAutomationCommandRequest } from "@opencoven/coven-client";
import type { OperationContext } from "@opencoven/sdk-core";
import { callDaemonBytes, type DaemonByteRequest } from "../coven-daemon.ts";

// Match the pinned SDK's action-specific socket/decoder budgets. Narrow
// capability/control replies stay small; definition-bearing reads are bounded
// separately so supported prompts remain readable after creation.
const LARGE_RESPONSE_BYTES = 1_048_576;
const RESPONSE_BYTES = 16_384;

function readResponseBytes(action: string): number {
  if (action === "coven.automations.definition.list.v1" || action === "coven.automations.runs") return 4_194_304;
  if (action === "coven.automations.definition.get.v1" || action === "coven.automations.run.get.v1"
    || action === "coven.automations.events.subscribe.v1") return LARGE_RESPONSE_BYTES;
  if (action === "coven.automations.occurrence.history.v1" || action === "coven.automations.run.history.v1") return 262_144;
  return RESPONSE_BYTES;
}

function boundedRequest(transport: typeof callDaemonBytes, operation: string) {
  return async (context: OperationContext, body?: { readonly action: string }, maxResponseBytes = RESPONSE_BYTES) => {
    context.signal.throwIfAborted();
    // Match the SDK socket adapter's five-minute safety ceiling while honoring
    // an explicit caller deadline longer than Cave's six-second default.
    const remaining = Math.min(300_000, Math.ceil((context.deadline ?? performance.now() + 6_000) - performance.now()));
    if (remaining <= 0) throw new CovenClientError(normalizeCovenError({ code: "timeout" }, operation));
    const request: DaemonByteRequest = {
      method: body ? "POST" : "GET",
      path: body ? "/api/v1/actions" : "/api/v1/capabilities",
      ...(body ? { body } : {}),
      maxResponseBytes,
      signal: context.signal,
      timeoutMs: remaining,
      hardTimeoutMs: remaining,
      retryTransportFailure: false,
      diagnosticOperation: body?.action ?? "automations.capabilities",
    };
    const result = await transport(request);
    context.signal.throwIfAborted();
    if (result.status === 0) {
      throw new CovenClientError(normalizeCovenError({ code: "unavailable" }, operation));
    }
    return { status: result.status, body: result.data ?? new Uint8Array() };
  };
}

/** Read-only SDK decoding over Cave's existing target/authentication boundary.
 * Validated producer fields are not authenticated authority or receipt proof.
 * Preserve raw bytes, error statuses and cancellation; never replay an action.
 */
export function createAutomationReadClient(
  transport: typeof callDaemonBytes = callDaemonBytes,
  { shareCapabilities = false }: {
    /** Answer every read with the first capabilities reply, for one bounded
     * projection that reads many definitions. A failed reply is not kept. */
    shareCapabilities?: boolean;
  } = {},
) {
  const request = boundedRequest(transport, "automations.read");
  let shared: Promise<{ status: number; body: Uint8Array }> | undefined;
  const capabilities = (context: OperationContext) => {
    if (!shareCapabilities) return request(context);
    shared ??= request(context).catch((error: unknown) => {
      shared = undefined;
      throw error;
    });
    return shared;
  };
  return createCovenAutomationsClient({
    operation: { timeoutMs: 6_000 },
    transport: {
      capabilities,
      readDefinitions: (input, context) => request(context, input,
        readResponseBytes(input.action)),
    },
  });
}

/** The read client plus the SDK's lifecycle command envelopes. A command is
 * sent at most once by this transport: a lost answer surfaces as the SDK's
 * `outcome_unknown`, and only the caller may resend it under the same
 * adoption key. Recorded principals are provenance, never an authority grant.
 */
export function createAutomationCommandClient(transport: typeof callDaemonBytes = callDaemonBytes) {
  const read = boundedRequest(transport, "automations.read");
  const command = boundedRequest(transport, "automations.command");
  return createCovenAutomationsClient({
    operation: { timeoutMs: 6_000 },
    transport: {
      capabilities: context => read(context),
      readDefinitions: (input, context) => read(context, input,
        readResponseBytes(input.action)),
      sendCommand: (input: CovenAutomationCommandRequest, context) => command(context, input,
        input.envelope.command === "definition.create.v1" || input.envelope.command === "definition.revise.v1"
          ? LARGE_RESPONSE_BYTES : RESPONSE_BYTES),
    },
  });
}
