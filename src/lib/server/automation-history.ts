import type { CovenAutomationEvent } from "@opencoven/coven-client";
import type { AutomationHistoryResult } from "../automations/history.ts";
import { createAutomationReadClient } from "./coven-automations-sdk.ts";

const labels: Record<CovenAutomationEvent["kind"], string> = {
  "definition.created": "Definition created", "definition.revised": "Definition revised",
  "definition.activated": "Definition activated", "definition.paused": "Definition paused",
  "definition.disabled": "Definition disabled", "definition.invalidated": "Definition invalidated",
  "definition.tombstoned": "Definition removed", "definition.imported": "Definition imported",
  "occurrence.transitioned": "Occurrence changed", "run.transitioned": "Run changed",
  "attempt.transitioned": "Attempt changed", "occurrence.misfire_recorded": "Missed occurrence recorded",
  "receipt.recorded": "Receipt recorded", "feed.snapshot": "History snapshot",
};
// Display vocabulary only. Transition validity and execution policy stay in Coven.
const states = new Set(["none", "planned", "eligible", "claimed", "dispatching", "running", "recovering",
  "recovery_required", "succeeded", "failed", "cancelled", "timed_out", "skipped", "superseded",
  "adopted", "started", "observing", "ambiguous", "queued", "cancellation_requested"]);

function detail(event: CovenAutomationEvent): string {
  if ("revision" in event.payload) return `Revision ${event.payload.revision}`;
  if ("from" in event.payload) {
    return states.has(event.payload.from) && states.has(event.payload.to)
      ? `${event.payload.from.replaceAll("_", " ")} → ${event.payload.to.replaceAll("_", " ")}`
      : "Unrecognized transition. Inspect daemon diagnostics.";
  }
  if (event.kind === "receipt.recorded") return `Reported outcome: ${event.payload.outcome.replaceAll("_", " ")}. Receipt verification is separate.`;
  if (event.kind === "feed.snapshot") return "Coven recorded a history snapshot.";
  return "Inspect the occurrence for its scheduling disposition.";
}

/** The SDK validates the wire. Project only non-sensitive history metadata;
 * never forward free-text summaries, reasons, snapshot state or authority data.
 */
export async function readAutomationHistory(
  id: string,
  query: URLSearchParams,
  signal: AbortSignal,
  client: Pick<ReturnType<typeof createAutomationReadClient>, "events"> = createAutomationReadClient(),
): Promise<AutomationHistoryResult> {
  const checkpoint = query.get("checkpoint");
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/.test(id) ||
    [...query.keys()].some(key => key !== "checkpoint") || query.getAll("checkpoint").length > 1 ||
    (checkpoint !== null && (!checkpoint.isWellFormed() || Buffer.byteLength(checkpoint) < 1 || Buffer.byteLength(checkpoint) > 512))) {
    return { kind: "invalid" };
  }
  try {
    const page = await client.events({ stream: { kind: "automation", id }, ...(checkpoint === null ? {} : { checkpoint }) }, { signal });
    const visible = page.events.filter(event => event.privacy.classification === "public" || event.privacy.classification === "operational");
    return {
      kind: "available",
      entries: visible.map(event => ({ id: event.eventId, sequence: event.sequence, recordedAt: event.recordedAt,
        label: labels[event.kind], detail: detail(event) })),
      withheld: page.events.length - visible.length,
      checkpoint: page.checkpoint,
      hasEntries: page.events.length > 0,
      readAt: new Date().toISOString(),
    };
  } catch (error) {
    const code = typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
    if (code === "CURSOR_EXPIRED") return { kind: "expired" };
    if (code === "capability_unsupported" || code === "unsupported_operation") return { kind: "unsupported" };
    return { kind: "unavailable" };
  }
}
