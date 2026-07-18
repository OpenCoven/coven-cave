import { hasRunBuffer, subscribeRunStream } from "@/lib/server/chat-stream-buffer";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SSE_HEARTBEAT = new TextEncoder().encode(": hb\n\n");
const SSE_HEARTBEAT_INTERVAL_MS = 15_000;

/**
 * GET /api/chat/stream?runId=…&cursor=N — re-attach to a LIVE chat run
 * mid-turn (cave-h40l, plan C2).
 *
 * Recovery used to be post-hoc only: a phone that dropped mid-reply showed
 * nothing until the turn ended and resync adopted the persisted transcript.
 * The send route now tees every stream event through a bounded per-run ring
 * (chat-stream-buffer); this route replays events past the client's cursor
 * (`id:` carries the seq, so the cursor is just the last SSE id seen) and
 * tails the live run. Re-attaching disarms the send route's detach-cap kill;
 * the last tail dropping re-arms it.
 *
 * `runId` accepts either registry key — the per-send client token or the
 * conversation id. 404 means no buffered run under that key (finished long
 * ago, or the server restarted): the client falls back to the existing
 * post-hoc resync.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const key = url.searchParams.get("runId")?.trim() || url.searchParams.get("sessionId")?.trim();
  if (!key) {
    return Response.json({ ok: false, error: "runId or sessionId required" }, { status: 400 });
  }
  if (!hasRunBuffer(key)) {
    return Response.json({ ok: false, error: "no buffered run for that key" }, { status: 404 });
  }
  const cursorRaw = Number(url.searchParams.get("cursor") ?? "0");
  const cursor = Number.isFinite(cursorRaw) && cursorRaw > 0 ? Math.floor(cursorRaw) : 0;

  const encoder = new TextEncoder();
  const sse = (seq: number, json: string) => encoder.encode(`id: ${seq}\ndata: ${json}\n\n`);

  let cleanup: (() => void) | null = null;
  const stream = new ReadableStream<Uint8Array>({
    start: (controller) => {
      let closed = false;
      const write = (chunk: Uint8Array) => {
        if (closed) return;
        try {
          controller.enqueue(chunk);
        } catch {
          closed = true;
        }
      };
      const heartbeat = setInterval(() => {
        if (closed) {
          clearInterval(heartbeat);
          return;
        }
        write(SSE_HEARTBEAT);
      }, SSE_HEARTBEAT_INTERVAL_MS);
      const close = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        subscription?.unsubscribe();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };

      const subscription = subscribeRunStream(
        key,
        cursor,
        (event) => write(sse(event.seq, event.json)),
        () => close(),
      );
      if (!subscription) {
        // The buffer was reaped between the 404 probe and the first read of
        // this stream — close out; the client's error path resyncs.
        close();
        return;
      }

      // Evicted history: tell the client to full-resync after draining —
      // rendered as a benign progress row, never an error.
      if (subscription.gapBeforeSeq != null) {
        write(
          sse(
            subscription.gapBeforeSeq,
            JSON.stringify({
              kind: "progress",
              id: "resume-gap",
              label: "Reconnected mid-turn",
              detail: "Some earlier output was trimmed — the full reply arrives when the turn ends.",
              status: "done",
            }),
          ),
        );
      }
      for (const event of subscription.replay) write(sse(event.seq, event.json));
      if (subscription.done) {
        close();
        return;
      }
      cleanup = close;
    },
    cancel: () => {
      cleanup?.();
    },
  });

  req.signal.addEventListener("abort", () => cleanup?.(), { once: true });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
