import assert from "node:assert/strict";
import { test } from "node:test";

import { TopicDiscoveryRunnerError } from "../../../../../../lib/server/research-topic-discovery-runner.ts";
import { createTopicJobCancelRouteHandlers } from "./route.ts";

function localRequest(): Request {
  return new Request("http://localhost:3000/api/research/topic-jobs/topicjob_a/cancel", {
    method: "POST",
    headers: { host: "localhost" },
  });
}

function nonLocalRequest(): Request {
  return new Request("http://example.com/api/research/topic-jobs/topicjob_a/cancel", {
    method: "POST",
    headers: { host: "example.com" },
  });
}

const params = { params: Promise.resolve({ id: "topicjob_a" }) };

test("flag-off returns not-found", async () => {
  const handlers = createTopicJobCancelRouteHandlers({ enabled: () => false });
  assert.equal((await handlers.POST(localRequest(), params)).status, 404);
});

test("non-local request is rejected with 403", async () => {
  const handlers = createTopicJobCancelRouteHandlers({ enabled: () => true });
  assert.equal((await handlers.POST(nonLocalRequest(), params)).status, 403);
});

test("cancel returns the cancelled job", async () => {
  const handlers = createTopicJobCancelRouteHandlers({
    enabled: () => true,
    runner: {
      cancelJob: async () => ({
        schema: "opencoven.topic-discovery-job/v1",
        id: "topicjob_a",
        contextPackId: "ctx_a",
        contextPackDigest: "a".repeat(64),
        familiarId: "charm",
        status: "cancelled",
        requestedAt: "2026-08-28T10:00:00.000Z",
        finishedAt: "2026-08-28T10:02:00.000Z",
        proposalIds: [],
      }),
    },
  });
  const response = await handlers.POST(localRequest(), params);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.job.status, "cancelled");
});

test("cancelling a terminal job maps to 409", async () => {
  const handlers = createTopicJobCancelRouteHandlers({
    enabled: () => true,
    runner: {
      cancelJob: async () => {
        throw new TopicDiscoveryRunnerError("job_not_cancellable", "job topicjob_a is completed");
      },
    },
  });
  const response = await handlers.POST(localRequest(), params);
  assert.equal(response.status, 409);
  const body = await response.json();
  assert.equal(body.code, "job_not_cancellable");
});

test("a missing job maps to 404", async () => {
  const handlers = createTopicJobCancelRouteHandlers({
    enabled: () => true,
    runner: {
      cancelJob: async () => {
        throw new TopicDiscoveryRunnerError("job_not_found", "job not found");
      },
    },
  });
  assert.equal((await handlers.POST(localRequest(), params)).status, 404);
});

console.log("research topic-jobs [id]/cancel route: ok");
