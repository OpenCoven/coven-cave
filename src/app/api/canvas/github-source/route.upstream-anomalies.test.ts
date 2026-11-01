// POST /api/canvas/github-source under every upstream anomaly (#6359).
//
// The importer asks GitHub's contents endpoint for the raw file and treats
// the body as text, never JSON, so the three "unreadable body" anomalies
// split: an empty body is "that file is empty" (422), while a torn or
// drifted JSON body is simply a file whose content happens to be JSON. A
// non-2xx keeps GitHub's status with a plain-English reason, a stalled
// socket is caught by the route's own 12 s deadline, and a dead network is
// a 502. The local-origin guard runs before any of it.
import assert from "node:assert/strict";
import test from "node:test";

import { installUpstreamAnomalyFetch } from "../../../../lib/testing/upstream-anomaly-fetch.ts";
import { expectErrorStatus, runUpstreamAnomalyMatrix, type MatrixOutcome } from "../../../../lib/testing/upstream-anomaly-matrix.ts";
import { isolateCaveHome } from "../../../../lib/testing/scratch-cave-home.ts";

const home = isolateCaveHome("canvas-github-source-anomalies");
const TOKEN = "ghp_testonly_never_dispatched_0123456789abcdef";
process.env.GITHUB_PAT = TOKEN;
delete process.env.COVEN_CAVE_AUTH_TOKEN;

const harness = installUpstreamAnomalyFetch();
const { POST } = await import("./route.ts");
test.after(() => {
  harness.restore();
  home.cleanup();
});

const CODE = "export default function Page() {\n  return <main>Hello</main>;\n}\n";

harness.healthy("github", (request) => {
  const url = new URL(request.url);
  assert.equal(request.headers.get("authorization"), `Bearer ${TOKEN}`);
  assert.equal(request.headers.get("accept"), "application/vnd.github.raw+json");
  if (request.method === "GET" && url.pathname === "/repos/o/r/contents/app/page.tsx" && url.searchParams.get("ref") === "main") {
    return new Response(CODE, { status: 200, headers: { "content-type": "application/vnd.github.raw+json" } });
  }
  return Response.json({ message: "Not Found" }, { status: 404 });
});

const importFile = (url = "https://github.com/o/r/blob/main/app/page.tsx") =>
  POST(
    new Request("http://localhost/api/canvas/github-source", {
      method: "POST",
      headers: { "content-type": "application/json", host: "localhost" },
      body: JSON.stringify({ url }),
    }),
  );

const refusedWith = (status: number, error: RegExp) => (outcome: MatrixOutcome) => {
  expectErrorStatus(status)(outcome, { kind: "http", status });
  assert.match((outcome.body as { error: string }).error, error);
};

/** The body is a file, whatever it looks like. */
const importedAsText = (expected: string) => (outcome: MatrixOutcome) => {
  assert.equal(outcome.status, 200, outcome.text);
  const body = outcome.body as { ok: boolean; code: string; kind: string };
  assert.equal(body.ok, true);
  assert.equal(body.code, expected);
  assert.equal(body.kind, "html");
};

test("POST /api/canvas/github-source across upstream anomalies", async (t) => {
  await runUpstreamAnomalyMatrix(t, {
    harness,
    id: "github",
    secrets: [TOKEN],
    invoke: () => importFile(),
    healthy: (outcome) => {
      assert.equal(outcome.status, 200, outcome.text);
      const body = outcome.body as { ok: boolean; code: string; kind: string; title: string; source: Record<string, unknown> };
      assert.equal(body.ok, true);
      assert.equal(body.code, CODE);
      assert.equal(body.kind, "react");
      assert.equal(body.title, "page");
      assert.equal(body.source.kind, "github");
      assert.equal(body.source.filePath, "app/page.tsx");
      assert.equal(body.source.ref, "main");
      assert.match(String(body.source.projectFileHash), /^[0-9a-f]{64}$/);
    },
    degraded: {
      // A non-2xx keeps GitHub's own status.
      "http-500": refusedWith(500, /couldn't load that file \(500\)/),
      "http-502": refusedWith(502, /couldn't load that file \(502\)/),
      "auth-revoked": refusedWith(401, /denied access/),
      "rate-limit": refusedWith(429, /couldn't load that file \(429\)/),
      timeout: refusedWith(502, /took too long/),
      network: refusedWith(502, /Couldn't reach GitHub/),
      // Raw content: a JSON-looking body is just a file's text.
      "malformed-json": importedAsText('{"data":[{"id":1,"name":"trunc'),
      "empty-body": refusedWith(422, /file is empty/),
      "schema-drift": (outcome) => {
        assert.equal(outcome.status, 200);
        const body = outcome.body as { ok: boolean; code: string };
        assert.equal(body.ok, true);
        assert.equal(JSON.parse(body.code).unexpected, true, "the drifted body is imported verbatim as the file");
      },
    },
  });
});

test("a 404 is 'not found or private' with GitHub's status", async () => {
  harness.inject("github", { kind: "http", status: 404, body: { message: "Not Found" } });
  const response = await importFile();
  assert.equal(response.status, 404);
  assert.match((await response.json()).error, /couldn't find that file or the repository is private/);
  harness.heal("github");
});

test("a non-local origin is refused before GitHub is contacted", async () => {
  harness.reset();
  const response = await POST(
    new Request("http://cave.example.ts.net/api/canvas/github-source", {
      method: "POST",
      headers: { "content-type": "application/json", host: "cave.example.ts.net" },
      body: JSON.stringify({ url: "https://github.com/o/r/blob/main/app/page.tsx" }),
    }),
  );
  assert.equal(response.status, 403);
  assert.equal(harness.calls().length, 0);
});

test("without a token the read is anonymous and still works", async () => {
  delete process.env.GITHUB_PAT;
  harness.healthy("github", (request) => {
    assert.equal(request.headers.get("authorization"), null);
    return new Response("<main>hi</main>", { status: 200 });
  });
  try {
    const body = await (await importFile()).json();
    assert.equal(body.ok, true);
    assert.equal(body.kind, "html");
  } finally {
    process.env.GITHUB_PAT = TOKEN;
  }
});

test("the contents read carries a deadline", async () => {
  const call = harness.calls("github").at(-1);
  assert.ok(call);
  assert.equal(call.hasDeadline, true, "the importer bounds the read with AbortSignal.timeout");
});
