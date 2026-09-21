import { createCovenAutomationsClient, CovenClientError, normalizeCovenError } from "@opencoven/coven-client";
import type { OperationContext } from "@opencoven/sdk-core";
import { callDaemonBytes, type DaemonByteRequest } from "../coven-daemon.ts";

/** Read-only SDK decoding over Cave's existing target/authentication boundary.
 * Validated producer fields are not authenticated authority or receipt proof.
 * Preserve raw bytes, error statuses and cancellation; never replay an action.
 */
export function createAutomationReadClient(transport: typeof callDaemonBytes = callDaemonBytes) {
  async function request(context: OperationContext, body?: { readonly action: string }) {
    context.signal.throwIfAborted();
    // Match the SDK socket adapter's five-minute safety ceiling while honoring
    // an explicit caller deadline longer than Cave's six-second default.
    const remaining = Math.min(300_000, Math.ceil((context.deadline ?? performance.now() + 6_000) - performance.now()));
    if (remaining <= 0) throw new CovenClientError(normalizeCovenError({ code: "timeout" }, "automations.read"));
    const request: DaemonByteRequest = {
      method: body ? "POST" : "GET",
      path: body ? "/api/v1/actions" : "/api/v1/capabilities",
      ...(body ? { body } : {}),
      maxResponseBytes: body?.action === "coven.automations.events.subscribe.v1" ? 1_048_576 : 16_384,
      signal: context.signal,
      timeoutMs: remaining,
      hardTimeoutMs: remaining,
      retryTransportFailure: false,
      diagnosticOperation: body?.action ?? "automations.capabilities",
    };
    const result = await transport(request);
    context.signal.throwIfAborted();
    if (result.status === 0) {
      throw new CovenClientError(normalizeCovenError({ code: "unavailable" }, "automations.read"));
    }
    return { status: result.status, body: result.data ?? new Uint8Array() };
  }
  return createCovenAutomationsClient({
    operation: { timeoutMs: 6_000 },
    transport: {
      capabilities: context => request(context),
      readDefinitions: (input, context) => request(context, input),
    },
  });
}
