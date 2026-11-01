// GET /api/github/repos under every upstream anomaly (#6359).
//
// Two upstream calls side by side, each with its own deadline: the org's
// repositories over REST and the curated star list over GraphQL. The route
// fails soft by design — a Home feed must never 500 because GitHub had a bad
// minute — so every anomaly is a 200 with no items, `incomplete: true`, and
// one plain-language error per source. Good answers are held for fifteen
// minutes; the clock is stubbed and stepped past that window before every
// call, and a separate test proves a degraded answer is never the one held.
import assert from "node:assert/strict";
import test from "node:test";

import { installUpstreamAnomalyFetch, type UpstreamHandler } from "../../../../lib/testing/upstream-anomaly-fetch.ts";
import { runUpstreamAnomalyMatrix, type DegradedExpectation } from "../../../../lib/testing/upstream-anomaly-matrix.ts";
import { isolateCaveHome } from "../../../../lib/testing/scratch-cave-home.ts";

const home = isolateCaveHome("github-repos-anomalies");
const TOKEN = "ghp_testonly_never_dispatched_repos_0123456789";
delete process.env.GITHUB_PAT;
process.env.GITHUB_TOKEN = TOKEN;

const TTL_MS = 15 * 60 * 1000;
let now = Date.UTC(2026, 0, 1);
const realNow = Date.now;
Date.now = () => now;
const stepPastCache = () => {
  now += TTL_MS + 1;
};

const harness = installUpstreamAnomalyFetch();
const { GET } = await import("./route.ts");
test.after(() => {
  harness.restore();
  Date.now = realNow;
  home.cleanup();
});

const github = (failing: { path: string; status: number } | null = null): UpstreamHandler => async (request) => {
  const url = new URL(request.url);
  assert.equal(request.headers.get("authorization"), `Bearer ${TOKEN}`, "the token travels as a bearer");
  if (failing && url.pathname === failing.path) {
    return Response.json({ message: "forced" }, { status: failing.status });
  }
  if (url.pathname === "/orgs/OpenCoven/repos") {
    assert.equal(url.searchParams.get("type"), "public");
    return Response.json([
      {
        id: 1,
        name: "coven-cave",
        full_name: "OpenCoven/coven-cave",
        owner: { login: "OpenCoven" },
        description: "The Cave",
        stargazers_count: 12,
        language: "TypeScript",
        html_url: "https://github.com/OpenCoven/coven-cave",
        pushed_at: "2026-10-31T00:00:00Z",
      },
    ]);
  }
  if (url.pathname === "/graphql") {
    assert.equal(request.method, "POST");
    const body = (await request.json()) as { query: string };
    assert.match(body.query, /user\(login: "BunsDev"\)/);
    return Response.json({
      data: {
        user: {
          lists: {
            nodes: [
              {
                slug: "opencoven-openclaw",
                items: {
                  nodes: [
                    {
                      __typename: "Repository",
                      nameWithOwner: "someone/starred-tool",
                      name: "starred-tool",
                      owner: { login: "someone" },
                      description: "A starred tool",
                      stargazerCount: 99,
                      primaryLanguage: { name: "Rust" },
                      url: "https://github.com/someone/starred-tool",
                      pushedAt: "2026-10-30T00:00:00Z",
                    },
                    { __typename: "Repository", nameWithOwner: "OpenCoven/coven-cave", name: "coven-cave", owner: { login: "OpenCoven" }, url: "https://github.com/OpenCoven/coven-cave" },
                  ],
                  pageInfo: { hasNextPage: false },
                },
              },
            ],
          },
        },
      },
    });
  }
  return Response.json({ message: "Not Found" }, { status: 404 });
};
harness.healthy("github", github());

const read = () => GET(new Request("http://localhost/api/github/repos"));

type ReposBody = {
  ok: boolean;
  items: Array<{ fullName: string }>;
  configured: boolean;
  incomplete: boolean;
  errors: string[];
  scope: { hasMore: boolean };
};

/** Fail-soft: 200, no items, incomplete, and one reason per source. */
const failSoft = (orgError: string, listError: string): DegradedExpectation => (outcome) => {
  assert.equal(outcome.status, 200, "the feed fails soft");
  const body = outcome.body as ReposBody;
  assert.equal(body.ok, true);
  assert.equal(body.configured, true);
  assert.deepEqual(body.items, []);
  assert.equal(body.incomplete, true);
  assert.deepEqual(body.errors, [orgError, listError]);
};

