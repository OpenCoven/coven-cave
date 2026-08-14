import {
  canonicalizeRunStreamEvent,
  ensureTerminalFailure,
  RUN_STREAM_EVENT_MAX_BYTES,
  subscribeRunStream,
} from "@/lib/server/chat-stream-buffer";
import type { StreamEvent } from "@/lib/stream-events";

export type ClientStreamEvent =
  | { type: "run.started"; runId: string; conversationId: string }
  | { type: "message.delta"; text: string }
  | { type: "progress"; id: string; label: string; detail?: string; status: string }
  | { type: "tool"; payload: Record<string, unknown> }
  | { type: "reconcile_required"; conversationId: string }
  | { type: "run.completed"; conversationId: string }
  | { type: "run.failed"; code: string; message: string };

export type ClientStreamContext = {
  runId: string;
  conversationId: string;
};

const encoder = new TextEncoder();
const KEEP_ALIVE = encoder.encode(": keep-alive\n\n");
const KEEP_ALIVE_MS = 15_000;
const RESUME_QUEUE_MAX_BYTES = 64 * 1024;
const CURSOR_RE = /^(0|[1-9][0-9]*)$/;
const SAFE_FAILURE_CODE_RE = /^[a-z][a-z0-9_-]{0,63}$/;
// The canonical event's JSON is limited by the shared run buffer. A compact
// SSE frame has a small `id:`/`data:` envelope around that payload; retain a
// bounded allowance only for that transport metadata so an exactly-at-limit
// canonical event remains valid on the initial stream too.
const SSE_FRAME_METADATA_MAX_BYTES = 1024;
const UPSTREAM_FRAME_MAX_BYTES = RUN_STREAM_EVENT_MAX_BYTES + SSE_FRAME_METADATA_MAX_BYTES;

type Translation = {
  event: ClientStreamEvent | null;
  terminal: boolean;
};

function safeFailureCode(code: string | undefined): string {
  return code && SAFE_FAILURE_CODE_RE.test(code) ? code : "run_failed";
}

function invalidStreamEvent(): Translation {
  return {
    event: {
      type: "run.failed",
      code: "invalid_stream_event",
      message: "The run failed.",
    },
    terminal: true,
  };
}

export function createClientStreamTranslator(context: ClientStreamContext) {
  let assistantText = "";
  let terminal = false;
  return {
    translate(value: unknown): Translation {
      const invalid = () => {
        terminal = true;
        assistantText = "";
        return invalidStreamEvent();
      };
      if (terminal || !value || typeof value !== "object" || Array.isArray(value)) {
        return terminal ? { event: null, terminal: true } : invalid();
      }
      const event = value as Partial<StreamEvent> & Record<string, unknown>;
      switch (event.kind) {
        case "session":
          if (typeof event.sessionId !== "string") return invalid();
          return { event: { type: "run.started", ...context }, terminal: false };
        case "assistant_chunk":
          if (typeof event.text !== "string") return invalid();
          assistantText += event.text;
          return {
            event: event.text ? { type: "message.delta", text: event.text } : null,
            terminal: false,
          };
        case "assistant_replace": {
          if (typeof event.text !== "string") return invalid();
          if (!event.text.startsWith(assistantText)) {
            terminal = true;
            assistantText = "";
            return {
              event: {
                type: "reconcile_required",
                conversationId: context.conversationId,
              },
              terminal: true,
            };
          }
          const suffix = event.text.slice(assistantText.length);
          assistantText = event.text;
          return {
            event: suffix ? { type: "message.delta", text: suffix } : null,
            terminal: false,
          };
        }
    case "progress":
      if (typeof event.label !== "string") return invalid();
      return {
        event: {
          type: "progress",
          id: typeof event.id === "string" ? event.id : "progress",
          label: event.label,
          ...(typeof event.detail === "string" && event.detail ? { detail: event.detail } : {}),
          status: typeof event.status === "string" ? event.status : "running",
        },
        terminal: false,
      };
    case "tool_use": {
      if (typeof event.name !== "string") return invalid();
      const payload: Record<string, unknown> = {
        ...(typeof event.id === "string" && event.id ? { id: event.id } : {}),
        name: event.name,
        ...(event.input !== undefined ? { input: event.input } : {}),
        ...(event.output !== undefined ? { output: event.output } : {}),
        status: typeof event.status === "string" ? event.status : "running",
        ...(typeof event.durationMs === "number" ? { durationMs: event.durationMs } : {}),
      };
      return { event: { type: "tool", payload }, terminal: false };
    }
    case "done": {
      terminal = true;
      return {
        event: event.isError
          ? { type: "run.failed", code: "run_failed", message: "The run failed." }
          : { type: "run.completed", conversationId: context.conversationId },
        terminal: true,
      };
    }
    case "error":
      terminal = true;
      return {
        event: {
          type: "run.failed",
          code: safeFailureCode(typeof event.code === "string" ? event.code : undefined),
          message: "The run failed.",
        },
        terminal: true,
      };
    case "user":
      if (typeof event.text !== "string") return invalid();
      return { event: null, terminal: false };
    case "attachment":
      return { event: null, terminal: false };
    default:
      return invalid();
      }
    },
  };
}

