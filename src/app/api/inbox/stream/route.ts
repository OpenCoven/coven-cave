import {
  broadcastSnapshot,
  startScheduler,
  subscribe,
} from "@/lib/inbox-scheduler";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

startScheduler();

export async function GET() {
  let unsubscribe: (() => void) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      unsubscribe = subscribe(controller);
      try {
        await broadcastSnapshot(controller);
      } catch (error) {
        unsubscribe();
        unsubscribe = null;
        throw error;
      }
      const enc = new TextEncoder();
      heartbeat = setInterval(() => {
        try {
          controller.enqueue(enc.encode(`: ping\n\n`));
        } catch {
          /* stream closed */
        }
      }, 25_000);
    },
    cancel() {
      if (unsubscribe) unsubscribe();
      if (heartbeat) clearInterval(heartbeat);
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
