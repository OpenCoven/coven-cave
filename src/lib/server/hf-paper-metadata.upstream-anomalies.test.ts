// fetchHfPaperMetadata under every upstream anomaly (#6359).
//
// The paper paste must land whether or not Hugging Face is having a good
// minute: the only contract under anomaly is `null` — never a throw — so the
// caller keeps the derived title. The matrix also pins the byte cap (a
// declared or streamed body over 1 MiB is null, not a 1 MiB title in the
// links store) and that nothing is cached: the first call after HF heals is
// live. No credential is involved.
import assert from "node:assert/strict";
import test from "node:test";

import { fetchHfPaperMetadata } from "./hf-paper-metadata.ts";
import { installUpstreamAnomalyFetch } from "../testing/upstream-anomaly-fetch.ts";
import { runUpstreamAnomalyMatrix, type MatrixOutcome } from "../testing/upstream-anomaly-matrix.ts";

const ARXIV_ID = "2401.12345";
const PAYLOAD = {
  id: ARXIV_ID,
  title: "Distributionally Robust Receive Beamforming",
  authors: [{ name: "Shixiong Wang" }, { name: "Wei Dai" }],
  publishedAt: "2024-01-22T20:20:48.000Z",
  summary: "This article investigates signal estimation.",
};

const harness = installUpstreamAnomalyFetch({ install: false });
test.after(() => harness.restore());

harness.healthy("huggingface", (request) => {
  assert.equal(new URL(request.url).pathname, `/api/papers/${ARXIV_ID}`);
  return Response.json(PAYLOAD);
});

const read = () => fetchHfPaperMetadata(ARXIV_ID, { fetchImpl: harness.fetch });

const isNull = (outcome: MatrixOutcome) => {
  assert.equal(outcome.value, null, "a flaky third party must not cost the user their paste");
};

test("fetchHfPaperMetadata across upstream anomalies", async (t) => {
  await runUpstreamAnomalyMatrix(t, {
    harness,
    id: "huggingface",
    invoke: read,
    healthy: (outcome) => {
      assert.deepEqual(outcome.value, {
        title: "Distributionally Robust Receive Beamforming",
        authors: ["Shixiong Wang", "Wei Dai"],
        abstract: "This article investigates signal estimation.",
        publishedAt: "2024-01-22T20:20:48.000Z",
      });
    },
    degraded: { default: isNull },
  });
});

test("the byte cap: a body declared over 1 MiB is refused before it is read", async () => {
  harness.inject("huggingface", {
    kind: "http",
    status: 200,
    body: PAYLOAD,
    headers: { "content-length": String(2 * 1024 * 1024) },
  });
  harness.reset();
  assert.equal(await read(), null);
  assert.equal(harness.calls("huggingface").length, 1);
  harness.heal("huggingface");
});

test("the byte cap: a streamed body that grows past 1 MiB is cancelled and null", async () => {
  harness.inject("huggingface", {
    kind: "http",
    status: 200,
    body: { ...PAYLOAD, title: "x".repeat(2 * 1024 * 1024) },
  });
  harness.reset();
  assert.equal(await read(), null, "an oversized title never reaches the links store");
  harness.heal("huggingface");
  assert.equal((await read())?.title, PAYLOAD.title, "the cap is per call; the next call is live");
});

test("every call carries a deadline", () => {
  for (const call of harness.calls("huggingface")) assert.equal(call.hasDeadline, true);
});