export function translateStreamEvent(
  event: StreamEvent,
  context: ClientStreamContext,
): ClientStreamEvent | null {
  return createClientStreamTranslator(context).translate(event).event;
}

/**
 * Attempt to converge on the SAME canonical synthetic terminal every other
 * concurrent consumer of this run's buffer (a resumed subscriber, the
 * producer's own `finish()`) would see, rather than synthesizing a local,
 * per-subscriber-only one. Returns null when there is no buffer key to
 * consult, the buffer is unknown, or the canonical entry fails to decode —
 * the caller falls back to a local synthesis in that case.
 */
function canonicalFailureTranslation(
  bufferKey: string | undefined,
  code: string,
  context: ClientStreamContext,
): { seq: number; translated: Translation } | null {
  if (!bufferKey) return null;
  const entry = ensureTerminalFailure(bufferKey, code);
  if (!entry) return null;
  try {
    const translated = createClientStreamTranslator(context).translate(JSON.parse(entry.json));
    return { seq: entry.seq, translated };
  } catch {
    return null;
  }
}

function safeFailureResponse(status: number): Response {
  const mapped = status === 400 || status === 422
    ? { status: 400, code: "invalid_request", message: "The run request was rejected.", retryable: false }
    : status === 401 || status === 403
      ? { status: 403, code: "forbidden", message: "The run was not authorized.", retryable: false }
      : status === 404
        ? { status: 404, code: "not_found", message: "The run could not be started.", retryable: false }
        : status === 409
          ? { status: 409, code: "conflict", message: "The run could not be started.", retryable: false }
          : status === 429
            ? { status: 429, code: "rate_limited", message: "Too many run requests.", retryable: true }
            : status === 501
              ? { status: 501, code: "unsupported", message: "This run is not supported.", retryable: false }
              : { status: 503, code: "service_unavailable", message: "Run launch is temporarily unavailable.", retryable: true };
  return Response.json(
    { ok: false, error: { code: mapped.code, message: mapped.message, retryable: mapped.retryable } },
    { status: mapped.status },
  );
}

type ParsedFrame =
  | { kind: "ignore" }
  | { kind: "invalid" }
  | { kind: "event"; seq: number; event: unknown };

function parseLegacyFrame(frame: string): ParsedFrame {
  let id: string | null = null;
  const data: string[] = [];
  for (const line of frame.split(/\r?\n/)) {
    if (line.startsWith(":")) continue;
    if (line.startsWith("id:")) id = line.slice(3).trim();
    else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
  }
  if (data.length === 0) return { kind: "ignore" };
  if (id === null) return { kind: "invalid" };
  try {
    return {
      kind: "event",
      seq: parseCursorValue(id, "upstream SSE id"),
      event: JSON.parse(data.join("\n")),
    };
  } catch {
    return { kind: "invalid" };
  }
}

