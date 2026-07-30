// @ts-nocheck
import assert from "node:assert/strict";
import { createServer } from "node:http";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";

const MEMORY_ID = "11111111-1111-5111-8111-111111111111";
const MOBILE_ACCESS_HEADER = "x-coven-cave-mobile-access";
const TEST_ROOT = mkdtempSync(path.join(tmpdir(), "coven-memory-routes-"));
const COVEN_HOME = path.join(TEST_ROOT, "coven");
const CAVE_HOME = path.join(TEST_ROOT, "cave");
const SOCKET_PATH = path.join(TEST_ROOT, "coven.sock");
const CONFIG_PATH = path.join(CAVE_HOME, "config.json");
const ORIGINAL_ENV = {
  COVEN_HOME: process.env.COVEN_HOME,
  COVEN_CAVE_HOME: process.env.COVEN_CAVE_HOME,
  COVEN_SOCKET: process.env.COVEN_SOCKET,
  COVEN_CAVE_AUTH_TOKEN: process.env.COVEN_CAVE_AUTH_TOKEN,
};

mkdirSync(COVEN_HOME, { recursive: true });
mkdirSync(CAVE_HOME, { recursive: true });
process.env.COVEN_HOME = COVEN_HOME;
process.env.COVEN_CAVE_HOME = CAVE_HOME;
process.env.COVEN_SOCKET = SOCKET_PATH;
delete process.env.COVEN_CAVE_AUTH_TOKEN;

const listPayload = [
  {
    id: MEMORY_ID,
    familiar_id: "fixture-familiar",
    title: "fixture-note",
    path: "fixture-familiar/fixture-note.md",
    updated_at: "4m ago",
    updated_at_iso: "2026-07-26T09:56:00Z",
    excerpt: "Synthetic summary.",
    source: { kind: "coven-origin", label: "Coven origin" },
    privacy_classification: null,
    reveal_required: null,
    verification_state: "unknown",
  },
];

const overviewPayload = {
  generated_at: "2026-07-26T10:00:00Z",
  totals: {
    entries: 1,
    familiars: 1,
    verified: 0,
    needs_review: 0,
    unknown: 1,
  },
  last_updated_at: "2026-07-26T09:56:00Z",
  capabilities: {
    detail: true,
    verification: false,
    attestation_metadata: false,
    supersession_history: false,
    mutations: false,
  },
  verification: {
    state: "unavailable",
    checked_at: "2026-07-26T10:00:00Z",
    manifest: null,
    index: null,
    issues: [],
  },
};

const detailPayload = {
  id: MEMORY_ID,
  familiar_id: "fixture-familiar",
  title: "fixture-note",
  updated_at: "2026-07-26T09:56:00Z",
  source: { kind: "coven-origin", label: "Coven origin" },
  content: "Synthetic detail.",
  content_format: "markdown",
  privacy: {
    classification: null,
    reveal_required: null,
    reason: "privacy taxonomy unavailable",
  },
  verification: {
    state: "unknown",
    reason: "verification metadata unavailable",
  },
  attestation: null,
  supersession: {
    supersedes: null,
    superseded_by: null,
  },
};

const socketPaths: string[] = [];
const socketServer = createServer((req, res) => {
  socketPaths.push(req.url ?? "");
  let payload: unknown;
  if (req.method !== "GET") {
    res.writeHead(405, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "method_not_allowed" }));
    return;
  }
  if (req.url === "/api/v1/memory") payload = listPayload;
  else if (req.url === "/api/v1/memory/overview") payload = overviewPayload;
  else if (req.url === `/api/v1/memory/${MEMORY_ID}`) payload = detailPayload;
  else {
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not_found" }));
    return;
  }
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify(payload));
});

await new Promise<void>((resolve, reject) => {
  socketServer.once("error", reject);
  socketServer.listen(SOCKET_PATH, () => {
    socketServer.off("error", reject);
    resolve();
  });
});

function writeMode(mode: "local" | "hub") {
  writeFileSync(
    CONFIG_PATH,
    JSON.stringify({
      multiHost:
        mode === "local"
          ? { mode: "local", hubUrl: "", executorUrls: [] }
          : {
              mode: "hub",
              hubUrl: "https://hub.example",
              executorUrls: [],
            },
    }),
  );
}

writeMode("local");

