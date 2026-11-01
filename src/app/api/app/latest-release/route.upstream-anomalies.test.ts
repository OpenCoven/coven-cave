// GET /api/app/latest-release under every upstream anomaly (#6359).
//
// This route fails soft by design — the update banner must never appear
// because GitHub had a bad minute — so the contract under anomaly is "no
// update, with an error field" rather than an error status. The matrix adds
// the self-healing half: a failed check is never cached, so the next call
// after GitHub recovers goes to GitHub, while a good answer is held for the
// ten-minute window to stay inside the unauthenticated budget.
import assert from "node:assert/strict";
import test from "node:test";

import { installUpstreamAnomalyFetch } from "../../../../lib/testing/upstream-anomaly-fetch.ts";
import { runUpstreamAnomalyMatrix, type MatrixOutcome } from "../../../../lib/testing/upstream-anomaly-matrix.ts";

const TTL_MS = 10 * 60 * 1000;
let now = Date.UTC(2026, 0, 1);
const realNow = Date.now;
Date.now = () => now;

const harness = installUpstreamAnomalyFetch();
const { GET } = await import("./route.ts");
test.after(() => {
  harness.restore();
  Date.now = realNow;
});

harness.healthy("github", (request) => {
  assert.equal(new URL(request.url).pathname, "/repos/OpenCoven/coven-cave/releases/latest");
  return Response.json({
    tag_name: "v99.0.0",
    html_url: "https://github.com/OpenCoven/coven-cave/releases/tag/v99.0.0",
    body: "Release notes",
    assets: [],
  });
});

const stepPastCache = () => {
  now += TTL_MS + 1;
};

const failSoft = (outcome: MatrixOutcome) => {
  assert.equal(outcome.status, 200, "the check fails soft");
  const body = outcome.body as { available: boolean; latest: string | null; error?: string; current: string };
  assert.equal(body.available, false, "a degraded check never announces an update");
  assert.equal(body.latest, null);
  assert.equal(typeof body.error, "string", "the degraded answer says why");
  assert.equal(typeof body.current, "string");
};

test("GET /api/app/latest-release across upstream anomalies", async (t) => {
  await runUpstreamAnomalyMatrix(t, {
    harness,
    id: "github",
    beforeEach: stepPastCache,
    invoke: () => GET(),
    healthy: (outcome) => {
      assert.equal(outcome.status, 200);
      const body = outcome.body as { latest: string | null; available: boolean; notes?: string; error?: string };
      assert.equal(body.latest, "99.0.0");
      assert.equal(body.available, true);
      assert.equal(body.notes, "Release notes");
      assert.equal(body.error, undefined);
    },
    degraded: {
      default: failSoft,
      "schema-drift": (outcome) => {
        // A well-formed body without a tag is "no release", not an error.
        assert.equal(outcome.status, 200);
        const body = outcome.body as { available: boolean; latest: string | null };
        assert.equal(body.available, false);
        assert.equal(body.latest, null);
      },
    },
  });
});

test("a failed check is not cached: the next call after GitHub heals is live, no clock needed", async () => {
  stepPastCache();
  harness.inject("github", { kind: "http", status: 503 });
  harness.reset();
  const degraded = await (await GET()).json();
  assert.equal(degraded.available, false);
  assert.equal(harness.calls("github").length, 1);

  harness.heal("github");
  harness.reset();
  const healed = await (await GET()).json();
  assert.equal(healed.latest, "99.0.0");
  assert.equal(harness.calls("github").length, 1, "the healed call reached GitHub at once");

  harness.reset();
  await GET();
  assert.equal(harness.calls("github").length, 0, "a good answer is then served from the window");
});

test("the release check carries a deadline", async () => {
  stepPastCache();
  harness.reset();
  await GET();
  const call = harness.calls("github").at(-1);
  assert.ok(call, "the call past the window reached GitHub");
  assert.equal(call.hasDeadline, true);
});
