import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { parseReadinessComments } from "../../../../components/role-surfaces/use-pr-readiness.ts";

const home = mkdtempSync(join(tmpdir(), "cave-review-evidence-"));
process.env.COVEN_HOME = home;
process.env.COVEN_CAVE_HOME = join(home, "cave");
process.env.GITHUB_PAT = "test-only-never-dispatched";
const { GET } = await import("./route.ts");
test.after(() => rmSync(home, { recursive: true, force: true }));

const completeThreads = {
  data: { repository: { pullRequest: {
    reviewThreads: { nodes: [], pageInfo: { hasNextPage: false } },
  } } },
};

function upstream(t: TestContext, threads: () => Response, reviews = () => Response.json([])) {
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    const url = String(input);
    if (url === "https://api.github.com/graphql") return threads();
    if (url.includes("/pulls/7/reviews?")) return reviews();
    if (url.includes("/issues/7/comments?")) return Response.json([]);
    throw new Error(`Unexpected upstream request: ${url}`);
  });
}

const read = () => GET(new Request("http://localhost/api/github/comments?repo=o/r&number=7&isPull=1"));

test("a failed GraphQL thread read cannot masquerade as an empty reviewed conversation", async (t) => {
  upstream(t, () => Response.json({ message: "Forbidden" }, { status: 403 }));
  const response = await read();
  const body = await response.json();
  assert.equal(response.status, 200, "the readable conversation remains available");
  assert.equal(body.reviewEvidenceComplete, false);
  assert.match(body.reviewEvidenceError, /thread/i);
  assert.throws(() => parseReadinessComments(body), /thread/i);
});

test("genuinely empty review evidence is complete and accepted", async (t) => {
  upstream(t, () => Response.json(completeThreads));
  const body = await (await read()).json();
  assert.equal(body.reviewEvidenceComplete, true);
  assert.equal(body.reviewEvidenceError, null);
  assert.deepEqual(parseReadinessComments(body).reviewThreads, []);
});

test("GraphQL partial errors, missing pagination, and malformed state cannot grant completeness", async (t) => {
  let payload: unknown = { ...completeThreads, errors: [{ message: "Field unavailable" }] };
  upstream(t, () => Response.json(payload));
  const payloads = [
    payload,
    { data: { repository: { pullRequest: { reviewThreads: { nodes: [] } } } } },
    { data: { repository: { pullRequest: { reviewThreads: {
      nodes: [{ id: "t1", isResolved: null, isOutdated: false, comments: { nodes: [] } }],
      pageInfo: { hasNextPage: false },
    } } } } },
  ];
  for (payload of payloads) {
    const body = await (await read()).json();
    assert.equal(body.reviewEvidenceComplete, false);
    assert.throws(() => parseReadinessComments(body));
  }
});

test("bounded thread and review windows explicitly remain incomplete", async (t) => {
  let hasNextPage = true;
  upstream(t, () => Response.json({
    data: { repository: { pullRequest: {
      reviewThreads: { nodes: [], pageInfo: { hasNextPage } },
    } } },
  }), () => Response.json([], {
    headers: hasNextPage ? {} : { link: '<https://api.github.com/repos/o/r/pulls/7/reviews?page=2>; rel="next"' },
  }));
  for (hasNextPage of [true, false]) {
    const body = await (await read()).json();
    assert.equal(body.reviewEvidenceComplete, false);
    assert.throws(() => parseReadinessComments(body));
  }
});

test("a failed review-summary read also blocks readiness without losing the timeline", async (t) => {
  upstream(t, () => Response.json(completeThreads),
    () => Response.json({ message: "Unavailable" }, { status: 503 }));
  const body = await (await read()).json();
  assert.equal(body.ok, true);
  assert.equal(body.reviewEvidenceComplete, false);
  assert.throws(() => parseReadinessComments(body));
});
