import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import {
  buildFamiliarExecutionAnalytics,
  EXECUTION_ATTEMPT_SCHEMA_VERSION,
  normalizeExecutionAttemptSnapshot,
  type ExecutionAttemptSnapshotV1,
} from "@/lib/familiar-execution-analytics.ts";
import {
  CLIENT_V1_HPKE_RESPONSE_MEDIA_TYPE,
} from "@/lib/server/client-v1/authority-contract.ts";
import type { ClientV1ReadSources } from "@/lib/server/client-v1/read-sources.ts";
import { createClientV1Runtime, type ClientV1Runtime } from "@/lib/server/client-v1/runtime.ts";
import { createClientV1HpkeTestClient } from "@/lib/server/client-v1/testing/hpke-client.ts";
import { withClientV1HpkeRouteTestAuthority } from "@/lib/server/client-v1/testing/route-authority.ts";
import type { VisibleFamiliarRosterEntry } from "@/lib/server/familiar-roster.ts";
import { LOCAL_PEER_HEADER } from "@/proxy-helpers.ts";

import { createClientV1FamiliarAnalyticsGetHandler } from "./route.ts";

const scratchPrefix = resolve(process.cwd(), ".scratch-client-v1-familiar-analytics-");
const STAMP = "loopback-secret";
const INSTANCE_ID = "client-v1-familiar-analytics-route-test";
const BOUND_NOW = 60_000;
const NOW = new Date("2026-08-18T10:00:00.000Z");

function snapshot(overrides: Record<string, unknown> = {}): ExecutionAttemptSnapshotV1 {
  const value = normalizeExecutionAttemptSnapshot({
    schemaVersion: EXECUTION_ATTEMPT_SCHEMA_VERSION,
    attemptId: "ea1_test",
    familiarId: "scribe",
    sessionId: "session-test",
    turnId: "turn-test",
    attemptNumber: 1,
    execution: { kind: "assistant-response", origin: "chat" },
    timing: { completedAt: "2026-08-18T09:00:00.000Z" },
    outcome: { status: "succeeded" },
    provenance: {
      source: "live",
      sourceSchema: "execution-attempt-v1",
      capturedAt: "2026-08-18T09:00:00.000Z",
    },
    coverage: { knownFields: [] },
    ...overrides,
  });
  assert.ok(value);
  return value;
}

const ATTEMPTS = [
  snapshot({ attemptId: "ea1_a", timing: { completedAt: "2026-08-18T09:30:00.000Z" }, outcome: { status: "error" } }),
  snapshot({ attemptId: "ea1_b", timing: { completedAt: "2026-08-17T09:30:00.000Z" } }),
  snapshot({ attemptId: "ea1_c", timing: { completedAt: "2026-06-01T09:00:00.000Z" }, outcome: { status: "cancelled" } }),
];

function analyticsFor(args: { familiarId: string; recentLimit: number }) {
  return buildFamiliarExecutionAnalytics({
    familiarId: args.familiarId,
    attempts: ATTEMPTS,
    now: NOW,
    recentLimit: args.recentLimit,
  });
}

function roster(...ids: string[]): VisibleFamiliarRosterEntry[] {
  return ids.map((id) => ({ id, display_name: id.toUpperCase(), role: "Familiar" }));
}

function sources(overrides: Partial<ClientV1ReadSources> = {}): ClientV1ReadSources {
  const unsupported = async (): Promise<never> => {
    throw new Error("unsupported read source for this route");
  };
  return {
    listFamiliars: async () => ({
      ok: true,
      config: {} as never,
      target: {} as never,
      roster: roster("mote", "scribe"),
    }),
    listProjects: unsupported,
    listConversations: unsupported,
    loadConversation: unsupported,
    loadFamiliarContract: unsupported,
    readFamiliarAnalytics: async (args) => analyticsFor(args),
    ...overrides,
  };
}

function request(id: string, headers: Record<string, string> = {}, query = ""): Request {
  return new Request(
    `http://127.0.0.1:3020/api/client/v1/familiars/${encodeURIComponent(id)}/analytics${query}`,
    { headers: { [LOCAL_PEER_HEADER]: STAMP, ...headers } },
  );
}

