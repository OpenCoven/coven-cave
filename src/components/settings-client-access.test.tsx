// @ts-nocheck
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { SettingsClientAccess } from "./settings-client-access";

const observed = vi.hoisted(() => ({
  announcements: [] as { message: string; level?: string }[],
}));

const pollMock = vi.hoisted(() => ({ callback: null as (() => void) | null, intervalMs: null as number | null }));

vi.mock("@/lib/use-pausable-poll", () => ({
  // usePausablePoll's own visibility-pause/resume/cleanup behavior is
  // exercised directly by its dedicated source-contract test
  // (use-pausable-poll.test.ts) — this mock preserves the WIRING contract
  // this component depends on (poll every 2s while enabled, capture the
  // latest callback) without re-deriving the hook's internal timer/DOM
  // logic here, matching this repo's established pattern for other
  // components that consume the same shared hook (e.g.
  // familiars-view-memory-ownership.test.tsx).
  usePausablePoll: (callback: () => void, intervalMs: number, options?: { enabled?: boolean }) => {
    pollMock.intervalMs = intervalMs;
    if (options?.enabled !== false) pollMock.callback = callback;
  },
}));
vi.mock("@/components/ui/live-region", () => ({
  useAnnouncer: () => ({
    announce: (message: string, level?: string) => observed.announcements.push({ message, level }),
  }),
}));
vi.mock("@/components/ui/button", () => ({
  // A faithful mock, not a discarding one: preserves the exact
  // loading -> disabled/aria-busy semantics the real Button implements, so
  // tests can assert busy/loading state during a pending mutation without
  // pulling in the real component's Icon/iconify dependency.
  Button: ({ children, loading, leadingIcon: _leadingIcon, trailingIcon: _trailingIcon, ...props }: {
    children?: unknown;
    loading?: boolean;
    leadingIcon?: unknown;
    trailingIcon?: unknown;
    [key: string]: unknown;
  }) => (
    <button {...props} disabled={Boolean(props.disabled) || Boolean(loading)} aria-busy={loading || undefined}>
      {children}
    </button>
  ),
}));
vi.mock("@/components/ui/empty-state", () => ({
  EmptyState: ({ headline }: { headline: unknown }) => <div data-empty-state>{headline}</div>,
}));
vi.mock("@/components/ui/error-state", () => ({
  ErrorState: ({ headline, actions }: { headline: unknown; actions: unknown }) => (
    <div data-error-state>
      {headline}
      {actions}
    </div>
  ),
}));
vi.mock("@/components/ui/skeleton", () => ({
  SkeletonRows: () => <div data-skeleton />,
}));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function response(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

function textContent(node: unknown): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textContent).join("");
  if (node && typeof node === "object" && "children" in node) {
    return textContent((node as { children: unknown }).children);
  }
  return "";
}

async function settle(): Promise<void> {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
}

function buttonWithText(renderer: ReactTestRenderer, text: string) {
  return renderer.root.findAllByType("button").find((candidate) => textContent(candidate.children).includes(text));
}

/**
 * Names of every rendered credential/pending row's `<strong>` heading — used
 * instead of a raw full-tree text search so an assertion like "the revoked
 * credential's row is gone" isn't accidentally satisfied (or defeated) by
 * the component's own static hero copy, which mentions "OpenCoven Chat" by
 * name regardless of what's actually in either list.
 */
function credentialRowNames(renderer: ReactTestRenderer): string[] {
  return renderer.root
    .findAllByProps({ className: "settings-client-access-row" })
    .map((row) => textContent(row.findByType("strong").children));
}

const pendingRequest = {
  id: "req-1",
  appName: "OpenCoven Chat",
  installationId: "9f4145de-9b43-4abc-876d-81ef63de60e0",
  scopes: ["chat:read", "chat:write"],
  status: "pending" as const,
  createdAt: Date.now(),
  expiresAt: Date.now() + 60_000,
};

const pairedCredential = {
  id: "cred-1",
  appName: "OpenCoven Chat",
  installationId: "1b1b1b1b-2222-4333-8444-555555555555",
  scopes: ["chat:read"],
  createdAt: Date.now(),
  lastUsedAt: null,
  revokedAt: null,
};

let originalFetch: typeof fetch;

