// @ts-nocheck
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const announce = vi.hoisted(() => vi.fn());

vi.mock("@/components/ui/live-region", () => ({
  useAnnouncer: () => ({ announce }),
}));

vi.mock("@/lib/use-pausable-poll", () => ({
  usePausablePoll: () => {},
}));

vi.mock("@/lib/icon", () => ({
  Icon: () => <span aria-hidden="true" />,
}));

import { ClientAccessSection } from "./settings-client-access";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const PAIRING_REQUESTS_URL = "/api/client/v1/admin/pairing-requests";
const CREDENTIALS_URL = "/api/client/v1/admin/credentials";
const TOKEN_HEADER = "x-coven-cave-token";

type FetchMock = ReturnType<typeof vi.fn>;

function success(data: Record<string, unknown>, status = 200): Response {
  return Response.json(
    {
      apiVersion: "1.0",
      minimumClientVersion: "0.1.0",
      capabilities: ["pairing", "credentials"],
      data,
    },
    { status },
  );
}

function failure(message: string, status = 500): Response {
  return Response.json(
    {
      apiVersion: "1.0",
      minimumClientVersion: "0.1.0",
      capabilities: ["pairing", "credentials"],
      error: {
        code: status === 409 ? "conflict" : "service_unavailable",
        message,
        retryable: status >= 500,
      },
    },
    { status },
  );
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function abortError(): Error {
  return typeof DOMException === "function"
    ? new DOMException("The operation was aborted.", "AbortError")
    : Object.assign(new Error("The operation was aborted."), { name: "AbortError" });
}

function abortableResponse(
  pending: Promise<Response>,
  signal: AbortSignal | null | undefined,
  onAbort: () => void,
): Promise<Response> {
  return new Promise<Response>((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", handleAbort);
      callback();
    };
    const handleAbort = () => {
      finish(() => {
        onAbort();
        reject(abortError());
      });
    };

    if (signal?.aborted) {
      handleAbort();
      return;
    }

    signal?.addEventListener("abort", handleAbort, { once: true });
    pending.then(
      (value) => {
        finish(() => {
          resolve(value);
        });
      },
      (error) => {
        finish(() => {
          reject(error);
        });
      },
    );
  });
}

function textContent(node: unknown): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textContent).join("");
  if (node && typeof node === "object" && "children" in node) {
    return textContent((node as { children: unknown }).children);
  }
  return "";
}

function rootText(renderer: ReactTestRenderer): string {
  return textContent(renderer.toJSON());
}

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
}

async function renderSection() {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(<ClientAccessSection />);
    await flushMicrotasks();
  });
  return renderer;
}

function findButton(renderer: ReactTestRenderer, matcher: string | RegExp) {
  return renderer.root.find(
    (node) =>
      node.type === "button"
      && (() => {
        const label = node.props["aria-label"];
        const text = textContent(node.children);
        if (typeof matcher === "string") {
          return label === matcher || text === matcher;
        }
        return matcher.test(label ?? "") || matcher.test(text);
      })(),
  );
}

let previousFetch: typeof globalThis.fetch | undefined;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-22T23:30:52.892Z"));
  announce.mockReset();
  previousFetch = globalThis.fetch;
});

afterEach(() => {
  vi.useRealTimers();
  if (previousFetch === undefined) {
    // @ts-expect-error test cleanup
    delete globalThis.fetch;
  } else {
    globalThis.fetch = previousFetch;
  }
});

test("shows loading skeletons before resolving empty states", async () => {
  const pairings = deferred<Response>();
  const credentials = deferred<Response>();

  globalThis.fetch = vi.fn((input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url === PAIRING_REQUESTS_URL) return pairings.promise;
    if (url === CREDENTIALS_URL) return credentials.promise;
    throw new Error(`Unexpected fetch: ${url}`);
  }) as unknown as FetchMock;

  const renderer = await renderSection();

  expect(
    renderer.root.findAll(
      (node) =>
        typeof node.props.className === "string"
        && node.props.className.includes("ui-skeleton"),
    ).length,
  ).toBeGreaterThan(0);

  await act(async () => {
    pairings.resolve(success({ pairingRequests: [] }));
    credentials.resolve(success({ credentials: [] }));
    await pairings.promise;
    await credentials.promise;
    await flushMicrotasks();
  });

  expect(rootText(renderer)).toContain("No pairing requests waiting");
  expect(rootText(renderer)).toContain("No client credentials issued");

  await act(async () => renderer.unmount());
});

