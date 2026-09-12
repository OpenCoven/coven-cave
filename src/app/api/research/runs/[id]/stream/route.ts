import { NextResponse } from "next/server";

import {
  replayResearchRunGateway,
  ResearchRunGatewayError,
  subscribeBeforeInitialResearchRunRead,
  watchResearchRunSources,
} from "@/lib/server/research-run-gateway";
import {
  authorizeResearchRunRequest,
  researchRunGatewayErrorResponse,
} from "@/lib/server/research-run-gateway-route";
import { researchRunIdForMissionId } from "@/lib/server/research-run-gateway-store";

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
  const authorized = await authorizeResearchRunRequest(req, id, {
    allowValidatedSidecarQuery: true,
  });
  if (!authorized.ok) return authorized.response;

  const url = new URL(req.url);
  const requestedQuery = cursorValue(url.searchParams.get("afterSeq"));
  const requestedHeader = cursorValue(req.headers.get("last-event-id"));
  if (requestedQuery === null || requestedHeader === null) {
    return NextResponse.json({ ok: false, error: "invalid event cursor" }, { status: 400 });
  }
  const afterSeq = Math.max(requestedQuery, requestedHeader);
  const cursorRunId = url.searchParams.get("cursorRunId");
  const requestedRunId = authorized.value.requestedRunId ?? undefined;
  const authorizedRunId = researchRunIdForMissionId(
    authorized.value.missionId,
    authorized.value.mission.runGeneration ?? 1,
  );
  const watchMissionSource =
    !requestedRunId || requestedRunId === authorizedRunId;
  const replayForStream = async (
    cursor: number,
    requireCursorIdentity = false,
  ) => {
    try {
      return await replayResearchRunGateway(
        authorized.value.missionId,
        cursor,
        STREAM_PAGE_SIZE,
        requestedRunId,
        requireCursorIdentity
          ? {
              requireCursorIdentity: true,
              cursorRunId,
            }
          : undefined,
      );
    } catch (error) {
      if (
        !requestedRunId
        && error instanceof ResearchRunGatewayError
        && error.code === "cursor"
      ) {
        return replayResearchRunGateway(
          authorized.value.missionId,
          0,
          STREAM_PAGE_SIZE,
        );
      }
      throw error;
    }
  };
  let publishOnChange = () => {};
  let initial;
  let activateWatching: (() => void) | null = null;
  let stopWatching: (() => void) | null = null;
  let rebindWatching = (_runId: string) => {};
  let watcherFailure: unknown = null;
  let closeStreamForWatcherFailure = () => {};
  const signalWatcherFailure = (error: unknown) => {
    watcherFailure ??= error;
    closeStreamForWatcherFailure();
  };
  try {
    const opened = await subscribeBeforeInitialResearchRunRead(
      (notify) => {
        const subscription = watchResearchRunSources(
          authorized.value.missionId,
          notify,
          signalWatcherFailure,
          undefined,
          requestedRunId ?? authorizedRunId,
          watchMissionSource,
        );
        rebindWatching = subscription.rebind;
        return subscription.stop;
      },
      () => publishOnChange(),
      () => replayForStream(afterSeq, true),
    );
    initial = opened.value;
    activateWatching = opened.activate;
    stopWatching = opened.stopWatching;
    if (!requestedRunId && initial) rebindWatching(initial.run.id);
  } catch (error) {
    return researchRunGatewayErrorResponse(error);
  }
  if (!initial) {
    stopWatching();
    return NextResponse.json({ ok: false, error: "research run not found" }, { status: 404 });
  }
  if (watcherFailure) {
    stopWatching();
    return researchRunGatewayErrorResponse(watcherFailure);
  }

  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let closed = false;
  let cursor = initial.afterSequence;
  let streamedRunId = initial.run.id;
  let publishChain = Promise.resolve();
  const encoder = new TextEncoder();

  const cleanup = () => {
    closed = true;
    publishOnChange = () => {};
    activateWatching = null;
    rebindWatching = () => {};
    closeStreamForWatcherFailure = () => {};
    stopWatching?.();
    stopWatching = null;
    if (heartbeat) clearInterval(heartbeat);
    heartbeat = null;
  };

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      closeStreamForWatcherFailure = () => {
        if (closed) return;
        cleanup();
        try { controller.close(); } catch { /* client disconnected */ }
      };
      if (watcherFailure) {
        closeStreamForWatcherFailure();
        return;
      }
      const publish = (includeSnapshot: boolean, firstPage = false) => {
        publishChain = publishChain.then(async () => {
          if (closed) return;
          let page = firstPage
            ? initial!
            : await replayForStream(cursor);
          let snapshotSent = !includeSnapshot;
          while (page) {
            if (closed) return;
            if (!requestedRunId && page.run.id !== streamedRunId) {
              cursor = 0;
              page = await replayForStream(0);
              snapshotSent = false;
              if (!page) break;
              rebindWatching(page.run.id);
              streamedRunId = page.run.id;
            }
            if (!snapshotSent) {
              controller.enqueue(sseFrame("snapshot", {
                run: page.run,
                lastEventSequence: page.lastEventSequence,
                nextEventSequence: page.nextEventSequence,
                afterSeq: cursor,
              }));
              snapshotSent = true;
              streamedRunId = page.run.id;
            }
            for (const event of page.events) {
              if (event.sequence <= cursor) continue;
              controller.enqueue(sseFrame("run-event", event, event.sequence));
              cursor = event.sequence;
            }
            if (!page.hasMore) break;
            page = await replayForStream(cursor);
            if (!page) break;
          }
        }).catch(() => {
          if (closed) return;
          cleanup();
          try { controller.close(); } catch { /* client disconnected */ }
        });
        return publishChain;
      };

      publishOnChange = () => {
        void publish(false);
      };
      await publish(true, true);
      if (closed) return;
      if (watcherFailure) {
        closeStreamForWatcherFailure();
        return;
      }
      activateWatching?.();

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
