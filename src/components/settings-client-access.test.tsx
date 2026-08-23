// @ts-nocheck
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const announce = vi.hoisted(() => vi.fn());

vi.mock("@/components/ui/live-region", () => ({
  useAnnouncer: () => ({ announce }),
}));

vi.mock("@/components/settings-overview", () => ({
  SettingsOverview: ({ section }: { section: string }) => (
    <header aria-label={`${section} overview`}>{section}</header>
  ),
}));

vi.mock("@/lib/icon", () => ({
  Icon: ({ name }: { name: string }) => <span data-icon={name} />,
}));

import { SECTIONS, SETTINGS_INDEX } from "./settings-sections";
import {
  CLIENT_ACCESS_LOAD_TIMEOUT_MS,
  CLIENT_ACCESS_POLL_MS,
  SettingsClientAccess,
} from "./settings-client-access";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const CREATED_AT = Date.UTC(2026, 7, 20, 22, 2, 0);
const EXPIRES_AT = Date.UTC(2026, 7, 20, 22, 7, 0);
const LAST_USED_AT = Date.UTC(2026, 7, 20, 22, 4, 30);
const REVOKED_AT = Date.UTC(2026, 7, 20, 22, 5, 15);

const pendingRequest = {
  id: "request-pending",
  appName: "OpenCoven Chat",
  installationId: "chat-install-4f92",
  scopes: ["chat:read", "chat:write", "tasks:handoff"],
  status: "pending",
  createdAt: CREATED_AT,
  expiresAt: EXPIRES_AT,
  decidedAt: null,
  secret: "pairing-secret-must-never-render",
  secretHash: "pairing-secret-hash-must-never-render",
};

const deniedRequest = {
  ...pendingRequest,
  id: "request-denied",
  appName: "Denied Client",
  installationId: "denied-install",
  status: "denied",
  decidedAt: CREATED_AT + 30_000,
};

const expiredRequest = {
  ...pendingRequest,
  id: "request-expired",
  appName: "Expired Client",
  installationId: "expired-install",
  status: "expired",
};

const activeCredential = {
  id: "credential-active",
  appName: "OpenCoven Chat",
  installationId: "chat-install-4f92",
  scopes: ["chat:read", "chat:write", "tasks:handoff"],
  createdAt: CREATED_AT,
  lastUsedAt: LAST_USED_AT,
  revokedAt: null,
  revocationReason: null,
  bearer: "bearer-value-must-never-render",
  bearerHash: "bearer-hash-must-never-render",
  authorization: "Bearer auth-token-must-never-render",
  headers: { authorization: "raw-header-must-never-render" },
};

const revokedCredential = {
  ...activeCredential,
  id: "credential-revoked",
  appName: "Revoked Client",
  installationId: "revoked-install",
  scopes: ["tasks:handoff"],
  revokedAt: REVOKED_AT,
  revocationReason: "Device was retired",
};

const sameInstallRequestA = {
  ...pendingRequest,
  id: "11111111-1111-4111-8111-11111111a1a1",
};

const sameInstallRequestB = {
  ...pendingRequest,
  id: "22222222-2222-4222-8222-22222222b2b2",
};

const sameInstallCredentialA = {
  ...activeCredential,
  id: "33333333-3333-4333-8333-33333333c3c3",
};

const sameInstallCredentialB = {
  ...activeCredential,
  id: "44444444-4444-4444-8444-44444444d4d4",
};

function displayTime(value: number): string {
  return new Date(value).toISOString().replace("T", " ").replace(".000Z", " UTC");
}

function text(renderer: ReactTestRenderer): string {
  return JSON.stringify(renderer.toJSON());
}

function buttonByLabel(renderer: ReactTestRenderer, label: string): ReactTestInstance {
  return renderer.root.find(
    (node) => node.type === "button" && node.props["aria-label"] === label,
  );
}

function nodeText(node: ReactTestInstance): string {
  return node.children
    .map((child) => (typeof child === "string" ? child : nodeText(child)))
    .join("");
}

function buttonByText(renderer: ReactTestRenderer, label: string): ReactTestInstance {
  return renderer.root.find(
    (node) => node.type === "button" && nodeText(node).includes(label),
  );
}