test("renders pending pairing and credential metadata without exposing secrets", async () => {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url === PAIRING_REQUESTS_URL) {
      return success({
        pairingRequests: [
          {
            id: "pair-1",
            appName: "OpenCoven Chat",
            installationId: "chat-install-1",
            scopes: ["chat:read", "tasks:write"],
            status: "pending",
            createdAt: Date.now() - 60_000,
            expiresAt: Date.now() + 4 * 60_000,
            decidedAt: null,
            secret: "pair-secret",
            secretHash: "pair-secret-hash",
          },
        ],
      });
    }
    if (url === CREDENTIALS_URL) {
      return success({
        credentials: [
          {
            id: "cred-1",
            appName: "Desktop Bridge",
            installationId: "bridge-install-1",
            scopes: ["chat:read"],
            createdAt: Date.now() - 2 * 60_000,
            lastUsedAt: Date.now() - 30_000,
            revokedAt: null,
            revocationReason: null,
            bearer: "secret-bearer",
            bearerHash: "secret-bearer-hash",
          },
          {
            id: "cred-2",
            appName: "Archive Reader",
            installationId: "archive-install-1",
            scopes: ["attachments:write"],
            createdAt: Date.now() - 5 * 60_000,
            lastUsedAt: null,
            revokedAt: Date.now() - 60_000,
            revocationReason: "revoked from Settings",
            bearer: "revoked-bearer",
          },
        ],
      });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  }) as unknown as FetchMock;

  const renderer = await renderSection();
  const rendered = rootText(renderer);

  expect(rendered).toContain("OpenCoven Chat");
  expect(rendered).toContain("chat-install-1");
  expect(rendered).toContain("chat:read");
  expect(rendered).toContain("tasks:write");
  expect(rendered).toContain("Pending approval");
  expect(rendered).toContain("Desktop Bridge");
  expect(rendered).toContain("bridge-install-1");
  expect(rendered).toContain("Active");
  expect(rendered).toContain("Revoked");
  expect(rendered).not.toContain("pair-secret");
  expect(rendered).not.toContain("secret-bearer");
  expect(rendered).not.toContain("secret-bearer-hash");
  expect(
    renderer.root.findAll(
      (node) => node.type === "ul" && node.props["aria-label"] === "Requested scopes",
    ),
  ).toHaveLength(1);
  expect(
    renderer.root.findAll(
      (node) => node.type === "ul" && node.props["aria-label"] === "Issued credential scopes",
    ),
  ).toHaveLength(2);

  const calls = (globalThis.fetch as FetchMock).mock.calls;
  expect(calls.map(([url]) => url)).toEqual([PAIRING_REQUESTS_URL, CREDENTIALS_URL]);
  for (const [, init] of calls) {
    const headers = new Headers(init?.headers);
    expect(headers.has(TOKEN_HEADER)).toBe(false);
  }

  await act(async () => renderer.unmount());
});