const unreachable = failSoft(
  "Couldn't reach GitHub for OpenCoven repositories.",
  "Couldn't reach GitHub for the curated repository list.",
);

test("GET /api/github/repos across upstream anomalies", async (t) => {
  await runUpstreamAnomalyMatrix(t, {
    harness,
    id: "github",
    secrets: [TOKEN],
    beforeEach: stepPastCache,
    invoke: read,
    healthy: (outcome) => {
      assert.equal(outcome.status, 200, outcome.text);
      const body = outcome.body as ReposBody;
      assert.equal(body.ok, true);
      assert.equal(body.configured, true);
      assert.equal(body.incomplete, false);
      assert.deepEqual(body.errors, []);
      assert.deepEqual(
        body.items.map((item) => item.fullName),
        ["OpenCoven/coven-cave", "someone/starred-tool"],
        "org repos lead and the star list is deduped against them",
      );
    },
    degraded: {
      "http-500": failSoft("Couldn't load OpenCoven repositories (500).", "Couldn't load the curated repository list (500)."),
      "http-502": failSoft("Couldn't load OpenCoven repositories (502).", "Couldn't load the curated repository list (502)."),
      "auth-revoked": failSoft("GitHub rejected the configured token.", "GitHub rejected the configured token."),
      "rate-limit": failSoft(
        "GitHub rate limit reached. Try again in 7 seconds.",
        "GitHub rate limit reached. Try again in 7 seconds.",
      ),
      timeout: unreachable,
      network: unreachable,
      // A torn or empty 200 body throws inside the same catch as a dead socket.
      "malformed-json": unreachable,
      "empty-body": unreachable,
      "schema-drift": failSoft(
        "GitHub returned an invalid OpenCoven repository response.",
        "GitHub didn't return the curated repository list.",
      ),
    },
  });
});

test("a degraded answer is never held: the next call after GitHub heals is live, no clock needed", async () => {
  stepPastCache();
  harness.inject("github", { kind: "http", status: 503, body: { message: "down" } });
  harness.reset();
  assert.equal(((await (await read()).json()) as ReposBody).incomplete, true);
  assert.equal(harness.calls("github").length, 2);

  harness.heal("github");
  harness.reset();
  assert.equal(((await (await read()).json()) as ReposBody).incomplete, false);
  assert.equal(harness.calls("github").length, 2, "the healed call reached both sources at once");

  harness.reset();
  assert.equal(((await (await read()).json()) as ReposBody).items.length, 2);
  assert.equal(harness.calls("github").length, 0, "a good answer is then served from the window");

  harness.reset();
  await GET(new Request("http://localhost/api/github/repos?refresh"));
  assert.equal(harness.calls("github").length, 2, "?refresh bypasses the window");
});

test("a star-list outage keeps the org repositories and says what is missing", async () => {
  stepPastCache();
  harness.healthy("github", github({ path: "/graphql", status: 500 }));
  const body = (await (await read()).json()) as ReposBody;
  assert.equal(body.ok, true);
  assert.deepEqual(body.items.map((item) => item.fullName), ["OpenCoven/coven-cave"]);
  assert.equal(body.incomplete, true);
  assert.deepEqual(body.errors, ["Couldn't load the curated repository list (500)."]);
  harness.healthy("github", github());
});

test("both sources carry a deadline", async () => {
  stepPastCache();
  harness.reset();
  await read();
  const calls = harness.calls("github");
  assert.equal(calls.length, 2);
  for (const call of calls) assert.equal(call.hasDeadline, true, `${call.url} is bounded`);
});

test("without a token the feed answers unconfigured without touching GitHub", async () => {
  delete process.env.GITHUB_TOKEN;
  harness.reset();
  try {
    const body = (await (await read()).json()) as ReposBody & { source: string };
    assert.equal(body.configured, false);
    assert.equal(body.source, "unconfigured");
    assert.equal(harness.calls().length, 0);
  } finally {
    process.env.GITHUB_TOKEN = TOKEN;
  }
});
