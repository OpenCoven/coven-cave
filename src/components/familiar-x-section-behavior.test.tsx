// @ts-nocheck
import { createElement } from "react";
import {
  act,
  create,
  type ReactTestInstance,
  type ReactTestRenderer,
} from "react-test-renderer";
import { beforeEach, describe, expect, test, vi } from "vitest";

const browserMocks = vi.hoisted(() => ({
  reserve: vi.fn(),
  cancel: vi.fn(),
  open: vi.fn(),
}));
const announce = vi.hoisted(() => vi.fn());

vi.mock("@/lib/tauri-platform", () => ({
  useTauriPlatform: () => "browser",
}));
vi.mock("@/lib/open-system-browser", () => ({
  reserveSystemBrowserWindow: browserMocks.reserve,
  cancelSystemBrowserOpen: browserMocks.cancel,
  openSystemBrowser: browserMocks.open,
}));
vi.mock("@/lib/use-armed-confirm", () => ({
  useArmedConfirm: () => ({
    armed: false,
    trigger: (callback: () => void) => callback(),
  }),
}));
vi.mock("@/components/ui/live-region", () => ({
  useAnnouncer: () => ({ announce }),
}));
vi.mock("@/components/ui/button", () => ({
  Button: ({ children, loading: _loading, ...props }: Record<string, unknown>) =>
    createElement("button", props, children),
}));
vi.mock("@/components/ui/error-state", () => ({
  ErrorState: ({ headline, subtitle }: { headline: string; subtitle: string }) =>
    createElement("div", null, `${headline}: ${subtitle}`),
}));
vi.mock("@/components/ui/skeleton", () => ({
  Skeleton: () => createElement("span"),
  SkeletonGroup: ({ children }: { children: unknown }) =>
    createElement("div", null, children),
}));

import { FamiliarXSection } from "./familiar-x-section";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

type Deferred<T> = {
  promise: Promise<T>;
  resolve(value: T): void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function jsonResponse(body: unknown, ok = true) {
  return {
    ok,
    json: async () => body,
  };
}

const familiarA = {
  id: "familiar-a",
  display_name: "A",
  xResearchEnabled: false,
  xPublishEnabled: false,
};
const familiarB = {
  id: "familiar-b",
  display_name: "B",
  xResearchEnabled: true,
  xPublishEnabled: false,
};

function button(renderer: ReactTestRenderer, label: string): ReactTestInstance {
  return renderer.root.find(
    (node) => node.type === "button" && node.props["aria-label"] === label,
  );
}

async function renderWithConnection(familiar: typeof familiarA, connected: boolean) {
  const connection = connected
    ? {
      configured: true,
      connected: true,
      activeFlow: false,
      account: { id: "42", username: "cave", name: "Cave" },
      scopes: ["tweet.read", "users.read", "offline.access"],
    }
    : { configured: true, connected: false, activeFlow: false };
  globalThis.fetch = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === "/api/x/connection" && !init?.method) {
      return jsonResponse(connection);
    }
    throw new Error(`unexpected fetch: ${url} ${init?.method ?? "GET"}`);
  });
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(<FamiliarXSection familiar={familiar} />);
  });
  return renderer;
}

beforeEach(() => {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      location: { hostname: "localhost" },
      dispatchEvent: vi.fn(),
      setInterval: globalThis.setInterval,
      clearInterval: globalThis.clearInterval,
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
    },
  });
  browserMocks.reserve.mockReset();
  browserMocks.cancel.mockReset();
  browserMocks.open.mockReset();
  announce.mockReset();
  browserMocks.reserve.mockReturnValue({
    ok: true,
    kind: "browser",
    popup: { opener: null, closed: false, location: { replace() {} }, close() {} },
  });
  browserMocks.open.mockResolvedValue({ ok: true });
});