test("approves, denies, and revokes through authoritative refreshes", async () => {
  const queue = [
    success({
      pairingRequests: [
        {
          id: "pair-alpha",
          appName: "Alpha Client",
          installationId: "alpha-install",
          scopes: ["chat:read"],
          status: "pending",
          createdAt: Date.now() - 60_000,
          expiresAt: Date.now() + 4 * 60_000,
          decidedAt: null,
        },
        {
          id: "pair-beta",
          appName: "Beta Client",
          installationId: "beta-install",
          scopes: ["tasks:write"],
          status: "pending",
          createdAt: Date.now() - 30_000,
          expiresAt: Date.now() + 5 * 60_000,
          decidedAt: null,
        },
      ],
    }),
    success({
      credentials: [
        {
          id: "cred-gamma",
          appName: "Gamma Client",
          installationId: "gamma-install",
          scopes: ["github:write"],
          createdAt: Date.now() - 10 * 60_000,
          lastUsedAt: Date.now() - 2 * 60_000,
          revokedAt: null,
          revocationReason: null,
        },
        {
          id: "cred-delta",
          appName: "Delta Client",
          installationId: "delta-install",
          scopes: ["attachments:write"],
          createdAt: Date.now() - 20 * 60_000,
          lastUsedAt: null,
          revokedAt: Date.now() - 3 * 60_000,
          revocationReason: "revoked from Settings",
        },
      ],
    }),
    success({
      pairingRequest: {
        id: "pair-alpha",
        appName: "Alpha Client",
        installationId: "alpha-install",
        scopes: ["chat:read"],
        status: "approved",
        createdAt: Date.now() - 60_000,
        expiresAt: Date.now() + 4 * 60_000,
        decidedAt: Date.now(),
      },
    }),
    success({
      pairingRequests: [
        {
          id: "pair-beta",
          appName: "Beta Client",
          installationId: "beta-install",
          scopes: ["tasks:write"],
          status: "pending",
          createdAt: Date.now() - 30_000,
          expiresAt: Date.now() + 5 * 60_000,
          decidedAt: null,
        },
      ],
    }),
    success({
      credentials: [
        {
          id: "cred-gamma",
          appName: "Gamma Client",
          installationId: "gamma-install",
          scopes: ["github:write"],
          createdAt: Date.now() - 10 * 60_000,
          lastUsedAt: Date.now() - 2 * 60_000,
          revokedAt: null,
          revocationReason: null,
        },
        {
          id: "cred-delta",
          appName: "Delta Client",
          installationId: "delta-install",
          scopes: ["attachments:write"],
          createdAt: Date.now() - 20 * 60_000,
          lastUsedAt: null,
          revokedAt: Date.now() - 3 * 60_000,
          revocationReason: "revoked from Settings",
        },
      ],
    }),
    success({
      pairingRequest: {
        id: "pair-beta",
        appName: "Beta Client",
        installationId: "beta-install",
        scopes: ["tasks:write"],
        status: "denied",
        createdAt: Date.now() - 30_000,
        expiresAt: Date.now() + 5 * 60_000,
        decidedAt: Date.now(),
      },
    }),
    success({ pairingRequests: [] }),
    success({
      credentials: [
        {
          id: "cred-gamma",
          appName: "Gamma Client",
          installationId: "gamma-install",
          scopes: ["github:write"],
          createdAt: Date.now() - 10 * 60_000,
          lastUsedAt: Date.now() - 2 * 60_000,
          revokedAt: null,
          revocationReason: null,
        },
        {
          id: "cred-delta",
          appName: "Delta Client",
          installationId: "delta-install",
          scopes: ["attachments:write"],
          createdAt: Date.now() - 20 * 60_000,
          lastUsedAt: null,
          revokedAt: Date.now() - 3 * 60_000,
          revocationReason: "revoked from Settings",
        },
      ],
    }),
    success({
      credential: {
        id: "cred-gamma",
        appName: "Gamma Client",
        installationId: "gamma-install",
        scopes: ["github:write"],
        createdAt: Date.now() - 10 * 60_000,
        lastUsedAt: Date.now() - 2 * 60_000,
        revokedAt: Date.now(),
        revocationReason: "revoked from Settings",
      },
    }),
    success({ pairingRequests: [] }),
    success({
      credentials: [
        {
          id: "cred-gamma",
          appName: "Gamma Client",
          installationId: "gamma-install",
          scopes: ["github:write"],
          createdAt: Date.now() - 10 * 60_000,
          lastUsedAt: Date.now() - 2 * 60_000,
          revokedAt: Date.now(),
          revocationReason: "revoked from Settings",
        },
        {
          id: "cred-delta",
          appName: "Delta Client",
          installationId: "delta-install",
          scopes: ["attachments:write"],
          createdAt: Date.now() - 20 * 60_000,
          lastUsedAt: null,
          revokedAt: Date.now() - 3 * 60_000,
          revocationReason: "revoked from Settings",
        },
      ],
    }),
  ];

  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    const next = queue.shift();
    if (!next) throw new Error(`Unexpected fetch: ${url}`);
    return next;
  }) as unknown as FetchMock;

  const renderer = await renderSection();

  await act(async () => {
    findButton(renderer, "Approve Alpha Client pairing request").props.onClick();
    await flushMicrotasks();
  });
  expect(rootText(renderer)).not.toContain("alpha-install");

  await act(async () => {
    findButton(renderer, "Deny Beta Client pairing request").props.onClick();
    await flushMicrotasks();
  });
  expect(rootText(renderer)).not.toContain("beta-install");

  await act(async () => {
    findButton(renderer, "Revoke Gamma Client credential").props.onClick();
    await flushMicrotasks();
  });
  expect(rootText(renderer)).not.toContain("RevokeGamma Client credential");
  expect(rootText(renderer)).toContain("revoked from Settings");

  const urls = (globalThis.fetch as FetchMock).mock.calls.map(([url]) => url);
  expect(urls.filter((url) => url === PAIRING_REQUESTS_URL)).toHaveLength(4);
  expect(urls.filter((url) => url === CREDENTIALS_URL)).toHaveLength(4);
  expect(urls.filter((url) => String(url).includes("/decision"))).toHaveLength(2);
  expect(urls.filter((url) => String(url).includes("/api/client/v1/admin/credentials/"))).toHaveLength(1);
  expect(
    announce.mock.calls.map(([message]) => message),
  ).toEqual(
    expect.arrayContaining([
      "Approved Alpha Client pairing request.",
      "Denied Beta Client pairing request.",
      "Revoked Gamma Client credential.",
    ]),
  );

  await act(async () => renderer.unmount());
});

