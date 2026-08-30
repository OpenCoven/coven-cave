import { NextResponse } from "next/server";

import {
  replayResearchRunGateway,
  watchResearchRunSources,
} from "@/lib/server/research-run-gateway";
import {
  authorizeResearchRunRequest,
  researchRunGatewayErrorResponse,
} from "@/lib/server/research-run-gateway-route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const STREAM_PAGE_SIZE = 200;

function cursorValue(value: string | null): number | null {
  if (value === null || value === "") return 0;
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function sseFrame(
  event: string,
  data: unknown,
  id?: number,
): Uint8Array {
  const encoded = JSON.stringify(data);
  const prefix = id === undefined ? "" : `id: ${id}\n`;
  return new TextEncoder().encode(`${prefix}event: ${event}\ndata: ${encoded}\n\n`);
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const authorized = await authorizeResearchRunRequest(req, id);
  if (!authorized.ok) return authorized.response;

  const url = new URL(req.url);
  const requestedQuery = cursorValue(url.searchParams.get("afterSeq"));
  const requestedHeader = cursorValue(req.headers.get("last-event-id"));
  if (requestedQuery === null || requestedHeader === null) {
    return NextResponse.json({ ok: false, error: "invalid event cursor" }, { status: 400 });
  }
  const afterSeq = Math.max(requestedQuery, requestedHeader);
  let initial;
  try {
    initial = await replayResearchRunGateway(
      authorized.value.missionId,
      afterSeq,
      STREAM_PAGE_SIZE,
    );
  } catch (error) {
    return researchRunGatewayErrorResponse(error);
  }
  if (!initial) {
    return NextResponse.json({ ok: false, error: "research run not found" }, { status: 404 });
  }

  let stopWatching: (() => void) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let closed = false;
  let cursor = afterSeq;
  let publishChain = Promise.resolve();
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
      const publish = (includeSnapshot: boolean, firstPage = false) => {
        publishChain = publishChain.then(async () => {
          if (closed) return;
          let page = firstPage
            ? initial!
            : await replayResearchRunGateway(
              authorized.value.missionId,
              cursor,
              STREAM_PAGE_SIZE,
            );
          let snapshotSent = !includeSnapshot;
          while (page) {
            if (closed) return;
            if (!snapshotSent) {
              controller.enqueue(sseFrame("snapshot", {
                run: page.run,
                lastEventSequence: page.lastEventSequence,
                nextEventSequence: page.nextEventSequence,
                afterSeq: cursor,
              }));
              snapshotSent = true;
            }
            for (const event of page.events) {
              if (event.sequence <= cursor) continue;
              controller.enqueue(sseFrame("run-event", event, event.sequence));
              cursor = event.sequence;
            }
            if (!page.hasMore) break;
            page = await replayResearchRunGateway(
              authorized.value.missionId,
              cursor,
              STREAM_PAGE_SIZE,
            );
            if (!page) break;
          }
        }).catch(() => {
          if (closed) return;
          cleanup();
          try { controller.close(); } catch { /* client disconnected */ }
        });
        return publishChain;
      };

      // Subscribe before sending the first page. If mission.json changes
      // between the route's initial read and this write, the invalidation is
      // serialized behind the snapshot and replayed from the advanced cursor.
      stopWatching = watchResearchRunSources(authorized.value.missionId, () => {
        void publish(false);
      });
      await publish(true, true);
      if (closed) return;

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
