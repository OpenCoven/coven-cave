import assert from "node:assert/strict";
import { test } from "node:test";

import { ContextPackStoreError } from "../../../../lib/server/research-context-pack-store.ts";
import { TopicDiscoveryRunnerError } from "../../../../lib/server/research-topic-discovery-runner.ts";
import { createTopicJobsRouteHandlers } from "./route.ts";

function localRequest(method = "GET", body?: unknown): Request {
  return new Request("http://localhost:3000/api/research/topic-jobs", {
    method,
    headers: { host: "localhost", "content-type": "application/json" },
    ...(body === undefined ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }),
  });
}

function nonLocalRequest(method = "GET"): Request {
  return new Request("http://example.com/api/research/topic-jobs", {
    method,
    headers: { host: "example.com", "content-type": "application/json" },
  });
}

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

test("flag-off returns not-found for GET and POST", async () => {
  const handlers = createTopicJobsRouteHandlers({ enabled: () => false });
  assert.equal((await handlers.GET(localRequest())).status, 404);
  assert.equal((await handlers.POST(localRequest("POST", { contextPackId: "ctx_a", familiarId: "charm" }))).status, 404);
});

test("non-local requests are rejected with 403", async () => {
  const handlers = createTopicJobsRouteHandlers({ enabled: () => true });
  assert.equal((await handlers.GET(nonLocalRequest())).status, 403);
  assert.equal((await handlers.POST(nonLocalRequest("POST"))).status, 403);
});

test("list returns jobs", async () => {
  const handlers = createTopicJobsRouteHandlers({
    enabled: () => true,
    store: { listJobs: async () => [JOB as never] },
  });
  const response = await handlers.GET(localRequest());
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.jobs.length, 1);
  assert.equal(body.jobs[0].id, "topicjob_a");
});

test("create delegates to the runner and returns the terminal job", async () => {
  const handlers = createTopicJobsRouteHandlers({
    enabled: () => true,
    runner: {
      createJob: async () => ({ job: { ...JOB, status: "completed", finishedAt: "2026-08-28T10:02:00.000Z", proposalIds: ["proposal_a", "proposal_b", "proposal_c"] } as never, proposals: [] }),
    },
  });
  const response = await handlers.POST(localRequest("POST", { contextPackId: "ctx_a", familiarId: "charm" }));
  assert.equal(response.status, 201);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.job.status, "completed");
});

test("malformed JSON is guarded by readJsonBody", async () => {
  const handlers = createTopicJobsRouteHandlers({ enabled: () => true });
  const response = await handlers.POST(localRequest("POST", "not json"));
  assert.equal(response.status, 400);
});

test("create over a missing pack maps to 404", async () => {
  const handlers = createTopicJobsRouteHandlers({
    enabled: () => true,
    runner: {
      createJob: async () => {
        throw new ContextPackStoreError("missing", "pack ctx_a is missing");
      },
    },
  });
  const response = await handlers.POST(localRequest("POST", { contextPackId: "ctx_a", familiarId: "charm" }));
  assert.equal(response.status, 404);
  const body = await response.json();
  assert.equal(body.code, "context_pack_not_found");
});

test("create with a forbidden purpose maps to 409", async () => {
  const handlers = createTopicJobsRouteHandlers({
    enabled: () => true,
    runner: {
      createJob: async () => {
        throw new TopicDiscoveryRunnerError("purpose_not_allowed", "pack ctx_a does not allow topic-discovery");
      },
    },
  });
  const response = await handlers.POST(localRequest("POST", { contextPackId: "ctx_a", familiarId: "charm" }));
  assert.equal(response.status, 409);
  const body = await response.json();
  assert.equal(body.code, "purpose_not_allowed");
});

console.log("research topic-jobs route: ok");
