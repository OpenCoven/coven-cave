import {
  IN_FLIGHT_VIEWS,
  IN_FLIGHT_VIEW_LIMIT,
  foldInFlight,
  type InFlightOverview,
  type InFlightState,
} from "../automations/in-flight.ts";
import { createAutomationReadClient } from "./coven-automations-sdk.ts";

type ReadClient = Pick<ReturnType<typeof createAutomationReadClient>, "occurrences">;

function errorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
    ? error.code
    : undefined;
}

/**
 * What every automation is doing right now: Coven's four scheduler inspection
 * views (`occurrence.list.v1`), read once each across all automations, in
 * order of urgency. Only the per-automation state, count, oldest slot and
 * whether it came from Run now leave the server.
 */
export async function readAutomationInFlight(
  query: URLSearchParams,
  signal: AbortSignal,
  client: ReadClient = createAutomationReadClient(undefined, { shareCapabilities: true }),
): Promise<InFlightOverview | { kind: "invalid" }> {
  if ([...query.keys()].length > 0) return { kind: "invalid" };
  const views = {} as Record<InFlightState, readonly unknown[]>;
  try {
    for (const view of IN_FLIGHT_VIEWS) {
      views[view] = (await client.occurrences({ view, limit: IN_FLIGHT_VIEW_LIMIT }, { signal })).occurrences;
    }
  } catch (error) {
    const code = errorCode(error);
    return { kind: code === "capability_unsupported" || code === "unsupported_operation" ? "unsupported" : "unavailable" };
  }
  const folded = foldInFlight(views);
  return folded ? { kind: "available", readAt: new Date().toISOString(), ...folded } : { kind: "unavailable" };
}
