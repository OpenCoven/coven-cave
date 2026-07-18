/**
 * Session trace helpers — pure logic behind the session trace timeline
 * (session-trace-overlay.tsx), the first UI consumer of
 * `GET /api/sessions/[id]/events`. Kept JSX-free so the summarization and
 * tone rules are unit-testable.
 */

/** Daemon event row as returned by /api/sessions/[id]/events. */
export type SessionTraceEvent = {
  seq: number;
  id: string;
  session_id: string;
  kind: string;
  payload_json: string;
  created_at: string;
};

/** Visual tone for an event kind — drives the timeline chip tint. */
export type TraceTone = "start" | "end" | "error" | "info";

/** Page size for the events fetch — mirrors the route's default cap. */
export const TRACE_PAGE_SIZE = 200;

/**
 * Classify an event kind into a tone. Kinds are daemon-defined free strings
 * (e.g. "session.started", "process.exit", "run-error"), so this matches on
 * conventional fragments rather than an enum.
 */
export function traceEventTone(kind: string): TraceTone {
  const k = kind.toLowerCase();
  if (/(error|fail|denied|timeout|killed)/.test(k)) return "error";
  if (/(end|exit|complete|done|closed|finish|stopped)/.test(k)) return "end";
  if (/(start|spawn|created|open|resume|launch)/.test(k)) return "start";
  return "info";
}

const SUMMARY_KEYS = [
  "text",
  "message",
  "title",
  "summary",
  "detail",
  "status",
  "error",
  "reason",
  "prompt",
  "command",
  "path",
] as const;

const SUMMARY_MAX_CHARS = 240;

function clip(value: string): string {
  const flat = value.replace(/\s+/g, " ").trim();
  return flat.length > SUMMARY_MAX_CHARS ? `${flat.slice(0, SUMMARY_MAX_CHARS)}…` : flat;
}

/**
 * Distill a payload JSON blob into one human line. Order of preference:
 * a bare string payload, then the first conventional message-ish key, then a
 * compact `key: value` join of the first few primitive fields. Returns null
 * when the payload carries nothing readable (empty object, unparseable).
 */
export function summarizeTracePayload(payloadJson: string): string | null {
  const raw = payloadJson?.trim();
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Not JSON — the raw text is the payload.
    return clip(raw);
  }
  if (parsed == null) return null;
  if (typeof parsed === "string") return parsed.trim() ? clip(parsed) : null;
  if (typeof parsed === "number" || typeof parsed === "boolean") return String(parsed);
  if (Array.isArray(parsed)) {
    const items = parsed.filter((item) => typeof item === "string" || typeof item === "number");
    return items.length > 0 ? clip(items.join(", ")) : null;
  }
  const record = parsed as Record<string, unknown>;
  for (const key of SUMMARY_KEYS) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return clip(value);
  }
  const pairs = Object.entries(record)
    .filter(([, value]) => ["string", "number", "boolean"].includes(typeof value))
    .slice(0, 3)
    .map(([key, value]) => `${key}: ${String(value)}`);
  return pairs.length > 0 ? clip(pairs.join(" · ")) : null;
}

/**
 * Pretty-print a payload for the expandable raw view. Null when there is no
 * more detail than the one-line summary already shows (bare/empty payloads).
 */
export function formatTracePayload(payloadJson: string): string | null {
  const raw = payloadJson?.trim();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed == null) return null;
    if (typeof parsed !== "object") return null;
    if (Object.keys(parsed as object).length === 0) return null;
    return JSON.stringify(parsed, null, 2);
  } catch {
    return null;
  }
}

/** Merge a fetched page into the ordered, deduped event list (ascending seq). */
export function mergeTraceEvents(
  existing: SessionTraceEvent[],
  incoming: SessionTraceEvent[],
): SessionTraceEvent[] {
  const bySeq = new Map<number, SessionTraceEvent>();
  for (const event of existing) bySeq.set(event.seq, event);
  for (const event of incoming) bySeq.set(event.seq, event);
  return [...bySeq.values()].sort((a, b) => a.seq - b.seq);
}
