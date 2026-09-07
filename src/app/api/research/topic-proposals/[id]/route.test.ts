import assert from "node:assert/strict";
import { test } from "node:test";

import { TopicDiscoveryStoreError } from "../../../../../lib/server/research-topic-discovery-store.ts";
import { createTopicProposalItemRouteHandlers } from "./route.ts";

function localRequest(): Request {
  return new Request("http://localhost:3000/api/research/topic-proposals/proposal_a", {
    headers: { host: "localhost" },
  });
}

function nonLocalRequest(): Request {
  return new Request("http://example.com/api/research/topic-proposals/proposal_a", {
    headers: { host: "example.com" },
  });
}

const params = { params: Promise.resolve({ id: "proposal_a" }) };
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
  const handlers = createTopicProposalItemRouteHandlers({ enabled: () => false });
  assert.equal((await handlers.GET(localRequest(), params)).status, 404);
});

test("non-local request is rejected with 403", async () => {
  const handlers = createTopicProposalItemRouteHandlers({ enabled: () => true });
  assert.equal((await handlers.GET(nonLocalRequest(), params)).status, 403);
});

test("get returns the proposal", async () => {
  const handlers = createTopicProposalItemRouteHandlers({
    enabled: () => true,
    store: { getProposal: async (id: string) => (id === "proposal_a" ? (PROPOSAL as never) : null) },
  });
  const response = await handlers.GET(localRequest(), params);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.proposal.id, "proposal_a");
});

test("missing proposal maps to 404", async () => {
  const handlers = createTopicProposalItemRouteHandlers({
    enabled: () => true,
    store: { getProposal: async () => null },
  });
  assert.equal((await handlers.GET(localRequest(), params)).status, 404);
});

test("unsafe id maps to 400", async () => {
  const handlers = createTopicProposalItemRouteHandlers({
    enabled: () => true,
    store: {
      getProposal: async () => {
        throw new TopicDiscoveryStoreError("invalid-id", "proposal id must match proposal_…");
      },
    },
  });
  const response = await handlers.GET(localRequest(), params);
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.equal(body.code, "invalid_topic_proposal_id");
});

console.log("research topic-proposals [id] route: ok");