function jsonResponse(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

function clientV1SuccessResponse(data: Record<string, unknown>): Response {
  return jsonResponse({
    apiVersion: "1.0",
    requestId: "request-test",
    capabilities: [],
    data,
  });
}

function clientV1ErrorResponse(
  code: string,
  message: string,
  status: number,
  details?: Record<string, unknown>,
): Response {
  return jsonResponse({
    apiVersion: "1.0",
    requestId: "request-test",
    capabilities: [],
    error: {
      code,
      message,
      ...(details ? { details } : {}),
    },
  }, status);
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

function createAbortError(): DOMException {
  return new DOMException("The operation was aborted.", "AbortError");
}

function hangingResponse(signal?: AbortSignal): Promise<Response> {
  return new Promise((_resolve, reject) => {
    if (!signal) return;
    if (signal.aborted) {
      reject(createAbortError());
      return;
    }
    const onAbort = () => {
      signal.removeEventListener("abort", onAbort);
      reject(createAbortError());
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

async function render(props = {}): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(<SettingsClientAccess {...props} />);
    await flush();
  });
  return renderer;
}

class TestDocument extends EventTarget {
  hidden = false;
  visibilityState = "visible";
  activeElement = null;
}

let previousWindow: unknown;
let previousDocument: unknown;
let previousFetch: unknown;

beforeEach(() => {
  previousWindow = globalThis.window;
  previousDocument = globalThis.document;
  previousFetch = globalThis.fetch;
  globalThis.window = new EventTarget();
  globalThis.document = new TestDocument();
  announce.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  if (previousWindow === undefined) delete globalThis.window;
  else globalThis.window = previousWindow;
  if (previousDocument === undefined) delete globalThis.document;
  else globalThis.document = previousDocument;
  if (previousFetch === undefined) delete globalThis.fetch;
  else globalThis.fetch = previousFetch;
});

describe("SettingsClientAccess", () => {
  test("renders exact request and credential metadata without secret material", async () => {
    const renderer = await render({
      pendingRequests: [pendingRequest, deniedRequest, expiredRequest],
      credentials: [activeCredential, revokedCredential],
      onApprove: vi.fn(),
      onDeny: vi.fn(),
      onRevoke: vi.fn(),
    });
    const rendered = text(renderer);

    for (const value of [
      "OpenCoven Chat",
      "chat-install-4f92",
      "chat:read",
      "chat:write",
      "tasks:handoff",
      displayTime(CREATED_AT),
      displayTime(EXPIRES_AT),
      displayTime(LAST_USED_AT),
      displayTime(REVOKED_AT),
      "Pending",
      "Denied",
      "Expired",
      "Active",
      "Revoked",
      "Device was retired",
    ]) {
      expect(rendered).toContain(value);
    }
    expect(
      renderer.root
        .findAll((node) => node.type === "ul" && node.props.className === "settings-client-access__scopes")
        .map((node) => node.props["aria-label"]),
    ).toEqual([
      "Requested scopes",
      "Requested scopes",
      "Requested scopes",
      "Granted scopes",
      "Granted scopes",
    ]);

    expect(
      renderer.root.findAll(
        (node) => node.type === "time" && node.props.dateTime === new Date(EXPIRES_AT).toISOString(),
      ),
    ).not.toHaveLength(0);

    for (const secret of [
      "pairing-secret-must-never-render",
      "pairing-secret-hash-must-never-render",
      "bearer-value-must-never-render",
      "bearer-hash-must-never-render",
      "auth-token-must-never-render",
      "raw-header-must-never-render",
      "secretHash",
      "bearerHash",
    ]) {
      expect(rendered).not.toContain(secret);
    }
  });

  test("provides loading, empty, and error states", async () => {
    const loading = await render({
      pendingRequests: [],
      credentials: [],
      loading: true,
      onApprove: vi.fn(),
      onDeny: vi.fn(),
      onRevoke: vi.fn(),
    });
    expect(text(loading)).toContain("Loading client access…");

    await act(async () => loading.update(
      <SettingsClientAccess
        pendingRequests={[]}
        credentials={[]}
        onApprove={vi.fn()}
        onDeny={vi.fn()}
        onRevoke={vi.fn()}
      />,
    ));
    expect(text(loading)).toContain("No pending requests.");
    expect(text(loading)).toContain("No client credentials issued.");

    await act(async () => loading.update(
      <SettingsClientAccess
        pendingRequests={[]}
        credentials={[]}
        error="Couldn’t load client access."
        onApprove={vi.fn()}
        onDeny={vi.fn()}
        onRevoke={vi.fn()}
      />,
    ));
    expect(text(loading)).toContain("Couldn’t load client access");
    expect(loading.root.findAll((node) => node.props.role === "alert")).not.toHaveLength(0);
  });

  test("uses app-specific accessible actions and disables duplicate mutations", async () => {
    const onApprove = vi.fn();
    const onDeny = vi.fn();
    const onRevoke = vi.fn();
    const renderer = await render({
      pendingRequests: [pendingRequest],
      credentials: [activeCredential],
      onApprove,
      onDeny,
      onRevoke,
    });

    await act(async () => {
      buttonByLabel(renderer, "Approve access for OpenCoven Chat").props.onClick();
      buttonByLabel(renderer, "Deny access for OpenCoven Chat").props.onClick();
      buttonByLabel(renderer, "Revoke access for OpenCoven Chat").props.onClick();
    });
    expect(onApprove).toHaveBeenCalledWith("request-pending");
    expect(onDeny).toHaveBeenCalledWith("request-pending");
    expect(onRevoke).toHaveBeenCalledWith("credential-active");

    await act(async () => renderer.update(
      <SettingsClientAccess
        pendingRequests={[pendingRequest]}
        credentials={[activeCredential]}
        action={{ kind: "approve", id: "request-pending" }}
        onApprove={onApprove}
        onDeny={onDeny}
        onRevoke={onRevoke}
      />,
    ));
    expect(buttonByLabel(renderer, "Approve access for OpenCoven Chat").props.disabled).toBe(true);
    expect(buttonByLabel(renderer, "Deny access for OpenCoven Chat").props.disabled).toBe(true);
    expect(buttonByLabel(renderer, "Revoke access for OpenCoven Chat").props.disabled).toBe(true);
  });

  test("adds installation ids to duplicate accessible action names", async () => {
    const duplicateRequestA = {
      ...pendingRequest,
      id: "request-a",
      installationId: "chat-install-a",
    };
    const duplicateRequestB = {
      ...pendingRequest,
      id: "request-b",
      installationId: "chat-install-b",
    };
    const duplicateCredentialA = {
      ...activeCredential,
      id: "credential-a",
      installationId: "chat-install-a",
    };
    const duplicateCredentialB = {
      ...activeCredential,
      id: "credential-b",
      installationId: "chat-install-b",
    };
    const renderer = await render({
      pendingRequests: [duplicateRequestA, duplicateRequestB],
      credentials: [duplicateCredentialA, duplicateCredentialB],
      onApprove: vi.fn(),
      onDeny: vi.fn(),
      onRevoke: vi.fn(),
    });

    expect(
      buttonByLabel(
        renderer,
        "Approve access for OpenCoven Chat, installation chat-install-a",
      ),
    ).toBeDefined();
    expect(
      buttonByLabel(
        renderer,
        "Deny access for OpenCoven Chat, installation chat-install-b",
      ),
    ).toBeDefined();
    expect(
      buttonByLabel(
        renderer,
        "Revoke access for OpenCoven Chat, installation chat-install-a",
      ),
    ).toBeDefined();
  });

  test("adds stable record distinguishers when app and installation ids both collide", async () => {
    const renderer = await render({
      pendingRequests: [sameInstallRequestA, sameInstallRequestB],
      credentials: [sameInstallCredentialA, sameInstallCredentialB],
      onApprove: vi.fn(),
      onDeny: vi.fn(),
      onRevoke: vi.fn(),
    });

    expect(
      buttonByLabel(
        renderer,
        "Approve access for OpenCoven Chat, installation chat-install-4f92, request ID ending a1a1",
      ),
    ).toBeDefined();
    expect(
      buttonByLabel(
        renderer,
        "Deny access for OpenCoven Chat, installation chat-install-4f92, request ID ending b2b2",
      ),
    ).toBeDefined();
    expect(
      buttonByLabel(
        renderer,
        "Revoke access for OpenCoven Chat, installation chat-install-4f92, credential ID ending c3c3",
      ),
    ).toBeDefined();
  });

  test("calls Task 3 admin APIs and announces duplicate app mutations with installation ids", async () => {
    let requests = [
      pendingRequest,
      {
        ...pendingRequest,
        id: "request-2",
        installationId: "chat-install-778b",
      },
    ];
    let credentials = [
      activeCredential,
      {
        ...activeCredential,
        id: "credential-2",
        installationId: "chat-install-778b",
      },
    ];
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/client/v1/admin/pairing-requests" && !init?.method) {
        return clientV1SuccessResponse({ pairingRequests: requests });
      }
      if (url === "/api/client/v1/admin/credentials" && !init?.method) {
        return clientV1SuccessResponse({ credentials });
      }
      if (url.endsWith("/request-pending/decision") && init?.method === "POST") {
        expect(JSON.parse(String(init.body))).toEqual({ decision: "approved" });
        requests = requests.filter((request) => request.id !== "request-pending");
        return clientV1SuccessResponse({
          pairingRequest: { ...pendingRequest, status: "approved", decidedAt: CREATED_AT + 1_000 },
        });
      }
      if (url.endsWith("/request-2/decision") && init?.method === "POST") {
        expect(JSON.parse(String(init.body))).toEqual({ decision: "denied" });
        const request = requests.find((entry) => entry.id === "request-2");
        requests = requests.filter((entry) => entry.id !== "request-2");
        return clientV1SuccessResponse({
          pairingRequest: { ...request, status: "denied", decidedAt: CREATED_AT + 2_000 },
        });
      }
      if (url.endsWith("/credential-active") && init?.method === "DELETE") {
        expect(JSON.parse(String(init.body))).toEqual({ reason: "Revoked in Cave settings" });
        credentials = [{
          ...activeCredential,
          revokedAt: REVOKED_AT,
          revocationReason: "Revoked in Cave settings",
        }];
        return clientV1SuccessResponse({ credential: credentials[0] });
      }
      throw new Error(`Unexpected fetch: ${url} ${init?.method ?? "GET"}`);
    });
    globalThis.fetch = fetchMock;
    const renderer = await render();

    await act(async () => {
      await buttonByLabel(
        renderer,
        "Approve access for OpenCoven Chat, installation chat-install-4f92",
      ).props.onClick();
      await flush();
    });
    expect(announce).toHaveBeenCalledWith(
      "Approved access for OpenCoven Chat, installation chat-install-4f92.",
      "polite",
    );

    await act(async () => {
      await buttonByLabel(
        renderer,
        "Deny access for OpenCoven Chat, installation chat-install-778b",
      ).props.onClick();
      await flush();
    });
    expect(announce).toHaveBeenCalledWith(
      "Denied access for OpenCoven Chat, installation chat-install-778b.",
      "polite",
    );

    await act(async () => {
      await buttonByLabel(
        renderer,
        "Revoke access for OpenCoven Chat, installation chat-install-4f92",
      ).props.onClick();
      await flush();
    });
    expect(announce).toHaveBeenCalledWith(
      "Revoked access for OpenCoven Chat, installation chat-install-4f92.",
      "polite",
    );

    expect(
      fetchMock.mock.calls.some(
        ([url, init]) => url === "/api/client/v1/admin/pairing-requests/request-pending/decision"
          && init?.method === "POST",
      ),
    ).toBe(true);
    expect(
      fetchMock.mock.calls.some(
        ([url, init]) => url === "/api/client/v1/admin/credentials/credential-active"
          && init?.method === "DELETE",
      ),
    ).toBe(true    );
  });

  test("announces exact duplicate app-install mutations with stable record distinguishers", async () => {
    let requests = [sameInstallRequestA, sameInstallRequestB];
    let credentials = [sameInstallCredentialA, sameInstallCredentialB];
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/client/v1/admin/pairing-requests" && !init?.method) {
        return clientV1SuccessResponse({ pairingRequests: requests });
      }
      if (url === "/api/client/v1/admin/credentials" && !init?.method) {
        return clientV1SuccessResponse({ credentials });
      }
      if (url.endsWith(`/${sameInstallRequestA.id}/decision`) && init?.method === "POST") {
        expect(JSON.parse(String(init.body))).toEqual({ decision: "approved" });
        requests = requests.filter((request) => request.id !== sameInstallRequestA.id);
        return clientV1SuccessResponse({
          pairingRequest: { ...sameInstallRequestA, status: "approved", decidedAt: CREATED_AT + 1_000 },
        });
      }
      if (url.endsWith(`/${sameInstallRequestB.id}/decision`) && init?.method === "POST") {
        expect(JSON.parse(String(init.body))).toEqual({ decision: "denied" });
        requests = requests.filter((request) => request.id !== sameInstallRequestB.id);
        return clientV1SuccessResponse({
          pairingRequest: { ...sameInstallRequestB, status: "denied", decidedAt: CREATED_AT + 2_000 },
        });
      }
      if (url.endsWith(`/${sameInstallCredentialA.id}`) && init?.method === "DELETE") {
        expect(JSON.parse(String(init.body))).toEqual({ reason: "Revoked in Cave settings" });
        credentials = [
          {
            ...sameInstallCredentialA,
            revokedAt: REVOKED_AT,
            revocationReason: "Revoked in Cave settings",
          },
          sameInstallCredentialB,
        ];
        return clientV1SuccessResponse({ credential: credentials[0] });
      }
      throw new Error(`Unexpected fetch: ${url} ${init?.method ?? "GET"}`);
    });
    globalThis.fetch = fetchMock;
    const renderer = await render();

    await act(async () => {
      await buttonByLabel(
        renderer,
        "Approve access for OpenCoven Chat, installation chat-install-4f92, request ID ending a1a1",
      ).props.onClick();
      await flush();
    });
    expect(announce).toHaveBeenCalledWith(
      "Approved access for OpenCoven Chat, installation chat-install-4f92, request ID ending a1a1.",
      "polite",
    );

    await act(async () => {
      await buttonByLabel(
        renderer,
        "Deny access for OpenCoven Chat, installation chat-install-4f92, request ID ending b2b2",
      ).props.onClick();
      await flush();
    });
    expect(announce).toHaveBeenCalledWith(
      "Denied access for OpenCoven Chat, installation chat-install-4f92, request ID ending b2b2.",
      "polite",
    );

    await act(async () => {
      await buttonByLabel(
        renderer,
        "Revoke access for OpenCoven Chat, installation chat-install-4f92, credential ID ending c3c3",
      ).props.onClick();
      await flush();
    });
    expect(announce).toHaveBeenCalledWith(
      "Revoked access for OpenCoven Chat, installation chat-install-4f92, credential ID ending c3c3.",
      "polite",
    );
  });

  test("blocks duplicate action submissions and announces sanitized failures", async () => {
    let resolveDecision!: (response: Response) => void;
    const decision = new Promise<Response>((resolve) => {
      resolveDecision = resolve;
    });
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/client/v1/admin/pairing-requests" && !init?.method) {
        return clientV1SuccessResponse({ pairingRequests: [pendingRequest] });
      }
      if (url === "/api/client/v1/admin/credentials" && !init?.method) {
        return clientV1SuccessResponse({ credentials: [] });
      }
      if (url.endsWith("/request-pending/decision") && init?.method === "POST") {
        return decision;
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    globalThis.fetch = fetchMock;
    const renderer = await render();
    const approve = buttonByLabel(renderer, "Approve access for OpenCoven Chat");

    let firstAction!: Promise<void>;
    await act(async () => {
      firstAction = approve.props.onClick();
      await flush();
    });
    const busyApprove = buttonByLabel(renderer, "Approve access for OpenCoven Chat");
    expect(busyApprove.props.disabled).toBe(true);
    await act(async () => {
      await busyApprove.props.onClick();
    });
    expect(
      fetchMock.mock.calls.filter(([, init]) => init?.method === "POST"),
    ).toHaveLength(1);

    await act(async () => {
      resolveDecision(jsonResponse({ ok: false, error: "pairing-secret-must-never-render" }, 500));
      await firstAction;
      await flush();
    });
    expect(announce).toHaveBeenCalledWith(
      "Couldn’t approve access for OpenCoven Chat.",
      "assertive",
    );
    expect(text(renderer)).toContain("Couldn’t approve access for OpenCoven Chat.");
    expect(text(renderer)).not.toContain("pairing-secret-must-never-render");
  });

  test("announces exact duplicate app-install failures with stable record distinguishers", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/client/v1/admin/pairing-requests" && !init?.method) {
        return clientV1SuccessResponse({ pairingRequests: [sameInstallRequestA, sameInstallRequestB] });
      }
      if (url === "/api/client/v1/admin/credentials" && !init?.method) {
        return clientV1SuccessResponse({ credentials: [sameInstallCredentialA, sameInstallCredentialB] });
      }
      if (url.endsWith(`/${sameInstallRequestA.id}/decision`) && init?.method === "POST") {
        return clientV1ErrorResponse("service_unavailable", "outage", 503);
      }
      if (url.endsWith(`/${sameInstallCredentialA.id}`) && init?.method === "DELETE") {
        return jsonResponse({ ok: false, error: "bearer-value-must-never-render" }, 500);
      }
      throw new Error(`Unexpected fetch: ${url} ${init?.method ?? "GET"}`);
    });
    globalThis.fetch = fetchMock;
    const renderer = await render();

    await act(async () => {
      await buttonByLabel(
        renderer,
        "Approve access for OpenCoven Chat, installation chat-install-4f92, request ID ending a1a1",
      ).props.onClick();
      await flush();
    });
    expect(announce).toHaveBeenCalledWith(
      "Couldn’t approve access for OpenCoven Chat, installation chat-install-4f92, request ID ending a1a1.",
      "assertive",
    );
    expect(text(renderer)).toContain(
      "Couldn’t approve access for OpenCoven Chat, installation chat-install-4f92, request ID ending a1a1.",
    );

    await act(async () => {
      await buttonByLabel(
        renderer,
        "Revoke access for OpenCoven Chat, installation chat-install-4f92, credential ID ending c3c3",
      ).props.onClick();
      await flush();
    });
    expect(announce).toHaveBeenCalledWith(
      "Couldn’t revoke access for OpenCoven Chat, installation chat-install-4f92, credential ID ending c3c3.",
      "assertive",
    );
    expect(text(renderer)).toContain(
      "Couldn’t revoke access for OpenCoven Chat, installation chat-install-4f92, credential ID ending c3c3.",
    );
    expect(text(renderer)).not.toContain("bearer-value-must-never-render");
  });

  test("clears stale mutation errors after a successful manual retry refresh", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/client/v1/admin/pairing-requests" && !init?.method) {
        return clientV1SuccessResponse({ pairingRequests: [pendingRequest] });
      }
      if (url === "/api/client/v1/admin/credentials" && !init?.method) {
        return clientV1SuccessResponse({ credentials: [] });
      }
      if (url.endsWith("/request-pending/decision") && init?.method === "POST") {
        return clientV1ErrorResponse("service_unavailable", "outage", 503);
      }
      throw new Error(`Unexpected fetch: ${url} ${init?.method ?? "GET"}`);
    });
    globalThis.fetch = fetchMock;
    const renderer = await render();

    await act(async () => {
      await buttonByLabel(renderer, "Approve access for OpenCoven Chat").props.onClick();
      await flush();
    });
    expect(text(renderer)).toContain("Couldn’t approve access for OpenCoven Chat.");

    await act(async () => {
      await buttonByText(renderer, "Retry").props.onClick();
      await flush();
    });

    expect(text(renderer)).not.toContain("Couldn’t approve access for OpenCoven Chat.");
    expect(buttonByLabel(renderer, "Approve access for OpenCoven Chat")).toBeDefined();
    expect(
      fetchMock.mock.calls.filter(
        ([url, init]) => url === "/api/client/v1/admin/pairing-requests" && !init?.method,
      ),
    ).toHaveLength(2);
    expect(
      fetchMock.mock.calls.filter(
        ([url, init]) => url === "/api/client/v1/admin/credentials" && !init?.method,
      ),
    ).toHaveLength(2);
  });

  test("times out a hung initial load into a retryable error", async () => {
    vi.useFakeTimers();
    const documentNode = globalThis.document as TestDocument;
    documentNode.hidden = true;
    documentNode.visibilityState = "hidden";
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === "/api/client/v1/admin/pairing-requests") {
        return hangingResponse(init?.signal as AbortSignal | undefined);
      }
      if (url === "/api/client/v1/admin/credentials") {
        return hangingResponse(init?.signal as AbortSignal | undefined);
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    globalThis.fetch = fetchMock;
    const renderer = await render({ active: true });
    expect(text(renderer)).toContain("Loading client access…");

    await act(async () => {
      vi.advanceTimersByTime(CLIENT_ACCESS_LOAD_TIMEOUT_MS);
      await flush();
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(text(renderer)).toContain("Client access took too long to load");
    expect(text(renderer)).toContain("Retry");
    expect(text(renderer)).not.toContain("Loading client access…");
    expect(text(renderer)).not.toContain("No pending requests.");
    expect(text(renderer)).not.toContain("No client credentials issued.");
  });

  test("coalesces poll and focus refreshes while a slow initial ledger load stays within timeout", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(CREATED_AT);
    const pairing = deferred<Response>();
    const credentials = deferred<Response>();
    const signals: AbortSignal[] = [];
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === "/api/client/v1/admin/pairing-requests") {
        signals.push(init?.signal as AbortSignal);
        return pairing.promise;
      }
      if (url === "/api/client/v1/admin/credentials") {
        signals.push(init?.signal as AbortSignal);
        return credentials.promise;
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    globalThis.fetch = fetchMock;
    const renderer = await render({ active: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(signals.every((signal) => signal.aborted === false)).toBe(true);

    await act(async () => {
      vi.advanceTimersByTime(CLIENT_ACCESS_LOAD_TIMEOUT_MS - 1);
      globalThis.window.dispatchEvent(new Event("focus"));
      await flush();
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(signals.every((signal) => signal.aborted === false)).toBe(true);

    await act(async () => {
      pairing.resolve(clientV1SuccessResponse({ pairingRequests: [pendingRequest] }));
      credentials.resolve(clientV1SuccessResponse({ credentials: [activeCredential] }));
      await flush();
    });
    expect(text(renderer)).toContain("OpenCoven Chat");
  });

  test("initial load failure shows retry without false empty guidance", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === "/api/client/v1/admin/pairing-requests") {
        return clientV1SuccessResponse({ pairingRequests: [] });
      }
      if (url === "/api/client/v1/admin/credentials") {
        return clientV1ErrorResponse("service_unavailable", "outage", 503);
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    globalThis.fetch = fetchMock;
    const renderer = await render();

    expect(text(renderer)).toContain("Couldn’t load client access");
    expect(text(renderer)).toContain("Retry");
    expect(text(renderer)).not.toContain("No pending requests.");
    expect(text(renderer)).not.toContain("No client credentials issued.");
  });

  test("keeps the last confirmed snapshot when a refresh times out", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(CREATED_AT);
    let phase: "initial" | "refresh-timeout" = "initial";
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (phase === "initial") {
        if (url === "/api/client/v1/admin/pairing-requests") {
          return Promise.resolve(clientV1SuccessResponse({ pairingRequests: [pendingRequest] }));
        }
        if (url === "/api/client/v1/admin/credentials") {
          return Promise.resolve(clientV1SuccessResponse({ credentials: [activeCredential] }));
        }
      }
      if (phase === "refresh-timeout") {
        if (url === "/api/client/v1/admin/pairing-requests") {
          return hangingResponse(init?.signal as AbortSignal | undefined);
        }
        if (url === "/api/client/v1/admin/credentials") {
          return hangingResponse(init?.signal as AbortSignal | undefined);
        }
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    globalThis.fetch = fetchMock;
    const renderer = await render({ active: true });
    expect(text(renderer)).toContain("OpenCoven Chat");

    phase = "refresh-timeout";
    await act(async () => {
      vi.advanceTimersByTime(1);
      globalThis.window.dispatchEvent(new Event("focus"));
      await flush();
    });
    (globalThis.document as TestDocument).hidden = true;
    (globalThis.document as TestDocument).visibilityState = "hidden";

    await act(async () => {
      vi.advanceTimersByTime(CLIENT_ACCESS_LOAD_TIMEOUT_MS);
      await flush();
    });

    expect(text(renderer)).toContain("Client access took too long to refresh");
    expect(text(renderer)).toContain("Showing the last confirmed snapshot.");
    expect(text(renderer)).toContain("OpenCoven Chat");
    expect(text(renderer)).toContain("Retry");
  });

  test("recovers with a fresh retry after a timed-out refresh", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(CREATED_AT);
    let phase: "initial" | "refresh-timeout" | "retry-success" = "initial";
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (phase === "initial") {
        if (url === "/api/client/v1/admin/pairing-requests") {
          return Promise.resolve(clientV1SuccessResponse({ pairingRequests: [pendingRequest] }));
        }
        if (url === "/api/client/v1/admin/credentials") {
          return Promise.resolve(clientV1SuccessResponse({ credentials: [] }));
        }
      }
      if (phase === "refresh-timeout") {
        if (url === "/api/client/v1/admin/pairing-requests") {
          return hangingResponse(init?.signal as AbortSignal | undefined);
        }
        if (url === "/api/client/v1/admin/credentials") {
          return hangingResponse(init?.signal as AbortSignal | undefined);
        }
      }
      if (phase === "retry-success") {
        if (url === "/api/client/v1/admin/pairing-requests") {
          return Promise.resolve(clientV1SuccessResponse({ pairingRequests: [] }));
        }
        if (url === "/api/client/v1/admin/credentials") {
          return Promise.resolve(clientV1SuccessResponse({ credentials: [activeCredential] }));
        }
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    globalThis.fetch = fetchMock;
    const renderer = await render({ active: true });
    expect(text(renderer)).toContain("OpenCoven Chat");

    phase = "refresh-timeout";
    await act(async () => {
      vi.advanceTimersByTime(1);
      globalThis.window.dispatchEvent(new Event("focus"));
      await flush();
    });
    (globalThis.document as TestDocument).hidden = true;
    (globalThis.document as TestDocument).visibilityState = "hidden";
    await act(async () => {
      vi.advanceTimersByTime(CLIENT_ACCESS_LOAD_TIMEOUT_MS);
      await flush();
    });
    expect(text(renderer)).toContain("Client access took too long to refresh");

    phase = "retry-success";
    (globalThis.document as TestDocument).hidden = false;
    (globalThis.document as TestDocument).visibilityState = "visible";
    await act(async () => {
      await buttonByText(renderer, "Retry").props.onClick();
      await flush();
    });

    expect(text(renderer)).not.toContain("Client access took too long to refresh");
    expect(text(renderer)).toContain("No pending requests.");
    expect(text(renderer)).toContain("OpenCoven Chat");
    expect(
      fetchMock.mock.calls.filter(
        ([url, init]) => url === "/api/client/v1/admin/pairing-requests" && !init?.method,
      ),
    ).toHaveLength(3);
    expect(
      fetchMock.mock.calls.filter(
        ([url, init]) => url === "/api/client/v1/admin/credentials" && !init?.method,
      ),
    ).toHaveLength(3);
  });

  test("keeps confirmed empty guidance visible when a later refresh fails", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(CREATED_AT);
    let phase: "initial" | "refresh" = "initial";
    const fetchMock = vi.fn(async (url: string) => {
      if (phase === "initial") {
        if (url === "/api/client/v1/admin/pairing-requests") {
          return clientV1SuccessResponse({ pairingRequests: [] });
        }
        if (url === "/api/client/v1/admin/credentials") {
          return clientV1SuccessResponse({ credentials: [] });
        }
      }
      if (phase === "refresh") {
        if (url === "/api/client/v1/admin/pairing-requests") {
          return clientV1SuccessResponse({ pairingRequests: [] });
        }
        if (url === "/api/client/v1/admin/credentials") {
          return clientV1ErrorResponse("service_unavailable", "outage", 503);
        }
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    globalThis.fetch = fetchMock;
    const renderer = await render({ active: true });
    expect(text(renderer)).toContain("No pending requests.");
    expect(text(renderer)).toContain("No client credentials issued.");

    phase = "refresh";
    await act(async () => {
      vi.advanceTimersByTime(CLIENT_ACCESS_POLL_MS);
      await flush();
    });

    expect(text(renderer)).toContain("Couldn’t refresh client access");
    expect(text(renderer)).toContain("Showing the last confirmed snapshot.");
    expect(text(renderer)).toContain("No pending requests.");
    expect(text(renderer)).toContain("No client credentials issued.");
  });

  test("keeps the last confirmed snapshot atomic when only one ledger list fails", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(CREATED_AT);
    let phase: "initial" | "refresh" = "initial";
    const fetchMock = vi.fn(async (url: string) => {
      if (phase === "initial") {
        if (url === "/api/client/v1/admin/pairing-requests") {
          return clientV1SuccessResponse({ pairingRequests: [pendingRequest] });
        }
        if (url === "/api/client/v1/admin/credentials") {
          return clientV1SuccessResponse({ credentials: [activeCredential] });
        }
      }
      if (phase === "refresh") {
        if (url === "/api/client/v1/admin/pairing-requests") {
          return clientV1SuccessResponse({ pairingRequests: [] });
        }
        if (url === "/api/client/v1/admin/credentials") {
          return clientV1ErrorResponse("service_unavailable", "outage", 503);
        }
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    globalThis.fetch = fetchMock;
    const renderer = await render({ active: true });
    expect(text(renderer)).toContain("OpenCoven Chat");

    phase = "refresh";
    await act(async () => {
      vi.advanceTimersByTime(CLIENT_ACCESS_POLL_MS);
      await flush();
    });

    expect(text(renderer)).toContain("Couldn’t refresh client access");
    expect(text(renderer)).toContain("Showing the last confirmed snapshot.");
    expect(buttonByLabel(renderer, "Approve access for OpenCoven Chat")).toBeDefined();
    expect(text(renderer)).not.toContain("No pending requests.");
  });

  test("keeps a cancelled initial load quiet when the section deactivates", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === "/api/client/v1/admin/pairing-requests") {
        return hangingResponse(init?.signal as AbortSignal | undefined);
      }
      if (url === "/api/client/v1/admin/credentials") {
        return hangingResponse(init?.signal as AbortSignal | undefined);
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    globalThis.fetch = fetchMock;
    const renderer = await render({ active: true });

    await act(async () => {
      renderer.update(<SettingsClientAccess active={false} />);
      await flush();
    });
    await act(async () => {
      vi.advanceTimersByTime(CLIENT_ACCESS_LOAD_TIMEOUT_MS);
      await flush();
    });

    expect(announce).not.toHaveBeenCalled();
    expect(text(renderer)).not.toContain("Client access took too long");
    expect(text(renderer)).not.toContain("Couldn’t load client access");
  });

  test("keeps a cancelled initial load quiet after unmount", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === "/api/client/v1/admin/pairing-requests") {
        return hangingResponse(init?.signal as AbortSignal | undefined);
      }
      if (url === "/api/client/v1/admin/credentials") {
        return hangingResponse(init?.signal as AbortSignal | undefined);
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    globalThis.fetch = fetchMock;
    const renderer = await render({ active: true });

    await act(async () => {
      renderer.unmount();
      await flush();
    });
    await act(async () => {
      vi.advanceTimersByTime(CLIENT_ACCESS_LOAD_TIMEOUT_MS);
      await flush();
    });

    expect(announce).not.toHaveBeenCalled();
  });

  test("keeps a superseded hung refresh quiet while authoritative reconciliation succeeds", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(CREATED_AT);
    let phase: "initial" | "background-hung" | "authoritative" = "initial";
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (phase === "initial") {
        if (url === "/api/client/v1/admin/pairing-requests" && !init?.method) {
          return Promise.resolve(clientV1SuccessResponse({ pairingRequests: [pendingRequest] }));
        }
        if (url === "/api/client/v1/admin/credentials" && !init?.method) {
          return Promise.resolve(clientV1SuccessResponse({ credentials: [] }));
        }
      }
      if (phase === "background-hung") {
        if (url === "/api/client/v1/admin/pairing-requests" && !init?.method) {
          return hangingResponse(init?.signal as AbortSignal | undefined);
        }
        if (url === "/api/client/v1/admin/credentials" && !init?.method) {
          return hangingResponse(init?.signal as AbortSignal | undefined);
        }
      }
      if (phase === "authoritative") {
        if (url === "/api/client/v1/admin/pairing-requests" && !init?.method) {
          return Promise.resolve(clientV1SuccessResponse({ pairingRequests: [] }));
        }
        if (url === "/api/client/v1/admin/credentials" && !init?.method) {
          return Promise.resolve(clientV1SuccessResponse({ credentials: [] }));
        }
      }
      if (url.endsWith("/request-pending/decision") && init?.method === "POST") {
        phase = "authoritative";
        return Promise.resolve(clientV1SuccessResponse({
          pairingRequest: { ...pendingRequest, status: "approved", decidedAt: CREATED_AT + 1_000 },
        }));
      }
      throw new Error(`Unexpected fetch: ${url} ${init?.method ?? "GET"}`);
    });
    globalThis.fetch = fetchMock;
    const renderer = await render({ active: true });
    phase = "background-hung";

    await act(async () => {
      vi.advanceTimersByTime(1);
      globalThis.window.dispatchEvent(new Event("focus"));
      await flush();
    });
    (globalThis.document as TestDocument).hidden = true;
    (globalThis.document as TestDocument).visibilityState = "hidden";

    await act(async () => {
      await buttonByLabel(renderer, "Approve access for OpenCoven Chat").props.onClick();
      await flush();
    });
    await act(async () => {
      vi.advanceTimersByTime(CLIENT_ACCESS_LOAD_TIMEOUT_MS);
      await flush();
    });

    expect(announce).toHaveBeenCalledWith("Approved access for OpenCoven Chat.", "polite");
    expect(text(renderer)).not.toContain("Client access took too long");
    expect(text(renderer)).not.toContain("Couldn’t refresh client access");
    expect(text(renderer)).toContain("Approved");
  });

  test.each([
    [
      "not found",
      clientV1ErrorResponse("not_found", "Pairing request not found.", 404),
    ],
    [
      "already decided elsewhere",
      clientV1ErrorResponse("conflict", "Pairing request was already decided.", 409, {
        reason: "pairing_already_decided",
      }),
    ],
  ])(
    "keeps terminal %s approve failures non-actionable when the follow-up refresh fails",
    async (_label, errorResponse) => {
      let followUpRefresh = false;
      const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
        if (url === "/api/client/v1/admin/pairing-requests" && !init?.method) {
          return followUpRefresh
            ? clientV1ErrorResponse("service_unavailable", "outage", 503)
            : clientV1SuccessResponse({ pairingRequests: [pendingRequest] });
        }
        if (url === "/api/client/v1/admin/credentials" && !init?.method) {
          return clientV1SuccessResponse({ credentials: [] });
        }
        if (url.endsWith("/request-pending/decision") && init?.method === "POST") {
          followUpRefresh = true;
          return errorResponse;
        }
        throw new Error(`Unexpected fetch: ${url} ${init?.method ?? "GET"}`);
      });
      globalThis.fetch = fetchMock;
      const renderer = await render();

      await act(async () => {
        await buttonByLabel(renderer, "Approve access for OpenCoven Chat").props.onClick();
        await flush();
      });

      expect(announce).toHaveBeenCalledWith(
        "Couldn’t approve access for OpenCoven Chat. The request is no longer pending.",
        "assertive",
      );
      expect(text(renderer)).toContain("The request is no longer pending.");
      expect(text(renderer)).toContain("No pending requests.");
      expect(text(renderer)).not.toContain("Couldn’t refresh client access");
      expect(
        renderer.root.findAll(
          (node) => node.type === "button" && node.props["aria-label"] === "Approve access for OpenCoven Chat",
        ),
      ).toHaveLength(0);
      expect(
        fetchMock.mock.calls.filter(
          ([url, init]) => url === "/api/client/v1/admin/pairing-requests" && !init?.method,
        ),
      ).toHaveLength(2);
      expect(
        fetchMock.mock.calls.filter(
          ([url, init]) => url === "/api/client/v1/admin/credentials" && !init?.method,
        ),
      ).toHaveLength(2);
    },
  );

  test.each([
    [
      "not found",
      clientV1ErrorResponse("not_found", "Pairing request not found.", 404),
    ],
    [
      "already decided elsewhere",
      clientV1ErrorResponse("conflict", "Pairing request was already decided.", 409, {
        reason: "pairing_already_decided",
      }),
    ],
  ])(
    "preserves terminal %s approve failures through automatic reconciliation and clears them after an explicit retry refresh",
    async (_label, errorResponse) => {
      let requests = [pendingRequest];
      const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
        if (url === "/api/client/v1/admin/pairing-requests" && !init?.method) {
          return clientV1SuccessResponse({ pairingRequests: requests });
        }
        if (url === "/api/client/v1/admin/credentials" && !init?.method) {
          return clientV1SuccessResponse({ credentials: [] });
        }
        if (url.endsWith("/request-pending/decision") && init?.method === "POST") {
          requests = [];
          return errorResponse;
        }
        throw new Error(`Unexpected fetch: ${url} ${init?.method ?? "GET"}`);
      });
      globalThis.fetch = fetchMock;
      const renderer = await render();

      await act(async () => {
        await buttonByLabel(renderer, "Approve access for OpenCoven Chat").props.onClick();
        await flush();
      });

      expect(announce).toHaveBeenCalledWith(
        "Couldn’t approve access for OpenCoven Chat. The request is no longer pending.",
        "assertive",
      );
      expect(text(renderer)).toContain("The request is no longer pending.");
      expect(text(renderer)).toContain("No pending requests.");
      expect(
        fetchMock.mock.calls.filter(
          ([url, init]) => url === "/api/client/v1/admin/pairing-requests" && !init?.method,
        ),
      ).toHaveLength(2);
      expect(
        fetchMock.mock.calls.filter(
          ([url, init]) => url === "/api/client/v1/admin/credentials" && !init?.method,
        ),
      ).toHaveLength(2);

      await act(async () => {
        await buttonByText(renderer, "Retry").props.onClick();
        await flush();
      });

      expect(text(renderer)).not.toContain("Couldn’t approve access for OpenCoven Chat.");
      expect(text(renderer)).not.toContain("The request is no longer pending.");
      expect(text(renderer)).toContain("No pending requests.");
      expect(
        fetchMock.mock.calls.filter(
          ([url, init]) => url === "/api/client/v1/admin/pairing-requests" && !init?.method,
        ),
      ).toHaveLength(3);
      expect(
        fetchMock.mock.calls.filter(
          ([url, init]) => url === "/api/client/v1/admin/credentials" && !init?.method,
        ),
      ).toHaveLength(3);
    },
  );

  test("does not treat generic decision failures as terminal authority", async () => {
    let requests = [pendingRequest];
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/client/v1/admin/pairing-requests" && !init?.method) {
        return clientV1SuccessResponse({ pairingRequests: requests });
      }
      if (url === "/api/client/v1/admin/credentials" && !init?.method) {
        return clientV1SuccessResponse({ credentials: [] });
      }
      if (url.endsWith("/request-pending/decision") && init?.method === "POST") {
        return clientV1ErrorResponse("service_unavailable", "outage", 503);
      }
      throw new Error(`Unexpected fetch: ${url} ${init?.method ?? "GET"}`);
    });
    globalThis.fetch = fetchMock;
    const renderer = await render();

    await act(async () => {
      await buttonByLabel(renderer, "Approve access for OpenCoven Chat").props.onClick();
      await flush();
    });

    expect(text(renderer)).toContain("OpenCoven Chat");
    expect(text(renderer)).not.toContain("The request is no longer pending.");
    expect(
      fetchMock.mock.calls.filter(
        ([url, init]) => url === "/api/client/v1/admin/pairing-requests" && !init?.method,
      ),
    ).toHaveLength(1);
    expect(
      fetchMock.mock.calls.filter(
        ([url, init]) => url === "/api/client/v1/admin/credentials" && !init?.method,
      ),
    ).toHaveLength(1);
  });

  test("polls only while active and cleans up on section change and unmount", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(CREATED_AT);
    const fetchMock = vi.fn(async (url: string) => {
      if (url === "/api/client/v1/admin/pairing-requests") {
        return clientV1SuccessResponse({ pairingRequests: [] });
      }
      if (url === "/api/client/v1/admin/credentials") {
        return clientV1SuccessResponse({ credentials: [] });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    globalThis.fetch = fetchMock;
    const renderer = await render({ active: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await act(async () => {
      vi.advanceTimersByTime(CLIENT_ACCESS_POLL_MS);
      await flush();
    });
    expect(fetchMock).toHaveBeenCalledTimes(4);

    await act(async () => {
      renderer.update(<SettingsClientAccess active={false} />);
      await flush();
    });
    await act(async () => {
      vi.advanceTimersByTime(CLIENT_ACCESS_POLL_MS * 3);
      await flush();
    });
    expect(fetchMock).toHaveBeenCalledTimes(4);

    await act(async () => renderer.unmount());
    vi.advanceTimersByTime(CLIENT_ACCESS_POLL_MS * 3);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  test("registers one searchable Client access destination in the existing section navigation", () => {
    expect(SECTIONS.map((section) => section.id)).toEqual([
      "profile",
      "general",
      "voice",
      "daemon",
      "mobile",
      "client-access",
      "appearance",
      "about",
    ]);
    expect(SECTIONS.find((section) => section.id === "client-access")).toMatchObject({
      label: "Client access",
      icon: "ph:key",
    });
    expect(
      SETTINGS_INDEX.filter((entry) => entry.section === "client-access").map((entry) => entry.group),
    ).toEqual(["Pending requests", "Issued credentials"]);
  });
});
