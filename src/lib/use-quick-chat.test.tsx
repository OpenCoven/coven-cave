// @ts-nocheck — react-test-renderer has no bundled types in this repository.
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { resetProjectsCacheForTests } from "./use-projects.ts";
import { useQuickChat, type UseQuickChat } from "./use-quick-chat.ts";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const FAMILIAR = {
  id: "nova",
  display_name: "Nova",
  role: "generalist",
};
const PROJECT = {
  id: "project-1",
  name: "Coven Cave",
  root: "/workspace/coven-cave",
  access: "write",
  createdAt: "2026-08-17T00:00:00.000Z",
  updatedAt: "2026-08-17T00:00:00.000Z",
};

type ControlledSend = {
  body: Record<string, unknown>;
  signal: AbortSignal | null;
  close: () => void;
  complete: (text: string) => void;
  completeThenError: (text: string) => void;
  truncate: (text: string) => void;
};

function controlledSse(sessionId: string): {
  response: Response;
  close: () => void;
  complete: (text: string) => void;
  completeThenError: (text: string) => void;
  truncate: (text: string) => void;
} {
  const encoder = new TextEncoder();
  let streamController: ReadableStreamDefaultController<Uint8Array> | null = null;
  const enqueue = (event: Record<string, unknown>) => {
    streamController?.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
  };
  const terminalThenError = (text: string) => {
    const frames = [
      `data: ${JSON.stringify({ kind: "assistant_chunk", text })}\n\n`,
      `data: ${JSON.stringify({ kind: "done", sessionId })}\n\n`,
    ].join("");
    streamController?.enqueue(encoder.encode(frames));
    streamController?.error(new Error("reader failed after done"));
  };
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      streamController = controller;
      enqueue({ kind: "session", sessionId });
    },
  });
  return {
    response: new Response(body, {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    }),
    close: () => streamController?.close(),
    complete: (text) => {
      enqueue({ kind: "assistant_chunk", text });
      enqueue({ kind: "done", sessionId });
      streamController?.close();
    },
    completeThenError: terminalThenError,
    truncate: (text) => {
      enqueue({ kind: "assistant_chunk", text });
      streamController?.close();
    },
  };
}

class QuickChatFetch {
  readonly sends: ControlledSend[] = [];
  readonly stops: Record<string, unknown>[] = [];
  readonly stopKeepalives: boolean[] = [];
  failStop = false;
  stopFailureError = "stop registry unavailable";
  delayStops = false;
  stopOutcome = { stopped: true, queued: false };
  private readonly stopReleases: Array<() => void> = [];

  releaseNextStop(): void {
    this.stopReleases.shift()?.();
  }

  readonly fetch = async (
    input: RequestInfo | URL,
    init: RequestInit = {},
  ): Promise<Response> => {
    const url = typeof input === "string"
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;

    if (url === "/api/familiars") {
      return Response.json({ familiars: [FAMILIAR] });
    }
    if (url === "/api/projects?familiarId=nova") {
      return Response.json({ ok: true, projects: [PROJECT] });
    }
    if (url.startsWith("/api/chat/model-state?")) {
      return Response.json({ ok: true, controls: [] });
    }
    if (url === "/api/chat/send") {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      const stream = controlledSse(
        typeof body.sessionId === "string" ? body.sessionId : "session-1",
      );
      this.sends.push({
        body,
        signal: init.signal ?? null,
        close: stream.close,
        complete: stream.complete,
        completeThenError: stream.completeThenError,
        truncate: stream.truncate,
      });
      return stream.response;
    }
    if (url === "/api/chat/stop") {
      this.stops.push(JSON.parse(String(init.body)) as Record<string, unknown>);
      this.stopKeepalives.push(init.keepalive === true);
      const failStop = this.failStop;
      const stopOutcome = { ...this.stopOutcome };
      if (this.delayStops) {
        await new Promise<void>((resolve) => {
          this.stopReleases.push(resolve);
        });
      }
      return failStop
        ? Response.json({
            ok: false,
            stopped: false,
            queued: false,
            retryable: true,
            error: this.stopFailureError,
          }, { status: 503 })
        : Response.json({ ok: true, ...stopOutcome });
    }

    throw new Error(`Unexpected fetch: ${url}`);
  };
}

function Probe({ onState }: { onState: (state: UseQuickChat) => void }) {
  onState(useQuickChat());
  return null;
}

async function waitFor(assertion: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (assertion()) return;
    await act(async () => {
      await Promise.resolve();
    });
  }
  throw new Error("Timed out waiting for Quick Chat state");
}