describe("FamiliarXSection async ownership", () => {
  test("switching familiars aborts and closes a pending OAuth start without navigating its late result", async () => {
    const renderer = await renderWithConnection(familiarA, false);
    const start = deferred<ReturnType<typeof jsonResponse>>();
    const requests: Array<{ method: string; body?: string; signal?: AbortSignal }> = [];
    globalThis.fetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (url !== "/api/x/oauth/start") throw new Error(`unexpected fetch: ${url}`);
      requests.push({
        method: init?.method ?? "GET",
        body: init?.body as string | undefined,
        signal: init?.signal as AbortSignal | undefined,
      });
      if (init?.method === "POST") return start.promise;
      return jsonResponse({ ok: true });
    });

    await act(async () => {
      renderer.root.findByType("button").props.onClick();
      await Promise.resolve();
    });
    const posted = JSON.parse(requests.find((request) => request.method === "POST")!.body!);

    await act(async () => {
      renderer.update(<FamiliarXSection familiar={familiarB} />);
    });

    expect(requests.find((request) => request.method === "POST")!.signal?.aborted).toBe(true);
    expect(browserMocks.cancel).toHaveBeenCalledTimes(1);
    const cancelled = requests.find((request) => request.method === "DELETE");
    expect(JSON.parse(cancelled!.body!)).toEqual({ flowId: posted.flowId });

    await act(async () => {
      start.resolve(jsonResponse({
        ok: true,
        flowId: posted.flowId,
        authorizationUrl: "https://x.com/i/oauth2/authorize",
      }));
      await start.promise;
      await Promise.resolve();
    });

    expect(browserMocks.open).not.toHaveBeenCalled();
  });

  test("a familiar switch racing OAuth POST completion cleans up only the old returned flow", async () => {
    const renderer = await renderWithConnection(familiarA, false);
    const startA = deferred<ReturnType<typeof jsonResponse>>();
    const startBodies: Array<{ flowId: string }> = [];
    const cancelledFlowIds: string[] = [];
    let connectionPolls = 0;
    const reservationA = {
      ok: true,
      kind: "browser",
      popup: { opener: null, closed: false, location: { replace() {} }, close() {} },
    };
    const reservationB = {
      ok: true,
      kind: "browser",
      popup: { opener: null, closed: false, location: { replace() {} }, close() {} },
    };
    browserMocks.reserve
      .mockReturnValueOnce(reservationA)
      .mockReturnValueOnce(reservationB);
    globalThis.fetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/x/oauth/start" && init?.method === "POST") {
        const body = JSON.parse(init.body as string) as { flowId: string };
        startBodies.push(body);
        if (startBodies.length === 1) return startA.promise;
        return jsonResponse({
          ok: true,
          flowId: body.flowId,
          authorizationUrl: "https://x.com/i/oauth2/authorize?flow=new",
        });
      }
      if (url === "/api/x/oauth/start" && init?.method === "DELETE") {
        cancelledFlowIds.push(
          (JSON.parse(init.body as string) as { flowId: string }).flowId,
        );
        return jsonResponse({ ok: true });
      }
      if (url === "/api/x/connection" && !init?.method) {
        connectionPolls += 1;
        return jsonResponse({
          configured: true,
          connected: false,
          activeFlow: true,
          oauthFlowId: startBodies[1].flowId,
          oauthOutcome: "pending",
        });
      }
      throw new Error(`unexpected fetch: ${url} ${init?.method ?? "GET"}`);
    });

    await act(async () => {
      renderer.root.findByType("button").props.onClick();
      await Promise.resolve();
    });
    await act(async () => {
      renderer.update(<FamiliarXSection familiar={familiarB} />);
    });
    await act(async () => {
      renderer.root.findByType("button").props.onClick();
      await Promise.resolve();
      await Promise.resolve();
    });

    const oldFlowId = startBodies[0].flowId;
    const newFlowId = startBodies[1].flowId;
    const pollsBeforeOldCompletion = connectionPolls;
    await act(async () => {
      startA.resolve(jsonResponse({
        ok: true,
        flowId: oldFlowId,
        authorizationUrl: "https://x.com/i/oauth2/authorize?flow=old",
      }));
      await startA.promise;
      await Promise.resolve();
    });

    expect(browserMocks.cancel).toHaveBeenCalledWith(reservationA);
    expect(browserMocks.cancel).not.toHaveBeenCalledWith(reservationB);
    expect(cancelledFlowIds.filter((flowId) => flowId === oldFlowId)).toHaveLength(2);
    expect(cancelledFlowIds).not.toContain(newFlowId);
    expect(browserMocks.open).toHaveBeenCalledTimes(1);
    expect(browserMocks.open).toHaveBeenCalledWith(
      "https://x.com/i/oauth2/authorize?flow=new",
      reservationB,
    );
    expect(connectionPolls).toBe(pollsBeforeOldCompletion);
    expect(announce).toHaveBeenCalledTimes(1);
    expect(announce).toHaveBeenCalledWith("X authorization opened in the system browser.");
    expect(JSON.stringify(renderer.toJSON())).toContain("Waiting for authorization");

    await act(async () => {
      renderer.unmount();
    });
  });

  test("switching familiars after browser handoff closes the active OAuth reservation", async () => {
    const reservation = {
      ok: true,
      kind: "browser",
      popup: { opener: null, closed: false, location: { replace() {} }, close() {} },
    };
    browserMocks.reserve.mockReturnValue(reservation);
    const renderer = await renderWithConnection(familiarA, false);
    let flowId = "";
    const cancelledFlowIds: string[] = [];
    globalThis.fetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/x/oauth/start" && init?.method === "POST") {
        flowId = (JSON.parse(init.body as string) as { flowId: string }).flowId;
        return jsonResponse({
          ok: true,
          flowId,
          authorizationUrl: "https://x.com/i/oauth2/authorize",
        });
      }
      if (url === "/api/x/oauth/start" && init?.method === "DELETE") {
        cancelledFlowIds.push(
          (JSON.parse(init.body as string) as { flowId: string }).flowId,
        );
        return jsonResponse({ ok: true });
      }
      if (url === "/api/x/connection" && !init?.method) {
        return jsonResponse({
          configured: true,
          connected: false,
          activeFlow: true,
          oauthFlowId: flowId,
          oauthOutcome: "pending",
        });
      }
      throw new Error(`unexpected fetch: ${url} ${init?.method ?? "GET"}`);
    });

    await act(async () => {
      renderer.root.findByType("button").props.onClick();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(browserMocks.open).toHaveBeenCalledWith(
      "https://x.com/i/oauth2/authorize",
      reservation,
    );

    await act(async () => {
      renderer.update(<FamiliarXSection familiar={familiarB} />);
    });

    expect(browserMocks.cancel).toHaveBeenCalledWith(reservation);
    expect(cancelledFlowIds).toContain(flowId);
  });

  test("unmounting after browser handoff closes the active OAuth reservation", async () => {
    const reservation = {
      ok: true,
      kind: "browser",
      popup: { opener: null, closed: false, location: { replace() {} }, close() {} },
    };
    browserMocks.reserve.mockReturnValue(reservation);
    const renderer = await renderWithConnection(familiarA, false);
    let flowId = "";
    const cancelledFlowIds: string[] = [];
    globalThis.fetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/x/oauth/start" && init?.method === "POST") {
        flowId = (JSON.parse(init.body as string) as { flowId: string }).flowId;
        return jsonResponse({
          ok: true,
          flowId,
          authorizationUrl: "https://x.com/i/oauth2/authorize",
        });
      }
      if (url === "/api/x/oauth/start" && init?.method === "DELETE") {
        cancelledFlowIds.push(
          (JSON.parse(init.body as string) as { flowId: string }).flowId,
        );
        return jsonResponse({ ok: true });
      }
      if (url === "/api/x/connection" && !init?.method) {
        return jsonResponse({
          configured: true,
          connected: false,
          activeFlow: true,
          oauthFlowId: flowId,
          oauthOutcome: "pending",
        });
      }
      throw new Error(`unexpected fetch: ${url} ${init?.method ?? "GET"}`);
    });

    await act(async () => {
      renderer.root.findByType("button").props.onClick();
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      renderer.unmount();
    });

    expect(browserMocks.cancel).toHaveBeenCalledWith(reservation);
    expect(cancelledFlowIds).toContain(flowId);
  });

  test("OAuth polling timeout closes the active browser reservation", async () => {
    const reservation = {
      ok: true,
      kind: "browser",
      popup: { opener: null, closed: false, location: { replace() {} }, close() {} },
    };
    browserMocks.reserve.mockReturnValue(reservation);
    const renderer = await renderWithConnection(familiarA, false);
    let timeoutCallback: (() => void) | undefined;
    window.setInterval = vi.fn(() => 1);
    window.clearInterval = vi.fn();
    window.setTimeout = vi.fn((callback: () => void) => {
      timeoutCallback = callback;
      return 2;
    });
    window.clearTimeout = vi.fn();
    let flowId = "";
    const cancelledFlowIds: string[] = [];
    globalThis.fetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/x/oauth/start" && init?.method === "POST") {
        flowId = (JSON.parse(init.body as string) as { flowId: string }).flowId;
        return jsonResponse({
          ok: true,
          flowId,
          authorizationUrl: "https://x.com/i/oauth2/authorize",
        });
      }
      if (url === "/api/x/oauth/start" && init?.method === "DELETE") {
        cancelledFlowIds.push(
          (JSON.parse(init.body as string) as { flowId: string }).flowId,
        );
        return jsonResponse({ ok: true });
      }
      if (url === "/api/x/connection" && !init?.method) {
        return jsonResponse({
          configured: true,
          connected: false,
          activeFlow: true,
          oauthFlowId: flowId,
          oauthOutcome: "pending",
        });
      }
      throw new Error(`unexpected fetch: ${url} ${init?.method ?? "GET"}`);
    });

    await act(async () => {
      renderer.root.findByType("button").props.onClick();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(timeoutCallback).toBeTypeOf("function");

    await act(async () => {
      timeoutCallback!();
      await Promise.resolve();
    });

    expect(browserMocks.cancel).toHaveBeenCalledWith(reservation);
    expect(cancelledFlowIds).toContain(flowId);
    expect(JSON.stringify(renderer.toJSON())).toContain("X authorization timed out");
  });

  test("OAuth callback failure closes the active browser reservation", async () => {
    const reservation = {
      ok: true,
      kind: "browser",
      popup: { opener: null, closed: false, location: { replace() {} }, close() {} },
    };
    browserMocks.reserve.mockReturnValue(reservation);
    const renderer = await renderWithConnection(familiarA, false);
    let flowId = "";
    globalThis.fetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/x/oauth/start" && init?.method === "POST") {
        flowId = (JSON.parse(init.body as string) as { flowId: string }).flowId;
        return jsonResponse({
          ok: true,
          flowId,
          authorizationUrl: "https://x.com/i/oauth2/authorize",
        });
      }
      if (url === "/api/x/connection" && !init?.method) {
        return jsonResponse({
          configured: true,
          connected: false,
          activeFlow: false,
          oauthFlowId: flowId,
          oauthOutcome: "failed",
        });
      }
      throw new Error(`unexpected fetch: ${url} ${init?.method ?? "GET"}`);
    });

    await act(async () => {
      renderer.root.findByType("button").props.onClick();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(browserMocks.cancel).toHaveBeenCalledWith(reservation);
    expect(JSON.stringify(renderer.toJSON())).toContain("X authorization failed");
  });

  test("successful OAuth callback leaves the navigated X tab to close itself", async () => {
    const reservation = {
      ok: true,
      kind: "browser",
      popup: { opener: null, closed: false, location: { replace() {} }, close() {} },
    };
    browserMocks.reserve.mockReturnValue(reservation);
    const renderer = await renderWithConnection(familiarA, false);
    let flowId = "";
    globalThis.fetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/x/oauth/start" && init?.method === "POST") {
        flowId = (JSON.parse(init.body as string) as { flowId: string }).flowId;
        return jsonResponse({
          ok: true,
          flowId,
          authorizationUrl: "https://x.com/i/oauth2/authorize",
        });
      }
      if (url === "/api/x/connection" && !init?.method) {
        return jsonResponse({
          configured: true,
          connected: true,
          activeFlow: false,
          oauthFlowId: flowId,
          oauthOutcome: "succeeded",
          account: { id: "42", username: "cave", name: "Cave" },
          scopes: ["tweet.read", "users.read", "offline.access"],
        });
      }
      throw new Error(`unexpected fetch: ${url} ${init?.method ?? "GET"}`);
    });

    await act(async () => {
      renderer.root.findByType("button").props.onClick();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      renderer.unmount();
    });

    expect(browserMocks.open).toHaveBeenCalledWith(
      "https://x.com/i/oauth2/authorize",
      reservation,
    );
    expect(browserMocks.cancel).not.toHaveBeenCalledWith(reservation);
  });

  test("a failed grant save from the old familiar cannot roll back the new familiar", async () => {
    const renderer = await renderWithConnection(familiarA, true);
    const save = deferred<ReturnType<typeof jsonResponse>>();
    globalThis.fetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/config" && init?.method === "PATCH") return save.promise;
      throw new Error(`unexpected fetch: ${url} ${init?.method ?? "GET"}`);
    });

    await act(async () => {
      button(renderer, "Allow X research for A").props.onClick();
      await Promise.resolve();
    });
    expect(button(renderer, "Allow X research for A").props["aria-checked"]).toBe(true);

    await act(async () => {
      renderer.update(<FamiliarXSection familiar={familiarB} />);
    });
    expect(button(renderer, "Allow X research for B").props["aria-checked"]).toBe(true);

    await act(async () => {
      save.resolve(jsonResponse({ ok: false }, false));
      await save.promise;
      await Promise.resolve();
    });

    expect(button(renderer, "Allow X research for B").props["aria-checked"]).toBe(true);
    expect(JSON.stringify(renderer.toJSON())).not.toContain("Couldn't save X research.");
  });
});
