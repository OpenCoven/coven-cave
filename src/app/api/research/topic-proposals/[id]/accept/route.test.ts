import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { TopicDiscoveryStoreError } from "../../../../../../lib/server/research-topic-discovery-store.ts";
import { createTopicProposalAcceptRouteHandlers } from "./route.ts";

function localRequest(): Request {
  return new Request("http://localhost:3000/api/research/topic-proposals/proposal_a/accept", {
    method: "POST",
    headers: { host: "localhost" },
  });
}

function nonLocalRequest(): Request {
  return new Request("http://example.com/api/research/topic-proposals/proposal_a/accept", {
    method: "POST",
    headers: { host: "example.com" },
  });
}

const params = { params: Promise.resolve({ id: "proposal_a" }) };

const PROPOSAL = {
  schema: "opencoven.topic-proposal/v1",
  id: "proposal_a",
  discoveryJobId: "topicjob_a",
  contextPackId: "ctx_a",
  title: "A topic",
  question: "A question?",
  whyNow: "now",
  evidence: [{ resourceId: "resource_a", selector: { type: "whole-resource" }, excerpt: "x", excerptDigest: "a".repeat(64) }],
  counterevidence: [],
  scores: { groundability: 2, decisionValue: 2, unresolvedness: 2, recurrence: 2, novelty: 2, timeliness: 2, familiarFit: 2, feasibility: 2, humanResonance: 2, riskPenalty: 0, visibleTotal: 2 },
  suggested: { mode: "sweep", deliverable: "a report", sourceTarget: 8, wallClockMinutes: 45 },
  uncertainty: "low",
  relatedMissionIds: ["mission_mission-1", "mission_unresolvable!"],
  createdAt: "2026-08-28T10:00:00.000Z",
};

const JOB = {
  schema: "opencoven.topic-discovery-job/v1",
  id: "topicjob_a",
  contextPackId: "ctx_a",
  contextPackDigest: "b".repeat(64),
  familiarId: "charm",
  status: "completed",
  requestedAt: "2026-08-28T10:00:00.000Z",
  finishedAt: "2026-08-28T10:02:00.000Z",
  proposalIds: ["proposal_a", "proposal_b", "proposal_c"],
};

test("flag-off returns not-found", async () => {
  const handlers = createTopicProposalAcceptRouteHandlers({ enabled: () => false });
  assert.equal((await handlers.POST(localRequest(), params)).status, 404);
});

test("non-local request is rejected with 403", async () => {
  const handlers = createTopicProposalAcceptRouteHandlers({ enabled: () => true });
  assert.equal((await handlers.POST(nonLocalRequest(), params)).status, 403);
});

test("accept returns a draft with portable mission ids resolved to local ids", async () => {
  const handlers = createTopicProposalAcceptRouteHandlers({
    enabled: () => true,
    store: {
      getProposal: async () => PROPOSAL as never,
      getJob: async () => JOB as never,
    },
  });
  const response = await handlers.POST(localRequest(), params);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.draft.proposalId, "proposal_a");
  assert.equal(body.draft.contextPackDigest, "b".repeat(64));
  assert.equal(body.draft.mode, "sweep");
  assert.deepEqual(body.draft.relatedMissionIds, ["mission-1"]);
});

test("accept is idempotent and does not create a mission", async () => {
  const handlers = createTopicProposalAcceptRouteHandlers({
    enabled: () => true,
    store: {
      getProposal: async () => PROPOSAL as never,
      getJob: async () => JOB as never,
    },
  });
  const first = await handlers.POST(localRequest(), params);
  const second = await handlers.POST(localRequest(), params);
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.deepEqual(await first.json(), await second.json());

  // Structural proof: the accept route source never imports a mission writer.
  const source = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "route.ts"), "utf8");
  assert.ok(!source.includes("createResearchMission"), "accept must not create a mission");
  assert.ok(!source.includes("saveResearchMission"), "accept must not save a mission");
});

test("missing proposal maps to 404", async () => {
  const handlers = createTopicProposalAcceptRouteHandlers({
    enabled: () => true,
    store: { getProposal: async () => null, getJob: async () => null },
  });
  assert.equal((await handlers.POST(localRequest(), params)).status, 404);
});

test("unsafe id maps to 400", async () => {
  const handlers = createTopicProposalAcceptRouteHandlers({
    enabled: () => true,
    store: {
      getProposal: async () => {
        throw new TopicDiscoveryStoreError("invalid-id", "proposal id must match proposal_…");
      },
      getJob: async () => null,
    },
  });
  const response = await handlers.POST(localRequest(), params);
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.equal(body.code, "invalid_topic_proposal_id");
});

console.log("research topic-proposals [id]/accept route: ok");
