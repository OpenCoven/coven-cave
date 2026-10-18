import { createCovenAutomationsClient, CovenClientError, normalizeCovenError } from "@opencoven/coven-client";
import type { CovenAutomationCommandRequest } from "@opencoven/coven-client";
import type { OperationContext } from "@opencoven/sdk-core";
import { callDaemonBytes, type DaemonByteRequest } from "../coven-daemon.ts";

// The SDK's own socket transport bounds: the event page and definition-bearing
// command answers get 1 MiB, every other read or command 16 KiB.
const LARGE_RESPONSE_BYTES = 1_048_576;
const RESPONSE_BYTES = 16_384;

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
        input.action === "coven.automations.events.subscribe.v1" ? LARGE_RESPONSE_BYTES : RESPONSE_BYTES),
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
        input.action === "coven.automations.events.subscribe.v1" ? LARGE_RESPONSE_BYTES : RESPONSE_BYTES),
      sendCommand: (input: CovenAutomationCommandRequest, context) => command(context, input,
        input.envelope.command === "definition.create.v1" || input.envelope.command === "definition.revise.v1"
          ? LARGE_RESPONSE_BYTES : RESPONSE_BYTES),
    },
  });
}