test("overlapping successful mutations wait for the newest authoritative refresh", async () => {
  const firstRefreshPairings = deferred<Response>();
  const firstRefreshCredentials = deferred<Response>();
  const secondRefreshPairings = deferred<Response>();
  const secondRefreshCredentials = deferred<Response>();
  const abortedRefreshes: string[] = [];
  let pairingLoads = 0;
  let credentialLoads = 0;

  globalThis.fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url === PAIRING_REQUESTS_URL) {
      pairingLoads += 1;
      if (pairingLoads === 1) {
        return Promise.resolve(success({
          pairingRequests: [
            {
              id: "pair-alpha",
              appName: "Alpha Client",
              installationId: "alpha-install",
              scopes: ["chat:read"],
              status: "pending",
              createdAt: Date.now() - 60_000,
              expiresAt: Date.now() + 4 * 60_000,
              decidedAt: null,
            },
          ],
        }));
      }
      if (pairingLoads === 2) {
        return abortableResponse(
          firstRefreshPairings.promise,
          init?.signal,
          () => abortedRefreshes.push("pairings:first"),
        );
      }
      if (pairingLoads === 3) {
        return abortableResponse(
          secondRefreshPairings.promise,
          init?.signal,
          () => abortedRefreshes.push("pairings:second"),
        );
      }
    }
    if (url === CREDENTIALS_URL) {
      credentialLoads += 1;
      if (credentialLoads === 1) {
        return Promise.resolve(success({
          credentials: [
            {
              id: "cred-gamma",
              appName: "Gamma Client",
              installationId: "gamma-install",
              scopes: ["github:write"],
              createdAt: Date.now() - 10 * 60_000,
              lastUsedAt: Date.now() - 2 * 60_000,
              revokedAt: null,
              revocationReason: null,
            },
          ],
        }));
      }
      if (credentialLoads === 2) {
        return abortableResponse(
          firstRefreshCredentials.promise,
          init?.signal,
          () => abortedRefreshes.push("credentials:first"),
        );
      }
      if (credentialLoads === 3) {
        return abortableResponse(
          secondRefreshCredentials.promise,
          init?.signal,
          () => abortedRefreshes.push("credentials:second"),
        );
      }
    }
    if (url === "/api/client/v1/admin/pairing-requests/pair-alpha/decision") {
      return Promise.resolve(success({
        pairingRequest: {
          id: "pair-alpha",
          appName: "Alpha Client",
          installationId: "alpha-install",
          scopes: ["chat:read"],
          status: "approved",
          createdAt: Date.now() - 60_000,
          expiresAt: Date.now() + 4 * 60_000,
          decidedAt: Date.now(),
        },
      }));
    }
    if (url === "/api/client/v1/admin/credentials/cred-gamma") {
      return Promise.resolve(success({
        credential: {
          id: "cred-gamma",
          appName: "Gamma Client",
          installationId: "gamma-install",
          scopes: ["github:write"],
          createdAt: Date.now() - 10 * 60_000,
          lastUsedAt: Date.now() - 2 * 60_000,
          revokedAt: Date.now(),
          revocationReason: "revoked from Settings",
        },
      }));
    }
    throw new Error(`Unexpected fetch: ${url}`);
  }) as unknown as FetchMock;

  const renderer = await renderSection();

  await act(async () => {
    findButton(renderer, "Approve Alpha Client pairing request").props.onClick();
    await flushMicrotasks();
  });
  expect(rootText(renderer)).not.toContain("alpha-install");

  await act(async () => {
    findButton(renderer, "Revoke Gamma Client credential").props.onClick();
    await flushMicrotasks();
  });

  expect(abortedRefreshes).toEqual(
    expect.arrayContaining(["pairings:first", "credentials:first"]),
  );
  expect(announce).not.toHaveBeenCalled();

  await act(async () => {
    secondRefreshPairings.resolve(success({ pairingRequests: [] }));
    secondRefreshCredentials.resolve(success({
      credentials: [
        {
          id: "cred-gamma",
          appName: "Gamma Client",
          installationId: "gamma-install",
          scopes: ["github:write"],
          createdAt: Date.now() - 10 * 60_000,
          lastUsedAt: Date.now() - 2 * 60_000,
          revokedAt: Date.now(),
          revocationReason: "revoked from Settings",
        },
      ],
    }));
    await secondRefreshPairings.promise;
    await secondRefreshCredentials.promise;
    await flushMicrotasks();
  });

  expect(
    announce.mock.calls.map(([message]) => message),
  ).toEqual(
    expect.arrayContaining([
      "Approved Alpha Client pairing request.",
      "Revoked Gamma Client credential.",
    ]),
  );
  expect(
    announce.mock.calls.some(([message]) => String(message).includes("Couldn't refresh the access ledger")),
  ).toBe(false);
  expect(rootText(renderer)).toContain("revoked from Settings");
  expect(pairingLoads).toBe(3);
  expect(credentialLoads).toBe(3);

  await act(async () => renderer.unmount());
});

