import {
  OCCURRENCE_ENTITY_ID_PATTERN,
  OCCURRENCE_PAGE_SIZE,
  projectOccurrence,
  projectOccurrenceDetail,
  validOccurrenceCursor,
  type AutomationOccurrenceResult,
  type AutomationOccurrencesResult,
  type AutomationOccurrenceView,
} from "../automations/occurrences.ts";
import { AUTOMATION_ID_PATTERN } from "../automations/lifecycle.ts";
import { createAutomationReadClient } from "./coven-automations-sdk.ts";

type ReadClient = Pick<ReturnType<typeof createAutomationReadClient>, "occurrenceHistory" | "getOccurrence">;

function errorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
    ? error.code
    : undefined;
}

/** A refused option (a cursor Coven does not recognise) is the request's fault, not the daemon's. */
function classify(error: unknown): "invalid" | "unsupported" | "unavailable" {
  const code = errorCode(error);
  if (code === "capability_unsupported" || code === "unsupported_operation") return "unsupported";
  if (code === "invalid_options") return "invalid";
  return "unavailable";
}

/**
 * One page of an automation's occurrences, newest first, through the pinned
 * SDK's `occurrence.history.v1`. Only bounded facts leave the server: free-text
 * reasons, lease owners and digests stay in the daemon. An occurrence Cave
 * cannot project fails the whole page rather than vanishing from it.
 */
export async function readAutomationOccurrences(
  id: string,
  query: URLSearchParams,
  signal: AbortSignal,
  client: ReadClient = createAutomationReadClient(),
): Promise<AutomationOccurrencesResult> {
  const cursor = query.get("cursor");
  if (!AUTOMATION_ID_PATTERN.test(id) || [...query.keys()].some((key) => key !== "cursor") ||
    query.getAll("cursor").length > 1 || (cursor !== null && !validOccurrenceCursor(cursor))) {
    return { kind: "invalid" };
  }
  try {
    const page = await client.occurrenceHistory(id, { limit: OCCURRENCE_PAGE_SIZE, ...(cursor === null ? {} : { cursor }) }, { signal });
    const occurrences: AutomationOccurrenceView[] = [];
    for (const occurrence of page.data) {
      const projected = occurrence.automationId === id ? projectOccurrence(occurrence) : undefined;
      if (!projected) return { kind: "unavailable" };
      occurrences.push(projected);
    }
    const next = page.cursor.hasMore && page.cursor.next !== undefined && validOccurrenceCursor(page.cursor.next) ? page.cursor.next : null;
    if (page.cursor.hasMore && next === null) return { kind: "unavailable" };
    return { kind: "available", readAt: new Date().toISOString(), occurrences, nextCursor: next };
  } catch (error) {
    return { kind: classify(error) };
  }
}

/**
 * One occurrence with its runs and their attempts, read from one producer
 * snapshot (`occurrence.get.v1`). An occurrence that belongs to another
 * automation is reported as absent here, never shown under this one.
 */
export async function readAutomationOccurrence(
  id: string,
  occurrenceId: string,
  signal: AbortSignal,
  client: ReadClient = createAutomationReadClient(),
): Promise<AutomationOccurrenceResult> {
  if (!AUTOMATION_ID_PATTERN.test(id) || !OCCURRENCE_ENTITY_ID_PATTERN.test(occurrenceId)) return { kind: "invalid" };
  try {
    const { occurrence } = await client.getOccurrence(occurrenceId, { signal });
    if (occurrence === null || occurrence.automationId !== id) {
      return { kind: "available", readAt: new Date().toISOString(), occurrence: null };
    }
    if (occurrence.runs.some((run) => run.automationId !== id || run.occurrenceId !== occurrence.id)) return { kind: "unavailable" };
    const projected = projectOccurrenceDetail(occurrence);
    return projected ? { kind: "available", readAt: new Date().toISOString(), occurrence: projected } : { kind: "unavailable" };
  } catch (error) {
    return { kind: classify(error) };
  }
}
