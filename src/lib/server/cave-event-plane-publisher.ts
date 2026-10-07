/**
 * Server-side publication facade for the Cave event plane (#5830).
 *
 * Next routes and server libraries call `markResourceChanged` after a durable
 * write succeeds. `server.ts` installs the broker behind
 * `globalThis.__covenCaveEventPlanePublisher` at boot. The two halves meet
 * through that bridge because Next bundles routes separately from the custom
 * server, so they don't share module instances.
 *
 * Publication is best-effort after a committed write. It must never turn a
 * mutation that already succeeded into an HTTP failure, so every failure here
 * returns `false` and is reported once per kind and topic, never thrown.
 */

import {
  MAX_EVENT_ENTITY_IDS,
  normalizeEntityIds,
  type CaveEventTopic,
} from "../cave-event-plane-protocol.ts";

export type CaveEventPlanePublisher = {
  /** False when the server's kill switch is off: publishing is then a quiet no-op. */
  enabled: boolean;
  markResourceChanged(topic: CaveEventTopic, entityIds?: readonly string[]): void;
};

declare global {
  // eslint-disable-next-line no-var
  var __covenCaveEventPlanePublisher: CaveEventPlanePublisher | undefined;
}

type FailureKind = "unavailable" | "malformed" | "publish-failed";
const reported = new Set<string>();

function reportOnce(
  report: (...args: unknown[]) => void,
  kind: FailureKind,
  topic: CaveEventTopic,
  error?: unknown,
): void {
  const key = `${kind}:${topic}`;
  if (reported.has(key)) return;
  reported.add(key);
  const detail = error instanceof Error ? error.message : undefined;
  report(`[event-plane] event-plane publisher ${kind} for topic "${topic}"`, ...(detail ? [detail] : []));
}

/**
 * Tell subscribers that `topic` may be stale. Returns whether the broker
 * accepted the invalidation. Entity ids are advisory: more than the protocol
 * allows degrades to a topic-wide invalidation rather than an error.
 */
export function markResourceChanged(
  topic: CaveEventTopic,
  entityIds?: readonly string[],
  report: (...args: unknown[]) => void = console.error,
): boolean {
  const publisher = globalThis.__covenCaveEventPlanePublisher;
  if (!publisher) {
    reportOnce(report, "unavailable", topic);
    return false;
  }
  if (publisher.enabled !== true) return false;
  if (typeof publisher.markResourceChanged !== "function") {
    reportOnce(report, "malformed", topic);
    return false;
  }
  try {
    const ids = entityIds && entityIds.length > MAX_EVENT_ENTITY_IDS ? undefined : normalizeEntityIds(entityIds);
    publisher.markResourceChanged(topic, ids);
    return true;
  } catch (error) {
    reportOnce(report, "publish-failed", topic, error);
    return false;
  }
}

/** Test-only: forget which failures were already reported. */
export function resetEventPublisherReportsForTests(): void {
  reported.clear();
}
