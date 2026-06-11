import type { SessionRow } from "@/lib/types";

/** Raw daemon event as returned by GET /api/sessions/[id]/events.
 *  Mirrors the shape in src/app/api/sessions/[id]/events/route.ts. */
export type CovenEvent = {
  seq: number;
  id: string;
  session_id: string;
  kind: string;
  payload_json: string;
  created_at: string;
};

/** Structural subset of ChatView's Turn type — chat-view's Turn is assignable
 *  to this without importing from the component (avoids a lib→component cycle). */
export type DebugTurn = {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  reasoning?: string;
  tools?: Array<{
    id: string;
    name: string;
    input?: string;
    output?: string;
    status: "running" | "ok" | "error";
    durationMs?: number;
  }>;
  progress?: Array<{
    id: string;
    label: string;
    detail?: string;
    status: "running" | "done" | "error";
    createdAt: string;
    durationMs?: number;
  }>;
  createdAt: string;
  pending?: boolean;
  error?: boolean;
  lifecycle?: "queued" | "connecting" | "streaming" | "tooling" | "cancelled" | "failed" | "complete";
  durationMs?: number;
  origin?: "chat" | "voice";
};

export type DebugBundle = {
  session: SessionRow | null;
  familiar: { id: string; harness?: string; model?: string } | null;
  turns: DebugTurn[];
  events: CovenEvent[];
};

/** Append a poll page onto the accumulated tail: dedupe by seq, keep ascending
 *  order. Returns the existing array unchanged when nothing new arrived so
 *  React state setters can bail out of a re-render. */
export function appendEvents(existing: CovenEvent[], incoming: CovenEvent[]): CovenEvent[] {
  if (incoming.length === 0) return existing;
  const seen = new Set(existing.map((e) => e.seq));
  const fresh = incoming.filter((e) => !seen.has(e.seq));
  if (fresh.length === 0) return existing;
  return [...existing, ...fresh].sort((a, b) => a.seq - b.seq);
}

/** Cursor for the next ?afterSeq= fetch. */
export function nextAfterSeq(events: CovenEvent[]): number {
  return events.reduce((max, e) => (e.seq > max ? e.seq : max), 0);
}

export function shouldPollEvents(args: { status: string | null; visible: boolean }): boolean {
  return args.status === "running" && args.visible;
}

export function formatEventPayload(payloadJson: string): string {
  try {
    return JSON.stringify(JSON.parse(payloadJson), null, 2);
  } catch {
    return payloadJson;
  }
}

/** Typed constructor for the export bundle. Callers pass a full Familiar;
 *  the explicit field-pick strips everything but {id, harness, model} from
 *  the export. Arrays are passed by reference (snapshot at call time), not
 *  cloned. */
export function buildDebugBundle(args: {
  session: SessionRow | null;
  familiar: { id: string; harness?: string; model?: string } | null;
  turns: DebugTurn[];
  events: CovenEvent[];
}): DebugBundle {
  return {
    session: args.session,
    familiar: args.familiar
      ? { id: args.familiar.id, harness: args.familiar.harness, model: args.familiar.model }
      : null,
    turns: args.turns,
    events: args.events,
  };
}

export function debugFileName(sessionId: string | null): string {
  return sessionId ? `debug-${sessionId}.json` : "debug-session.json";
}
