import assert from "node:assert/strict";
import { test } from "node:test";

import { TopicDiscoveryStoreError } from "../../../../../lib/server/research-topic-discovery-store.ts";
import { createTopicJobItemRouteHandlers } from "./route.ts";

function localRequest(): Request {
  return new Request("http://localhost:3000/api/research/topic-jobs/topicjob_a", {
    headers: { host: "localhost" },
  });
}

function nonLocalRequest(): Request {
  return new Request("http://example.com/api/research/topic-jobs/topicjob_a", {
    headers: { host: "example.com" },
  });
}

const params = { params: Promise.resolve({ id: "topicjob_a" }) };
const JOB = {
  schema: "opencoven.topic-discovery-job/v1",
  id: "topicjob_a",
  contextPackId: "ctx_a",
  contextPackDigest: "a".repeat(64),
  familiarId: "charm",
  status: "queued",
  requestedAt: "2026-08-28T10:00:00.000Z",
  proposalIds: [],
};

test("flag-off returns not-found", async () => {
  const handlers = createTopicJobItemRouteHandlers({ enabled: () => false });
  const response = await handlers.GET(localRequest(), params);
  assert.equal(response.status, 404);
});

test("non-local request is rejected with 403", async () => {
  const handlers = createTopicJobItemRouteHandlers({ enabled: () => true });
  assert.equal((await handlers.GET(nonLocalRequest(), params)).status, 403);
});

test("get returns the job", async () => {
  const handlers = createTopicJobItemRouteHandlers({
    enabled: () => true,
    store: { getJob: async (id: string) => (id === "topicjob_a" ? (JOB as never) : null) },
  });
  const response = await handlers.GET(localRequest(), params);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.job.id, "topicjob_a");
});

test("missing job maps to 404", async () => {
  const handlers = createTopicJobItemRouteHandlers({
    enabled: () => true,
    store: { getJob: async () => null },
  });
  assert.equal((await handlers.GET(localRequest(), params)).status, 404);
});

test("unsafe id maps to 400", async () => {
  const handlers = createTopicJobItemRouteHandlers({
    enabled: () => true,
    store: {
      getJob: async () => {
        throw new TopicDiscoveryStoreError("invalid-id", "job id must match topicjob_…");
      },
    },
  });
  const response = await handlers.GET(localRequest(), params);
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.equal(body.code, "invalid_topic_job_id");
});

console.log("research topic-jobs [id] route: ok");
