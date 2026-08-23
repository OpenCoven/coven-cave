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

  test("calls Task 3 admin APIs and announces approve, deny, and revoke success", async () => {
    let requests = [pendingRequest, { ...pendingRequest, id: "request-2", appName: "Task Client" }];
    let credentials = [activeCredential];
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
      await buttonByLabel(renderer, "Approve access for OpenCoven Chat").props.onClick();
      await flush();
    });
    expect(announce).toHaveBeenCalledWith("Approved access for OpenCoven Chat.", "polite");

    await act(async () => {
      await buttonByLabel(renderer, "Deny access for Task Client").props.onClick();
      await flush();
    });
    expect(announce).toHaveBeenCalledWith("Denied access for Task Client.", "polite");

    await act(async () => {
      await buttonByLabel(renderer, "Revoke access for OpenCoven Chat").props.onClick();
      await flush();
    });
    expect(announce).toHaveBeenCalledWith("Revoked access for OpenCoven Chat.", "polite");

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
    ).toBe(true);
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