function parseCursorValue(value: string, source: string): number {
  if (!CURSOR_RE.test(value)) throw new Error(`${source} must be a nonnegative integer.`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(`${source} must be a safe integer.`);
  return parsed;
}

function parseResumeCursorValue(value: string, source: string): number {
  const parsed = parseCursorValue(value, source);
  if (parsed >= Number.MAX_SAFE_INTEGER) {
    throw new Error(`${source} must be less than ${Number.MAX_SAFE_INTEGER}.`);
  }
  return parsed;
}

export function parseClientStreamCursor(req: Request): number {
  const url = new URL(req.url);
  const query = url.searchParams.get("cursor");
  const header = req.headers.get("last-event-id");
  const values = [
    ...(query === null ? [] : [parseResumeCursorValue(query, "cursor")]),
    ...(header === null ? [] : [parseResumeCursorValue(header, "Last-Event-ID")]),
  ];
  return values.length ? Math.max(...values) : 0;
}

export function encodeClientStreamEvent(seq: number, event: ClientStreamEvent): Uint8Array {
  if (!Number.isSafeInteger(seq) || seq < 0) {
    throw new Error("SSE sequence must be a nonnegative safe integer.");
  }
  return encoder.encode(`id: ${seq}\ndata: ${JSON.stringify(event)}\n\n`);
}

function sseHeaders(): HeadersInit {
  return {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "x-accel-buffering": "no",
  };
}

/** Translate the original send response with one-output-per-pull backpressure.
 *  `bufferKey` — when given, the canonical run buffer key (the client-v1
 *  send path's `internalRunId`) this raw response is tee'd through — lets a
 *  truncated/malformed upstream converge on the SAME canonical synthetic
 *  `run.failed` terminal a concurrently resumed subscriber would see,
 *  instead of a local, initial-request-only one. */
export function translateInitialChatResponse(
  response: Response,
  context: ClientStreamContext,
  bufferKey?: string,
): Response {
  const contentType = response.headers.get("content-type") ?? "";
  if (!response.body || !/^text\/event-stream(?:\s*;|$)/i.test(contentType)) {
    void response.body?.cancel().catch(() => {});
    return safeFailureResponse(response.status);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffered = "";
  let sourceDone = false;
  let closed = false;
  let lastSeq = 0;
  const translator = createClientStreamTranslator(context);
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      const close = () => {
        if (closed) return;
        closed = true;
        controller.close();
      };
      const fail = async (code: string) => {
        if (closed) return;
        const canonical = canonicalFailureTranslation(bufferKey, code, context);
        const seq = canonical?.seq ?? lastSeq + 1;
        const translated = canonical?.translated.event
          ? canonical.translated
          : invalidStreamEvent();
        if (translated.event) {
          controller.enqueue(encodeClientStreamEvent(seq, translated.event));
        }
        await reader.cancel().catch(() => {});
        close();
      };
      while (!closed) {
        const boundary = buffered.indexOf("\n\n");
        if (boundary >= 0 || (sourceDone && buffered.length > 0)) {
          const raw = boundary >= 0 ? buffered.slice(0, boundary) : buffered;
          buffered = boundary >= 0 ? buffered.slice(boundary + 2) : "";
          if (Buffer.byteLength(raw, "utf8") > UPSTREAM_FRAME_MAX_BYTES) {
            await fail("stream_event_too_large");
            return;
          }
          const frame = parseLegacyFrame(raw);
          if (frame.kind === "ignore") continue;
          if (frame.kind === "invalid" || frame.seq <= lastSeq) {
            await fail("invalid_stream_event");
            return;
          }
          lastSeq = frame.seq;
          const translated = translator.translate(
            canonicalizeRunStreamEvent(frame.event as StreamEvent),
          );
          if (translated.event) {
            controller.enqueue(encodeClientStreamEvent(frame.seq, translated.event));
          }
          if (translated.terminal) {
            await reader.cancel().catch(() => {});
            close();
          } else if (translated.event) {
            return;
          }
          continue;
        }
        if (sourceDone) {
          // Upstream ended (or was cancelled) without ever emitting a
          // canonical terminal event — a truncated turn. Never leave the
          // client hanging on a silent close: publish (or read back) the
          // SAME canonical synthetic `run.failed` this run's buffer will
          // ever carry (see `ensureTerminalFailure`), so a concurrently or
          // later resumed subscriber converges on the identical terminal
          // rather than seeing nothing, or a different one.
          await fail("upstream_disconnected");
          return;
        }
        if (Buffer.byteLength(buffered, "utf8") > UPSTREAM_FRAME_MAX_BYTES) {
          await fail("stream_event_too_large");
          return;
        }
        try {
          const read = await reader.read();
          if (read.done) {
            buffered += decoder.decode().replace(/\r\n/g, "\n");
            sourceDone = true;
          } else {
            buffered += decoder.decode(read.value, { stream: true }).replace(/\r\n/g, "\n");
          }
        } catch {
          await fail("invalid_stream_event");
          return;
        }
      }
    },
    async cancel() {
      closed = true;
      await reader.cancel().catch(() => {});
    },
  }, {
    highWaterMark: RESUME_QUEUE_MAX_BYTES,
    size: (chunk) => chunk.byteLength,
  });
  return new Response(stream, {
    status: response.status,
    headers: sseHeaders(),
  });
}