beforeEach(() => {
  observed.announcements.length = 0;
  pollMock.callback = null;
  pollMock.intervalMs = null;
  originalFetch = globalThis.fetch;
});

afterEach(async () => {
  vi.restoreAllMocks();
  globalThis.fetch = originalFetch;
});

test("renders empty states when there is nothing pending and nothing paired", async () => {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/admin/pairing-requests")) return response({ ok: true, requests: [] });
    if (url.includes("/admin/credentials")) return response({ ok: true, credentials: [] });
    throw new Error(`Unexpected request: ${url}`);
  }) as typeof fetch;

  let renderer: ReactTestRenderer | null = null;
  try {
    await act(async () => {
      renderer = create(<SettingsClientAccess />);
      await settle();
    });
    const emptyStates = renderer!.root.findAll((node) => node.props["data-empty-state"] !== undefined);
    expect(emptyStates.length).toBe(2);
    expect(textContent(emptyStates[0].children)).toMatch(/No pending pairing requests/);
    expect(textContent(emptyStates[1].children)).toMatch(/No paired clients yet/);
  } finally {
    await act(async () => {
      renderer?.unmount();
    });
  }
});

test("approving a pending request posts a decision, removes the row, and announces success", async () => {
  const decisions: RequestInit[] = [];
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/decision")) {
      decisions.push(init!);
      return response({ ok: true, request: { ...pendingRequest, status: "approved" } });
    }
    if (url.includes("/admin/pairing-requests")) return response({ ok: true, requests: [pendingRequest] });
    if (url.includes("/admin/credentials")) return response({ ok: true, credentials: [] });
    throw new Error(`Unexpected request: ${url}`);
  }) as typeof fetch;

  let renderer: ReactTestRenderer | null = null;
  try {
    await act(async () => {
      renderer = create(<SettingsClientAccess />);
      await settle();
    });
    expect(textContent(renderer!.toJSON())).toContain("OpenCoven Chat");
    expect(textContent(renderer!.toJSON())).toMatch(/Requested .*ago|Requested just now/);
    expect(textContent(renderer!.toJSON())).toMatch(/Expires in|Expiring now/);

    await act(async () => {
      buttonWithText(renderer!, "Approve")!.props.onClick();
      await settle();
    });

    expect(decisions).toHaveLength(1);
    expect(new Headers(decisions[0].headers).get("idempotency-key")).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(JSON.parse(decisions[0].body as string)).toEqual({ decision: "approve" });
    expect(observed.announcements).toContainEqual({ message: "Approved OpenCoven Chat.", level: undefined });
    const emptyStates = renderer!.root.findAll((node) => node.props["data-empty-state"] !== undefined);
    expect(textContent(emptyStates[0].children)).toMatch(/No pending pairing requests/);
  } finally {
    await act(async () => {
      renderer?.unmount();
    });
  }
});

test("denying a pending request announces the denial and clears the row", async () => {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/decision")) return response({ ok: true, request: { ...pendingRequest, status: "denied" } });
    if (url.includes("/admin/pairing-requests")) return response({ ok: true, requests: [pendingRequest] });
    if (url.includes("/admin/credentials")) return response({ ok: true, credentials: [] });
    throw new Error(`Unexpected request: ${url}`);
  }) as typeof fetch;

  let renderer: ReactTestRenderer | null = null;
  try {
    await act(async () => {
      renderer = create(<SettingsClientAccess />);
      await settle();
    });
    await act(async () => {
      buttonWithText(renderer!, "Deny")!.props.onClick();
      await settle();
    });
    expect(observed.announcements).toContainEqual({ message: "Denied OpenCoven Chat.", level: undefined });
  } finally {
    await act(async () => {
      renderer?.unmount();
    });
  }
});

test("a paired credential row renders both its creation time and last-use time", async () => {
  const pairedAt = Date.now() - 3 * 60 * 60 * 1000; // 3 hours ago
  const usedAt = Date.now() - 5 * 60 * 1000; // 5 minutes ago
  const credential = { ...pairedCredential, createdAt: pairedAt, lastUsedAt: usedAt };
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/admin/pairing-requests")) return response({ ok: true, requests: [] });
    if (url.includes("/admin/credentials")) return response({ ok: true, credentials: [credential] });
    throw new Error(`Unexpected request: ${url}`);
  }) as typeof fetch;

  let renderer: ReactTestRenderer | null = null;
  try {
    await act(async () => {
      renderer = create(<SettingsClientAccess />);
      await settle();
    });
    const text = textContent(renderer!.toJSON());
    expect(text).toMatch(/Paired 3h ago/);
    expect(text).toMatch(/Last used 5m ago/);
  } finally {
    await act(async () => {
      renderer?.unmount();
    });
  }
});

