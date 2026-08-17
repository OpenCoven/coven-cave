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
};

function controlledSse(sessionId: string): {
  response: Response;
  close: () => void;
} {
  const encoder = new TextEncoder();
  let streamController: ReadableStreamDefaultController<Uint8Array> | null = null;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      streamController = controller;
      controller.enqueue(encoder.encode(
        `data: ${JSON.stringify({ kind: "session", sessionId })}\n\n`,
      ));
    },
  });
  return {
    response: new Response(body, {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    }),
    close: () => streamController?.close(),
  };
}

class QuickChatFetch {
  readonly sends: ControlledSend[] = [];
  readonly stops: Record<string, unknown>[] = [];
  readonly stopKeepalives: boolean[] = [];
  failStop = false;
  delayStops = false;
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
      });
      return stream.response;
    }
    if (url === "/api/chat/stop") {
      this.stops.push(JSON.parse(String(init.body)) as Record<string, unknown>);
      this.stopKeepalives.push(init.keepalive === true);
      if (this.delayStops) {
        await new Promise<void>((resolve) => {
          this.stopReleases.push(resolve);
        });
      }
      return this.failStop
        ? Response.json({ ok: false, error: "stop registry unavailable" }, { status: 503 })
        : Response.json({ ok: true, stopped: true });
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

  test("a delayed old Stop stays run-scoped after a newer send resumes the same session", async () => {
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

    requests.delayStops = true;
    await act(async () => {
      state!.cancel();
      await Promise.resolve();
    });
    expect(first.signal?.aborted).toBe(true);
    expect(requests.stops[0]).toEqual({
      runId: first.body.runId,
    });
    expect(state!.messages.at(-1)?.lifecycle).toBe("cancelled");

    await act(async () => {
      state!.setDraft("second question");
    });
    let secondSend!: Promise<void>;
    await act(async () => {
      secondSend = state!.send();
      await Promise.resolve();
    });
    await waitFor(() => requests.sends.length === 2);

    const second = requests.sends[1]!;
    expect(second.body.runId).toEqual(expect.any(String));
    expect(second.body.runId).not.toBe(first.body.runId);
    expect(second.body.sessionId).toBe("session-1");
    expect(requests.stops[0]).not.toHaveProperty("sessionId");
    expect(second.signal?.aborted).toBe(false);

    requests.delayStops = false;
    requests.releaseNextStop();
    await act(async () => {
      await Promise.resolve();
    });
    expect(second.signal?.aborted).toBe(false);

    await act(async () => {
      first.close();
      await firstSend;
    });
    expect(state!.sendState).toBe("sending");
    expect(second.signal?.aborted).toBe(false);
    expect(state!.messages.at(-1)?.pending).toBe(true);

    await act(async () => {
      state!.cancel();
      await Promise.resolve();
    });
    expect(second.signal?.aborted).toBe(true);
    expect(requests.stops[1]).toEqual({
      runId: second.body.runId,
    });

    await act(async () => {
      second.close();
      await secondSend;
    });
  });

  test("a stop API failure remains visible without delaying local cancellation", async () => {
    const requests = new QuickChatFetch();
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
    await waitFor(() => requests.sends.length === 1 && state?.sessionId === "session-1");

    await act(async () => {
      state!.cancel();
      await Promise.resolve();
    });
    expect(requests.sends[0]!.signal?.aborted).toBe(true);
    expect(state!.messages.at(-1)?.lifecycle).toBe("cancelled");
    await waitFor(() => state?.error?.includes("stop registry unavailable") === true);
    expect(consoleError).toHaveBeenCalledWith(
      "[Quick Chat] Failed to stop server-side response:",
      expect.any(Error),
    );

    await act(async () => {
      requests.sends[0]!.close();
      await send;
    });
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

  test("pagehide and unmount share one keepalive Stop for the captured run", async () => {
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
      window.dispatchEvent(new Event("pagehide"));
      await Promise.resolve();
    });
    expect(requests.stops).toEqual([{ runId: requests.sends[0]!.body.runId }]);
    expect(requests.stopKeepalives).toEqual([true]);
    expect(requests.sends[0]!.signal?.aborted).toBe(true);

    await act(async () => {
      renderer!.unmount();
    });
    renderer = null;
    expect(requests.stops).toHaveLength(1);

    requests.sends[0]!.close();
    await send;
  });
});