after(async () => {
  await new Promise<void>((resolve) => {
    socketServer.close(() => resolve());
    socketServer.closeAllConnections();
  });
  for (const [name, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  rmSync(TEST_ROOT, { recursive: true, force: true });
});

function request(
  pathname: string,
  headers: Record<string, string> = {},
): Request {
  return new Request(`http://127.0.0.1:3000${pathname}`, {
    headers: {
      host: "127.0.0.1:3000",
      ...headers,
    },
  });
}

type Route = {
  name: string;
  pathname: string;
  call: (req: Request, id?: string) => Promise<Response>;
};

async function responseJson(response: Response) {
  const body = await response.json();
  assert.equal(
    response.headers.get("cache-control"),
    "private, no-store",
  );
  return body;
}

async function expectDenied(
  route: Route,
  headers: Record<string, string>,
  id = MEMORY_ID,
) {
  const before = socketPaths.length;
  const response = await route.call(request(route.pathname, headers), id);
  assert.equal(response.status, 403, `${route.name} must reject non-local access`);
  assert.deepEqual(await responseJson(response), {
    ok: false,
    code: "local_access_required",
  });
  assert.equal(
    socketPaths.length,
    before,
    `${route.name} denial must happen before a socket read`,
  );
}

async function expectSuccess(
  route: Route,
  headers: Record<string, string> = {},
) {
  const response = await route.call(request(route.pathname, headers));
  assert.equal(response.status, 200, `${route.name} loopback request succeeds`);
  const body = await responseJson(response);
  assert.equal(body.ok, true);
  assert.doesNotMatch(
    JSON.stringify(body),
    /"path"/,
    `${route.name} browser response must not serialize a daemon path`,
  );
  return body;
}

test("mobile canonical-memory routes require a verified mobile request before daemon access", async () => {
  const [listModule, overviewModule, detailModule] = await Promise.all([
    import("../mobile/coven-memory/route.ts"),
    import("../mobile/coven-memory/overview/route.ts"),
    import("../mobile/coven-memory/[id]/route.ts"),
  ]);
  const httpMethods = [
    "GET",
    "POST",
    "PUT",
    "PATCH",
    "DELETE",
    "HEAD",
    "OPTIONS",
  ];
  for (const routeModule of [listModule, overviewModule, detailModule]) {
    assert.equal(routeModule.dynamic, "force-dynamic");
    assert.equal(routeModule.runtime, "nodejs");
    assert.deepEqual(
      Object.keys(routeModule)
        .filter((name) => httpMethods.includes(name))
        .sort(),
      ["GET", "HEAD", "OPTIONS", "POST"],
    );
  }

  const routes: Route[] = [
    {
      name: "mobile list",
      pathname: "/api/mobile/coven-memory",
      call: (req) => listModule.GET(req),
    },
    {
      name: "mobile overview",
      pathname: "/api/mobile/coven-memory/overview",
      call: (req) => overviewModule.GET(req),
    },
    {
      name: "mobile detail",
      pathname: `/api/mobile/coven-memory/${MEMORY_ID}`,
      call: (req, id = MEMORY_ID) =>
        detailModule.GET(req, { params: Promise.resolve({ id }) }),
    },
  ];

  let before = socketPaths.length;
  for (const route of routes) {
    const response = await route.call(request(route.pathname));
    assert.equal(
      response.status,
      401,
      `${route.name} must require verified mobile access`,
    );
    assert.deepEqual(await responseJson(response), {
      ok: false,
      code: "mobile_access_required",
    });
  }
  assert.equal(
    socketPaths.length,
    before,
    "unstamped mobile requests must perform zero daemon reads",
  );

  before = socketPaths.length;
  // Direct route tests run below `proxy.ts`, so they intentionally set its
  // trusted marker. `project-permission-routes.test.ts` pins spoof resistance.
  const [listBody, overviewBody, detailBody] = await Promise.all(
    routes.map((route) =>
      expectSuccess(route, { [MOBILE_ACCESS_HEADER]: "1" }),
    ),
  );
  assert.deepEqual(socketPaths.slice(before).sort(), [
    "/api/v1/memory",
    `/api/v1/memory/${MEMORY_ID}`,
    "/api/v1/memory/overview",
  ].sort());
  assert.deepEqual(listBody.entries[0].source, {
    kind: "coven-origin",
    label: "Coven origin",
  });
  assert.equal(overviewBody.overview.totals.entries, 1);
  assert.equal(detailBody.entry.id, MEMORY_ID);

  before = socketPaths.length;
  for (const [routeModule, pathname] of [
    [listModule, "/api/mobile/coven-memory"],
    [overviewModule, "/api/mobile/coven-memory/overview"],
    [detailModule, `/api/mobile/coven-memory/${MEMORY_ID}`],
  ] as const) {
    for (const method of ["POST", "HEAD", "OPTIONS"] as const) {
      const response = await routeModule[method](request(pathname));
      assert.equal(response.status, 405, `${method} ${pathname} must be rejected`);
      assert.equal(response.headers.get("allow"), "GET");
      assert.deepEqual(await responseJson(response), {
        ok: false,
        code: "method_not_allowed",
      });
    }
  }
  assert.equal(
    socketPaths.length,
    before,
    "mobile read-only route rejection must perform zero daemon reads",
  );
});

test("all canonical-memory routes enforce the local boundary before config or transport", async () => {
  const listModule = await import("./route.ts");
  const firstSocketCount = socketPaths.length;
  const firstDenied = await listModule.GET(
    request("/api/coven-memory", {
      [MOBILE_ACCESS_HEADER]: "1",
    }),
  );
  assert.equal(firstDenied.status, 403);
  assert.deepEqual(await responseJson(firstDenied), {
    ok: false,
    code: "local_access_required",
  });
  assert.equal(socketPaths.length, firstSocketCount);

  const [overviewModule, detailModule] = await Promise.all([
    import("./overview/route.ts"),
    import("./[id]/route.ts"),
  ]);
  const httpMethods = ["GET", "POST", "PUT", "PATCH", "DELETE"];
  for (const routeModule of [listModule, overviewModule, detailModule]) {
    assert.equal(routeModule.dynamic, "force-dynamic");
    assert.equal(routeModule.runtime, "nodejs");
    assert.deepEqual(
      Object.keys(routeModule)
        .filter((name) => httpMethods.includes(name))
        .sort(),
      ["GET", "POST"],
    );
  }

  rmSync(CONFIG_PATH, { force: true });
  try {
    for (const [routeModule, pathname] of [
      [listModule, "/api/coven-memory"],
      [overviewModule, "/api/coven-memory/overview"],
      [detailModule, `/api/coven-memory/${MEMORY_ID}`],
    ] as const) {
      const before = socketPaths.length;
      const response = await routeModule.POST(request(pathname));
      assert.equal(response.status, 405);
      assert.equal(response.headers.get("allow"), "GET");
      assert.deepEqual(await responseJson(response), {
        ok: false,
        code: "method_not_allowed",
      });
      assert.equal(
        socketPaths.length,
        before,
        "read-only route rejection must perform zero local daemon reads",
      );
    }
  } finally {
    writeMode("local");
  }

  const routes: Route[] = [
    {
      name: "list",
      pathname: "/api/coven-memory",
      call: (req) => listModule.GET(req),
    },
    {
      name: "overview",
      pathname: "/api/coven-memory/overview",
      call: (req) => overviewModule.GET(req),
    },
    {
      name: "detail",
      pathname: `/api/coven-memory/${MEMORY_ID}`,
      call: (req, id = MEMORY_ID) =>
        detailModule.GET(req, { params: Promise.resolve({ id }) }),
    },
  ];

  for (const route of routes) {
    await expectDenied(route, { [MOBILE_ACCESS_HEADER]: "1" });
  }
  await expectDenied(
    routes[2],
    { [MOBILE_ACCESS_HEADER]: "1" },
    "../fixture-note.md",
  );

  for (const route of routes) {
    await expectDenied(route, { host: "cave.example.ts.net:8443" });
    await expectDenied(route, { origin: "https://forged.example" });
  }

  process.env.COVEN_CAVE_AUTH_TOKEN = "sidecar-secret";
  for (const route of routes) {
    await expectDenied(route, {});
    await expectDenied(route, { "x-coven-cave-token": "wrong" });
  }

  let before = socketPaths.length;
  for (const route of routes) {
    await expectSuccess(route, {
      "x-coven-cave-token": "sidecar-secret",
    });
  }
  assert.deepEqual(socketPaths.slice(before), [
    "/api/v1/memory",
    "/api/v1/memory/overview",
    `/api/v1/memory/${MEMORY_ID}`,
  ]);

  delete process.env.COVEN_CAVE_AUTH_TOKEN;
  before = socketPaths.length;
  const [listBody, overviewBody, detailBody] = await Promise.all(
    routes.map((route) => expectSuccess(route)),
  );
  assert.deepEqual(socketPaths.slice(before).sort(), [
    "/api/v1/memory",
    `/api/v1/memory/${MEMORY_ID}`,
    "/api/v1/memory/overview",
  ].sort());
  assert.deepEqual(listBody.entries[0].source, {
    kind: "coven-origin",
    label: "Coven origin",
  });
  assert.equal(overviewBody.overview.totals.entries, 1);
  assert.equal(detailBody.entry.id, MEMORY_ID);

  writeMode("hub");
  before = socketPaths.length;
  for (const route of routes) {
    const response = await route.call(request(route.pathname));
    assert.equal(response.status, 409);
    assert.deepEqual(await responseJson(response), {
      ok: false,
      code: "local_daemon_required",
    });
  }
  assert.equal(
    socketPaths.length,
    before,
    "hub-selected requests perform zero local daemon reads",
  );
});