test("a paired credential never used still shows its creation time alongside \"Never used\"", async () => {
  const pairedAt = Date.now() - 60 * 60 * 1000; // 1 hour ago
  const credential = { ...pairedCredential, createdAt: pairedAt, lastUsedAt: null };
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/admin/pairing-requests")) return response({ ok: true, requests: [] });
    if (url.includes("/admin/credentials")) return response({ ok: true, credentials: [credential] });
    throw new Error(`Unexpected request: ${url}`);
  }) as typeof fetch;

  let renderer: ReactTestRenderer | null = null;
  try {
    await act(async () => {
      renderer = create(<SettingsClientAccess />);
      await settle();
    });
    const text = textContent(renderer!.toJSON());
    expect(text).toMatch(/Paired 1h ago/);
    expect(text).toContain("Never used");
  } finally {
    await act(async () => {
      renderer?.unmount();
    });
  }
});

test("revoking a paired credential deletes it, removes the row, and announces success", async () => {
  const deletes: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    if (init?.method === "DELETE") {
      deletes.push({ url, init });
      return response({ ok: true, revoked: true });
    }
    if (url.includes("/admin/pairing-requests")) return response({ ok: true, requests: [] });
    if (url.includes("/admin/credentials")) return response({ ok: true, credentials: [pairedCredential] });
    throw new Error(`Unexpected request: ${url}`);
  }) as typeof fetch;

  let renderer: ReactTestRenderer | null = null;
  try {
    await act(async () => {
      renderer = create(<SettingsClientAccess />);
      await settle();
    });
    expect(textContent(renderer!.toJSON())).toContain("OpenCoven Chat");

    await act(async () => {
      buttonWithText(renderer!, "Revoke")!.props.onClick();
      await settle();
    });

    expect(deletes).toHaveLength(1);
    expect(deletes[0].url).toContain(`/admin/credentials/${pairedCredential.id}`);
    expect(new Headers(deletes[0].init?.headers).get("idempotency-key")).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(observed.announcements).toContainEqual({
      message: "Revoked access for OpenCoven Chat.",
      level: undefined,
    });
  } finally {
    await act(async () => {
      renderer?.unmount();
    });
  }
});

test("a mutation failure announces assertively and leaves the row in place", async () => {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/decision")) return response({ ok: false }, 500);
    if (url.includes("/admin/pairing-requests")) return response({ ok: true, requests: [pendingRequest] });
    if (url.includes("/admin/credentials")) return response({ ok: true, credentials: [] });
    throw new Error(`Unexpected request: ${url}`);
  }) as typeof fetch;

  let renderer: ReactTestRenderer | null = null;
  try {
    await act(async () => {
      renderer = create(<SettingsClientAccess />);
      await settle();
    });
    await act(async () => {
      buttonWithText(renderer!, "Approve")!.props.onClick();
      await settle();
    });
    expect(observed.announcements).toContainEqual({
      message: "Couldn’t approve OpenCoven Chat.",
      level: "assertive",
    });
    expect(textContent(renderer!.toJSON())).toContain("OpenCoven Chat");
  } finally {
    await act(async () => {
      renderer?.unmount();
    });
  }
});