function context(id: string) {
  return { params: Promise.resolve({ id }) };
}

async function withRuntime<T>(
  scopes: ("chat:read" | "chat:write")[],
  body: (runtime: ClientV1Runtime, bearer: string) => Promise<T>,
): Promise<T> {
  const root = await mkdtemp(scratchPrefix);
  try {
    const runtime = createClientV1Runtime({ credentialRoot: root, loopbackSecret: STAMP });
    const issued = await runtime.credentialStore.issue({
      appName: "OpenCoven Chat",
      installationId: "chat-install-1",
      scopes,
    });
    return await body(runtime, issued.bearer);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
}

type AnalyticsBody = {
  capabilities: string[];
  data: {
    analytics: {
      generatedAt: string;
      windows: Record<string, { attempts: number; completed: number; failed: number; days?: { date: string; completed: number; failed: number; cancelled: number }[] }>;
      recentAttempts: { id: string }[];
      backfill: { state: string };
    };
  };
};

test("a paired credential reads every window, the day series, and the recent attempts", async () => {
  await withRuntime(["chat:read"], async (runtime, bearer) => {
    const seen: { familiarId: string; recentLimit: number }[] = [];
    const handler = createClientV1FamiliarAnalyticsGetHandler(
      runtime,
      sources({
        readFamiliarAnalytics: async (args) => {
          seen.push(args);
          return analyticsFor(args);
        },
      }),
    );
    const response = await handler(
      request("scribe", { authorization: `Bearer ${bearer}` }),
      context("scribe"),
    );
    assert.equal(response.status, 200);
    const body = await response.json() as AnalyticsBody;
    assert.ok(body.capabilities.includes("familiar-analytics"));
    const { analytics } = body.data;
    assert.equal(analytics.generatedAt, NOW.toISOString());
    assert.deepEqual(Object.keys(analytics.windows), ["7d", "14d", "8w", "all"]);
    assert.equal(analytics.windows["7d"].attempts, 2);
    assert.equal(analytics.windows["7d"].failed, 1);
    assert.equal(analytics.windows["7d"].days?.length, 7);
    assert.deepEqual(analytics.windows["7d"].days?.at(-1), {
      date: "2026-08-18", completed: 0, failed: 1, cancelled: 0,
    });
    assert.equal("days" in analytics.windows.all, false);
    assert.deepEqual(analytics.recentAttempts.map((attempt) => attempt.id), ["ea1_a", "ea1_b", "ea1_c"]);
    assert.equal(analytics.backfill.state, "not-started");
    assert.deepEqual(seen, [{ familiarId: "scribe", recentLimit: 50 }]);
  });
});

test("window and recent narrow the read without changing what was stored", async () => {
  await withRuntime(["chat:read"], async (runtime, bearer) => {
    const seen: { familiarId: string; recentLimit: number }[] = [];
    const handler = createClientV1FamiliarAnalyticsGetHandler(
      runtime,
      sources({
        readFamiliarAnalytics: async (args) => {
          seen.push(args);
          return analyticsFor(args);
        },
      }),
    );
    const authorization = `Bearer ${bearer}`;
    const narrowed = await handler(request("scribe", { authorization }, "?window=14d&recent=1"), context("scribe"));
    assert.equal(narrowed.status, 200);
    const { analytics } = (await narrowed.json() as AnalyticsBody).data;
    assert.deepEqual(Object.keys(analytics.windows), ["14d"]);
    assert.equal(analytics.windows["14d"].days?.length, 14);
    assert.deepEqual(analytics.recentAttempts.map((attempt) => attempt.id), ["ea1_a"]);
    assert.deepEqual(seen, [{ familiarId: "scribe", recentLimit: 1 }]);

    const none = await handler(request("scribe", { authorization }, "?recent=0"), context("scribe"));
    assert.deepEqual((await none.json() as AnalyticsBody).data.analytics.recentAttempts, []);
  });
});

test("a query the route does not serve is refused before the store is read", async () => {
  await withRuntime(["chat:read"], async (runtime, bearer) => {
    let reads = 0;
    const handler = createClientV1FamiliarAnalyticsGetHandler(
      runtime,
      sources({
        readFamiliarAnalytics: async (args) => {
          reads += 1;
          return analyticsFor(args);
        },
      }),
    );
    const authorization = `Bearer ${bearer}`;
    for (const query of [
      "?limit=5",
      "?cursor=abc",
      "?window=3d",
      "?window=7d&window=14d",
      "?recent=101",
      "?recent=-1",
      "?recent=1.5",
      "?recent=abc",
    ]) {
      const response = await handler(request("scribe", { authorization }, query), context("scribe"));
      assert.equal(response.status, 400, query);
      const body = await response.json() as { error: { code: string; details?: { reason?: string } } };
      assert.equal(body.error.code, "invalid_request", query);
      assert.equal(typeof body.error.details?.reason, "string", query);
    }
    assert.equal(reads, 0);
  });
});

test("an id the roster does not carry is not_found, whatever shape it has", async () => {
  await withRuntime(["chat:read"], async (runtime, bearer) => {
    let reads = 0;
    const handler = createClientV1FamiliarAnalyticsGetHandler(
      runtime,
      sources({
        readFamiliarAnalytics: async (args) => {
          reads += 1;
          return analyticsFor(args);
        },
      }),
    );
    const authorization = `Bearer ${bearer}`;
    for (const id of ["warden", "../../../etc/passwd", "..", "", "scribe/analytics", "scrib", "scribe2"]) {
      const response = await handler(request(id, { authorization }), context(id));
      assert.equal(response.status, 404, id);
      const body = await response.json() as { error: { code: string; retryable: boolean } };
      assert.equal(body.error.code, "not_found", id);
      assert.equal(body.error.retryable, false, id);
    }
    assert.equal(reads, 0);
  });
});

test("a roster that cannot be read is service_unavailable, not not_found", async () => {
  await withRuntime(["chat:read"], async (runtime, bearer) => {
    const handler = createClientV1FamiliarAnalyticsGetHandler(
      runtime,
      sources({
        listFamiliars: async () => ({
          ok: false,
          config: {} as never,
          target: {} as never,
          status: 503,
          error: "daemon at http://127.0.0.1:7777 is not reachable",
        }),
      }),
    );
    const response = await handler(
      request("scribe", { authorization: `Bearer ${bearer}` }),
      context("scribe"),
    );
    assert.equal(response.status, 503);
    const body = await response.json() as { error: { code: string; retryable: boolean; message: string } };
    assert.equal(body.error.code, "service_unavailable");
    assert.equal(body.error.retryable, true);
    assert.equal(body.error.message.includes("7777"), false);
  });
});

test("an analytics read that throws answers an envelope without the path it named", async () => {
  await withRuntime(["chat:read"], async (runtime, bearer) => {
    const handler = createClientV1FamiliarAnalyticsGetHandler(
      runtime,
      sources({
        readFamiliarAnalytics: async () => {
          throw new Error("ENOENT: no such file or directory, open '/home/me/.coven/cave/execution-attempts.jsonl'");
        },
      }),
    );
    const response = await handler(
      request("scribe", { authorization: `Bearer ${bearer}` }),
      context("scribe"),
    );
    assert.equal(response.status, 500);
    const body = await response.json() as {
      apiVersion: string;
      error: { code: string; message: string; retryable: boolean; details?: unknown };
    };
    assert.equal(body.error.code, "internal_error");
    assert.equal(body.error.retryable, false);
    assert.equal(body.apiVersion, "1.0");
    assert.equal(body.error.details, undefined);
    assert.equal(body.error.message.includes("/home/me"), false);
  });
});

test("the route refuses every request that does not carry a scoped bearer", async () => {
  await withRuntime(["chat:write"], async (runtime, writeOnlyBearer) => {
    const handler = createClientV1FamiliarAnalyticsGetHandler(runtime, sources());
    assert.equal((await handler(request("scribe"), context("scribe"))).status, 401);
    assert.equal(
      (await handler(
        request("scribe", { authorization: "Bearer not-a-real-bearer" }),
        context("scribe"),
      )).status,
      401,
    );
    assert.equal(
      (await handler(
        request("scribe", { authorization: `Bearer ${writeOnlyBearer}` }),
        context("scribe"),
      )).status,
      403,
    );
    const unstamped = new Request(
      "http://127.0.0.1:3020/api/client/v1/familiars/scribe/analytics",
      { headers: { authorization: `Bearer ${writeOnlyBearer}` } },
    );
    assert.equal((await handler(unstamped, context("scribe"))).status, 401);
  });
});

test("an unauthenticated probe cannot learn whether a familiar exists", async () => {
  let rosterReads = 0;
  let reads = 0;
  await withRuntime(["chat:write"], async (runtime, writeOnlyBearer) => {
    const handler = createClientV1FamiliarAnalyticsGetHandler(
      runtime,
      sources({
        listFamiliars: async () => {
          rosterReads += 1;
          return { ok: true, config: {} as never, target: {} as never, roster: roster("scribe") };
        },
        readFamiliarAnalytics: async (args) => {
          reads += 1;
          return analyticsFor(args);
        },
      }),
    );
    const real = await handler(request("scribe"), context("scribe"));
    const invented = await handler(request("warden"), context("warden"));
    assert.equal(real.status, invented.status);
    assert.deepEqual(await real.json(), await invented.json());
    await handler(request("scribe", { authorization: `Bearer ${writeOnlyBearer}` }), context("scribe"));
    assert.deepEqual({ rosterReads, reads }, { rosterReads: 0, reads: 0 });
  });
});

test("bound analytics reads carry the encoded route and refuse a plaintext downgrade", async () => {
  const root = await mkdtemp(scratchPrefix);
  try {
    await withClientV1HpkeRouteTestAuthority(
      { instanceId: INSTANCE_ID, now: BOUND_NOW, seed: 89 },
      async (authority) => {
        const familiarId = "scribe";
        const encodedPath = `/api/client/v1/familiars/${encodeURIComponent(familiarId)}/analytics`;
        const runtime = createClientV1Runtime({
          authority: authority.runtime,
          credentialRoot: root,
          loopbackSecret: STAMP,
          now: () => BOUND_NOW,
        });
        const issued = await runtime.credentialStore.issue({
          appName: "OpenCoven Chat",
          installationId: "chat-install-bound-analytics",
          scopes: ["chat:read"],
        });
        let reads = 0;
        const handler = createClientV1FamiliarAnalyticsGetHandler(
          runtime,
          sources({
            readFamiliarAnalytics: async (args) => {
              reads += 1;
              return analyticsFor(args);
            },
          }),
        );

        const downgrade = await handler(
          request(familiarId, { authorization: `Bearer ${issued.bearer}` }),
          context(familiarId),
        );
        assert.equal(downgrade.status, 426);
        assert.equal(reads, 0);

        const prepared = await createClientV1HpkeTestClient({
          authority: authority.authority,
          instanceId: INSTANCE_ID,
          runtimeNonce: authority.runtimeNonce,
          operation: "familiars.analytics.read",
          url: `http://127.0.0.1:3020${encodedPath}?window=7d`,
          method: "GET",
          issuedAt: BOUND_NOW,
          requestNonce: new Uint8Array(32).fill(19),
          authorization: { kind: "bearer", value: issued.bearer },
        });
        const headers = new Headers(prepared.request.headers);
        headers.set(LOCAL_PEER_HEADER, STAMP);
        const valid = await handler(new Request(prepared.request, { headers }), context(familiarId));
        assert.equal(valid.status, 200);
        assert.equal(valid.headers.get("content-type"), CLIENT_V1_HPKE_RESPONSE_MEDIA_TYPE);
        const opened = await prepared.open(valid);
        assert.equal(opened.status, 200);
        const body = JSON.parse(new TextDecoder().decode(opened.body)) as AnalyticsBody;
        assert.deepEqual(Object.keys(body.data.analytics.windows), ["7d"]);
        assert.equal(reads, 1);

        // The bound request named `?window=7d`; a query that drifts from what
        // was bound is refused, and the store is not consulted for it.
        const wrongQuery = await handler(
          new Request(`http://127.0.0.1:3020${encodedPath}?window=14d`, { headers }),
          context(familiarId),
        );
        assert.notEqual(wrongQuery.status, 200);
        assert.equal(reads, 1);
      },
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});
