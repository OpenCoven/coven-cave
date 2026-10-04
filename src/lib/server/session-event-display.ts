import { createHash } from "node:crypto";
import type { SessionTraceEvent } from "../session-trace.ts";

// Coven 6473024e132eaefb2d6eebca3c977fb7df8b9b20: event_writer.rs,
// api.rs and store.rs. Its redacted PTY chunks are not classified complete
// display units. Only the selected lifecycle counters below are admitted.
const KINDS = new Set(["input", "output", "output_truncated", "exit", "kill", "transcript_text"]);
const TERMINAL_STATUSES = new Set(["completed", "failed", "killed"]);
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;
const WITHHELD = JSON.stringify({ detail: "Payload details unavailable.", disclosure: "metadata-only" });

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

function payloadForDisplay(kind: string, raw: unknown): string {
  // Never parse/reconstruct arbitrary output or let an embedded disclosure,
  // summary, approval or receipt field opt its contents into display.
  if (kind !== "exit" && kind !== "output_truncated") return WITHHELD;
  if (typeof raw !== "string" || Buffer.byteLength(raw) > 16 * 1024) return WITHHELD;
  let payload: Record<string, unknown> | null;
  try { payload = record(JSON.parse(raw)); } catch { return WITHHELD; }
  if (!payload) return WITHHELD;
  if (kind === "exit") {
    if (typeof payload.status !== "string" || !TERMINAL_STATUSES.has(payload.status)) return WITHHELD;
    const code = payload.exitCode;
    if (code !== null && !(typeof code === "number" && Number.isSafeInteger(code) && code >= -2147483648 && code <= 2147483647)) return WITHHELD;
    // This is an observed process exit, never proof of a tool's effect or a
    // committed operation. Do not copy arbitrary siblings from the record.
    return JSON.stringify({ status: payload.status, exitCode: code });
  }
  const { droppedEvents, droppedBytes } = payload;
  if (typeof droppedEvents !== "number" || !Number.isSafeInteger(droppedEvents) || droppedEvents < 0 ||
    typeof droppedBytes !== "number" || !Number.isSafeInteger(droppedBytes) || droppedBytes < 0) return WITHHELD;
  return JSON.stringify({ droppedEvents, droppedBytes });
}

/** Project an owned daemon page before it reaches trace/debug caches or
 * exports. Refuse invalid pagination/scope instead of silently skipping rows
 * and stranding the cursor. This display contract grants no new authority. */
export function projectSessionEventPage(
  value: unknown, sessionId: string, afterSeq: number, limit: number,
): SessionTraceEvent[] | null {
  if (!Array.isArray(value) || value.length > limit) return null;
  const events: SessionTraceEvent[] = [];
  let cursor = afterSeq;
  for (const valueRow of value) {
    const row = record(valueRow);
    if (!row || row.session_id !== sessionId || typeof row.seq !== "number" ||
      !Number.isSafeInteger(row.seq) || row.seq <= cursor || typeof row.id !== "string" ||
      !row.id || row.id.length > 1024) return null;
    const kind = typeof row.kind === "string" && KINDS.has(row.kind) ? row.kind : "unclassified";
    events.push({
      seq: row.seq,
      id: UUID.test(row.id) ? row.id : `opaque-${createHash("sha256").update(row.id).digest("hex")}`,
      session_id: sessionId,
      kind,
      payload_json: payloadForDisplay(kind, row.payload_json),
      created_at: typeof row.created_at === "string" && INSTANT.test(row.created_at) && Number.isFinite(Date.parse(row.created_at))
        ? row.created_at : "",
    });
    cursor = row.seq;
  }
  return events;
}