function pageTransitionEvent(type: "pagehide" | "pageshow", persisted: boolean): PageTransitionEvent {
  return Object.assign(new Event(type), { persisted }) as PageTransitionEvent;
}

describe("useQuickChat send cancellation", () => {
  const realFetch = globalThis.fetch;
  let renderer: ReactTestRenderer | null = null;

  beforeEach(() => {
    resetProjectsCacheForTests();
  });

  afterEach(async () => {
    await act(async () => {
      renderer?.unmount();
    });
    renderer = null;
    globalThis.fetch = realFetch;
    resetProjectsCacheForTests();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  test("accepted Stop waits for server acknowledgement before aborting and cancelling", async () => {
    const requests = new QuickChatFetch();
    globalThis.fetch = requests.fetch as typeof fetch;
    let state: UseQuickChat | null = null;

    await act(async () => {
      renderer = create(<Probe onState={(next) => { state = next; }} />);
    });
    await waitFor(() => state?.projects.length === 1);
    await act(async () => {
      state!.setSelectedProjectRoot(PROJECT.root);
    });
    await waitFor(() => state?.projectLaunchReady === true);

    await act(async () => {
      state!.setDraft("first question");
    });
    let firstSend!: Promise<void>;
    await act(async () => {
      firstSend = state!.send();
      await Promise.resolve();
    });
    await waitFor(() => requests.sends.length === 1 && state?.sessionId === "session-1");

    const first = requests.sends[0]!;
    expect(first.body.runId).toEqual(expect.any(String));
    expect(first.body.runId).not.toBe("");
    expect(first.body).not.toHaveProperty("sessionId");

    await act(async () => {
      state!.setDraft("queued follow-up");
    });
    await act(async () => {
      await state!.send();
    });
    expect(state!.queued).toHaveLength(1);

    requests.delayStops = true;
    await act(async () => {
      state!.cancel();
      await Promise.resolve();
    });
    expect(first.signal?.aborted).toBe(false);
    expect(requests.stops[0]).toEqual({
      runId: first.body.runId,
    });
    expect(state!.messages.at(-1)?.lifecycle).toBe("streaming");

    requests.releaseNextStop();
    await waitFor(() => first.signal?.aborted === true);
    expect(state!.messages.at(-1)).toMatchObject({
      pending: false,
      lifecycle: "cancelled",
      error: null,
    });
    expect(state!.sendState).toBe("idle");
    expect(state!.queued).toHaveLength(1);
    expect(requests.sends).toHaveLength(1);

    await act(async () => {
      first.close();
      await firstSend;
    });
    expect(state!.queued).toHaveLength(1);
    expect(requests.sends).toHaveLength(1);
  });

  test("a queued early Stop is accepted and cancels the owned local stream", async () => {
    const requests = new QuickChatFetch();
    requests.stopOutcome = { stopped: false, queued: true };
    globalThis.fetch = requests.fetch as typeof fetch;
    let state: UseQuickChat | null = null;

    await act(async () => {
      renderer = create(<Probe onState={(next) => { state = next; }} />);
    });
    await waitFor(() => state?.projects.length === 1);
    await act(async () => {
      state!.setSelectedProjectRoot(PROJECT.root);
      state!.setDraft("question");
    });
    await waitFor(() => state?.projectLaunchReady === true);

    let send!: Promise<void>;
    await act(async () => {
      send = state!.send();
      await Promise.resolve();
    });
    await waitFor(() => requests.sends.length === 1);
    await act(async () => {
      state!.cancel();
      await Promise.resolve();
    });
    await waitFor(() => requests.sends[0]!.signal?.aborted === true);
    expect(requests.stops).toEqual([{ runId: requests.sends[0]!.body.runId }]);
    expect(state!.messages.at(-1)?.lifecycle).toBe("cancelled");

    await act(async () => {
      requests.sends[0]!.close();
      await send;
    });
  });

  test("a late no-op Stop leaves the stream attached for definitive completion", async () => {
    const requests = new QuickChatFetch();
    requests.stopOutcome = { stopped: false, queued: false };
    requests.delayStops = true;
    globalThis.fetch = requests.fetch as typeof fetch;
    let state: UseQuickChat | null = null;

    await act(async () => {
      renderer = create(<Probe onState={(next) => { state = next; }} />);
    });
    await waitFor(() => state?.projects.length === 1);
    await act(async () => {
      state!.setSelectedProjectRoot(PROJECT.root);
      state!.setDraft("question");
    });
    await waitFor(() => state?.projectLaunchReady === true);

    let send!: Promise<void>;
    await act(async () => {
      send = state!.send();
      await Promise.resolve();
    });
    await waitFor(() => requests.sends.length === 1);
    await act(async () => {
      state!.cancel();
      await Promise.resolve();
    });
    expect(requests.sends[0]!.signal?.aborted).toBe(false);

    requests.releaseNextStop();
    await act(async () => {
      await Promise.resolve();
    });
    expect(requests.sends[0]!.signal?.aborted).toBe(false);
    expect(state!.messages.at(-1)?.lifecycle).toBe("streaming");

    await act(async () => {
      requests.sends[0]!.complete("Final answer");
      await send;
    });
    expect(state!.messages.at(-1)).toMatchObject({
      text: "Final answer",
      pending: false,
      lifecycle: "complete",
      error: null,
    });
    expect(state!.sendState).toBe("done");
  });

  test("a full Stop queue stays visible, keeps the stream attached, and permits retry", async () => {
    const requests = new QuickChatFetch();
    requests.failStop = true;
    requests.stopFailureError = "The pending Stop queue is full. Retry shortly.";
    globalThis.fetch = requests.fetch as typeof fetch;
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    let state: UseQuickChat | null = null;

    await act(async () => {
      renderer = create(<Probe onState={(next) => { state = next; }} />);
    });
    await waitFor(() => state?.projects.length === 1);
    await act(async () => {
      state!.setSelectedProjectRoot(PROJECT.root);
      state!.setDraft("question");
    });
    await waitFor(() => state?.projectLaunchReady === true);

    let send!: Promise<void>;
    await act(async () => {
      send = state!.send();
      await Promise.resolve();
    });
    await waitFor(() => requests.sends.length === 1 && state?.sessionId === "session-1");

    await act(async () => {
      state!.cancel();
      await Promise.resolve();
    });
    expect(requests.sends[0]!.signal?.aborted).toBe(false);
    expect(state!.messages.at(-1)?.lifecycle).toBe("streaming");
    await waitFor(() => state?.error?.includes("pending Stop queue is full") === true);
    expect(consoleError).toHaveBeenCalledWith(
      "[Quick Chat] Failed to stop server-side response:",
      expect.any(Error),
    );

    requests.failStop = false;
    await act(async () => {
      state!.cancel();
      await Promise.resolve();
    });
    await waitFor(() => requests.sends[0]!.signal?.aborted === true);
    expect(requests.stops).toEqual([
      { runId: requests.sends[0]!.body.runId },
      { runId: requests.sends[0]!.body.runId },
    ]);
    expect(state!.messages.at(-1)?.lifecycle).toBe("cancelled");

    await act(async () => {
      requests.sends[0]!.close();
      await send;
    });
  });

  test("double Stop clicks share one in-flight request", async () => {
    const requests = new QuickChatFetch();
    requests.delayStops = true;
    globalThis.fetch = requests.fetch as typeof fetch;
    let state: UseQuickChat | null = null;

    await act(async () => {
      renderer = create(<Probe onState={(next) => { state = next; }} />);
    });
    await waitFor(() => state?.projects.length === 1);
    await act(async () => {
      state!.setSelectedProjectRoot(PROJECT.root);
      state!.setDraft("question");
    });
    await waitFor(() => state?.projectLaunchReady === true);

    let send!: Promise<void>;
    await act(async () => {
      send = state!.send();
      await Promise.resolve();
    });
    await waitFor(() => requests.sends.length === 1);
    await act(async () => {
      state!.cancel();
      state!.cancel();
      await Promise.resolve();
    });
    expect(requests.stops).toHaveLength(1);
    expect(requests.sends[0]!.signal?.aborted).toBe(false);

    requests.releaseNextStop();
    await waitFor(() => requests.sends[0]!.signal?.aborted === true);
    await act(async () => {
      requests.sends[0]!.close();
      await send;
    });
  });

  test("done before an accepted Stop response cancels the turn and parks the queue", async () => {
    const requests = new QuickChatFetch();
    requests.delayStops = true;
    globalThis.fetch = requests.fetch as typeof fetch;
    let state: UseQuickChat | null = null;

    await act(async () => {
      renderer = create(<Probe onState={(next) => { state = next; }} />);
    });
    await waitFor(() => state?.projects.length === 1);
    await act(async () => {
      state!.setSelectedProjectRoot(PROJECT.root);
      state!.setDraft("question");
    });
    await waitFor(() => state?.projectLaunchReady === true);

    let send!: Promise<void>;
    await act(async () => {
      send = state!.send();
      await Promise.resolve();
    });
    await waitFor(() => requests.sends.length === 1);
    await act(async () => {
      state!.setDraft("queued follow-up");
    });
    await act(async () => {
      await state!.send();
    });
    expect(state!.queued).toHaveLength(1);

    await act(async () => {
      state!.cancel();
      await Promise.resolve();
      requests.sends[0]!.complete("Already finished");
      await Promise.resolve();
    });
    await waitFor(() => state!.messages.some((message) => message.text === "Already finished"));
    expect(requests.sends[0]!.signal?.aborted).toBe(false);
    expect(state!.messages.find((message) => message.text === "Already finished")).toMatchObject({
      text: "Already finished",
      pending: true,
      lifecycle: "streaming",
    });
    expect(state!.queued).toHaveLength(1);
    expect(requests.sends).toHaveLength(1);

    requests.releaseNextStop();
    await act(async () => {
      await send;
    });
    expect(requests.sends[0]!.signal?.aborted).toBe(true);
    expect(state!.messages.at(-1)).toMatchObject({
      text: "Already finished",
      pending: false,
      lifecycle: "cancelled",
      error: null,
    });
    expect(state!.sendState).toBe("idle");
    expect(state!.queued).toHaveLength(1);
    expect(requests.sends).toHaveLength(1);
  });

  test("done before a settled Stop response completes and drains the queue", async () => {
    const requests = new QuickChatFetch();
    requests.stopOutcome = { stopped: false, queued: false };
    requests.delayStops = true;
    globalThis.fetch = requests.fetch as typeof fetch;
    let state: UseQuickChat | null = null;

    await act(async () => {
      renderer = create(<Probe onState={(next) => { state = next; }} />);
    });
    await waitFor(() => state?.projects.length === 1);
    await act(async () => {
      state!.setSelectedProjectRoot(PROJECT.root);
      state!.setDraft("question");
    });
    await waitFor(() => state?.projectLaunchReady === true);

    let send!: Promise<void>;
    await act(async () => {
      send = state!.send();
      await Promise.resolve();
    });
    await waitFor(() => requests.sends.length === 1);
    await act(async () => {
      state!.setDraft("queued follow-up");
    });
    await act(async () => {
      await state!.send();
    });
    expect(state!.queued).toHaveLength(1);

    await act(async () => {
      state!.cancel();
      await Promise.resolve();
    });
    expect(requests.stops).toHaveLength(1);
    expect(requests.sends[0]!.signal?.aborted).toBe(false);

    await act(async () => {
      requests.sends[0]!.complete("Final answer");
      await Promise.resolve();
    });
    await waitFor(() => state!.messages.some((message) => message.text === "Final answer"));
    expect(state!.messages.find((message) => message.text === "Final answer")).toMatchObject({
      text: "Final answer",
      pending: true,
      lifecycle: "streaming",
    });
    expect(state!.queued).toHaveLength(1);
    expect(requests.sends).toHaveLength(1);
    expect(requests.sends[0]!.signal?.aborted).toBe(false);

    requests.releaseNextStop();
    await waitFor(() => requests.sends.length === 2);
    expect(state!.messages.find((message) => message.text === "Final answer")).toMatchObject({
      pending: false,
      lifecycle: "complete",
      error: null,
    });
    expect(state!.queued).toHaveLength(0);

    await act(async () => {
      requests.sends[1]!.complete("Follow-up answer");
      await send;
    });
    expect(state!.messages.at(-1)).toMatchObject({
      text: "Follow-up answer",
      pending: false,
      lifecycle: "complete",
      error: null,
    });
  });

  test("done before a failed Stop response stays complete and surfaces the Stop failure", async () => {
    const requests = new QuickChatFetch();
    requests.delayStops = true;
    requests.failStop = true;
    globalThis.fetch = requests.fetch as typeof fetch;
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    let state: UseQuickChat | null = null;

    await act(async () => {
      renderer = create(<Probe onState={(next) => { state = next; }} />);
    });
    await waitFor(() => state?.projects.length === 1);
    await act(async () => {
      state!.setSelectedProjectRoot(PROJECT.root);
      state!.setDraft("question");
    });
    await waitFor(() => state?.projectLaunchReady === true);

    let send!: Promise<void>;
    await act(async () => {
      send = state!.send();
      await Promise.resolve();
    });
    await waitFor(() => requests.sends.length === 1);
    await act(async () => {
      state!.cancel();
      await Promise.resolve();
      requests.sends[0]!.complete("Final answer");
      await Promise.resolve();
    });
    expect(state!.messages.at(-1)).toMatchObject({
      text: "Final answer",
      pending: true,
      lifecycle: "streaming",
    });
    expect(state!.error).toBeNull();

    requests.releaseNextStop();
    await act(async () => {
      await send;
    });
    expect(requests.sends[0]!.signal?.aborted).toBe(false);
    expect(state!.messages.at(-1)).toMatchObject({
      text: "Final answer",
      pending: false,
      lifecycle: "complete",
      error: null,
    });
    expect(state!.sendState).toBe("done");
    expect(state!.error).toContain("stop registry unavailable");
    expect(consoleError).toHaveBeenCalledWith(
      "[Quick Chat] Failed to stop server-side response:",
      expect.any(Error),
    );
  });

  test("done before a reader error completes the turn and drains the queued prompt", async () => {
    const requests = new QuickChatFetch();
    globalThis.fetch = requests.fetch as typeof fetch;
    let state: UseQuickChat | null = null;

    await act(async () => {
      renderer = create(<Probe onState={(next) => { state = next; }} />);
    });
    await waitFor(() => state?.projects.length === 1);
    await act(async () => {
      state!.setSelectedProjectRoot(PROJECT.root);
      state!.setDraft("question");
    });
    await waitFor(() => state?.projectLaunchReady === true);

    let send!: Promise<void>;
    await act(async () => {
      send = state!.send();
      await Promise.resolve();
    });
    await waitFor(() => requests.sends.length === 1);
    await act(async () => {
      state!.setDraft("queued follow-up");
    });
    await act(async () => {
      await state!.send();
      requests.sends[0]!.completeThenError("Definitive answer");
      await Promise.resolve();
    });

    await waitFor(() => requests.sends.length === 2);
    expect(state!.messages.find((message) => message.text === "Definitive answer")).toMatchObject({
      pending: false,
      lifecycle: "complete",
      error: null,
    });
    expect(state!.queued).toHaveLength(0);

    await act(async () => {
      requests.sends[1]!.complete("Follow-up answer");
      await send;
    });
    expect(state!.messages.at(-1)).toMatchObject({
      text: "Follow-up answer",
      pending: false,
      lifecycle: "complete",
      error: null,
    });
  });

  test("truncated SSE fails with partial text and parks the queued prompt", async () => {
    const requests = new QuickChatFetch();
    globalThis.fetch = requests.fetch as typeof fetch;
    let state: UseQuickChat | null = null;

    await act(async () => {
      renderer = create(<Probe onState={(next) => { state = next; }} />);
    });
    await waitFor(() => state?.projects.length === 1);
    await act(async () => {
      state!.setSelectedProjectRoot(PROJECT.root);
      state!.setDraft("question");
    });
    await waitFor(() => state?.projectLaunchReady === true);

    let send!: Promise<void>;
    await act(async () => {
      send = state!.send();
      await Promise.resolve();
    });
    await waitFor(() => requests.sends.length === 1);
    await act(async () => {
      state!.setDraft("queued follow-up");
    });
    await act(async () => {
      await state!.send();
    });
    expect(state!.queued).toHaveLength(1);

    await act(async () => {
      requests.sends[0]!.truncate("Useful partial answer");
      await send;
    });
    expect(state!.messages.at(-1)).toMatchObject({
      text: "Useful partial answer",
      pending: false,
      lifecycle: "failed",
      error: "the connection closed before the familiar finished responding",
    });
    expect(state!.sendState).toBe("idle");
    expect(state!.queued).toHaveLength(1);
    expect(requests.sends).toHaveLength(1);
  });

  test("newThread stops one captured run before clearing the local thread", async () => {
    const requests = new QuickChatFetch();
    globalThis.fetch = requests.fetch as typeof fetch;
    let state: UseQuickChat | null = null;

    await act(async () => {
      renderer = create(<Probe onState={(next) => { state = next; }} />);
    });
    await waitFor(() => state?.projects.length === 1);
    await act(async () => {
      state!.setSelectedProjectRoot(PROJECT.root);
      state!.setDraft("question");
    });
    await waitFor(() => state?.projectLaunchReady === true);

    let send!: Promise<void>;
    await act(async () => {
      send = state!.send();
      await Promise.resolve();
    });
    await waitFor(() => requests.sends.length === 1 && state?.sessionId === "session-1");

    await act(async () => {
      state!.newThread();
      state!.newThread();
      await Promise.resolve();
    });
    expect(requests.stops).toEqual([{ runId: requests.sends[0]!.body.runId }]);
    expect(requests.stopKeepalives).toEqual([true]);
    expect(requests.sends[0]!.signal?.aborted).toBe(true);
    expect(state!.messages).toEqual([]);
    expect(state!.sessionId).toBeNull();

    await act(async () => {
      requests.sends[0]!.close();
      await send;
    });
  });

  test("non-persisted pagehide aborts immediately and stale cleanup cannot own a later send", async () => {
    const requests = new QuickChatFetch();
    globalThis.fetch = requests.fetch as typeof fetch;
    const testWindow = Object.assign(new EventTarget(), {
      localStorage: {
        getItem: () => null,
        setItem: () => {},
      },
    });
    vi.stubGlobal("window", testWindow);
    let state: UseQuickChat | null = null;

    await act(async () => {
      renderer = create(<Probe onState={(next) => { state = next; }} />);
    });
    await waitFor(() => state?.projects.length === 1);
    await act(async () => {
      state!.setSelectedProjectRoot(PROJECT.root);
      state!.setDraft("question");
    });
    await waitFor(() => state?.projectLaunchReady === true);

    let send!: Promise<void>;
    await act(async () => {
      send = state!.send();
      await Promise.resolve();
    });
    await waitFor(() => requests.sends.length === 1 && state?.sessionId === "session-1");

    await act(async () => {
      window.dispatchEvent(pageTransitionEvent("pagehide", false));
      await Promise.resolve();
    });
    expect(requests.stops).toEqual([{ runId: requests.sends[0]!.body.runId }]);
    expect(requests.stopKeepalives).toEqual([true]);
    expect(requests.sends[0]!.signal?.aborted).toBe(true);
    expect(state!.messages.at(-1)).toMatchObject({
      pending: true,
      lifecycle: "streaming",
      error: null,
    });
    expect(state!.sendState).toBe("sending");

    await act(async () => {
      window.dispatchEvent(pageTransitionEvent("pageshow", false));
      await Promise.resolve();
    });
    expect(state!.sendState).toBe("sending");

    await act(async () => {
      state!.setDraft("question after restore");
    });
    let restoredSend!: Promise<void>;
    await act(async () => {
      restoredSend = state!.send();
      await Promise.resolve();
    });
    await waitFor(() => requests.sends.length === 2 && state?.sendState === "sending");
    expect(requests.sends[1]!.signal?.aborted).toBe(false);

    await act(async () => {
      requests.sends[0]!.close();
      await send;
    });
    expect(state!.sendState).toBe("sending");
    expect(requests.sends[1]!.signal?.aborted).toBe(false);
    expect(state!.messages.at(-1)?.pending).toBe(true);

    await act(async () => {
      renderer!.unmount();
    });
    renderer = null;
    expect(requests.stops).toEqual([
      { runId: requests.sends[0]!.body.runId },
      { runId: requests.sends[1]!.body.runId },
    ]);
    expect(requests.stopKeepalives).toEqual([true, true]);
    expect(requests.sends[1]!.signal?.aborted).toBe(true);

    requests.sends[1]!.close();
    await restoredSend;
  });

  test("BFCache waits for an accepted keepalive Stop before cancelling and parks the queue", async () => {
    const requests = new QuickChatFetch();
    requests.delayStops = true;
    globalThis.fetch = requests.fetch as typeof fetch;
    const testWindow = Object.assign(new EventTarget(), {
      localStorage: {
        getItem: () => null,
        setItem: () => {},
      },
    });
    vi.stubGlobal("window", testWindow);
    let state: UseQuickChat | null = null;

    await act(async () => {
      renderer = create(<Probe onState={(next) => { state = next; }} />);
    });
    await waitFor(() => state?.projects.length === 1);
    await act(async () => {
      state!.setSelectedProjectRoot(PROJECT.root);
      state!.setDraft("question");
    });
    await waitFor(() => state?.projectLaunchReady === true);

    let send!: Promise<void>;
    await act(async () => {
      send = state!.send();
      await Promise.resolve();
    });
    await waitFor(() => requests.sends.length === 1);
    await act(async () => {
      state!.setDraft("queued follow-up");
    });
    await act(async () => {
      await state!.send();
      window.dispatchEvent(pageTransitionEvent("pagehide", true));
      window.dispatchEvent(pageTransitionEvent("pagehide", true));
      await Promise.resolve();
    });

    expect(requests.stops).toEqual([{ runId: requests.sends[0]!.body.runId }]);
    expect(requests.stopKeepalives).toEqual([true]);
    expect(requests.sends[0]!.signal?.aborted).toBe(false);
    expect(state!.messages.at(-1)?.lifecycle).toBe("streaming");
    expect(state!.sendState).toBe("sending");

    requests.releaseNextStop();
    await waitFor(() => requests.sends[0]!.signal?.aborted === true);
    expect(state!.messages.at(-1)).toMatchObject({
      pending: false,
      lifecycle: "cancelled",
      error: null,
    });
    expect(state!.sendState).toBe("idle");
    expect(state!.queued).toHaveLength(1);

    await act(async () => {
      renderer!.unmount();
    });
    renderer = null;
    expect(requests.stops).toHaveLength(1);

    requests.sends[0]!.close();
    await send;
  });

  test("BFCache settled Stop keeps the stream attached until definitive done", async () => {
    const requests = new QuickChatFetch();
    requests.delayStops = true;
    requests.stopOutcome = { stopped: false, queued: false };
    globalThis.fetch = requests.fetch as typeof fetch;
    const testWindow = Object.assign(new EventTarget(), {
      localStorage: {
        getItem: () => null,
        setItem: () => {},
      },
    });
    vi.stubGlobal("window", testWindow);
    let state: UseQuickChat | null = null;

    await act(async () => {
      renderer = create(<Probe onState={(next) => { state = next; }} />);
    });
    await waitFor(() => state?.projects.length === 1);
    await act(async () => {
      state!.setSelectedProjectRoot(PROJECT.root);
      state!.setDraft("question");
    });
    await waitFor(() => state?.projectLaunchReady === true);

    let send!: Promise<void>;
    await act(async () => {
      send = state!.send();
      await Promise.resolve();
      window.dispatchEvent(pageTransitionEvent("pagehide", true));
      await Promise.resolve();
    });
    expect(requests.stopKeepalives).toEqual([true]);
    expect(requests.sends[0]!.signal?.aborted).toBe(false);
    expect(state!.messages.at(-1)?.lifecycle).toBe("streaming");
    expect(state!.sendState).toBe("sending");

    requests.releaseNextStop();
    await act(async () => {
      window.dispatchEvent(pageTransitionEvent("pageshow", true));
      await Promise.resolve();
    });
    expect(requests.sends[0]!.signal?.aborted).toBe(false);
    expect(state!.messages.at(-1)?.lifecycle).toBe("streaming");
    expect(state!.sendState).toBe("sending");

    await act(async () => {
      requests.sends[0]!.complete("Definitive answer");
      await send;
    });
    expect(state!.messages.at(-1)).toMatchObject({
      text: "Definitive answer",
      pending: false,
      lifecycle: "complete",
      error: null,
    });
    expect(state!.sendState).toBe("done");

    await act(async () => {
      renderer!.unmount();
    });
    renderer = null;
    expect(requests.stops).toHaveLength(1);
  });

  test("BFCache Stop failure preserves completion and surfaces the existing error", async () => {
    const requests = new QuickChatFetch();
    requests.delayStops = true;
    requests.failStop = true;
    globalThis.fetch = requests.fetch as typeof fetch;
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const testWindow = Object.assign(new EventTarget(), {
      localStorage: {
        getItem: () => null,
        setItem: () => {},
      },
    });
    vi.stubGlobal("window", testWindow);
    let state: UseQuickChat | null = null;

    await act(async () => {
      renderer = create(<Probe onState={(next) => { state = next; }} />);
    });
    await waitFor(() => state?.projects.length === 1);
    await act(async () => {
      state!.setSelectedProjectRoot(PROJECT.root);
      state!.setDraft("question");
    });
    await waitFor(() => state?.projectLaunchReady === true);

    let send!: Promise<void>;
    await act(async () => {
      send = state!.send();
      await Promise.resolve();
      window.dispatchEvent(pageTransitionEvent("pagehide", true));
      await Promise.resolve();
    });
    expect(requests.sends[0]!.signal?.aborted).toBe(false);
    expect(state!.sendState).toBe("sending");

    requests.releaseNextStop();
    await waitFor(() => state?.error?.includes("stop registry unavailable") === true);
    expect(requests.sends[0]!.signal?.aborted).toBe(false);
    expect(state!.messages.at(-1)?.lifecycle).toBe("streaming");
    expect(consoleError).toHaveBeenCalledWith(
      "[Quick Chat] Failed to stop server-side response:",
      expect.any(Error),
    );

    await act(async () => {
      requests.sends[0]!.complete("Definitive answer");
      await send;
    });
    expect(state!.messages.at(-1)).toMatchObject({
      text: "Definitive answer",
      pending: false,
      lifecycle: "complete",
      error: null,
    });
    expect(state!.sendState).toBe("done");
  });

  test("a stale BFCache Stop outcome cannot cancel or report against a newer send", async () => {
    const requests = new QuickChatFetch();
    requests.delayStops = true;
    globalThis.fetch = requests.fetch as typeof fetch;
    const testWindow = Object.assign(new EventTarget(), {
      localStorage: {
        getItem: () => null,
        setItem: () => {},
      },
    });
    vi.stubGlobal("window", testWindow);
    let state: UseQuickChat | null = null;

    await act(async () => {
      renderer = create(<Probe onState={(next) => { state = next; }} />);
    });
    await waitFor(() => state?.projects.length === 1);
    await act(async () => {
      state!.setSelectedProjectRoot(PROJECT.root);
      state!.setDraft("first question");
    });
    await waitFor(() => state?.projectLaunchReady === true);

    let firstSend!: Promise<void>;
    await act(async () => {
      firstSend = state!.send();
      await Promise.resolve();
      window.dispatchEvent(pageTransitionEvent("pagehide", true));
      await Promise.resolve();
      state!.newThread();
      state!.setDraft("replacement question");
    });
    let replacementSend!: Promise<void>;
    await act(async () => {
      replacementSend = state!.send();
      await Promise.resolve();
    });
    await waitFor(() => requests.sends.length === 2 && state?.sendState === "sending");
    expect(requests.stops).toEqual([{ runId: requests.sends[0]!.body.runId }]);

    requests.releaseNextStop();
    await act(async () => {
      requests.sends[0]!.close();
      await firstSend;
    });
    expect(state!.sendState).toBe("sending");
    expect(requests.sends[1]!.signal?.aborted).toBe(false);
    expect(state!.messages.at(-1)).toMatchObject({
      pending: true,
      lifecycle: "streaming",
    });

    await act(async () => {
      requests.sends[1]!.complete("Replacement answer");
      await replacementSend;
    });
    expect(state!.messages.at(-1)).toMatchObject({
      text: "Replacement answer",
      pending: false,
      lifecycle: "complete",
    });
  });

  test("pagehide reissues a pending normal Stop once with keepalive", async () => {
    const requests = new QuickChatFetch();
    requests.delayStops = true;
    globalThis.fetch = requests.fetch as typeof fetch;
    const testWindow = Object.assign(new EventTarget(), {
      localStorage: {
        getItem: () => null,
        setItem: () => {},
      },
    });
    vi.stubGlobal("window", testWindow);
    let state: UseQuickChat | null = null;

    await act(async () => {
      renderer = create(<Probe onState={(next) => { state = next; }} />);
    });
    await waitFor(() => state?.projects.length === 1);
    await act(async () => {
      state!.setSelectedProjectRoot(PROJECT.root);
      state!.setDraft("question");
    });
    await waitFor(() => state?.projectLaunchReady === true);

    let send!: Promise<void>;
    await act(async () => {
      send = state!.send();
      await Promise.resolve();
    });
    await waitFor(() => requests.sends.length === 1);
    await act(async () => {
      state!.cancel();
      await Promise.resolve();
    });
    expect(requests.stops).toHaveLength(1);
    expect(requests.stopKeepalives).toEqual([false]);

    await act(async () => {
      window.dispatchEvent(new Event("pagehide"));
      await Promise.resolve();
    });
    expect(requests.stops).toEqual([
      { runId: requests.sends[0]!.body.runId },
      { runId: requests.sends[0]!.body.runId },
    ]);
    expect(requests.stopKeepalives).toEqual([false, true]);
    expect(requests.sends[0]!.signal?.aborted).toBe(true);
    expect(state!.messages.at(-1)).toMatchObject({
      pending: true,
      lifecycle: "streaming",
      error: null,
    });
    expect(state!.sendState).toBe("sending");

    await act(async () => {
      renderer!.unmount();
    });
    renderer = null;
    expect(requests.stops).toHaveLength(2);

    requests.releaseNextStop();
    requests.releaseNextStop();
    requests.sends[0]!.close();
    await send;
  });
});
