import assert from "node:assert/strict";
import { test } from "node:test";

import { TopicDiscoveryStoreError } from "../../../../lib/server/research-topic-discovery-store.ts";
import { createTopicProposalsRouteHandlers } from "./route.ts";

function localRequest(url = "http://localhost:3000/api/research/topic-proposals?jobId=topicjob_a"): Request {
  return new Request(url, { headers: { host: "localhost" } });
}

function nonLocalRequest(): Request {
  return new Request("http://example.com/api/research/topic-proposals?jobId=topicjob_a", {
    headers: { host: "example.com" },
  });
}

const PROPOSAL = {
  schema: "opencoven.topic-proposal/v1",
  id: "proposal_a",
  discoveryJobId: "topicjob_a",
  contextPackId: "ctx_a",
  title: "T",
  question: "Q?",
  whyNow: "now",
  evidence: [{ resourceId: "resource_a", selector: { type: "whole-resource" }, excerpt: "x", excerptDigest: "a".repeat(64) }],
  counterevidence: [],
  scores: { groundability: 2, decisionValue: 2, unresolvedness: 2, recurrence: 2, novelty: 2, timeliness: 2, familiarFit: 2, feasibility: 2, humanResonance: 2, riskPenalty: 0, visibleTotal: 2 },
  suggested: { mode: "brief", deliverable: "r", sourceTarget: 3, wallClockMinutes: 30 },
  uncertainty: "low",
  relatedMissionIds: [],
  createdAt: "2026-08-28T10:00:00.000Z",
};

test("flag-off returns not-found", async () => {
  const handlers = createTopicProposalsRouteHandlers({ enabled: () => false });
  assert.equal((await handlers.GET(localRequest())).status, 404);
});

test("non-local request is rejected with 403", async () => {
  const handlers = createTopicProposalsRouteHandlers({ enabled: () => true });
  assert.equal((await handlers.GET(nonLocalRequest())).status, 403);
});

test("lists proposals for the job", async () => {
  const handlers = createTopicProposalsRouteHandlers({
    enabled: () => true,
    store: { listProposals: async (jobId?: string) => (jobId === "topicjob_a" ? [PROPOSAL as never] : []) },
  });
  const response = await handlers.GET(localRequest());
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.proposals.length, 1);
  assert.equal(body.proposals[0].id, "proposal_a");
});

test("missing jobId maps to 400", async () => {
  const handlers = createTopicProposalsRouteHandlers({ enabled: () => true });
  const response = await handlers.GET(localRequest("http://localhost:3000/api/research/topic-proposals"));
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.equal(body.code, "invalid_topic_job_id");
});

test("invalid jobId maps to 400", async () => {
  const handlers = createTopicProposalsRouteHandlers({
    enabled: () => true,
    store: {
      listProposals: async () => {
        throw new TopicDiscoveryStoreError("invalid-id", "job id must match topicjob_…");
      },
    },
  });
  const response = await handlers.GET(localRequest());
  assert.equal(response.status, 400);
});

console.log("research topic-proposals route: ok");