test("renders actionable request failures and retries successfully", async () => {
  let attempt = 0;

  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    attempt += 1;
    if (attempt <= 2) {
      if (url === PAIRING_REQUESTS_URL) return failure("Cave admin authorization is required.", 401);
      if (url === CREDENTIALS_URL) return failure("Cave admin authorization is required.", 401);
    }
    if (url === PAIRING_REQUESTS_URL) return success({ pairingRequests: [] });
    if (url === CREDENTIALS_URL) return success({ credentials: [] });
    throw new Error(`Unexpected fetch: ${url}`);
  }) as unknown as FetchMock;

  const renderer = await renderSection();

  expect(rootText(renderer)).toContain("Couldn't load pending approvals.");
  expect(rootText(renderer)).toContain("Couldn't load issued credentials.");

  await act(async () => {
    findButton(renderer, "Retry pending approvals").props.onClick();
    await flushMicrotasks();
  });

  expect(rootText(renderer)).toContain("No pairing requests waiting");
  expect(rootText(renderer)).toContain("No client credentials issued");
  expect(announce.mock.calls.some(([message]) => message === "Client access refreshed.")).toBe(true);

  await act(async () => renderer.unmount());
});

test("keeps the pending approvals empty state visible when a stale refresh fails", async () => {
  let pairingLoads = 0;
  let credentialLoads = 0;

  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url === PAIRING_REQUESTS_URL) {
      pairingLoads += 1;
      if (pairingLoads === 1 || pairingLoads === 3) {
        return success({ pairingRequests: [] });
      }
      return failure("Pending approvals refresh requires a fresh session.", 401);
    }
    if (url === CREDENTIALS_URL) {
      credentialLoads += 1;
      return success({ credentials: [] });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  }) as unknown as FetchMock;

  const renderer = await renderSection();

  await act(async () => {
    findButton(renderer, "Refresh client access").props.onClick();
    await flushMicrotasks();
  });

  expect(rootText(renderer)).toContain("No pairing requests waiting");
  expect(rootText(renderer)).toContain("Couldn't refresh pending approvals.");
  expect(rootText(renderer)).toContain("Pending approvals refresh requires a fresh session.");
  expect(rootText(renderer)).toContain("No client credentials issued");
  expect(announce).toHaveBeenCalledWith(
    "Couldn't refresh client access. Check the sections below.",
    "assertive",
  );

  await act(async () => {
    findButton(renderer, "Retry pending approvals").props.onClick();
    await flushMicrotasks();
  });

  expect(rootText(renderer)).toContain("No pairing requests waiting");
  expect(rootText(renderer)).not.toContain("Couldn't refresh pending approvals.");
  expect(announce).toHaveBeenCalledWith("Client access refreshed.", "polite");
  expect(pairingLoads).toBe(3);
  expect(credentialLoads).toBe(3);

  await act(async () => renderer.unmount());
});

