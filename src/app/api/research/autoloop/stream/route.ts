import { rejectNonLocalRequest } from "@/lib/server/api-security";
import {
  loadAutoresearchSnapshot,
  watchAutoresearchSources,
} from "@/lib/server/research-autoloop";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const forbidden = rejectNonLocalRequest(req);
  if (forbidden) return forbidden;

  let stopWatching: (() => void) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let closed = false;
  const encoder = new TextEncoder();

  const cleanup = () => {
    closed = true;
    stopWatching?.();
    stopWatching = null;
    if (heartbeat) clearInterval(heartbeat);
    heartbeat = null;
  };

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let refresh = Promise.resolve();
      const publish = () => {
        refresh = refresh.then(async () => {
          const snapshot = await loadAutoresearchSnapshot();
          if (closed) return;
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(snapshot)}\n\n`));
          } catch {
            cleanup();
          }
        });
        return refresh;
      };

      // Subscribe before the first read so a ledger append cannot land in the
      // load/watch gap. The serialized publish chain prevents stale reads from
      // arriving after a newer invalidation.
      stopWatching = watchAutoresearchSources(() => {
        void publish();
      });
      await publish();

      // Transport heartbeat only. Authoritative data refreshes come solely
      // from fs.watch invalidations above.
      heartbeat = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(": ping\n\n"));
        } catch {
          cleanup();
        }
      }, 25_000);
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