test("a poll tick refreshes BOTH the pending list and the credentials list, without disturbing an in-flight local decision", async () => {
  let pendingReads = 0;
  let credentialReads = 0;
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/admin/pairing-requests")) {
      pendingReads += 1;
      return response({ ok: true, requests: pendingReads === 1 ? [pendingRequest] : [] });
    }
    if (url.includes("/admin/credentials")) {
      credentialReads += 1;
      return response({ ok: true, credentials: [] });
    }
    throw new Error(`Unexpected request: ${url}`);
  }) as typeof fetch;

  let renderer: ReactTestRenderer | null = null;
  try {
    await act(async () => {
      renderer = create(<SettingsClientAccess />);
      await settle();
    });
    expect(pendingReads).toBe(1);
    expect(credentialReads).toBe(1);
    expect(pollMock.callback).toBeTruthy();

    // The single callback SettingsClientAccess wires into usePausablePoll is
    // invoked identically on BOTH a recurring interval tick and an
    // on-regained-focus refresh (usePausablePoll's own contract, pinned by
    // use-pausable-poll.test.ts) — so exercising it here once proves both
    // triggers refresh both endpoints.
    await act(async () => {
      pollMock.callback!();
      await settle();
    });
    expect(pendingReads).toBe(2);
    expect(credentialReads).toBe(2);
    const emptyStates = renderer!.root.findAll((node) => node.props["data-empty-state"] !== undefined);
    expect(textContent(emptyStates[0].children)).toMatch(/No pending pairing requests/);
  } finally {
    await act(async () => {
      renderer?.unmount();
    });
  }
});

test("an approved-and-since-exchanged credential appears on a later poll tick, without remounting", async () => {
  let credentialReads = 0;
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/admin/pairing-requests")) return response({ ok: true, requests: [] });
    if (url.includes("/admin/credentials")) {
      credentialReads += 1;
      // The first fetch (mount load) sees no credentials yet; a later poll
      // tick observes one that was approved and exchanged out-of-band (in
      // the OpenCoven Chat client) in between.
      return response({ ok: true, credentials: credentialReads === 1 ? [] : [pairedCredential] });
    }
    throw new Error(`Unexpected request: ${url}`);
  }) as typeof fetch;

  let renderer: ReactTestRenderer | null = null;
  try {
    await act(async () => {
      renderer = create(<SettingsClientAccess />);
      await settle();
    });
    expect(credentialReads).toBe(1);
    let emptyStates = renderer!.root.findAll((node) => node.props["data-empty-state"] !== undefined);
    expect(textContent(emptyStates.find((n) => /paired clients yet/.test(textContent(n.children)))?.children)).toMatch(
      /No paired clients yet/,
    );

    await act(async () => {
      pollMock.callback!();
      await settle();
    });
    expect(credentialReads).toBe(2);
    emptyStates = renderer!.root.findAll((node) => node.props["data-empty-state"] !== undefined);
    expect(emptyStates.some((n) => /paired clients yet/.test(textContent(n.children)))).toBe(false);
    const rows = renderer!.root.findAllByProps({ className: "settings-client-access-row" });
    expect(rows.some((row) => textContent(row.children).includes(pairedCredential.appName))).toBe(true);
  } finally {
    await act(async () => {
      renderer?.unmount();
    });
  }
});