export function createResumedRunStream(
  key: string,
  cursor: number,
  context: ClientStreamContext,
  signal: AbortSignal,
): Response | null {
  let cleanup: (() => void) | null = null;
  let subscription: ReturnType<typeof subscribeRunStream> = null;
  let pump: (() => void) | null = null;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let heartbeat: NodeJS.Timeout | null = null;
      let lastEmittedSeq = cursor;
      let replayIndex = 0;
      let pendingLive: { seq: number; json: string } | null = null;
      let finished = false;
      const translator = createClientStreamTranslator(context);
      const close = () => {
        if (closed) return;
        closed = true;
        pendingLive = null;
        if (heartbeat) clearInterval(heartbeat);
        subscription?.unsubscribe();
        try {
          controller.close();
        } catch {
          // The transport already closed.
        }
      };
      const fail = (seq: number, code: string = "invalid_stream_event") => {
        // This only fires on a local integrity violation (corrupted stored
        // JSON, or an out-of-order seq) — everything reaching `consume()`
        // was already recorded as a well-formed StreamEvent by the
        // producer, so unlike the initial path (which has privileged
        // access to the truly raw upstream bytes) this is never evidence
        // the run itself is unhealthy. It stays local and does NOT touch
        // the canonical buffer — publishing a synthetic terminal here would
        // wrongly fail an otherwise-healthy run for every other subscriber.
        if (seq <= cursor || seq <= lastEmittedSeq) seq = lastEmittedSeq + 1;
        try {
          controller.enqueue(encodeClientStreamEvent(seq, {
            type: "run.failed",
            code: safeFailureCode(code),
            message: "The run failed.",
          }));
          lastEmittedSeq = seq;
        } catch {
          // The transport already closed.
        }
        close();
      };
      const seedTranslator = (json: string): boolean => {
        try {
          const translated = translator.translate(JSON.parse(json));
          if (
            translated.event
            && (translated.event.type === "reconcile_required"
              || (translated.event.type === "run.failed"
                && translated.event.code === "invalid_stream_event"))
          ) return false;
          return true;
        } catch {
          return false;
        }
      };

      const nextEvent = () => {
        if (subscription && replayIndex < subscription.replay.length) {
          return { event: subscription.replay[replayIndex], replay: true };
        }
        return pendingLive ? { event: pendingLive, replay: false } : null;
      };
      const consumeNext = (replay: boolean) => {
        if (replay) {
          replayIndex += 1;
        } else {
          pendingLive = null;
        }
      };

      // Static replay is retained by the canonical ring and is consumed only
      // when downstream pulls. At most one later live event waits behind it:
      // a stalled subscriber is detached rather than accumulating a private,
      // unbounded replay queue.
      pump = () => {
        while (!closed) {
          if (controller.desiredSize !== null && controller.desiredSize <= 0) return;
          const next = nextEvent();
          if (!next) {
            if (finished) close();
            return;
          }
          let translated: Translation;
          try {
            translated = translator.translate(JSON.parse(next.event.json));
          } catch {
            consumeNext(next.replay);
            fail(next.event.seq);
            return;
          }
          consumeNext(next.replay);
          if (!translated.event) {
            if (translated.terminal) close();
            continue;
          }
          if (next.event.seq <= cursor || next.event.seq <= lastEmittedSeq) {
            fail(lastEmittedSeq + 1);
            return;
          }
          try {
            controller.enqueue(encodeClientStreamEvent(next.event.seq, translated.event));
          } catch {
            close();
            return;
          }
          lastEmittedSeq = next.event.seq;
          if (translated.terminal) {
            close();
            return;
          }
          // One output per pull (or live append) keeps a boundary-sized
          // canonical frame from pushing a following terminal into a full
          // readable-stream queue.
          return;
        }
      };

      const onEvent = (event: { seq: number; json: string }) => {
        if (closed) return;
        if (pendingLive) {
          close();
          return;
        }
        pendingLive = event;
        pump?.();
      };
      const onFinish = () => {
        finished = true;
        pump?.();
      };

      subscription = subscribeRunStream(
        key,
        cursor,
        onEvent,
        onFinish,
      );
      if (!subscription) {
        close();
        return;
      }
      if (subscription.cursorAhead) {
        try {
          controller.enqueue(encodeClientStreamEvent(cursor + 1, {
            type: "reconcile_required",
            conversationId: context.conversationId,
          }));
          lastEmittedSeq = cursor + 1;
        } catch {
          // The transport already closed.
        }
        close();
        cleanup = close;
        return;
      }
      if (subscription.gapBeforeSeq !== null) {
        try {
          controller.enqueue(encodeClientStreamEvent(subscription.gapBeforeSeq, {
            type: "reconcile_required",
            conversationId: context.conversationId,
          }));
          lastEmittedSeq = subscription.gapBeforeSeq;
        } catch {
          // The transport already closed.
        }
        close();
        cleanup = close;
        return;
      }
      for (const event of subscription.seed) {
        if (!seedTranslator(event.json)) {
          fail(cursor + 1);
          break;
        }
      }
      finished = subscription.done;
      if (!closed && !finished) {
        heartbeat = setInterval(() => {
          if (
            closed
            || pendingLive
            || (subscription && replayIndex < subscription.replay.length)
            || (controller.desiredSize !== null && controller.desiredSize <= 0)
          ) return;
          try {
            controller.enqueue(KEEP_ALIVE);
          } catch {
            close();
          }
        }, KEEP_ALIVE_MS);
        heartbeat.unref?.();
      }
      cleanup = close;
    },
    pull() {
      pump?.();
    },
    cancel() {
      cleanup?.();
    },
  }, {
    highWaterMark: RESUME_QUEUE_MAX_BYTES,
    size: (chunk) => chunk.byteLength,
  });
  if (signal.aborted) {
    void stream.cancel();
  } else {
    signal.addEventListener("abort", () => cleanup?.(), { once: true });
  }
  if (!subscription) {
    void stream.cancel();
    return null;
  }
  return new Response(stream, { headers: sseHeaders() });
}
