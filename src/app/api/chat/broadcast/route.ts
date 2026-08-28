import { NextResponse } from "next/server";

import { loadConversation } from "@/lib/cave-conversations";
import {
  BROADCAST_CONCURRENCY,
  normalizeBroadcastTargets,
  runBounded,
  type BroadcastResult,
} from "@/lib/chat-broadcast";
import { rejectNonLocalRequest } from "@/lib/server/api-security";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/chat/broadcast — send one message into many existing chats.
 *
 * Server-side rather than a client fan-out for three reasons: the browser would
 * otherwise hold N concurrent SSE connections open while the user keeps
 * browsing; the concurrency ceiling belongs somewhere a single client cannot
 * opt out of; and the caller wants ONE response carrying a per-target outcome,
 * which is what the sessions list renders on each row.
 *
 * The internal `fetch("/api/chat/send")` follows `src/app/api/salem/route.ts`,
 * which already calls that route server-to-server.
 *
 * ── Deliver and detach ──────────────────────────────────────────────────────
 * A target resolves as soon as its send is ACCEPTED — the response opens and
 * announces `{ kind: "session" }` — not when its reply finishes. Waiting for
 * every reply would hold one HTTP request open across N multi-minute agent
 * turns; "delivered" is also the honest claim here, since the reply lands in
 * each chat's own transcript where the user reads it.
 *
 * The turn still completes server-side after we stop reading: `/api/chat/send`
 * treats a bare transport abort as "the client vanished" and lets the turn
 * finish and persist, bounded by CHAT_DETACH_MAX_MS (10 minutes). So a reply
 * longer than that ceiling can be cut short. That is the accepted cost of not
 * blocking the request; a user who needs to watch a long reply opens the chat,
 * which re-attaches through /api/chat/stream.
 */

/** Long enough to cover a cold harness spawn, short enough that one wedged
 *  target cannot hold a broadcast open. Only bounds the ACCEPT window — the
 *  turn itself runs on past it, server-side. */
const ACCEPT_TIMEOUT_MS = 30_000;

type SendOutcome = Pick<BroadcastResult, "ok" | "runId" | "error" | "code">;

/**
 * Fire one send and resolve once it is accepted.
 *
 * `familiarId` is read from the target's own conversation, never from the
 * caller: `/api/chat/send` answers 404 when the body's familiar does not match
 * the persisted one, and a broadcast may legitimately span familiars.
 *
 * `projectRoot` is deliberately NOT passed. A continued turn omits it, and the
 * send route then recovers the conversation's own cwd from its recorded
 * runtime (or the daemon's session record). Passing the caller's active
 * project instead would run someone else's chat in the wrong directory.
 */
async function sendOne(req: Request, sessionId: string, text: string): Promise<SendOutcome> {
  const conversation = await loadConversation(sessionId).catch(() => null);
  if (!conversation) {
    return { ok: false, code: "conversation_not_found", error: "conversation not found" };
  }

  const runId = crypto.randomUUID();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ACCEPT_TIMEOUT_MS);
  try {
    const res = await fetch(new URL("/api/chat/send", req.url), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        familiarId: conversation.familiarId,
        prompt: text,
        sessionId,
        runId,
      }),
      signal: controller.signal,
    });
    if (!res.ok || !res.body) {
      const detail = await res.text().catch(() => "");
      return {
        ok: false,
        code: "send_rejected",
        error: `send refused with ${res.status}${detail ? `: ${detail.slice(0, 200)}` : ""}`,
      };
    }
    // Read only far enough to see the run acknowledged, then let go. Cancelling
    // the reader is what detaches us; the turn continues server-side.
    const accepted = await waitForAccept(res.body);
    if (!accepted.ok) return { ok: false, code: "send_failed", error: accepted.error };
    return { ok: true, runId };
  } catch (err) {
    const aborted = err instanceof Error && err.name === "AbortError";
    return {
      ok: false,
      code: "send_failed",
      error: aborted
        ? `send was not acknowledged within ${Math.round(ACCEPT_TIMEOUT_MS / 1000)}s`
        : err instanceof Error
          ? err.message
          : "send failed",
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Consume SSE frames until the run is acknowledged.
 *
 * `session` means accepted. An `error` frame before it is a real per-target
 * failure and must be reported rather than counted as delivered — this is the
 * case `/api/inbox/bulk` has no precedent for, since its actions cannot fail
 * individually the way a spawned harness can.
 */
async function waitForAccept(body: ReadableStream<Uint8Array>): Promise<{ ok: true } | { ok: false; error: string }> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        return { ok: false, error: "stream closed before the run was acknowledged" };
      }
      buffer += decoder.decode(value, { stream: true });
      const frames = buffer.split("\n\n");
      buffer = frames.pop() ?? "";
      for (const frame of frames) {
        const line = frame.split(/\r?\n/).find((item) => item.startsWith("data:"));
        if (!line) continue;
        let event: { kind?: string; message?: string; isError?: boolean };
        try {
          event = JSON.parse(line.slice(5).trim());
        } catch {
          continue;
        }
        if (event.kind === "session") return { ok: true };
        if (event.kind === "error") return { ok: false, error: event.message ?? "send failed" };
        // A `done` that arrives without a preceding `session` is a refusal that
        // still framed itself as a stream (the offline/travel queue path does
        // this). Treat an error-flagged done as a failure, not a delivery.
        if (event.kind === "done" && event.isError) {
          return { ok: false, error: event.message ?? "send failed" };
        }
        if (event.kind === "done") return { ok: true };
      }
    }
  } finally {
    // Detach. The turn keeps running and persisting on the server.
    await reader.cancel().catch(() => undefined);
  }
}

export async function POST(req: Request) {
  const forbidden = rejectNonLocalRequest(req);
  if (forbidden) return forbidden;

  let body: { text?: unknown; targets?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json body" }, { status: 400 });
  }

  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text) {
    return NextResponse.json({ ok: false, error: "text is required" }, { status: 400 });
  }

  const targets = normalizeBroadcastTargets(body.targets);
  if (targets.length === 0) {
    return NextResponse.json(
      { ok: false, error: "targets must be a non-empty array of session ids" },
      { status: 400 },
    );
  }

  const results = await runBounded(targets, BROADCAST_CONCURRENCY, async (target) => {
    const outcome = await sendOne(req, target.sessionId, text);
    return { sessionId: target.sessionId, ...outcome } satisfies BroadcastResult;
  });

  // 200 with a per-target result array even when some targets failed: the
  // operation ran, and the caller needs the breakdown to retry only the
  // failures. `ok` reports whether EVERY target was delivered.
  return NextResponse.json({ ok: results.every((r) => r.ok), results });
}