test("a revoke immediately suppresses the row against a stale already-in-flight GET, and later server responses resolve the suppression correctly", async () => {
  // Mirrors the pending-decision race this component already guards
  // against, for credential revocation: a credential GET that was already
  // in flight when the operator revoked must never resurrect the row (even
  // if its response still contains it), and a subsequent poll tick — one
  // the server hadn't yet caught up on — must ALSO keep suppressing the row
  // locally until the server itself confirms the id is gone. Only then does
  // normal (unrelated) future data apply again.
  const inFlightGate = deferred<Response>();
  const laggingServerGate = deferred<Response>();
  const confirmedAbsentGate = deferred<Response>();
  let credentialReads = 0;
  const signalsSeen: AbortSignal[] = [];
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    if (init?.method === "DELETE") return response({ ok: true, revoked: true });
    if (url.includes("/admin/pairing-requests")) return response({ ok: true, requests: [] });
    if (url.includes("/admin/credentials")) {
      credentialReads += 1;
      if (init?.signal) signalsSeen.push(init.signal);
      // 1st read: the mount load, resolves normally with the paired credential.
      if (credentialReads === 1) return response({ ok: true, credentials: [pairedCredential] });
      // 2nd read: a poll tick's GET, deliberately left in flight (gated)
      // across the revoke below.
      if (credentialReads === 2) return inFlightGate.promise;
      // 3rd read: the NEXT poll tick after the revoke — this simulates a
      // server that hasn't yet caught up with the revocation (read lag),
      // still reporting the credential as present.
      if (credentialReads === 3) return laggingServerGate.promise;
      // 4th read: a later poll tick where the server has now confirmed the
      // id is really gone.
      if (credentialReads === 4) return confirmedAbsentGate.promise;
      // 5th+ read: normal, unrelated future data — a different credential
      // entirely, proving suppression doesn't leak past confirmation.
      return response({ ok: true, credentials: [{ ...pairedCredential, id: "cred-2", appName: "Second Client" }] });
    }
    throw new Error(`Unexpected request: ${url}`);
  }) as typeof fetch;

  let renderer: ReactTestRenderer | null = null;
  try {
    await act(async () => {
      renderer = create(<SettingsClientAccess />);
      await settle();
    });
    expect(credentialReads).toBe(1);
    expect(credentialRowNames(renderer!)).toContain("OpenCoven Chat");

    // A poll tick starts a second, gated GET — left in flight.
    await act(async () => {
      pollMock.callback!();
      await settle();
    });
    expect(credentialReads).toBe(2);

    // While that GET is still in flight, the operator revokes successfully.
    await act(async () => {
      buttonWithText(renderer!, "Revoke")!.props.onClick();
      await settle();
    });
    expect(observed.announcements).toContainEqual({
      message: "Revoked access for OpenCoven Chat.",
      level: undefined,
    });
    // The row is removed immediately — a caller must never have to wait for
    // the next poll to see a revoked credential disappear.
    expect(credentialRowNames(renderer!)).not.toContain("OpenCoven Chat");
    // The in-flight GET's own AbortController was aborted by the revoke.
    expect(signalsSeen[1]?.aborted).toBe(true);

    // The stale, already-in-flight GET now resolves with a response that
    // STILL contains the just-revoked row (it captured server state from
    // before the revoke). It must not resurrect the row.
    await act(async () => {
      inFlightGate.resolve(response({ ok: true, credentials: [pairedCredential] }));
      await settle();
    });
    expect(credentialRowNames(renderer!)).not.toContain("OpenCoven Chat");

    // The next poll tick issues a BRAND NEW GET (a fresh, current
    // generation) — but the server itself is still lagging and reports the
    // credential as present. Local suppression (not the generation guard,
    // which only protects against responses issued before the revoke) must
    // still keep the row hidden.
    await act(async () => {
      pollMock.callback!();
      await settle();
    });
    expect(credentialReads).toBe(3);
    await act(async () => {
      laggingServerGate.resolve(response({ ok: true, credentials: [pairedCredential] }));
      await settle();
    });
    expect(credentialRowNames(renderer!)).not.toContain("OpenCoven Chat");

    // A later poll tick's response FINALLY confirms the server no longer
    // reports the id — suppression is lifted.
    await act(async () => {
      pollMock.callback!();
      await settle();
    });
    expect(credentialReads).toBe(4);
    await act(async () => {
      confirmedAbsentGate.resolve(response({ ok: true, credentials: [] }));
      await settle();
    });
    expect(credentialRowNames(renderer!)).not.toContain("OpenCoven Chat");

    // Normal future data (an entirely different, never-revoked credential)
    // now applies without being caught by any lingering suppression.
    await act(async () => {
      pollMock.callback!();
      await settle();
    });
    expect(credentialReads).toBe(5);
    expect(credentialRowNames(renderer!)).toContain("Second Client");
  } finally {
    await act(async () => {
      renderer?.unmount();
    });
  }
});

test("a failed revoke DELETE never hides the credential", async () => {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    if (init?.method === "DELETE") return response({ ok: false }, 500);
    if (url.includes("/admin/pairing-requests")) return response({ ok: true, requests: [] });
    if (url.includes("/admin/credentials")) return response({ ok: true, credentials: [pairedCredential] });
    throw new Error(`Unexpected request: ${url}`);
  }) as typeof fetch;

  let renderer: ReactTestRenderer | null = null;
  try {
    await act(async () => {
      renderer = create(<SettingsClientAccess />);
      await settle();
    });
    await act(async () => {
      buttonWithText(renderer!, "Revoke")!.props.onClick();
      await settle();
    });
    expect(observed.announcements).toContainEqual({
      message: "Couldn’t revoke access for OpenCoven Chat.",
      level: "assertive",
    });
    expect(textContent(renderer!.toJSON())).toContain("OpenCoven Chat");

    // A subsequent poll tick still reports the (never revoked) credential
    // normally — a failed DELETE must never install any local suppression.
    await act(async () => {
      pollMock.callback!();
      await settle();
    });
    expect(textContent(renderer!.toJSON())).toContain("OpenCoven Chat");
  } finally {
    await act(async () => {
      renderer?.unmount();
    });
  }
});

