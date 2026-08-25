// @ts-nocheck
/**
 * HTTP behaviour of GET /api/familiars/[id]/dashboard.
 *
 * These drive the exported handler with injected dependencies and read the real
 * Response — status, headers and parsed body. Nothing here inspects the route's
 * source text: a route can contain every right word and still answer 200 to a
 * traversal id, which is the failure mode this file exists to rule out.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { createFamiliarDashboardGetHandler, GET } from "./route.ts";
import { FAMILIAR_DASHBOARD_LIMITS } from "@/lib/familiar-dashboard";

const CONFIG = {
  version: 1,
  defaults: { harness: "claude", model: "claude-sonnet" },
  familiars: { sage: { harness: "codex", model: "gpt-5.3" } },
  roles: [],
  marketplace: { installed: {} },
  multiHost: { mode: "local", hubUrl: "", executorUrls: [] },
  omnigent: {
    enabled: false,
    baseUrl: "",
    defaultAgentId: "",
    defaultHostId: "",
    defaultWorkspace: "",
    hostMap: {},
    hostWorkspaceMap: {},
    exposeHostsInComposer: false,
  },
  remoteHosts: [],
};

function dependencies(overrides = {}, spy) {
  const track = (name, fn) => async (...args) => {
    spy?.push(name);
    return fn(...args);
  };
  return {
    loadRoster: track("loadRoster", async () => ({
      ok: true,
      config: CONFIG,
      target: {},
      roster: [{ id: "sage", display_name: "Sage", role: "Researcher", status: "online" }],
    })),
    loadConfig: track("loadConfig", async () => CONFIG),
    resolveAvatar: track("resolveAvatar", async () => null),
    loadSessions: track("loadSessions", async () => ({ sessions: [], degraded: false })),
    loadTasks: track("loadTasks", async () => []),
    loadReminders: track("loadReminders", async () => []),
    loadMemory: track("loadMemory", async () => []),
    loadContract: track("loadContract", async () => ({
      properties: [{ property: "Named Identity", pass: true }],
      violations: [],
      warnings: [],
    })),
    loadSelfReports: track("loadSelfReports", async () => ({ reports: [], total: 0 })),
    ...overrides,
  };
}

function call(id, { query = "", overrides = {}, spy } = {}) {
  const handler = createFamiliarDashboardGetHandler(dependencies(overrides, spy));
  return handler(
    new Request(`http://127.0.0.1/api/familiars/${id}/dashboard${query}`, {
      headers: { host: "127.0.0.1" },
    }),
    { params: Promise.resolve({ id }) },
  );
}

// --- refusals ---------------------------------------------------------------

test("an id that is not a valid familiar slug is refused 403 before anything is read", async () => {
  for (const bad of ["../../etc/passwd", "a/b", "..", "sage/../moss", "with space", ""]) {
    const spy = [];
    const response = await call(encodeURIComponent(bad), { spy });
    // `params` is what the handler actually reads, so pass the raw value there.
    const direct = await createFamiliarDashboardGetHandler(dependencies({}, spy))(
      new Request("http://127.0.0.1/api/familiars/x/dashboard", { headers: { host: "127.0.0.1" } }),
      { params: Promise.resolve({ id: bad }) },
    );

    assert.equal(direct.status, 403, `${JSON.stringify(bad)} must be refused, not served`);
    const body = await direct.json();
    assert.equal(body.ok, false);
    assert.equal(
      body.error,
      "path not allowed",
      "the wording matches every sibling /api/familiars/[id]/ route",
    );
    assert.equal(body.code, "invalid_familiar_id");
    assert.deepEqual(
      spy,
      [],
      `${JSON.stringify(bad)} reached a data source before the guard settled`,
    );
    void response;
  }
});

test("a well-formed id naming no familiar is 404, and a daemon outage is 503", async () => {
  const notFound = await call("ghost");
  assert.equal(notFound.status, 404);
  const notFoundBody = await notFound.json();
  assert.equal(notFoundBody.ok, false);
  assert.equal(notFoundBody.code, "familiar_not_found");

  const outage = await call("sage", {
    overrides: {
      loadRoster: async () => {
        throw new Error("connect ENOENT /Users/buns/.coven/daemon.sock");
      },
    },
  });
  assert.equal(
    outage.status,
    503,
    "an unreadable roster must not answer 404 — that would tell a client its familiar was deleted",
  );
  const outageBody = await outage.json();
  assert.equal(outageBody.code, "dashboard_unavailable");
  assert.equal(
    JSON.stringify(outageBody).includes("daemon.sock"),
    false,
    "the refusal body must not carry the underlying error",
  );
});

// --- versioning -------------------------------------------------------------

test("the version parameter is honoured, and an unservable version is refused", async () => {
  const explicit = await call("sage", { query: "?v=1" });
  assert.equal(explicit.status, 200);
  assert.equal((await explicit.json()).version, 1);

  const implicit = await call("sage");
  assert.equal(implicit.status, 200, "an unversioned client is still served");
  assert.equal(
    (await implicit.json()).version,
    1,
    "and the response states which version it is",
  );

  for (const bad of ["2", "0", "abc", "1.0"]) {
    const response = await call("sage", { query: `?v=${bad}` });
    assert.equal(response.status, 400, `v=${bad} must be refused, not silently answered as v1`);
    assert.equal((await response.json()).code, "unsupported_version");
  }
});

// --- the success path -------------------------------------------------------

test("a known familiar returns 200 with identity and all three sections", async () => {
  const response = await call("sage", { query: "?v=1" });
  assert.equal(response.status, 200);
  assert.equal(
    response.headers.get("cache-control"),
    "no-store",
    "a live operational read must not be cached by an intermediary",
  );

  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.familiarId, "sage");
  assert.equal(body.identity.displayName, "Sage");
  assert.deepEqual(Object.keys(body.sections).sort(), ["analytics", "overview", "profile"]);
  for (const [name, section] of Object.entries(body.sections)) {
    assert.ok(
      ["fresh", "partial", "empty", "unavailable"].includes(section.state),
      `${name} reported the non-server state ${section.state}`,
    );
    assert.notEqual(section.state, "stale", `${name} emitted the client-only state`);
    assert.equal(
      section.data === null,
      section.state === "unavailable",
      `${name} broke the data-null/unavailable correspondence over the wire`,
    );
  }
});

test("a failing source still returns 200 — the section carries the bad news, not the status", async () => {
  const response = await call("sage", {
    overrides: {
      loadSessions: async () => {
        throw new Error("daemon unreachable at /var/run/coven.sock");
      },
    },
  });

  assert.equal(
    response.status,
    200,
    "one degraded section must not turn a usable dashboard into an error",
  );
  const body = await response.json();
  assert.equal(body.sections.overview.state, "partial");
  assert.ok(
    body.sections.overview.issues.some((issue) => issue.code === "sessions_unavailable"),
  );
  assert.equal(
    JSON.stringify(body).includes("/var/run/coven.sock"),
    false,
    "the socket path must not cross the API boundary",
  );
});

test("an oversized source cannot push the response past the published budget", async () => {
  const response = await call("sage", {
    overrides: {
      loadSessions: async () => ({
        sessions: Array.from({ length: 8_000 }, (_, index) => ({
          id: `s${index}`,
          title: "T".repeat(2_000),
          status: "running",
          updated_at: "2026-08-23T10:00:00.000Z",
        })),
        degraded: false,
      }),
    },
  });

  assert.equal(response.status, 200);
  const text = await response.text();
  assert.ok(
    new TextEncoder().encode(text).byteLength <= FAMILIAR_DASHBOARD_LIMITS.responseBytes,
    `the served body was ${new TextEncoder().encode(text).byteLength} bytes, over budget`,
  );
  const body = JSON.parse(text);
  assert.equal(
    body.sections.overview.data.sessions.active.total,
    8_000,
    "the cap still reports the true total",
  );
});

test("the module's exported GET is the same handler Next.js will serve", () => {
  assert.equal(typeof GET, "function");
  assert.equal(GET.length, 2, "GET takes (request, ctx) as the App Router calls it");
});

console.log("familiars/[id]/dashboard route.test.ts: ok");