test("keeps the issued credentials empty state visible when a stale refresh fails", async () => {
  let pairingLoads = 0;
  let credentialLoads = 0;

  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url === PAIRING_REQUESTS_URL) {
      pairingLoads += 1;
      return success({ pairingRequests: [] });
    }
    if (url === CREDENTIALS_URL) {
      credentialLoads += 1;
      if (credentialLoads === 1 || credentialLoads === 3) {
        return success({ credentials: [] });
      }
      return failure("Issued credential refresh timed out.", 504);
    }
    throw new Error(`Unexpected fetch: ${url}`);
  }) as unknown as FetchMock;

  const renderer = await renderSection();

  await act(async () => {
    findButton(renderer, "Refresh client access").props.onClick();
    await flushMicrotasks();
  });

  expect(rootText(renderer)).toContain("No client credentials issued");
  expect(rootText(renderer)).toContain("Couldn't refresh issued credentials.");
  expect(rootText(renderer)).toContain("Issued credential refresh timed out.");
  expect(rootText(renderer)).toContain("No pairing requests waiting");
  expect(announce).toHaveBeenCalledWith(
    "Couldn't refresh client access. Check the sections below.",
    "assertive",
  );

  await act(async () => {
    findButton(renderer, "Retry issued credentials").props.onClick();
    await flushMicrotasks();
  });

  expect(rootText(renderer)).toContain("No client credentials issued");
  expect(rootText(renderer)).not.toContain("Couldn't refresh issued credentials.");
  expect(announce).toHaveBeenCalledWith("Client access refreshed.", "polite");
  expect(pairingLoads).toBe(3);
  expect(credentialLoads).toBe(3);

  await act(async () => renderer.unmount());
});

test("blocks duplicate mutations and announces failures accessibly", async () => {
  const pendingDecision = deferred<Response>();
  let decisionCalls = 0;

  globalThis.fetch = vi.fn((input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url === PAIRING_REQUESTS_URL) {
      return Promise.resolve(success({
        pairingRequests: [
          {
            id: "pair-client",
            appName: "Pair Client",
            installationId: "pair-install",
            scopes: ["chat:read"],
            status: "pending",
            createdAt: Date.now() - 60_000,
            expiresAt: Date.now() + 4 * 60_000,
            decidedAt: null,
          },
        ],
      }));
    }
    if (url === CREDENTIALS_URL) {
      return Promise.resolve(success({ credentials: [] }));
    }
    if (url === "/api/client/v1/admin/pairing-requests/pair-client/decision") {
      decisionCalls += 1;
      return pendingDecision.promise;
    }
    throw new Error(`Unexpected fetch: ${url}`);
  }) as unknown as FetchMock;

  const renderer = await renderSection();
  const approve = findButton(renderer, "Approve Pair Client pairing request");

  await act(async () => {
    approve.props.onClick();
    approve.props.onClick();
    await Promise.resolve();
  });

  expect(decisionCalls).toBe(1);
  expect(findButton(renderer, "Approve Pair Client pairing request").props.disabled).toBe(true);

  await act(async () => {
    pendingDecision.resolve(failure("Pairing request was already decided.", 409));
    await pendingDecision.promise;
    await flushMicrotasks();
  });

  expect(rootText(renderer)).toContain("Couldn't approve pairing request.");
  expect(rootText(renderer)).toContain("Pairing request was already decided.");
  expect(announce).toHaveBeenCalledWith(
    "Couldn't approve Pair Client pairing request: Pairing request was already decided.",
    "assertive",
  );

  await act(async () => renderer.unmount());
});