test("unmounting mid-poll aborts BOTH the pending and credentials in-flight fetches", async () => {
  const pendingGate = deferred<Response>();
  const credentialsGate = deferred<Response>();
  const pendingSignals: AbortSignal[] = [];
  const credentialSignals: AbortSignal[] = [];
  let pendingCalls = 0;
  let credentialCalls = 0;
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/admin/pairing-requests")) {
      pendingCalls += 1;
      if (init?.signal) pendingSignals.push(init.signal);
      if (pendingCalls === 1) return response({ ok: true, requests: [] });
      return pendingGate.promise;
    }
    if (url.includes("/admin/credentials")) {
      credentialCalls += 1;
      if (init?.signal) credentialSignals.push(init.signal);
      if (credentialCalls === 1) return response({ ok: true, credentials: [] });
      return credentialsGate.promise;
    }
    throw new Error(`Unexpected request: ${url}`);
  }) as typeof fetch;

  let renderer: ReactTestRenderer | null = null;
  await act(async () => {
    renderer = create(<SettingsClientAccess />);
    await settle();
  });
  expect(pendingCalls).toBe(1);
  expect(credentialCalls).toBe(1);

  // Trigger a poll tick whose two fetches never resolve (both gated), then
  // unmount before they settle.
  await act(async () => {
    pollMock.callback!();
    await settle();
  });
  expect(pendingCalls).toBe(2);
  expect(credentialCalls).toBe(2);
  expect(pendingSignals[1]?.aborted).toBe(false);
  expect(credentialSignals[1]?.aborted).toBe(false);

  await act(async () => {
    renderer!.unmount();
    await settle();
  });

  expect(pendingSignals[1]?.aborted).toBe(true);
  expect(credentialSignals[1]?.aborted).toBe(true);

  // Resolving the gated fetches after unmount must never throw (no
  // dangling state updates on an unmounted component).
  pendingGate.resolve(response({ ok: true, requests: [] }));
  credentialsGate.resolve(response({ ok: true, credentials: [] }));
  await settle();
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((onResolve) => {
    resolve = onResolve;
  });
  return { promise, resolve };
}

test("pending requests and credentials are both polled every 2 seconds through the SAME usePausablePoll wiring, matching the repo's shared visibility-aware poll hook", async () => {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/admin/pairing-requests")) return response({ ok: true, requests: [] });
    if (url.includes("/admin/credentials")) return response({ ok: true, credentials: [] });
    throw new Error(`Unexpected request: ${url}`);
  }) as typeof fetch;

  let renderer: ReactTestRenderer | null = null;
  try {
    await act(async () => {
      renderer = create(<SettingsClientAccess />);
      await settle();
    });
    // usePausablePoll itself owns the actual visibility-pause/resume/cleanup
    // behavior (pinned by its own use-pausable-poll.test.ts source-contract
    // test); this test only pins that SettingsClientAccess actually wires it
    // up with the 2-second interval the spec requires, and stays enabled.
    expect(pollMock.intervalMs).toBe(2_000);
    expect(pollMock.callback).toBeTruthy();
  } finally {
    await act(async () => {
      renderer?.unmount();
    });
  }
});

test("the pending and paired-clients loading states are announced (role=status, aria-busy, sr-only text) before their first fetch resolves", async () => {
  const pendingGate = deferred<Response>();
  const credentialsGate = deferred<Response>();
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/admin/pairing-requests")) return pendingGate.promise;
    if (url.includes("/admin/credentials")) return credentialsGate.promise;
    throw new Error(`Unexpected request: ${url}`);
  }) as typeof fetch;

  let renderer: ReactTestRenderer | null = null;
  try {
    await act(async () => {
      renderer = create(<SettingsClientAccess />);
      await settle();
    });
    const statusRegions = renderer!.root.findAll(
      (node) => node.type === "section" && node.props.role === "status",
    );
    expect(statusRegions).toHaveLength(2);
    for (const region of statusRegions) {
      expect(region.props["aria-busy"]).toBe("true");
    }
    const srOnlyText = statusRegions.map((region) => textContent(region.children));
    expect(srOnlyText.some((text) => /Loading pending pairing requests/.test(text))).toBe(true);
    expect(srOnlyText.some((text) => /Loading paired clients/.test(text))).toBe(true);

    await act(async () => {
      pendingGate.resolve(response({ ok: true, requests: [] }));
      credentialsGate.resolve(response({ ok: true, credentials: [] }));
      await settle();
    });
    expect(renderer!.root.findAll((node) => node.type === "section" && node.props.role === "status")).toHaveLength(0);
  } finally {
    await act(async () => {
      renderer?.unmount();
    });
  }
});

