import type { CovenAutomationEvent, CovenAutomationEventPage } from "@opencoven/coven-client";
import {
  FEED_MAX_EVENTS,
  FEED_STREAM_ID_PATTERN,
  validFeedCheckpoint,
  type AutomationFeedEvent,
  type AutomationFeedRead,
  type AutomationFeedStream,
  type AutomationFeedTopic,
} from "../automations/feed.ts";
import { AUTOMATION_ID_PATTERN } from "../automations/lifecycle.ts";
import { describeAutomationEvent } from "./automation-history.ts";
import { createAutomationReadClient } from "./coven-automations-sdk.ts";

type ReadClient = Pick<ReturnType<typeof createAutomationReadClient>, "events">;

/** Coven v0.4.10 answers at most 100 events per page; a shorter page is the stream's head. */
const DAEMON_PAGE_EVENTS = 100;
/** Pages one feed read walks before it reports `caughtUp: false` and lets the next read continue. */
const MAX_PAGES = 10;

function topicOf(event: CovenAutomationEvent): AutomationFeedTopic | "other" {
  if (event.kind.startsWith("definition.")) return "definition";
  if (event.kind.startsWith("occurrence.")) return "occurrence";
  if (event.kind === "run.transitioned" || event.kind === "attempt.transitioned" || event.kind === "receipt.recorded") return "run";
  return "other";
}

function errorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
    ? error.code
    : undefined;
}

function requestedStream(id: string, query: URLSearchParams): { stream: AutomationFeedStream; checkpoint: string | null } | null {
  const allowed = new Set(["stream", "streamId", "checkpoint"]);
  if (!AUTOMATION_ID_PATTERN.test(id) || [...query.keys()].some((key) => !allowed.has(key)) ||
    [...allowed].some((key) => query.getAll(key).length > 1)) return null;
  const kind = query.get("stream") ?? "automation";
  const streamId = query.get("streamId");
  const checkpoint = query.get("checkpoint");
  if (checkpoint !== null && !validFeedCheckpoint(checkpoint)) return null;
  if (kind === "automation") return streamId === null ? { stream: { kind, id }, checkpoint } : null;
  if ((kind === "occurrence" || kind === "run") && streamId !== null && FEED_STREAM_ID_PATTERN.test(streamId)) {
    return { stream: { kind, id: streamId }, checkpoint };
  }
  return null;
}

/**
 * Read one changefeed stream of an automation from a checkpoint, or from the
 * beginning when there is none, walking at most MAX_PAGES pages toward its
 * head. Only labels and bounded transition details leave the server: no
 * summaries, reasons, snapshot state or authority data. Every event must name
 * this automation; a stream that carries another automation's events is
 * refused rather than shown here.
 */
export async function readAutomationFeed(
  id: string,
  query: URLSearchParams,
  signal: AbortSignal,
  client: ReadClient = createAutomationReadClient(),
): Promise<AutomationFeedRead> {
  const request = requestedStream(id, query);
  if (!request) return { kind: "invalid" };
  const { stream } = request;
  let checkpoint = request.checkpoint;
  const visible: AutomationFeedEvent[] = [];
  let omitted = 0;
  let throughSequence: number | null = null;
  let caughtUp = false;
  let last: CovenAutomationEventPage | null = null;
  try {
    for (let pages = 0; pages < MAX_PAGES; pages += 1) {
      const page = await client.events({ stream, ...(checkpoint === null ? {} : { checkpoint }) }, { signal });
      for (const event of page.events) {
        if (event.automationId !== undefined ? event.automationId !== id : stream.kind !== "automation") return { kind: "invalid" };
        throughSequence = Math.max(throughSequence ?? -1, event.sequence);
        if (event.privacy.classification === "public" || event.privacy.classification === "operational") {
          visible.push({ id: event.eventId, sequence: event.sequence, recordedAt: event.recordedAt, topic: topicOf(event), ...describeAutomationEvent(event) });
        } else {
          omitted += 1;
        }
      }
      last = page;
      checkpoint = page.checkpoint;
      if (page.events.length < DAEMON_PAGE_EVENTS) {
        caughtUp = true;
        break;
      }
    }
  } catch (error) {
    const code = errorCode(error);
    // Coven prunes expired checkpoints, so a lost position can also come back unknown.
    if (code === "CURSOR_EXPIRED" || (code === "NOT_FOUND" && request.checkpoint !== null)) return { kind: "expired" };
    if (code === "capability_unsupported" || code === "unsupported_operation") return { kind: "unsupported" };
    if (code === "invalid_options") return { kind: "invalid" };
    return { kind: "unavailable" };
  }
  if (!last || !validFeedCheckpoint(last.checkpoint)) return { kind: "unavailable" };
  const kept = visible.slice(-FEED_MAX_EVENTS);
  return {
    kind: "available",
    readAt: new Date().toISOString(),
    checkpoint: last.checkpoint,
    caughtUp,
    events: kept,
    omitted: omitted + (visible.length - kept.length),
    throughSequence,
  };
}