test("approve/deny expose real Button loading/aria-busy semantics while a decision is in flight, and clear them afterward", async () => {
  const decisionGate = deferred<Response>();
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/decision")) return decisionGate.promise;
    if (url.includes("/admin/pairing-requests")) return response({ ok: true, requests: [pendingRequest] });
    if (url.includes("/admin/credentials")) return response({ ok: true, credentials: [] });
    throw new Error(`Unexpected request: ${url}`);
  }) as typeof fetch;

  let renderer: ReactTestRenderer | null = null;
  try {
    await act(async () => {
      renderer = create(<SettingsClientAccess />);
      await settle();
    });

    const approveBefore = buttonWithText(renderer!, "Approve")!;
    const denyBefore = buttonWithText(renderer!, "Deny")!;
    expect(approveBefore.props["aria-busy"]).toBeUndefined();
    expect(approveBefore.props.disabled).toBeFalsy();
    expect(denyBefore.props.disabled).toBeFalsy();

    await act(async () => {
      buttonWithText(renderer!, "Approve")!.props.onClick();
      await settle();
    });

    // Still pending on the server — the row (and both its buttons) must show
    // busy/loading semantics for as long as the decision is in flight.
    const approveDuring = buttonWithText(renderer!, "Approve")!;
    const denyDuring = buttonWithText(renderer!, "Deny")!;
    expect(approveDuring.props["aria-busy"]).toBe(true);
    expect(approveDuring.props.disabled).toBe(true);
    expect(denyDuring.props["aria-busy"]).toBe(true);
    expect(denyDuring.props.disabled).toBe(true);

    await act(async () => {
      decisionGate.resolve(response({ ok: true, request: { ...pendingRequest, status: "approved" } }));
      await settle();
    });

    expect(observed.announcements).toContainEqual({ message: "Approved OpenCoven Chat.", level: undefined });
    expect(buttonWithText(renderer!, "Approve")).toBeUndefined();
  } finally {
    await act(async () => {
      renderer?.unmount();
    });
  }
});

test("revoke exposes real Button loading/aria-busy semantics while the revoke request is in flight, and clears them afterward", async () => {
  const revokeGate = deferred<Response>();
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    if (init?.method === "DELETE") return revokeGate.promise;
    if (url.includes("/admin/pairing-requests")) return response({ ok: true, requests: [] });
    if (url.includes("/admin/credentials")) return response({ ok: true, credentials: [pairedCredential] });
    throw new Error(`Unexpected request: ${url}`);
  }) as typeof fetch;

  let renderer: ReactTestRenderer | null = null;
  try {
    await act(async () => {
      renderer = create(<SettingsClientAccess />);
      await settle();
    });

    const revokeBefore = buttonWithText(renderer!, "Revoke")!;
    expect(revokeBefore.props["aria-busy"]).toBeUndefined();
    expect(revokeBefore.props.disabled).toBeFalsy();

    await act(async () => {
      buttonWithText(renderer!, "Revoke")!.props.onClick();
      await settle();
    });

    const revokeDuring = buttonWithText(renderer!, "Revoke")!;
    expect(revokeDuring.props["aria-busy"]).toBe(true);
    expect(revokeDuring.props.disabled).toBe(true);

    await act(async () => {
      revokeGate.resolve(response({ ok: true, revoked: true }));
      await settle();
    });

    expect(observed.announcements).toContainEqual({
      message: "Revoked access for OpenCoven Chat.",
      level: undefined,
    });
    expect(buttonWithText(renderer!, "Revoke")).toBeUndefined();
  } finally {
    await act(async () => {
      renderer?.unmount();
    });
  }
});

console.log("settings-client-access.test.tsx: ok");
